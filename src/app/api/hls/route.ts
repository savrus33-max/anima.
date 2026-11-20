import { NextRequest } from "next/server";
import { resolveAnimeEpisodeStream } from "@/lib/streams";

export const dynamic = "force-dynamic";

const ALLOWED_CDN_HOSTS = [
  ".libria.fun",
  ".anilibria.top",
  ".anilibria.wtf",
  ".solodcdn.com",
  ".kodik-storage.com",
  ".kodik.biz",
  ".kodikplayer.com",
  ".senku.one",
];
const ALLOWED_EXACT_HOSTS = ["senku.one", "edge.senku.one", "www.senku.one"];

function isAllowedCdnUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (ALLOWED_EXACT_HOSTS.includes(u.hostname)) return true;
    return ALLOWED_CDN_HOSTS.some((suffix) => u.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

function absolutize(ref: string, baseDir: string): string {
  if (ref.startsWith("http://") || ref.startsWith("https://")) return ref;
  if (ref.startsWith("//")) return `https:${ref}`;
  if (ref.startsWith("/")) return ref;
  if (ref.startsWith("./")) return `${baseDir}${ref.slice(2)}`;
  return `${baseDir}${ref}`;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const playlistUrl = q.get("playlist");

  // 1. Sub-playlist proxy: rewrite relative segment URLs to absolute CDN URLs
  if (playlistUrl) {
    if (!isAllowedCdnUrl(playlistUrl)) {
      return new Response("Forbidden upstream host", { status: 403 });
    }
    try {
      const isDirectMp4 = /\.(mp4|m4v)(\?|$)/i.test(playlistUrl);
      const ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

      if (isDirectMp4) {
        const range = request.headers.get("range") || undefined;
        const res = await fetch(playlistUrl, {
          headers: { "User-Agent": ua, ...(range ? { Range: range } : {}) },
          signal: AbortSignal.timeout(30000),
          redirect: "follow",
        });
        const headers = new Headers({
          "Content-Type": res.headers.get("content-type") || "video/mp4",
          "Accept-Ranges": res.headers.get("accept-ranges") || "bytes",
          "Access-Control-Allow-Origin": "*",
        });
        const cl = res.headers.get("content-length");
        const cr = res.headers.get("content-range");
        if (cl) headers.set("Content-Length", cl);
        if (cr) headers.set("Content-Range", cr);
        return new Response(res.body, { status: res.status, headers });
      }

      const res = await fetch(playlistUrl, {
        headers: { "User-Agent": ua, Referer: new URL(playlistUrl).origin + "/" },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        return new Response("Upstream playlist error", { status: 502 });
      }
      const text = await res.text();
      const finalUrl = res.url || playlistUrl;
      const baseDir = finalUrl.slice(0, finalUrl.lastIndexOf("/") + 1);

      // Rewrite only URI-bearing lines. Every other line (comments, tags,
      // empty lines) MUST be passed through untouched — otherwise the
      // playlist is corrupted and playback fails in every player.
      const rewritten = text
        .split("\n")
        .map((rawLine) => {
          const line = rawLine.trimEnd();
          const trimmed = line.trim();
          if (!trimmed) return line;

          if (trimmed.startsWith("#")) {
            // Rewrite URI="..." inside tags such as #EXT-X-MAP
            if (trimmed.includes("URI=\"")) {
              return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${absolutize(uri, baseDir)}"`);
            }
            return line;
          }
          return absolutize(trimmed, baseDir);
        })
        .join("\n");

      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      return new Response("Failed to load playlist", { status: 502 });
    }
  }

  // 2. Master HLS playlist: 380p/360p, 480p, 720p, 1080p, 1440p (2K), 2160p (4K)
  const animeId = Number(q.get("id")) || 52991;
  const episode = Math.max(1, Number(q.get("episode")) || 1);
  const provider = q.get("provider") || "anima";
  const translationId = q.get("translation") || "";

  const resolved = await resolveAnimeEpisodeStream({
    animeId,
    episode,
    provider,
    translationId,
  });

  const tiers = [
    { key: "360", w: 640, h: 360, bw: 500000 },
    { key: "480", w: 854, h: 480, bw: 900000 },
    { key: "720", w: 1280, h: 720, bw: 1800000 },
    { key: "1080", w: 1920, h: 1080, bw: 3200000 },
    { key: "1440", w: 2560, h: 1440, bw: 5500000 },
    { key: "2160", w: 3840, h: 2160, bw: 9500000 },
  ];

  let master = "#EXTM3U\n#EXT-X-VERSION:3\n";
  for (const t of tiers) {
    const target = resolved.qualities[t.key];
    if (!target) continue;
    const uri = target.startsWith("/")
      ? target
      : `/api/hls?playlist=${encodeURIComponent(target)}`;
    master += `#EXT-X-STREAM-INF:BANDWIDTH=${t.bw},RESOLUTION=${t.w}x${t.h},FRAME-RATE=24.000\n${uri}\n`;
  }

  return new Response(master, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
