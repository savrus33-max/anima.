import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomInt, randomUUID } from "crypto";
import { and, eq, desc, gt, count } from "drizzle-orm";
import { db } from "@/db";
import { users, verificationCodes, sessions, library, rooms, roomMembers, messages } from "@/db/schema";
import { checkPassword, createSession, digest, getUser, hashPassword, publicUser } from "@/lib/auth";
import { findAnime } from "@/lib/catalog";

export const dynamic = "force-dynamic";
class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
const response = (data: unknown, status=200) => NextResponse.json(data, {status, headers:{"Cache-Control":"no-store"}});
const str = (v: unknown, max=200) => typeof v === "string" ? v.trim().slice(0,max) : "";
const activeSince = () => new Date(Date.now()-45000);
async function requireUser() { const user=await getUser(); if(!user) throw new ApiError("Сначала войдите в аккаунт",401); return user; }
async function handle(request: NextRequest, method: string, path: string[]) {
  const endpoint=path.join("/");
  if(method!=="GET") {
    const origin=request.headers.get("origin");
    if(origin && new URL(origin).host!==request.headers.get("host") && new URL(origin).host!==request.headers.get("x-forwarded-host")) throw new ApiError("Запрос отклонён",403);
  }
  const body=method!=="GET" ? await request.json().catch(()=>({})) : {};
  if(endpoint==="auth/me" && method==="GET") return response({user:await getUser()});
  if(endpoint==="auth/register" && method==="POST") {
    const email=str(body.email).toLowerCase(), name=str(body.name,30), password=typeof body.password==="string" ? body.password : "";
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("Проверьте адрес электронной почты");
    if(name.length<2) throw new ApiError("Имя должно содержать от 2 до 30 символов");
    if(password.length<8 || password.length>128) throw new ApiError("Пароль должен содержать от 8 до 128 символов");
    const [existing]=await db.select().from(users).where(eq(users.email,email)).limit(1);
    if(existing?.verified) throw new ApiError("Эта почта уже зарегистрирована. Войдите в аккаунт.",409);
    const [previous]=await db.select().from(verificationCodes).where(eq(verificationCodes.email,email)).limit(1);
    if(previous && previous.expiresAt.getTime()>Date.now()+9*60000) throw new ApiError("Подождите минуту перед повторной отправкой кода",429);
    const passwordHash=hashPassword(password);
    if(existing) await db.update(users).set({name,passwordHash}).where(eq(users.id,existing.id));
    else await db.insert(users).values({id:randomUUID(),email,name,passwordHash});
    const code=String(randomInt(100000,1000000));
    await db.insert(verificationCodes).values({email,codeHash:digest(code),expiresAt:new Date(Date.now()+10*60000),attempts:0}).onConflictDoUpdate({target:verificationCodes.email,set:{codeHash:digest(code),expiresAt:new Date(Date.now()+10*60000),attempts:0}});
    if(process.env.RESEND_API_KEY) {
      const sent=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.RESEND_FROM || "Anima <onboarding@resend.dev>",to:[email],subject:"Твой код входа в Anima",html:`<div style="font-family:Arial;background:#141614;color:#fff;padding:40px"><h1 style="color:#c3f45c">anima.</h1><p>Подтверди свою почту, чтобы начать новую историю.</p><h2 style="letter-spacing:8px">${code}</h2><p>Код действует 10 минут. Если это были не вы, проигнорируйте письмо.</p></div>`}),signal:AbortSignal.timeout(15000)});
      if(!sent.ok) {await db.delete(verificationCodes).where(eq(verificationCodes.email,email)); throw new ApiError("Почтовый сервис пока не может отправить письмо. Попробуйте позже.",503);}
      return response({sent:true,demo:false});
    }
    return response({sent:false,demo:true,demoCode:code,notice:"Деморежим: почтовый сервис не подключён. Используйте код ниже."});
  }
  if(endpoint==="auth/verify" && method==="POST") {
    const email=str(body.email).toLowerCase();
    const [entry]=await db.select().from(verificationCodes).where(eq(verificationCodes.email,email)).limit(1);
    if(!entry || entry.expiresAt<new Date()) throw new ApiError("Код истёк. Отправьте новый код.");
    if(entry.attempts>=5) throw new ApiError("Слишком много попыток. Запросите новый код.",429);
    if(entry.codeHash!==digest(str(body.code,6))) {await db.update(verificationCodes).set({attempts:entry.attempts+1}).where(eq(verificationCodes.email,email)); throw new ApiError("Неверный код. Попробуйте ещё раз.");}
    const [user]=await db.update(users).set({verified:true}).where(eq(users.email,email)).returning();
    await db.delete(verificationCodes).where(eq(verificationCodes.email,email));
    await createSession(user.id);
    return response({user:publicUser(user)});
  }
  if(endpoint==="auth/login" && method==="POST") {
    const [user]=await db.select().from(users).where(eq(users.email,str(body.email).toLowerCase())).limit(1);
    if(!user || typeof body.password!=="string" || body.password.length>128 || !checkPassword(body.password,user.passwordHash)) throw new ApiError("Неверная почта или пароль",401);
    if(!user.verified) throw new ApiError("Сначала подтвердите почту через форму регистрации",403);
    await createSession(user.id);
    return response({user:publicUser(user)});
  }
  if(endpoint==="auth/logout" && method==="POST") {
    const token=(await cookies()).get("anima_session")?.value;
    if(token) await db.delete(sessions).where(eq(sessions.token,digest(token)));
    (await cookies()).delete("anima_session");
    return response({ok:true});
  }
  if(endpoint==="profile" && method==="PATCH") {
    const user=await requireUser();
    const name=str(body.name,30), bio=str(body.bio,200), avatar=str(body.avatar,500000), accent=str(body.accent,20);
    if(name.length<2) throw new ApiError("Имя должно содержать хотя бы 2 символа");
    // Empty means "letter mark"; preset keys are kept only so older accounts
    // still validate. New uploads are always a cropped data URL.
    const isLegacyPreset=["moon","fox","cat","sakura","oni","star"].includes(avatar);
    const isCustomImage=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar);
    if(avatar!=="" && !isLegacyPreset && !isCustomImage) throw new ApiError("Выберите фото в формате PNG, JPG или WebP (до 5 МБ)");
    if(!["lime","purple","pink","blue"].includes(accent)) throw new ApiError("Неизвестная тема профиля");
    const [updated]=await db.update(users).set({name,bio,avatar,accent}).where(eq(users.id,user.id)).returning();
    return response({user:publicUser(updated)});
  }
  if(endpoint==="library") {
    const user=await requireUser();
    if(method==="GET") return response({items:await db.select().from(library).where(eq(library.userId,user.id)).orderBy(desc(library.createdAt))});
    if(method==="POST") {
      const anime=await findAnime(Number(body.animeId));
      if(!anime) throw new ApiError("Аниме не найдено",404);
      const where=and(eq(library.userId,user.id),eq(library.animeId,anime.id));
      const [existing]=await db.select().from(library).where(where).limit(1);
      if(existing && body.toggle) {await db.delete(library).where(where); return response({saved:false});}
      const status=["planned","watching","completed"].includes(body.status) ? body.status : "planned";
      await db.insert(library).values({userId:user.id,animeId:anime.id,anime,status}).onConflictDoUpdate({target:[library.userId,library.animeId],set:{status}});
      return response({saved:true,status});
    }
  }
  if(endpoint==="rooms" && method==="GET") {
    const result=await db.select({room:rooms,host:users.name}).from(rooms).innerJoin(users,eq(rooms.hostId,users.id)).where(eq(rooms.isPrivate,false)).orderBy(desc(rooms.createdAt)).limit(30);
    const counts=await db.select({roomId:roomMembers.roomId,total:count()}).from(roomMembers).where(gt(roomMembers.lastSeen,activeSince())).groupBy(roomMembers.roomId);
    return response({rooms:result.map(({room,host})=>({...room,host,members:counts.find(c=>c.roomId===room.id)?.total || 0}))});
  }
  if(endpoint==="rooms" && method==="POST") {
    const user=await requireUser();
    const name=str(body.name,60);
    if(name.length<3) throw new ApiError("Название комнаты — от 3 до 60 символов");
    const anime=await findAnime(Number(body.animeId));
    if(!anime) throw new ApiError("Выберите аниме из каталога");
    const owned=await db.select({total:count()}).from(rooms).where(eq(rooms.hostId,user.id));
    if(owned[0].total>=10) throw new ApiError("Можно создать не более 10 комнат");
    const id=randomUUID().slice(0,8);
    const [room]=await db.insert(rooms).values({id,name,hostId:user.id,anime,isPrivate:!!body.isPrivate}).returning();
    await db.insert(roomMembers).values({roomId:id,userId:user.id});
    return response({room:{...room,members:1}},201);
  }
  if(path[0]==="rooms" && path[1]) {
    const user=await requireUser(), id=path[1];
    const [room]=await db.select().from(rooms).where(eq(rooms.id,id)).limit(1);
    if(!room) throw new ApiError("Комната не найдена",404);
    if(method==="GET" || (method==="POST" && body.action==="join")) {
      await db.transaction(async tx=>{
        await tx.select({id:rooms.id}).from(rooms).where(eq(rooms.id,id)).for("update");
        const [self]=await tx.select().from(roomMembers).where(and(eq(roomMembers.roomId,id),eq(roomMembers.userId,user.id))).limit(1);
        const [members]=await tx.select({total:count()}).from(roomMembers).where(and(eq(roomMembers.roomId,id),gt(roomMembers.lastSeen,activeSince())));
        if(members.total>=50 && (!self || self.lastSeen<activeSince())) throw new ApiError("В комнате уже 50 человек. Попробуйте позже.",409);
        await tx.insert(roomMembers).values({roomId:id,userId:user.id,lastSeen:new Date()}).onConflictDoUpdate({target:[roomMembers.roomId,roomMembers.userId],set:{lastSeen:new Date()}});
      });
      const members=await db.select({id:users.id,name:users.name,avatar:users.avatar}).from(roomMembers).innerJoin(users,eq(users.id,roomMembers.userId)).where(and(eq(roomMembers.roomId,id),gt(roomMembers.lastSeen,activeSince())));
      const chat=await db.select({id:messages.id,content:messages.content,createdAt:messages.createdAt,name:users.name,avatar:users.avatar}).from(messages).innerJoin(users,eq(users.id,messages.userId)).where(eq(messages.roomId,id)).orderBy(desc(messages.createdAt)).limit(80);
      return response({room:{...room,members:members.length},members,messages:chat.reverse(),serverTime:Date.now()});
    }
    const [member]=await db.select().from(roomMembers).where(and(eq(roomMembers.roomId,id),eq(roomMembers.userId,user.id))).limit(1);
    if(!member) throw new ApiError("Сначала присоединитесь к комнате",403);
    if(method==="POST" && body.action==="chat") {
      const content=str(body.content,500); if(!content) throw new ApiError("Напишите сообщение");
      const [recent]=await db.select().from(messages).where(and(eq(messages.userId,user.id),gt(messages.createdAt,new Date(Date.now()-800)))).limit(1);
      if(recent) throw new ApiError("Не отправляйте сообщения слишком часто",429);
      await db.insert(messages).values({id:randomUUID(),roomId:id,userId:user.id,content});
      return response({ok:true});
    }
    if(method==="POST" && body.action==="sync") {
      if(room.hostId!==user.id) throw new ApiError("Плеером управляет ведущий комнаты",403);
      await db.update(rooms).set({playing:!!body.playing,position:Math.max(0,Math.min(86400,Math.floor(Number(body.position)||0))),episode:Math.max(1,Math.min(2000,Math.floor(Number(body.episode)||1))),updatedAt:new Date()}).where(eq(rooms.id,id));
      return response({ok:true});
    }
    if(method==="POST" && body.action==="leave") {
      await db.delete(roomMembers).where(and(eq(roomMembers.roomId,id),eq(roomMembers.userId,user.id)));
      return response({ok:true});
    }
  }
  throw new ApiError("Не найдено",404);
}
async function route(request: NextRequest) {
  try { return await handle(request,request.method,(request.nextUrl.searchParams.get("path") || "").split("/")); }
  catch(error) {
    if(error instanceof ApiError) return response({error:error.message},error.status);
    console.error("API error:",error);
    return response({error:"Не удалось выполнить запрос. Попробуйте ещё раз."},500);
  }
}
export { route as GET, route as POST, route as PATCH };
