import { readFile, writeFile, mkdir } from 'node:fs/promises';
const source = JSON.parse(await readFile('/tmp/anime-offline.json', 'utf8'));
const tags = { action:'Экшен', adventure:'Приключения', fantasy:'Фэнтези', drama:'Драма', comedy:'Комедия', romance:'Романтика', mystery:'Детектив', supernatural:'Сверхъестественное', 'sci-fi':'Фантастика', thriller:'Триллер', sports:'Спорт', 'slice of life':'Повседневность', horror:'Ужасы', music:'Музыка' };
const seen = new Set();
const records = source.data.flatMap((a) => {
  const url = a.sources.find(s => /^https:\/\/myanimelist.net\/anime\/\d+$/.test(s));
  if (!url || (a.tags.some(t=>['hentai','explicit sex'].includes(t)) && !url.endsWith('/54492'))) return [];
  const id = Number(url.split('/').pop());
  if (seen.has(id)) return [];
  seen.add(id);
  const russian = a.synonyms.find(t => /[а-яё]/i.test(t) && !/[іїєґ]/i.test(t));
  return [{ id, title:russian || a.title, original:a.title, image:a.picture, score:Number((a.score?.arithmeticGeometricMean || 0).toFixed(1)), year:a.animeSeason.year || 0, genres:Object.entries(tags).filter(([k])=>a.tags.includes(k)).map(([,v])=>v).slice(0,5), episodes:a.episodes, aired:a.episodes, status:a.status, type:a.type, description:'', synonyms:a.synonyms.filter(t=>/[a-zа-я]/i.test(t)).slice(0,14) }];
});
records.sort((a,b)=>b.score-a.score);
await mkdir('public/data',{recursive:true});
await mkdir('public/images/posters',{recursive:true});
await writeFile('public/data/catalog.json',JSON.stringify(records));
await writeFile('public/data/attribution.json',JSON.stringify({source:source.repository,license:source.license,lastUpdate:source.lastUpdate,total:records.length,note:'Filtered and normalized metadata. Original data by manami-project and contributing metadata providers. Poster copyrights remain with their respective owners.'},null,2));
const ids=[52991,52299,57334,54492,40748,44511,38000,16498,21,20,32281,33352,37521,38524,5114,52991,58567,11061];
await Promise.all([...new Set(ids)].map(async id=>{
  const a=records.find(x=>x.id===id);
  if(!a) return;
  try { const res=await fetch(a.image,{signal:AbortSignal.timeout(20000)}); if(!res.ok) throw new Error(String(res.status)); await writeFile(`public/images/posters/${id}.jpg`,Buffer.from(await res.arrayBuffer())); console.log(id,a.original,'poster saved'); } catch(e){console.log(id,'poster download:',e.message);}
}));
console.log(`Prepared ${records.length} unique catalog entries.`);
