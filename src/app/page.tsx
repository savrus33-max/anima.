import AnimeApp from "@/components/anime-app";
import { getCatalog } from "@/lib/catalog";
export const dynamic="force-dynamic";
export default async function HomePage() {
 const catalog=await getCatalog();
 return <AnimeApp total={catalog.length}/>;
}
