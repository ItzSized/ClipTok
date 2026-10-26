'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import type { CaptionStyle } from '@shared/captionEngine';
import type { CaptionFraming, FontInfo, TranscriptWord } from '@/lib/types';
import { absoluteFileUrl } from '@/lib/api';
import { prepareCaptions, drawCaptions } from '@/lib/captionCanvas';
import { ensureFontById } from '@/lib/fonts';
import { formatTime } from '@/components/ui/controls';

const ASPECTS: Record<string, [number, number]> = { '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080] };

/** Même calcul que le backend (captionRenderer.outputSize). */
export function outputSize(srcW: number, srcH: number, aspect: string) {
  if (ASPECTS[aspect]) return { width: ASPECTS[aspect][0], height: ASPECTS[aspect][1] };
  return { width: srcW || 1080, height: srcH || 1920 };
}

export interface CaptionPreviewHandle {
  seek: (t: number) => void;
  togglePlay: () => void;
}

interface Props {
  src: string;
  words: TranscriptWord[];
  style: CaptionStyle;
  framing: CaptionFraming;
  sourceWidth: number;
  sourceHeight: number;
  onTimeChange?: (t: number) => void;
  onStyleChange?: (style: CaptionStyle) => void;
}

/** Dessine une image vidéo selon le cadrage choisi (identique aux filtres ffmpeg du rendu). */
function drawFramed(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, framing: CaptionFraming, W: number, H: number) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!vw || !vh) return;
  const cover = Math.max(W / vw, H / vh);
  const contain = Math.min(W / vw, H / vh);
  if (framing.aspect === 'original') {
    ctx.drawImage(video, 0, 0, W, H);
  } else if (framing.fit === 'crop') {
    const dw = vw * cover;
    const dh = vh * cover;
    ctx.drawImage(video, (W - dw) * framing.cropX, (H - dh) / 2, dw, dh);
  } else {
    if (framing.fit === 'blur') {
      ctx.save();
      ctx.filter = `blur(${Math.round(Math.max(W, H) / 40)}px) brightness(0.92)`;
      const dw = vw * cover;
      const dh = vh * cover;
      ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.restore();
    }
    const dw = vw * contain;
    const dh = vh * contain;
    ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
}

const CaptionPreview = forwardRef<CaptionPreviewHandle, Props>(function CaptionPreview(
  { src, words, style, framing, sourceWidth, sourceHeight, onTimeChange, onStyleChange },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [font, setFont] = useState<FontInfo | null>(null);
  const [box, setBox] = useState({ w: 300, h: 500 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const out = outputSize(sourceWidth, sourceHeight, framing.aspect);
  const prepared = useMemo(() => prepareCaptions(words, style), [words, style]);

  useEffect(() => {
    let alive = true;
    ensureFontById(style.fontId).then((f) => alive && setFont(f));
    return () => {
      alive = false;
    };
  }, [style.fontId]);

  // Taille d'affichage : on remplit le conteneur en gardant le ratio de sortie.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const maxW = el.clientWidth;
      const maxH = el.clientHeight;
      const ratio = out.width / out.height;
      let w = maxW;
      let h = w / ratio;
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [out.width, out.height]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawFramed(ctx, video, framing, canvas.width, canvas.height);
    drawCaptions(ctx, prepared, font, video.currentTime, canvas.width, canvas.height);
  }, [framing, prepared, font]);

  // Boucle d'affichage : redessine à chaque image pendant la lecture.
  useEffect(() => {
    let raf = 0;
    let lastReported = -1;
    const loop = () => {
      draw();
      const v = videoRef.current;
      if (v && Math.abs(v.currentTime - lastReported) > 0.04) {
        lastReported = v.currentTime;
        setTime(v.currentTime);
        onTimeChange?.(v.currentTime);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw, onTimeChange]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  useImperativeHandle(ref, () => ({
    seek: (t: number) => {
      if (videoRef.current) videoRef.current.currentTime = Math.max(0, t);
    },
    togglePlay,
  }));

  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <div ref={wrapRef} className="flex-1 min-h-0 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={Math.round(box.w * dpr)}
          height={Math.round(box.h * dpr)}
          style={{ width: box.w, height: box.h }}
          className="rounded-xl shadow-2xl bg-black cursor-pointer touch-none"
          onPointerDown={(e) => {
            dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d || !onStyleChange) return;
            if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
            d.moved = true;
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            const x = Math.min(0.9, Math.max(0.1, (e.clientX - rect.left) / rect.width));
            const y = Math.min(0.95, Math.max(0.05, (e.clientY - rect.top) / rect.height));
            onStyleChange({ ...style, positionX: Math.round(x * 1000) / 1000, positionY: Math.round(y * 1000) / 1000 });
          }}
          onPointerUp={() => {
            if (dragRef.current && !dragRef.current.moved) togglePlay();
            dragRef.current = null;
          }}
        />
        <video
          ref={videoRef}
          src={absoluteFileUrl(src)}
          crossOrigin="anonymous"
          playsInline
          preload="auto"
          muted={muted}
          className="hidden"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      </div>

      <div className="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
        <button type="button" onClick={togglePlay} className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center flex-shrink-0" aria-label={playing ? 'Pause' : 'Lecture'}>
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <span className="text-xs font-mono text-zinc-300 w-24 flex-shrink-0">
          {formatTime(time, true)} / {formatTime(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={time}
          onChange={(e) => {
            if (videoRef.current) videoRef.current.currentTime = Number(e.target.value);
          }}
          className="flex-1 accent-fuchsia-500 cursor-pointer"
        />
        <button type="button" onClick={() => setMuted((m) => !m)} className="text-zinc-400 hover:text-white" aria-label={muted ? 'Activer le son' : 'Couper le son'}>
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
});

export default CaptionPreview;
