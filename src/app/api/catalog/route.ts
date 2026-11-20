import { searchCatalog, findAnime } from "@/lib/catalog";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.has("id")) {
    const anime = await findAnime(Number(params.get("id")));
    return Response.json({ anime }, { status:anime ? 200 : 404 });
  }
  return Response.json(await searchCatalog(params));
}
