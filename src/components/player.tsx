"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  Maximize,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  Wifi,
} from "lucide-react";
import type { Anime, Room } from "@/lib/types";
import { useApp } from "./app-context";
import { errorMessage } from "@/lib/client";

export type SyncState = { playing: boolean; position: number; episode: number };

type VoiceOption = {
  id: string;
  title: string;
  type: "voice" | "subtitles";
  episodesCount?: number;
  source: string;
};

type Source = {
  type: "hls" | "iframe";
  url: string;
  embedUrl?: string;
  demo: boolean;
  provider: string;
  episode: number;
  episodesCount: number;
  translationId: string;
  translationTitle: string;
  translations: VoiceOption[];
  skipOpening?: [number, number];
  skipEnding?: [number, number];
  episodeTitle?: string;
  isNative4K?: boolean;
  maxRealHeight?: number;
  demoHeights?: number[];
};

const formatTime = (time: number) =>
  `${Math.floor((time || 0) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor((time || 0) % 60)
    .toString()
    .padStart(2, "0")}`;

export default function Player({
  anime,
  room,
  onSync,
}: {
  anime: Anime;
  room?: Room;
  onSync?: (state: SyncState) => void;
}) {
  const { user, notify } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const hls = useRef<Hls | null>(null);
  const lastSync = useRef(0);

  const [provider, setProvider] = useState("anima");
  const [translation, setTranslation] = useState("");
  const [useIframe, setUseIframe] = useState(false);
  const [episode, setEpisode] = useState(room?.episode || 1);
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const [quality, setQuality] = useState(-1);
  const [qualityOpen, setQualityOpen] = useState(false);

  const host = !room || room.hostId === user?.id;
  const episodeNumber = room?.episode || episode;

  const sync = useCallback(
    (override: Partial<SyncState> = {}) => {
      if (onSync && host && video.current) {
        onSync({
          playing: !video.current.paused,
          position: video.current.currentTime,
          episode: episodeNumber,
          ...override,
        });
      }
    },
    [onSync, host, episodeNumber]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setReady(false);
    setError(null);
    setSource(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setLevels([]);
    setQuality(-1);

    const mode = useIframe && !room ? "iframe" : "hls";
    const qs = new URLSearchParams({
      provider,
      id: String(anime.id),
      episode: String(episodeNumber),
      mode,
    });
    if (translation) qs.set("translation", translation);

    fetch(`/api/player?${qs.toString()}`, { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setError({ title: data.error || "Ошибка загрузки", detail: data.detail });
          return;
        }
        setSource(data);
        if (data.translationId && !translation) {
          setTranslation(data.translationId);
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError({
            title: "Источник временно не ответил",
            detail: "Проверь подключение или выбери другую озвучку.",
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [provider, anime.id, episodeNumber, translation, useIframe, room, retry]);

  useEffect(() => {
    if (!source || source.type !== "hls" || !video.current) return;
    const element = video.current;
    let disposed = false;
    let instance: Hls | null = null;

    import("hls.js")
      .then(({ default: HlsClass }) => {
        if (disposed) return;
        if (HlsClass.isSupported()) {
          instance = new HlsClass({ capLevelToPlayerSize: false, maxBufferLength: 30 });
          hls.current = instance;
          instance.loadSource(source.url);
          instance.attachMedia(element);
          instance.on(HlsClass.Events.MANIFEST_PARSED, () => {
            if (!disposed) {
              const found = [...new Set(instance!.levels.map((l) => l.height))].sort(
                (a, b) => b - a
              );
              setLevels(found);
              // Never let automatic level selection jump to the short local
              // 2K/4K demo clip while a full episode stream exists.
              const cap = source.maxRealHeight || 0;
              if (cap > 0) {
                const cappedIndex = instance!.levels.reduce(
                  (best, level, i) =>
                    level.height <= cap && level.height > instance!.levels[best].height ? i : best,
                  0
                );
                instance!.autoLevelCapping = cappedIndex;
              }
              setReady(true);
            }
          });
          instance.on(HlsClass.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
              instance?.startLoad();
            } else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) {
              instance?.recoverMediaError();
            } else {
              setError({
                title: "Не удалось воспроизвести поток",
                detail: "Попробуйте выбрать другую озвучку или плеер.",
              });
            }
          });
        } else if (element.canPlayType("application/vnd.apple.mpegurl")) {
          element.src = source.url;
          setReady(true);
        } else {
          setError({
            title: "Браузер не поддерживает HLS",
            detail: "Откройте Anima в современном Chrome, Firefox или Safari.",
          });
        }
      })
      .catch(() => setError({ title: "Не удалось инициализировать плеер" }));

    return () => {
      disposed = true;
      instance?.destroy();
      hls.current = null;
    };
  }, [source]);

  useEffect(() => {
    if (!room || host || !ready || !video.current) return;
    const element = video.current;
    const position =
      room.position +
      (room.playing
        ? Math.max(0, Date.now() - new Date(room.updatedAt).getTime()) / 1000
        : 0);
    if (Math.abs(element.currentTime - position) > 2.5) {
      element.currentTime = Math.min(position, element.duration || position);
    }
    if (room.playing && element.paused) element.play().catch(() => {});
    else if (!room.playing && !element.paused) element.pause();
  }, [room, host, ready]);

  function togglePlay() {
    if (!host) {
      if (room?.playing && video.current?.paused && ready) {
        video.current
          .play()
          .catch(() =>
            notify("Браузер пока не разрешил запуск видео. Попробуй ещё раз.")
          );
      } else {
        notify("Воспроизведением управляет ведущий комнаты");
      }
      return;
    }
    if (!video.current || !ready) return;
    if (video.current.paused) {
      video.current.play().catch((e) => notify(errorMessage(e)));
    } else {
      video.current.pause();
    }
  }

  function seek(value: number) {
    if (!host || !video.current) return;
    const maxDur = duration || video.current.duration || 1800;
    video.current.currentTime = Math.max(0, Math.min(value, maxDur));
    setTime(video.current.currentTime);
    sync({ position: video.current.currentTime });
  }

  function selectQuality(height: number) {
    setQuality(height);
    if (hls.current) {
      const idx =
        height === -1 ? -1 : hls.current.levels.findIndex((l) => l.height === height);
      hls.current.currentLevel = idx;
    }
    setQualityOpen(false);
  }

  function fullScreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      frame.current
        ?.requestFullscreen()
        .catch(() => notify("Полноэкранный режим недоступен в этом окне"));
    }
  }

  function selectEpisode(value: number) {
    if (!host) return;
    setEpisode(value);
    if (onSync) onSync({ position: 0, playing: false, episode: value });
  }

  const totalEpisodes = Math.max(
    source?.episodesCount || 0,
    anime.episodes || 12
  );
  const [opStart, opEnd] = source?.skipOpening || [0, 90];
  const showSkipOpening =
    host &&
    ready &&
    ((time >= opStart && time < opEnd) || (opStart === 0 && time < 90));

  function handleSkipOpening() {
    const target = time >= opStart && time < opEnd ? opEnd : time + 85;
    seek(target);
    notify("Опенинг пропущен ⏭");
  }

  const qualityLabel = (h: number) => {
    if (h === 2160) return "2160p 4K";
    if (h === 1440) return "1440p 2K";
    if (h === 1080) return "1080p FHD";
    if (h === 720) return "720p HD";
    if (h === 480) return "480p SD";
    if (h === 360) return "380p / 360p";
    return `${h}p`;
  };

  const applyAnime4KShader =
    (quality === 2160 || quality === 1440) && !source?.isNative4K;

  return (
    <section className="watch-player">
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <filter id="anima-4k-sharpen">
            <feConvolveMatrix
              order="3"
              preserveAlpha="true"
              kernelMatrix="0 -0.35 0 -0.35 2.4 -0.35 0 -0.35 0"
            />
          </filter>
        </defs>
      </svg>

      <div className="player-toolbar">
        <div className="provider-tabs">
          {[
            ["anima", "Anima", "4K UHD"],
            ["kodik", "Kodik", "20+ озвучек"],
            ["senku", "Senku", "Multi-Dub"],
            ["anilibria", "AniLibria", "1080p"],
          ].map(([id, title, badge]) => (
            <button
              key={id}
              className={provider === id ? "active" : ""}
              onClick={() => {
                setProvider(id);
                setTranslation("");
                setUseIframe(false);
              }}
            >
              {id === "anima" && <Play size={12} fill="currentColor" />}
              {title}
              <span>{badge}</span>
            </button>
          ))}
        </div>

        <div className="player-selectors" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {source?.translations && source.translations.length > 0 && (
            <div className="player-episode">
              <Mic size={12} className="lime" />
              <span>Озвучка</span>
              <select
                aria-label="Выбрать озвучку"
                value={source.translationId || translation}
                onChange={(e) => setTranslation(e.target.value)}
              >
                {source.translations.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.title}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </div>
          )}

          {provider === "kodik" && source?.embedUrl && !room && (
            <button
              type="button"
              className="text-button"
              style={{ fontSize: "9px", padding: "4px 8px", border: "1px solid #3e5b2b", borderRadius: "4px" }}
              onClick={() => setUseIframe((v) => !v)}
            >
              <ExternalLink size={11} />
              {useIframe ? "Плеер Anima HLS" : "Встроенный Kodik"}
            </button>
          )}

          <div className="player-episode">
            <span>Серия</span>
            <select
              aria-label="Выбрать серию"
              value={episodeNumber}
              disabled={!host}
              onChange={(e) => selectEpisode(Number(e.target.value))}
            >
              {Array.from(
                { length: Math.min(totalEpisodes, 2000) },
                (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1} из {totalEpisodes}
                  </option>
                )
              )}
            </select>
            <ChevronDown size={13} />
          </div>
        </div>
      </div>

      <div
        className="video-frame"
        ref={frame}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
          if (e.code === "Space") {
            e.preventDefault();
            togglePlay();
          }
          if (e.key === "ArrowRight") seek(time + 10);
          if (e.key === "ArrowLeft") seek(time - 10);
          if (e.key.toLowerCase() === "f") fullScreen();
          if (e.key.toLowerCase() === "m") setMuted(!muted);
        }}
      >
        {source?.type === "hls" && (
          <>
            <video
              ref={video}
              playsInline
              preload="metadata"
              muted={muted}
              poster="/images/fantasy-hero.png"
              style={
                applyAnime4KShader
                  ? { filter: "url(#anima-4k-sharpen) contrast(1.04) saturate(1.06)" }
                  : undefined
              }
              onClick={togglePlay}
              onLoadedMetadata={() => {
                setDuration(video.current?.duration || 0);
                setReady(true);
                if (room && video.current) video.current.currentTime = room.position;
              }}
              onDurationChange={() => setDuration(video.current?.duration || 0)}
              onTimeUpdate={() => {
                const current = video.current?.currentTime || 0;
                setTime(current);
                if (Date.now() - lastSync.current > 5000) {
                  lastSync.current = Date.now();
                  sync();
                }
              }}
              onPlay={() => {
                setPlaying(true);
                sync({ playing: true });
              }}
              onPause={() => {
                setPlaying(false);
                sync({ playing: false });
              }}
              onEnded={() => {
                setPlaying(false);
                sync({ playing: false });
              }}
              onError={() =>
                setError({
                  title: "Ошибка загрузки видеопотока",
                  detail: "Попробуйте выбрать другую озвучку или плеер.",
                })
              }
            />

            <span className="video-demo-label">
              <Sparkles size={11} /> {anime.title.toUpperCase()} · СЕРИЯ {episodeNumber}
            </span>

            {!playing && !error && (
              <button
                className="video-center-play"
                onClick={togglePlay}
                aria-label="Воспроизвести видео"
              >
                {ready ? (
                  <Play size={32} fill="currentColor" />
                ) : (
                  <LoaderCircle size={28} className="spin" />
                )}
              </button>
            )}

            {showSkipOpening && (
              <button className="skip-intro" onClick={handleSkipOpening}>
                Пропустить опенинг <SkipForward size={16} />
                <small>
                  {opEnd > opStart ? `до ${formatTime(opEnd)}` : "+85 с"}
                </small>
              </button>
            )}

            <div className="video-controls">
              <input
                aria-label="Позиция воспроизведения"
                className="video-progress"
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={Math.min(time, duration || 1)}
                disabled={!host}
                onChange={(e) => seek(Number(e.target.value))}
                style={
                  {
                    "--progress": `${duration ? (time / duration) * 100 : 0}%`,
                  } as React.CSSProperties
                }
              />
              <div className="video-control-row">
                <button
                  onClick={togglePlay}
                  aria-label={playing ? "Пауза" : "Воспроизвести"}
                >
                  {playing ? (
                    <Pause size={20} fill="currentColor" />
                  ) : (
                    <Play size={20} fill="currentColor" />
                  )}
                </button>
                <button
                  onClick={() => setMuted(!muted)}
                  aria-label={muted ? "Включить звук" : "Отключить звук"}
                >
                  {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
                </button>
                <span className="video-time">
                  {formatTime(time)} <span>/ {formatTime(duration)}</span>
                </span>
                {room && (
                  <span className="sync-tag">
                    <Wifi size={12} />
                    {host ? "Ты ведущий" : "Синхронизировано"}
                  </span>
                )}

                <div className="video-settings">
                  <button
                    onClick={() => setQualityOpen(!qualityOpen)}
                    aria-label="Качество видео"
                  >
                    <Settings2 size={18} />
                    <span>
                      {quality === -1
                        ? "Авто"
                        : quality === 360
                        ? "380p"
                        : `${quality}p`}
                    </span>
                  </button>
                  {qualityOpen && (
                    <div className="quality-menu">
                      <span>Качество видео</span>
                      <button
                        className={quality === -1 ? "active" : ""}
                        onClick={() => selectQuality(-1)}
                      >
                        Автоматически
                        {quality === -1 && <Check size={13} />}
                      </button>
                      {[2160, 1440, 1080, 720, 480, 360].map((l) => (
                        <button
                          key={l}
                          disabled={!levels.includes(l)}
                          className={quality === l ? "active" : ""}
                          onClick={() => selectQuality(l)}
                        >
                          {qualityLabel(l)}
                          {quality === l && <Check size={13} />}
                        </button>
                      ))}
                      <small>380p — 4K Ultra HD</small>
                    </div>
                  )}
                </div>

                <button onClick={fullScreen} aria-label="Полноэкранный режим">
                  <Maximize size={19} />
                </button>
              </div>
            </div>
          </>
        )}

        {source?.type === "iframe" && (
          <iframe
            src={source.url}
            title={`Плеер ${provider}`}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}

        {loading && (
          <div className="player-cover">
            <LoaderCircle className="spin" size={30} />
            <p>Загружаем аниме «{anime.title}»…</p>
          </div>
        )}

        {error && (
          <div className="player-cover player-error">
            <AlertCircle size={34} />
            <h3>{error.title}</h3>
            {error.detail && <p>{error.detail}</p>}
            <div>
              <button
                className="button button-primary"
                onClick={() => {
                  setProvider("anima");
                  setTranslation("");
                  setUseIframe(false);
                  setRetry((r) => r + 1);
                }}
              >
                <Play size={16} /> Открыть в Anima 4K
              </button>
              <button
                className="button button-secondary"
                onClick={() => setRetry((r) => r + 1)}
              >
                <RotateCcw size={16} /> Повторить
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="player-bottom">
        <span>
          <span className="lime">●</span> {anime.title} · Серия {episodeNumber}
          {source?.episodeTitle ? ` (${source.episodeTitle})` : ""} · Озвучка:{" "}
          {source?.translationTitle || "Русская озвучка"}
        </span>
        <button
          className="text-button"
          disabled={!host || episodeNumber >= totalEpisodes}
          onClick={() => selectEpisode(episodeNumber + 1)}
        >
          Следующая серия <SkipForward size={15} />
        </button>
      </div>
    </section>
  );
}
