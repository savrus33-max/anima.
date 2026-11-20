"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bookmark, Check, CheckCheck, ImagePlus, LogOut, Palette, Save, Sparkles, Trash2, UserRound } from "lucide-react";
import { useApp } from "./app-context";
import { api, errorMessage } from "@/lib/client";
import { Avatar, EmptyState, Loading, AnimeCard } from "./ui";
import AvatarCrop from "./avatar-crop";
import type { Anime, Profile } from "@/lib/types";
type LibraryItem={animeId:number;anime:Anime;status:string};

export function ProfileView() {
 const {user,loadingUser,openAuth,setUser,notify,saved}=useApp();
 const [name,setName]=useState(""),[bio,setBio]=useState(""),[avatar,setAvatar]=useState(""),[accent,setAccent]=useState("lime"),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [cropSrc,setCropSrc]=useState(""),[cropName,setCropName]=useState("");
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(user){setName(user.name);setBio(user.bio);setAvatar(user.avatar);setAccent(user.accent);}},[user]);
 if(loadingUser)return <Loading/>;
 if(!user)return <EmptyState icon={<UserRound size={32}/>} title="Твоя личная вселенная" action={<button className="button button-primary" onClick={openAuth}>Создать профиль <Sparkles size={17}/></button>}>Загрузи своё фото, укрась профиль и собирай любимые истории. Для этого нужен аккаунт.</EmptyState>;

 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError("");try{const result=await api<{user:Profile}>("profile",{name,bio,avatar,accent},"PATCH");setUser(result.user);notify("Профиль сохранён. Выглядишь потрясающе! ✨");}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 function pickFile(file?:File){
  if(!file)return;
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)){setError("Выбери изображение JPG, PNG или WebP");return;}
  if(file.size>5*1024*1024){setError("Изображение должно быть меньше 5 МБ");return;}
  setCropSrc(URL.createObjectURL(file));setCropName(file.name);setError("");
 }
 function closeCrop(){if(cropSrc)URL.revokeObjectURL(cropSrc);setCropSrc("");setCropName("");}
 const colors:Record<string,string>={lime:"#c5f563",purple:"#b6a0ff",pink:"#ffa6cb",blue:"#91d5ff"};
 return <section className="profile-view" style={{"--profile-accent":colors[accent]} as React.CSSProperties}>
  <div className="page-intro"><div><div className="eyebrow">МАЛЕНЬКАЯ ВСЕЛЕННАЯ БОЛЬШОГО ФАНАТА</div><h1>Мой профиль<span className="lime">.</span></h1><p>Это место — совсем как ты. Только в аниме.</p></div><button className="button button-secondary" onClick={async()=>{try{await api("auth/logout",{});setUser(null);notify("До новой серии! Ты вышел из аккаунта.");}catch(e){notify(errorMessage(e));}}}><LogOut size={16}/> Выйти</button></div>
  <div className="profile-cover"><div className="profile-cover-lines"/><span>わたしの物語</span><Sparkles size={40}/></div>
  <div className="profile-heading"><Avatar value={avatar} size={98} label={name||user.name}/><div><h2>{name||user.name}</h2><p>{bio}</p><span className="profile-role"><Sparkles size={11}/> Главный герой</span></div><div className="profile-stat"><strong>{saved.size}</strong><span>в коллекции</span></div></div>
  <form onSubmit={save} className="profile-settings">
   <section className="settings-panel"><h3><UserRound size={19}/> О тебе</h3><div className="stack-form"><label>Имя в сообществе<input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={30} required/></label><label>Пара слов о себе<textarea value={bio} onChange={e=>setBio(e.target.value)} maxLength={200} rows={3} placeholder="Какое аниме изменило твою жизнь?"/></label><label>Почта<input value={user.email} disabled/></label><small className="muted">Почта подтверждена <CheckCheck size={13} className="inline-icon"/></small></div></section>
   <section className="settings-panel"><h3><Palette size={19}/> Сделай по-своему</h3>
    <label className="field-label">Твоё фото в круге</label>
    <div className="avatar-upload-row"><Avatar value={avatar} size={62} label={name||user.name}/><div className="avatar-upload-copy"><button type="button" className="button button-secondary" onClick={()=>input.current?.click()}><ImagePlus size={16}/> {avatar?"Заменить фото":"Загрузить фото"}</button><small className="field-help">JPG, PNG или WebP · до 5 МБ · кропишь круг сам</small></div></div>
    {avatar&&<button type="button" className="text-button avatar-remove" onClick={()=>setAvatar("")}><Trash2 size={13}/> Убрать фото</button>}
    <input type="file" accept="image/png,image/jpeg,image/webp" ref={input} onChange={e=>{pickFile(e.target.files?.[0]);e.target.value="";}} className="visually-hidden"/>
    <label className="field-label theme-label">Настроение профиля</label>
    <div className="theme-picker">{Object.entries(colors).map(([key,color])=><button type="button" aria-label={`Тема ${key}`} className={accent===key?"selected":""} key={key} style={{background:color}} onClick={()=>setAccent(key)}>{accent===key&&<Check size={18}/>}</button>)}</div>
   </section>
   {error&&<div className="form-error">{error}</div>}
   <div className="settings-save"><span className="muted">Красивый профиль — начало красивой истории.</span><button type="submit" className="button button-primary" disabled={busy}><Save size={17}/>{busy?"Сохраняем…":"Сохранить изменения"}</button></div>
  </form>
  {cropSrc&&<AvatarCrop src={cropSrc} fileName={cropName} onCancel={closeCrop} onPickAnother={()=>{closeCrop();input.current?.click();}} onConfirm={url=>{setAvatar(url);closeCrop();notify("Фото обрезано — теперь оно в твоём круге ✦");}}/>}
 </section>;
}

