import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { featuredAnime } from "./anime";
import type { Anime } from "./types";

type RecordAnime = Anime & { type: string; synonyms: string[] };
let catalogPromise: Promise<RecordAnime[]> | undefined;
export function getCatalog() {
  if (!catalogPromise) catalogPromise = readFile(path.join(process.cwd(), "public/data/catalog.json"), "utf8")
    .then(raw => JSON.parse(raw) as RecordAnime[]).then(items => {
      const featured = new Map(featuredAnime.map(a=>[a.id,a]));
      return items.map(a => featured.has(a.id) ? { ...a, ...featured.get(a.id) } : a);
    });
  return catalogPromise;
}
export async function searchCatalog(params: URLSearchParams) {
  const all = await getCatalog();
  const q = (params.get("q") || "").trim().toLocaleLowerCase().slice(0,150);
  const genre = params.get("genre");
  const status = params.get("status");
  const year = Number(params.get("year"));
  const order = params.get("order") || "popular";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const limit = 24;
  let results = all.filter(a => (!q || [a.title,a.original,...a.synonyms].some(t=>t.toLocaleLowerCase().includes(q))) && (!genre || a.genres.includes(genre)) && (!status || a.status===status || (status==="MOVIE" && a.type==="MOVIE")) && (!year || a.year===year));
  if (order === "new") results = results.toSorted((a,b)=>b.year-a.year || b.score-a.score);
  if (order === "name") results = results.toSorted((a,b)=>a.title.localeCompare(b.title,"ru"));
  if (order === "popular") {
    const priorities = new Map(featuredAnime.map((a,i)=>[a.id,100-i]));
    results = results.toSorted((a,b)=>(priorities.get(b.id)||0)-(priorities.get(a.id)||0) || b.score-a.score);
  }
  return { data:results.slice((page-1)*limit,page*limit).map(({synonyms, ...a})=>a), total:results.length, catalogTotal:all.length, page, pages:Math.ceil(results.length/limit) };
}
export async function findAnime(id: number) {
  return (await getCatalog()).find(a=>a.id===id) || null;
}
