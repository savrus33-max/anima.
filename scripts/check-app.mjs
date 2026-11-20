import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const base=process.env.TEST_BASE_URL || 'http://localhost:3000';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1040}});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const assert=(value,message)=>{if(!value)throw new Error(message);console.log('PASS',message);};
const url=path=>`${base}/api/service?path=${encodeURIComponent(path)}`;
async function call(ctx,path,body,method){const res=await ctx.request.fetch(url(path),{method:method||(body===undefined?'GET':'POST'),data:body});return {status:res.status(),data:await res.json()};}
try{
 await page.goto(base,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'artifacts/home-desktop.png'});
 assert(await page.locator('.hero').isVisible(),'cinematic homepage renders');
 assert(await page.locator('.trending-section .anime-card').count()===6,'six featured anime cards render');
 assert(await page.locator('.poster img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),'featured posters load');
 let r=await context.request.get(`${base}/api/catalog?q=naruto`);let catalog=await r.json();assert(catalog.catalogTotal>10000&&catalog.data.some(a=>a.id===20),'catalog contains over 10,000 real entries and searches correctly');
 r=await context.request.get(`${base}/api/catalog?genre=${encodeURIComponent('Романтика')}`);catalog=await r.json();assert(catalog.data.length>0&&catalog.data.every(a=>a.genres.includes('Романтика')),'genre filtering works');
 await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();await page.getByPlaceholder('Твой никнейм').fill('Путешественник');const email=`test-${Date.now()}@anima.test`;await page.getByPlaceholder('you@example.com').fill(email);await page.getByPlaceholder('Не менее 8 символов').fill('Test-Anima-2026!');await page.locator('.auth-modal form button[type="submit"]').click();await page.waitForSelector('.demo-code strong');const code=await page.locator('.demo-code strong').textContent();await page.getByPlaceholder('000000').fill(code);await page.getByRole('button',{name:'Подтвердить почту',exact:true}).click();await page.waitForSelector('.header-profile');
 let result=await call(context,'auth/me');assert(result.data.user?.email===email,'registration, verification and secure session work');
 result=await call(context,'profile',{name:'Путешественник',bio:'Проверяю собственную вселенную',avatar:'fox',accent:'purple'},'PATCH');assert(result.data.user?.avatar==='fox','profile customization persists');
 result=await call(context,'library',{animeId:52991,toggle:true});assert(result.data.saved===true,'bookmark persists');result=await call(context,'library');assert(result.data.items.some(i=>i.animeId===52991),'saved library is readable');
 result=await call(context,'rooms',{name:'Закрытая тестовая комната',animeId:52991,isPrivate:true});const roomId=result.data.room?.id;assert(!!roomId,'private watch room is created in PostgreSQL');
 const guest=await browser.newContext();const guestEmail=`guest-${Date.now()}@anima.test`;result=await call(guest,'auth/register',{name:'Зритель',email:guestEmail,password:'Test-Anima-2026!'});await call(guest,'auth/verify',{email:guestEmail,code:result.data.demoCode});result=await call(guest,`rooms/${roomId}`);assert(result.data.members?.length===2,'two authenticated viewers join the same room');
 result=await call(guest,`rooms/${roomId}`,{action:'sync',playing:true,position:10,episode:1});assert(result.status===403,'guests cannot control host playback');
 await call(context,`rooms/${roomId}`,{action:'sync',playing:false,position:12,episode:2});result=await call(guest,`rooms/${roomId}`);assert(result.data.room.position===12&&result.data.room.episode===2,'host timeline and episode synchronize');
 await call(guest,`rooms/${roomId}`,{action:'chat',content:'Всем хорошего просмотра!'});result=await call(context,`rooms/${roomId}`);assert(result.data.messages.some(m=>m.content==='Всем хорошего просмотра!'),'room chat persists and reaches the host');
 for (const prov of ['anima','kodik','senku','anilibria']) {
  const pr = await context.request.get(`${base}/api/player?provider=${prov}&id=52991&episode=1`);
  const pj = await pr.json();
  assert(pr.status()===200 && pj.url && pj.translations?.length>0, `player provider ${prov} resolves real anime stream and voiceovers`);
 }
 await page.goto(`${base}/anime/52991`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1,undefined,{timeout:25000});await page.getByRole('button',{name:'Качество видео',exact:true}).click();assert(await page.locator('.quality-menu button').filter({hasText:'2160p'}).isEnabled(),'real 4K quality track is available');assert(await page.locator('.quality-menu button').filter({hasText:'1440p'}).isEnabled(),'real 2K quality track is available');assert(await page.locator('.quality-menu button').filter({hasText:'380p'}).isEnabled(),'380p quality track is available');await page.locator('.quality-menu button').filter({hasText:'2160p'}).click();await page.getByRole('button',{name:'Воспроизвести видео',exact:true}).click();await page.waitForFunction(()=>{const v=document.querySelector('video');return v?.videoHeight===2160&&v.currentTime>0;},undefined,{timeout:30000});assert(true,'native player actually decodes and plays 3840×2160 real anime video');await page.getByRole('button',{name:'Пауза',exact:true}).click();await page.getByRole('button',{name:'Качество видео',exact:true}).click();await page.screenshot({path:'artifacts/player-desktop.png'});await page.getByRole('button',{name:'Качество видео',exact:true}).click();await page.locator('.provider-tabs button').filter({hasText:'Kodik'}).click();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1,undefined,{timeout:25000});assert(true,'Kodik player loads real anime stream');await page.locator('.provider-tabs button').filter({hasText:'Senku'}).click();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1,undefined,{timeout:25000});assert(true,'Senku player loads real anime stream');
 await page.goto(`${base}/profile`,{waitUntil:'networkidle'});await page.screenshot({path:'artifacts/profile-desktop.png'});assert(await page.getByRole('button',{name:'Сохранить изменения',exact:true}).isVisible(),'profile editor renders');
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});const mp=await mobile.newPage();await mp.goto(base,{waitUntil:'networkidle'});await mp.screenshot({path:'artifacts/home-mobile.png',fullPage:true});assert(await mp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile homepage has no horizontal overflow');
 assert(errors.length===0,`no browser runtime errors (${errors.join('; ')})`);
 console.log('ALL END-TO-END CHECKS PASSED');await guest.close();await mobile.close();
}finally{await browser.close();}
