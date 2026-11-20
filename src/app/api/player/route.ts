import { NextRequest } from "next/server";
import { resolveAnimeEpisodeStream } from "@/lib/streams";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const provider = q.get("provider") || "anima";
  const id = Number(q.get("id"));
  const episode = Math.max(1, Number(q.get("episode")) || 1);
  const translation = q.get("translation") || "";
  const mode = q.get("mode") || "hls";

  if (!Number.isSafeInteger(id) || id <= 0) {
    return Response.json({ error: "Неверный ID аниме" }, { status: 400 });
  }

  if (!["anima", "kodik", "senku", "anilibria"].includes(provider)) {
    return Response.json({ error: "Плеер не найден" }, { status: 404 });
  }

  try {
    const resolved = await resolveAnimeEpisodeStream({
      animeId: id,
      episode,
      provider,
      translationId: translation,
    });

    if (mode === "iframe" && resolved.embedUrl) {
      return Response.json({
        type: "iframe",
        url: resolved.embedUrl,
        embedUrl: resolved.embedUrl,
        demo: false,
        provider,
        episode,
        episodesCount: resolved.episodesCount,
        translationId: resolved.translationId,
        translationTitle: resolved.translationTitle,
        translations: resolved.translations,
        skipOpening: resolved.skipOpening,
        skipEnding: resolved.skipEnding,
        episodeTitle: resolved.episodeTitle,
      });
    }

    const hasDirectTracks = Object.keys(resolved.qualities).length > 0;

    // If no direct stream could be resolved, fall back to the provider's
    // official embed instead of returning an empty HLS playlist.
    if (!hasDirectTracks && resolved.embedUrl && mode !== "hls-only") {
      return Response.json({
        type: "iframe",
        url: resolved.embedUrl,
        embedUrl: resolved.embedUrl,
        demo: false,
        provider,
        episode,
        episodesCount: resolved.episodesCount,
        translationId: resolved.translationId,
        translationTitle: resolved.translationTitle,
        translations: resolved.translations,
        skipOpening: resolved.skipOpening,
        skipEnding: resolved.skipEnding,
        episodeTitle: resolved.episodeTitle,
      });
    }

    const hlsMasterUrl = `/api/hls?id=${id}&episode=${episode}&provider=${encodeURIComponent(
      provider
    )}&translation=${encodeURIComponent(resolved.translationId)}`;

    return Response.json({
      type: "hls",
      url: process.env.ANIMA_HLS_URL || hlsMasterUrl,
      embedUrl: resolved.embedUrl,
      demo: false,
      provider,
      episode,
      episodesCount: resolved.episodesCount,
      translationId: resolved.translationId,
      translationTitle: resolved.translationTitle,
      translations: resolved.translations,
      skipOpening: resolved.skipOpening,
      skipEnding: resolved.skipEnding,
      episodeTitle: resolved.episodeTitle,
      isNative4K: resolved.isNative4K,
      maxRealHeight: resolved.maxRealHeight,
      demoHeights: resolved.demoHeights,
    });
  } catch {
    return Response.json(
      {
        error: "Не удалось подключить видеопоток",
        detail: "Попробуйте выбрать другую озвучку или плеер.",
      },
      { status: 502 }
    );
  }
}
