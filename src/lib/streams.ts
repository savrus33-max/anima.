import "server-only";
import { findAnime } from "./catalog";

export type VoiceOption = {
  id: string;
  title: string;
  type: "voice" | "subtitles";
  episodesCount?: number;
  source: "anilibria" | "kodik" | "senku" | "anima4k";
};

export type ResolvedStream = {
  animeId: number;
  episode: number;
  episodesCount: number;
  provider: string;
  translationId: string;
  translationTitle: string;
  translations: VoiceOption[];
  qualities: Record<string, string>;
  embedUrl?: string;
  skipOpening: [number, number];
  skipEnding?: [number, number];
  episodeTitle?: string;
  isNative4K?: boolean;
  /** Highest resolution that belongs to the real episode (never the demo clip). */
  maxRealHeight: number;
  /** Resolutions that point at the short local 2K/4K demo clip. */
  demoHeights: number[];
};

const KNOWN_ANILIBRIA_IDS: Record<number, number> = {
  52991: 9542,
  52299: 9600,
  57334: 9789,
  40748: 8789,
  38000: 8325,
  32281: 6826,
  33352: 5620,
  5114: 9528,
  21: 10290,
  20: 413,
  58567: 9884,
};

const FALLBACK_KODIK_TOKENS = [
  "447d179e875efe44217f20d1ee2146be",
  "71d44f128588811a31e108f235b7b4e4",
  "a0457f4b23217c83b60116895772e963",
];

let cachedTokens: string[] | null = null;
let cachedTokensAt = 0;
let cachedPostLink: string | null = null;
let cachedCryptStep: number | null = null;

const searchCache = new Map<string, { expires: number; data: unknown }>();
function getCached<T>(key: string): T | null {
  const entry = searchCache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data as T;
  return null;
}
function setCached(key: string, data: unknown, ttlMs = 15 * 60 * 1000) {
  searchCache.set(key, { expires: Date.now() + ttlMs, data });
}

function decryptKodikToken(tkn: string): string {
  const half = Math.floor(tkn.length / 2);
  const p1 = Buffer.from(tkn.slice(0, half).split("").reverse().join(""), "base64").toString("utf8");
  const p2 = Buffer.from(tkn.slice(half).split("").reverse().join(""), "base64").toString("utf8");
  return p2 + p1;
}

async function getKodikTokens(): Promise<string[]> {
  if (process.env.KODIK_API_TOKEN) {
    return [process.env.KODIK_API_TOKEN, ...FALLBACK_KODIK_TOKENS];
  }
  if (cachedTokens && Date.now() - cachedTokensAt < 3600_000) {
    return cachedTokens;
  }
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/YaNesyTortiK/AnimeParsers/main/kdk_tokns/tokens.json",
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const data = await res.json();
      const list = [...(data.stable || []), ...(data.unstable || [])]
        .map((x: { tokn?: string }) => (x.tokn ? decryptKodikToken(x.tokn) : ""))
        .filter(Boolean);
      if (list.length > 0) {
        cachedTokens = [...new Set([...list, ...FALLBACK_KODIK_TOKENS])];
        cachedTokensAt = Date.now();
        return cachedTokens;
      }
    }
  } catch {
    // Use built-in fallback tokens
  }
  cachedTokens = FALLBACK_KODIK_TOKENS;
  cachedTokensAt = Date.now();
  return cachedTokens;
}

type KodikResult = {
  id: string;
  title: string;
  title_orig: string;
  link: string;
  episodes_count?: number;
  last_episode?: number;
  translation?: { id: number; title: string; type: "voice" | "subtitles" };
  seasons?: Record<string, { link?: string; episodes?: Record<string, string> }>;
};

export async function searchKodikByAnime(animeId: number, title?: string, original?: string): Promise<KodikResult[]> {
  const cacheKey = `kodik:search:${animeId}`;
  const hit = getCached<KodikResult[]>(cacheKey);
  if (hit) return hit;

  const tokens = await getKodikTokens();
  for (const token of tokens) {
    try {
      const res = await fetch("https://kodik-api.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token,
          shikimori_id: String(animeId),
          with_episodes: "true",
          limit: "50",
        }),
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.results) && json.results.length > 0) {
          setCached(cacheKey, json.results);
          return json.results;
        }
      }
    } catch {
      // try next token
    }
  }

  const queryTitle = original || title;
  if (queryTitle) {
    for (const token of tokens.slice(0, 2)) {
      try {
        const res = await fetch("https://kodik-api.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token,
            title: queryTitle,
            types: "anime,anime-serial",
            with_episodes: "true",
            limit: "25",
          }),
          signal: AbortSignal.timeout(7000),
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.results) && json.results.length > 0) {
            setCached(cacheKey, json.results);
            return json.results;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return [];
}