export function LibraryView() {
 const {user,loadingUser,openAuth,saved,notify}=useApp();
 const [items,setItems]=useState<LibraryItem[]|null>(null),[tab,setTab]=useState("all"),[error,setError]=useState("");
 useEffect(()=>{if(user)api<{items:LibraryItem[]}>("library").then(r=>setItems(r.items)).catch(e=>setError(errorMessage(e)));else setItems(null);},[user,saved.size]);
 if(loadingUser)return <Loading/>;
 if(!user)return <EmptyState icon={<Bookmark size={30}/>} title="Всё любимое — в одном месте" action={<button className="button button-primary" onClick={openAuth}>Войти и собрать коллекцию</button>}>Сохраняй аниме на потом, отмечай просмотренное и не теряй хорошие истории.</EmptyState>;
 const visible=items?.filter(i=>tab==="all"||i.status===tab);
 return <section><div className="page-intro"><div><div className="eyebrow">ТОЛЬКО ТО, ЧТО ТЕБЕ БЛИЗКО</div><h1>Моя коллекция<span className="lime">.</span></h1><p>Истории, к которым хочется вернуться.</p></div><span className="outline-tag"><Bookmark size={16}/>{items?.length||0} аниме</span></div><div className="section-tabs library-tabs">{[["all","Все аниме"],["planned","Буду смотреть"],["watching","Смотрю"],["completed","Просмотрено"]].map(([id,title])=><button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}>{title}</button>)}</div>{error?<p className="form-error">{error}</p>:!items?<Loading/>:visible?.length?<div className="anime-grid">{visible.map(item=><div key={item.animeId}><AnimeCard anime={item.anime}/><select className="library-status" aria-label="Статус просмотра" value={item.status} onChange={async e=>{const status=e.target.value;try{await api("library",{animeId:item.animeId,status});setItems(items.map(i=>i.animeId===item.animeId?{...i,status}:i));notify("Статус просмотра обновлён");}catch(e){notify(errorMessage(e));}}}><option value="planned">Буду смотреть</option><option value="watching">Смотрю</option><option value="completed">Просмотрено</option></select></div>)}</div>:<EmptyState icon={<Bookmark size={28}/>} title="Здесь скоро будет твоя история">Нажми на закладку у понравившегося аниме в каталоге — оно появится здесь.</EmptyState>}</section>;
}
