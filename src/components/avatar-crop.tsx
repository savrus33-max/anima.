"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Move, RotateCcw, Upload, X, ZoomIn } from "lucide-react";
import { Modal } from "./ui";

const EXPORT_SIZE = 512;
const VIEW_SIZE = 300;

/**
 * Circular avatar cropper: the user picks the exact part of the uploaded
 * photo that lands inside the circle, with drag + zoom, then exports a
 * square WebP data URL.
 */
export default function AvatarCrop({
  src,
  fileName,
  onCancel,
  onConfirm,
  onPickAnother,
}: {
  src: string;
  fileName?: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
  onPickAnother: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const ratio = EXPORT_SIZE / VIEW_SIZE; // canvas px per CSS px

  const geometry = useCallback(() => {
    const img = image.current;
    if (!img) return null;
    const base = Math.max(EXPORT_SIZE / img.naturalWidth, EXPORT_SIZE / img.naturalHeight);
    const scale = base * zoom;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    return { w, h, dx: (EXPORT_SIZE - w) / 2 + offset.x * ratio, dy: (EXPORT_SIZE - h) / 2 + offset.y * ratio };
  }, [zoom, offset, ratio]);

  const clamp = useCallback((next: { x: number; y: number }, z = zoom) => {
    const img = image.current;
    if (!img) return next;
    const base = Math.max(EXPORT_SIZE / img.naturalWidth, EXPORT_SIZE / img.naturalHeight);
    const w = img.naturalWidth * base * z;
    const h = img.naturalHeight * base * z;
    const max = (v: number, span: number) => Math.max(-(span - EXPORT_SIZE) / 2 / ratio, Math.min((span - EXPORT_SIZE) / 2 / ratio, v));
    return { x: max(next.x, w), y: max(next.y, h) };
  }, [zoom, ratio]);

  const draw = useCallback(() => {
    const c = canvas.current;
    const img = image.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const g = geometry();
    if (!g) return;
    ctx.clearRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);
    ctx.drawImage(img, g.dx, g.dy, g.w, g.h);
  }, [geometry]);

  // Load the source exactly once per file. Depending on `draw` here would
  // recreate the image on every render and reset the crop position.
  useEffect(() => {
    setReady(false);
    setOffset({ x: 0, y: 0 });
    setZoom(1);
    const img = new Image();
    img.onload = () => {
      image.current = img;
      setReady(true);
    };
    img.src = src;
    return () => {
      image.current = null;
    };
  }, [src]);

  useEffect(() => {
    if (ready) draw();
  }, [ready, draw]);

  function onPointerDown(e: React.PointerEvent) {
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dx = (e.clientX - last.current.x) / ratio;
    const dy = (e.clientY - last.current.y) / ratio;
    last.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => clamp({ x: prev.x + dx, y: prev.y + dy }));
  }
  function onPointerUp(e: React.PointerEvent) {
    dragging.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }
  function changeZoom(value: number) {
    setZoom(value);
    setOffset((prev) => clamp(prev, value));
  }
  function reset() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }
  function confirm() {
    const c = canvas.current;
    if (!c || !ready) return;
    onConfirm(c.toDataURL("image/webp", 0.88));
  }

  return (
    <Modal onClose={onCancel} label="Выбери круг для аватара" className="crop-modal">
      <h2>
        Выбери круг<span className="lime">.</span>
      </h2>
      <p className="muted">
        Потяни фото и приближай, пока лицо не окажется в круге.
      </p>

      <div
        className="crop-stage"
        style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas
          ref={canvas}
          width={EXPORT_SIZE}
          height={EXPORT_SIZE}
          style={{ width: VIEW_SIZE, height: VIEW_SIZE, cursor: dragging.current ? "grabbing" : "grab" }}
        />
        <div className="crop-ring" />
        <div className="crop-hint">
          <Move size={13} /> Перетащи
        </div>
      </div>

      <div className="crop-controls">
        <label className="crop-zoom">
          <ZoomIn size={16} />
          <span className="visually-hidden">Масштаб</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => changeZoom(Number(e.target.value))}
          />
          <small>{zoom.toFixed(1)}×</small>
        </label>
        <button type="button" className="text-button" onClick={reset}>
          <RotateCcw size={14} /> Сбросить
        </button>
      </div>

      {fileName && <p className="crop-file">Файл: {fileName}</p>}

      <div className="crop-actions">
        <button type="button" className="button button-secondary" onClick={onPickAnother}>
          <Upload size={16} /> Другое фото
        </button>
        <button type="button" className="button button-primary" onClick={confirm} disabled={!ready}>
          <Check size={16} /> Сделать аватаром
        </button>
      </div>
      <button type="button" className="text-button crop-cancel" onClick={onCancel}>
        <X size={14} /> Отмена
      </button>
    </Modal>
  );
}