function decodeKodikStreamUrl(str: string): string | null {
  if (str.includes("mp4:hls:manifest")) {
    return str.startsWith("//") ? `https:${str}` : str;
  }
  const alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const tryRot = (rot: number): string | null => {
    let crypted = "";
    for (const ch of str) {
      const up = ch.toUpperCase();
      const idx = alph.indexOf(up);
      if (idx !== -1) {
        const next = alph[(idx + rot) % 26];
        crypted += ch === up ? next : next.toLowerCase();
      } else {
        crypted += ch;
      }
    }
    crypted += "=".repeat((4 - (crypted.length % 4)) % 4);
    try {
      const decoded = Buffer.from(crypted, "base64").toString("utf8");
      if (decoded.includes("mp4:hls:manifest")) {
        return decoded.startsWith("//") ? `https:${decoded}` : decoded;
      }
    } catch {
      return null;
    }
    return null;
  };

  if (cachedCryptStep !== null) {
    const fast = tryRot(cachedCryptStep);
    if (fast) return fast;
  }
  for (let rot = 0; rot < 26; rot++) {
    const decoded = tryRot(rot);
    if (decoded) {
      cachedCryptStep = rot;
      return decoded;
    }
  }
  return null;
}

function parseKodikSkipSegments(html: string): [number, number][] {
  const match = html.match(/parseSkipButton\((["'])([^"']+)\1/);
  if (!match?.[2]) return [];
  const segments: [number, number][] = [];
  for (const part of match[2].split(",")) {
    if (!part.includes("-")) continue;
    const [s, e] = part.split("-");
    const parseTime = (t: string) => {
      const nums = t.split(":").map(Number);
      if (nums.some(isNaN)) return 0;
      return nums.length === 2 ? nums[0] * 60 + nums[1] : nums[0];
    };
    const start = parseTime(s);
    const end = parseTime(e);
    if (end > start) segments.push([start, end]);
  }
  return segments;
}

export async function extractKodikDirectStreams(embedLink: string): Promise<{
  qualities: Record<string, string>;
  skipOpening?: [number, number];
  skipEnding?: [number, number];
} | null> {
  const normalizedUrl = embedLink.startsWith("//") ? `https:${embedLink}` : embedLink;
  const cacheKey = `kodik:direct:${normalizedUrl}`;
  const hit = getCached<{ qualities: Record<string, string>; skipOpening?: [number, number]; skipEnding?: [number, number] }>(cacheKey);
  if (hit) return hit;

  try {
    const html = await fetch(normalizedUrl, { signal: AbortSignal.timeout(7000) }).then((r) => r.text());
    // urlParams is a single-quoted JSON string: urlParams = '{"d":...}'
    // The old character class stopped at the first inner double quote and
    // JSON.parse then threw, which emptied the Kodik playlist.
    const urlParamsMatch = html.match(/urlParams\s*=\s*'([^']+)'/);
    if (!urlParamsMatch) return null;
    const urlParams = JSON.parse(urlParamsMatch[1]);
    const vType = html.match(/\.type\s*=\s*['"]([^'"]+)['"]/)?.[1];
    const vHash = html.match(/\.hash\s*=\s*['"]([^'"]+)['"]/)?.[1];
    const vId = html.match(/\.id\s*=\s*['"]([^'"]+)['"]/)?.[1];
    if (!vType || !vHash || !vId) return null;

    let postLink = cachedPostLink;
    if (!postLink) {
      const scriptSrc = html.match(/<script[^>]+src="(\/assets\/js\/app\.player_single[^"]+)"/)?.[1];
      if (scriptSrc) {
        const js = await fetch(`https://kodikplayer.com${scriptSrc}`, { signal: AbortSignal.timeout(6000) }).then((r) => r.text());
        const ajaxMatch = js.slice(js.indexOf("$.ajax") + 30, js.indexOf("cache:!1") - 3);
        postLink = Buffer.from(ajaxMatch, "base64").toString("utf8");
        cachedPostLink = postLink;
      } else {
        postLink = "/ftor";
      }
    }

    const params = new URLSearchParams({
      hash: vHash,
      id: vId,
      type: vType,
      d: urlParams.d,
      d_sign: urlParams.d_sign,
      pd: urlParams.pd,
      pd_sign: urlParams.pd_sign,
      ref: "",
      ref_sign: urlParams.ref_sign,
      bad_user: "true",
      cdn_is_working: "true",
    });

    const postRes = await fetch(`https://kodikplayer.com${postLink}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(7000),
    }).then((r) => r.json());

    if (!postRes?.links) return null;
    const qualities: Record<string, string> = {};
    for (const [q, arr] of Object.entries(postRes.links as Record<string, { src: string }[]>)) {
      const first = arr?.[0]?.src;
      if (first) {
        const decoded = decodeKodikStreamUrl(first);
        if (decoded) qualities[q] = decoded;
      }
    }
    if (Object.keys(qualities).length === 0) return null;

    const skips = parseKodikSkipSegments(html);
    const result = {
      qualities,
      skipOpening: skips[0],
      skipEnding: skips[1],
    };
    setCached(cacheKey, result, 10 * 60 * 1000);
    return result;
  } catch {
    return null;
  }
}

type AniLibriaEpisode = {
  ordinal: number;
  name?: string | null;
  hls_480?: string | null;
  hls_720?: string | null;
  hls_1080?: string | null;
  opening?: { start?: number | null; stop?: number | null };
  ending?: { start?: number | null; stop?: number | null };
};

type AniLibriaRelease = {
  id: number;
  name?: { main?: string; english?: string };
  episodes?: AniLibriaEpisode[];
};

const norm = (s?: string | null) => (s || "").toLowerCase().replace(/[^a-zа-яё0-9]+/gi, " ").trim();

export async function fetchAniLibriaRelease(animeId: number, title?: string, original?: string): Promise<AniLibriaRelease | null> {
  const cacheKey = `anilibria:rel:${animeId}`;
  const hit = getCached<AniLibriaRelease | null>(cacheKey);
  if (hit !== null) return hit;

  let releaseId = KNOWN_ANILIBRIA_IDS[animeId];
  if (!releaseId && (original || title)) {
    for (const q of [original, title].filter(Boolean) as string[]) {
      try {
        const res = await fetch(
          `https://anilibria.top/api/v1/app/search/releases?query=${encodeURIComponent(q)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const items = (await res.json()) as AniLibriaRelease[];
          const matched = items.find((item) => {
            const en = norm(item.name?.english);
            const ru = norm(item.name?.main);
            const qEn = norm(original);
            const qRu = norm(title);
            return (qEn && en && (en === qEn || en.includes(qEn) || qEn.includes(en))) ||
                   (qRu && ru && (ru === qRu || ru.includes(qRu) || qRu.includes(ru)));
          });
          if (matched) {
            releaseId = matched.id;
            break;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  if (!releaseId) {
    setCached(cacheKey, null, 10 * 60 * 1000);
    return null;
  }

  try {
    const res = await fetch(`https://anilibria.top/api/v1/anime/releases/${releaseId}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const release = (await res.json()) as AniLibriaRelease;
      if (release?.episodes?.length) {
        setCached(cacheKey, release, 30 * 60 * 1000);
        return release;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function cleanLibriaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.split("?")[0];
}

type SenkuEpisodeStream = {
  qualities: Record<string, string>;
  studio?: string;
};

export async function fetchSenkuEpisodeStream(animeId: number, episode: number): Promise<{
  studios: string[];
  episodeQualities: Record<string, SenkuEpisodeStream>;
} | null> {
  const cacheKey = `senku:cat:${animeId}:${episode}`;
  const hit = getCached<{ studios: string[]; episodeQualities: Record<string, SenkuEpisodeStream> }>(cacheKey);
  if (hit) return hit;

  try {
    const res = await fetch(
      `https://senku.one/api/senku-catalog?id=${animeId}&episode=${episode}`,
      {
        headers: {
          "User-Agent": "AnimaPlayer/1.0 (+https://github.com/anima-app)",
          "Accept": "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
          "X-Senku-Requested-With": "fetch",
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      const epMap = data?.episodes?.[String(episode)];
      if (epMap) {
        const episodeQualities: Record<string, SenkuEpisodeStream> = {};
        for (const [studio, quals] of Object.entries(epMap as Record<string, Record<string, { url?: string }>>)) {
          const qualities: Record<string, string> = {};
          for (const [q, val] of Object.entries(quals)) {
            if (!val?.url) continue;
            const url = val.url.startsWith("http") ? val.url : `https://senku.one${val.url}`;
            // Senku marks some admin_media .mp4 links (video1.cdnlibs.org /
            // video1.imglib.info) that answer 403/404 — skip them so the
            // player never selects a dead variant.
            const deadHost = /video1\.(cdnlibs\.org|imglib\.info)/.test(url);
            const isHls = /\.m3u8(\?|$)/i.test(url) || url.includes("/api/quality-stream/");
            if (!deadHost && (isHls || !/\.(mp4|m4v)(\?|$)/i.test(url))) {
              qualities[q] = url;
            }
          }
          if (Object.keys(qualities).length > 0) {
            episodeQualities[studio] = { qualities, studio };
          }
        }
        const studios = Object.keys(episodeQualities);
        const result = { studios, episodeQualities };
        setCached(cacheKey, result, 10 * 60 * 1000);
        return result;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function resolveStreamInternal(params: {
  animeId: number;
  episode: number;
  provider: string;
  translationId?: string;
}): Promise<Omit<ResolvedStream, "maxRealHeight" | "demoHeights">> {
  const { animeId, episode, provider } = params;
  const anime = await findAnime(animeId);
  const title = anime?.title;
  const original = anime?.original;

  const [kodikResults, libriaRelease, senkuData] = await Promise.all([
    searchKodikByAnime(animeId, title, original),
    fetchAniLibriaRelease(animeId, title, original),
    provider === "senku" ? fetchSenkuEpisodeStream(animeId, episode) : Promise.resolve(null),
  ]);

  const translations: VoiceOption[] = [];
  const seenTranslations = new Set<string>();

  if (provider === "senku" && senkuData?.studios?.length) {
    for (const studio of senkuData.studios) {
      const trId = `senku:${studio}`;
      if (seenTranslations.has(trId)) continue;
      seenTranslations.add(trId);
      translations.push({
        id: trId,
        title: `${studio} (Senku)`,
        type: studio.includes("Subtitles") ? "subtitles" : "voice",
        episodesCount: anime?.episodes || 12,
        source: "senku",
      });
    }
  } else if (provider !== "senku") {
    if (libriaRelease?.episodes?.length) {
      translations.push({
        id: "anilibria-fhd",
        title: "AniLibria 1080p FHD",
        type: "voice",
        episodesCount: libriaRelease.episodes.length,
        source: "anilibria",
      });
      seenTranslations.add("anilibria-fhd");
    }

    for (const r of kodikResults) {
      const trId = String(r.translation?.id || "0");
      if (seenTranslations.has(trId)) continue;
      seenTranslations.add(trId);
      const seasonEps = r.seasons ? Object.values(r.seasons)[0]?.episodes : undefined;
      const epCount = seasonEps ? Object.keys(seasonEps).length : r.episodes_count || anime?.episodes || 1;
      translations.push({
        id: trId,
        title: r.translation?.title || "Русская озвучка",
        type: r.translation?.type || "voice",
        episodesCount: epCount,
        source: "kodik",
      });
    }
  }

  if (animeId === 52991 || translations.length === 0) {
    translations.push({
      id: "anima-4k-uhd",
      title: "Anima 4K UHD (Нативный 2160p)",
      type: "voice",
      episodesCount: anime?.episodes || 28,
      source: "anima4k",
    });
  }

  let selectedTr = params.translationId || "";
  if (!selectedTr || !translations.some((t) => t.id === selectedTr)) {
    if (provider === "senku" && senkuData) {
      // Prefer a Senku studio that actually exposes a 720p HLS track
      const has720 = (t: VoiceOption) => {
        const studio = senkuData.episodeQualities[t.title.replace(" (Senku)", "")];
        return !!studio?.qualities["720"];
      };
      const preferredSenku =
        translations.find(has720) || translations[0];
      selectedTr = preferredSenku?.id || "anima-4k-uhd";
    } else if (provider === "kodik") {
      const kodikVoices = translations.filter((t) => t.source === "kodik");
      selectedTr = (kodikVoices[0] || translations[0])?.id || "anima-4k-uhd";
    } else if (provider === "anilibria" && translations.some((t) => t.id === "anilibria-fhd")) {
      selectedTr = "anilibria-fhd";
    } else {
      selectedTr = translations[0]?.id || "anima-4k-uhd";
    }
  }

  const chosenVoice = translations.find((t) => t.id === selectedTr) || translations[0];
  const firstKodik = kodikResults[0];
  const kodikSeason = firstKodik?.seasons ? Object.values(firstKodik.seasons)[0] : undefined;
  const rawEmbed = kodikSeason?.episodes?.[String(episode)] || firstKodik?.link;
  const embedUrl = rawEmbed ? (rawEmbed.startsWith("//") ? `https:${rawEmbed}` : rawEmbed) : undefined;
  const useNative4KFrieren = animeId === 52991 && episode === 1;

  // 1. Senku provider: direct Senku HLS streams
  if (chosenVoice?.source === "senku" && senkuData?.studios?.length) {
    const studioName = chosenVoice.title.replace(" (Senku)", "");
    const studioData = senkuData.episodeQualities[studioName];
    if (studioData?.qualities) {
      const q360 = studioData.qualities["360"];
      const q480 = studioData.qualities["480"] || q360;
      const q720 = studioData.qualities["720"] || q480;
      const q1080 = studioData.qualities["1080"] || q720;
      // For AniLibria.TV 4K UHD, AniLibria 1080p HLS is native multi-bitrate from cache.libria.fun
      const q1440 = studioData.qualities["1440"] || q1080;
      const q2160 = studioData.qualities["2160"] || q1080;
      return {
        animeId,
        episode,
        episodesCount: anime?.episodes || 12,
        provider,
        translationId: chosenVoice.id,
        translationTitle: chosenVoice.title,
        translations,
        qualities: {
          "360": q360,
          "480": q480,
          "720": q720,
          "1080": q1080,
          "1440": useNative4KFrieren ? "/media/demo/1440/index.m3u8" : q1440,
          "2160": useNative4KFrieren ? "/media/demo/2160/index.m3u8" : q2160,
        },
        embedUrl: `https://senku.one/watch/${animeId}/${episode}`,
        skipOpening: [0, 90],
        isNative4K: false,
      };
    }
  }

  // 2. AniLibria provider: AniLibria 1080p FHD
  if (chosenVoice?.source === "anilibria" && libriaRelease?.episodes?.length) {
    const epObj =
      libriaRelease.episodes.find((e) => e.ordinal === episode) ||
      libriaRelease.episodes[Math.min(episode - 1, libriaRelease.episodes.length - 1)] ||
      libriaRelease.episodes[0];

    const hls1080 = cleanLibriaUrl(epObj.hls_1080);
    const hls720 = cleanLibriaUrl(epObj.hls_720) || hls1080;
    const hls480 = cleanLibriaUrl(epObj.hls_480) || hls720;

    if (hls1080 || hls720 || hls480) {
      const best = (hls1080 || hls720 || hls480)!;
      const low = (hls480 || hls720 || best)!;
      const mid = (hls720 || best)!;
      const start = epObj.opening?.start ?? 0;
      const stop = epObj.opening?.stop ?? 90;
      return {
        animeId,
        episode,
        episodesCount: Math.max(libriaRelease.episodes.length, anime?.episodes || 1),
        provider,
        translationId: chosenVoice.id,
        translationTitle: chosenVoice.title,
        translations,
        qualities: {
          "360": low,
          "480": low,
          "720": mid,
          "1080": best,
          "1440": useNative4KFrieren ? "/media/demo/1440/index.m3u8" : best,
          "2160": useNative4KFrieren ? "/media/demo/2160/index.m3u8" : best,
        },
        embedUrl,
        skipOpening: [start, stop > start ? stop : start + 90],
        skipEnding:
          epObj.ending?.start && epObj.ending?.stop && epObj.ending.stop > epObj.ending.start
            ? [epObj.ending.start, epObj.ending.stop]
            : undefined,
        episodeTitle: epObj.name || undefined,
        isNative4K: false,
      };
    }
  }

  // 3. Kodik provider: real anime HLS stream in Anima player, switchable to Kodik iframe
  if (chosenVoice?.source === "kodik" && kodikResults.length > 0) {
    const matchedKodik =
      kodikResults.find((r) => String(r.translation?.id || "0") === chosenVoice.id) || kodikResults[0];
    const seasonObj = matchedKodik.seasons ? Object.values(matchedKodik.seasons)[0] : undefined;
    const episodeMap = seasonObj?.episodes || {};
    const epKeys = Object.keys(episodeMap).sort((a, b) => Number(a) - Number(b));
    const targetEpLink =
      episodeMap[String(episode)] ||
      (epKeys.length > 0 ? episodeMap[epKeys[Math.min(episode - 1, epKeys.length - 1)]] : undefined) ||
      matchedKodik.link;

    const epEmbedUrl = targetEpLink.startsWith("//") ? `https:${targetEpLink}` : targetEpLink;
    const extracted = await extractKodikDirectStreams(epEmbedUrl);

    if (extracted && Object.keys(extracted.qualities).length > 0) {
      const q360 = extracted.qualities["360"] || extracted.qualities["480"] || extracted.qualities["720"];
      const q480 = extracted.qualities["480"] || extracted.qualities["720"] || q360;
      const q720 = extracted.qualities["720"] || q480;
      return {
        animeId,
        episode,
        episodesCount: Math.max(epKeys.length, matchedKodik.episodes_count || 0, anime?.episodes || 1),
        provider,
        translationId: chosenVoice.id,
        translationTitle: chosenVoice.title,
        translations,
        qualities: {
          "360": q360,
          "480": q480,
          "720": q720,
          "1080": q720,
          "1440": useNative4KFrieren ? "/media/demo/1440/index.m3u8" : q720,
          "2160": useNative4KFrieren ? "/media/demo/2160/index.m3u8" : q720,
        },
        embedUrl: epEmbedUrl,
        skipOpening: extracted.skipOpening || [0, 90],
        skipEnding: extracted.skipEnding,
        isNative4K: false,
      };
    } else {
      return {
        animeId,
        episode,
        episodesCount: Math.max(epKeys.length, matchedKodik.episodes_count || 0, anime?.episodes || 1),
        provider,
        translationId: chosenVoice.id,
        translationTitle: chosenVoice.title,
        translations,
        qualities: {},
        embedUrl: epEmbedUrl,
        skipOpening: [0, 90],
        isNative4K: false,
      };
    }
  }

  // 4. Fallback / Native 4K UHD stream
  return {
    animeId,
    episode,
    episodesCount: anime?.episodes || 12,
    provider,
    translationId: "anima-4k-uhd",
    translationTitle: "Anima 4K UHD (Русская озвучка)",
    translations,
    qualities: {
      "360": "/media/demo/360/index.m3u8",
      "480": "/media/demo/480/index.m3u8",
      "720": "/media/demo/720/index.m3u8",
      "1080": "/media/demo/1080/index.m3u8",
      "1440": "/media/demo/1440/index.m3u8",
      "2160": "/media/demo/2160/index.m3u8",
    },
    skipOpening: [0, 90],
    isNative4K: true,
  };
}

/**
 * Adds resolution provenance so the client can cap *automatic* level
 * selection to the real episode. The short local 2K/4K demo clip stays
 * reachable only through an explicit quality choice — auto-selection must
 * never swap a full episode for a 30 second sample.
 */
export async function resolveAnimeEpisodeStream(params: {
  animeId: number;
  episode: number;
  provider: string;
  translationId?: string;
}): Promise<ResolvedStream> {
  const resolved = await resolveStreamInternal(params);
  const entries = Object.entries(resolved.qualities);
  const heights = (isDemo: boolean) =>
    entries
      .filter(([, url]) => url.startsWith("/media/demo/") === isDemo)
      .map(([key]) => Number(key))
      .filter((n) => Number.isFinite(n) && n > 0);
  const realHeights = heights(false);
  const demoHeights = heights(true);
  return {
    ...resolved,
    maxRealHeight: realHeights.length ? Math.max(...realHeights) : 0,
    demoHeights,
  };
}
