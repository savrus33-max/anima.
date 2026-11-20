import { notFound } from "next/navigation";
import AnimeApp from "@/components/anime-app";
import { findAnime, getCatalog } from "@/lib/catalog";
export const dynamic="force-dynamic";
export default async function AnimePage({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;
 const anime=await findAnime(Number(id));
 if(!anime)notFound();
 const catalog=await getCatalog();
 return <AnimeApp total={catalog.length} anime={anime}/>;
}
