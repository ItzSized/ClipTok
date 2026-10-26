'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Volume2, VolumeX, Lock, Unlock, Film, Music, Type, Captions, Trash2, Plus, Gauge, Sparkles, Diamond } from 'lucide-react';
import * as core from '@shared/editorCore';
import type { Clip, Track } from '@shared/editorCore';
import { useEditor, useEditorStore, isSfxTrack } from './store';
import { useEngine, DND_MIME, type DragPayload } from './engineContext';
import { getWaveform, mediaThumbnailUrl, absoluteFileUrl } from '@/lib/api';

const HEADER_W = 168;
const RULER_H = 28;

function trackHeight(t: Track) {
  if (t.main) return 64;
  if (t.kind === 'caption') return 36;
  if (t.kind === 'audio') return 44;
  return 46;
}

function compatible(clip: Clip, track: Track) {
  if (track.kind === 'audio') return clip.type === 'audio';
  if (track.kind === 'caption') return clip.type === 'caption';
  if (track.main) return clip.type === 'video' || clip.type === 'image';
  return core.isVisual(clip);
}

// ------------------------------------------------------------------ forme d'onde

const waveCache = new Map<string, Promise<{ rate: number; peaks: number[] } | null>>();

function Waveform({ mediaId, trimStart, span, width, height, color }: { mediaId: string; trimStart: number; span: number; width: number; height: number; color: string }) {
  const [data, setData] = useState<{ rate: number; peaks: number[] } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!waveCache.has(mediaId)) waveCache.set(mediaId, getWaveform(mediaId).catch(() => null));
    waveCache.get(mediaId)!.then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [mediaId]);
  const path = useMemo(() => {
    if (!data || width < 2) return '';
    const cols = Math.min(Math.floor(width / 2), 2000);
    const mid = height / 2;
    let d = '';
    for (let i = 0; i < cols; i++) {
      const t0 = trimStart + (i / cols) * span;
      const t1 = trimStart + ((i + 1) / cols) * span;
      let peak = 0;
      for (let j = Math.floor(t0 * data.rate); j < Math.ceil(t1 * data.rate) && j < data.peaks.length; j++) peak = Math.max(peak, data.peaks[j] || 0);
      const x = (i / cols) * width;
      const h = Math.max(0.5, peak * mid * 0.95);
      d += `M${x.toFixed(1)} ${(mid - h).toFixed(1)}V${(mid + h).toFixed(1)}`;
    }
    return d;
  }, [data, width, height, trimStart, span]);
  if (!path) return null;
  return (
    <svg width={width} height={height} className="absolute inset-0 pointer-events-none" preserveAspectRatio="none">
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" />
    </svg>
  );
}

// ------------------------------------------------------------------ clip

const COLORS: Record<string, string> = {
  video: 'bg-sky-900/70 border-sky-400/40',
  image: 'bg-teal-900/70 border-teal-400/40',
  audio: 'bg-emerald-900/70 border-emerald-400/40',
  text: 'bg-violet-800/80 border-violet-400/50',
  sticker: 'bg-amber-800/70 border-amber-400/50',
  caption: 'bg-cyan-900/70 border-cyan-400/50',
};

interface ClipViewProps {
  clip: Clip;
  left: number;
  width: number;
  height: number;
  selected: boolean;
  dragging: boolean;
  onBodyDown: (e: React.PointerEvent, clip: Clip) => void;
  onTrimDown: (e: React.PointerEvent, clip: Clip, side: 'left' | 'right') => void;
}

const ClipView = memo(function ClipView({ clip, left, width, height, selected, dragging, onBodyDown, onTrimDown }: ClipViewProps) {
  const label = clip.type === 'text' ? clip.text : clip.type === 'sticker' ? clip.emoji : clip.type === 'caption' ? (clip.words || []).slice(0, 12).map((w) => w.text).join(' ') : clip.name;
  const thumb = clip.type === 'video' && clip.mediaId ? mediaThumbnailUrl(clip.mediaId) : clip.type === 'image' && clip.src ? absoluteFileUrl(clip.src) : null;
  const hasFx = (clip.effects || []).length > 0 || (clip.filter && clip.filter.id !== 'none') || clip.animIn || clip.animOut || clip.animLoop;
  const hasKeys = clip.keyframes && Object.values(clip.keyframes).some((k) => k && k.length);
  return (
    <div
      data-clip={clip.id}
      onPointerDown={(e) => onBodyDown(e, clip)}
      className={`absolute top-1 rounded-md border overflow-hidden select-none cursor-grab active:cursor-grabbing group ${COLORS[clip.type]} ${selected ? 'ring-2 ring-white z-10' : 'hover:brightness-125'
        } ${dragging ? 'opacity-80 shadow-2xl z-20' : ''}`}
      style={{
        left,
        width: Math.max(4, width),
        height: height - 8,
        backgroundImage: thumb ? `url(${thumb})` : undefined,
        backgroundSize: thumb ? `auto 100%` : undefined,
        backgroundRepeat: 'repeat-x',
      }}
    >
      {thumb && <div className="absolute inset-0 bg-black/35" />}
      {(clip.type === 'audio' || (clip.type === 'video' && clip.hasAudio !== false && height > 50)) && clip.mediaId && (
        <div className={`absolute inset-x-0 ${clip.type === 'video' ? 'bottom-0 h-1/3 bg-black/40' : 'inset-y-0'}`}>
          <Waveform
            mediaId={clip.mediaId}
            trimStart={clip.trimStart || 0}
            span={clip.duration * (clip.speed || 1)}
            width={Math.max(4, width)}
            height={clip.type === 'video' ? (height - 8) / 3 : height - 8}
            color={clip.muted ? 'rgba(255,255,255,0.25)' : clip.type === 'video' ? 'rgba(125,211,252,0.9)' : 'rgba(110,231,183,0.9)'}
          />
        </div>
      )}
      <div className="relative flex items-center gap-1 px-1.5 pt-0.5 text-[10px] font-semibold text-white whitespace-nowrap">
        {clip.type === 'video' && <Film className="w-3 h-3 flex-shrink-0 opacity-80" />}
        {clip.type === 'audio' && <Music className="w-3 h-3 flex-shrink-0 opacity-80" />}
        {clip.type === 'text' && <Type className="w-3 h-3 flex-shrink-0 opacity-80" />}
        {clip.type === 'caption' && <Captions className="w-3 h-3 flex-shrink-0 opacity-80" />}
        {(clip.speed || 1) !== 1 && (
          <span className="flex items-center gap-0.5 bg-black/50 rounded px-1">
            <Gauge className="w-2.5 h-2.5" />
            {clip.speed}x
          </span>
        )}
        {hasFx && <Sparkles className="w-3 h-3 text-yellow-300 flex-shrink-0" />}
        {hasKeys && <Diamond className="w-2.5 h-2.5 text-sky-300 flex-shrink-0" />}
        {clip.muted && <VolumeX className="w-3 h-3 flex-shrink-0 text-red-300" />}
        <span className="truncate">{label}</span>
      </div>
      {/* Poignées de rognage */}
      <div onPointerDown={(e) => onTrimDown(e, clip, 'left')} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40 group-hover:bg-white/20" />
      <div onPointerDown={(e) => onTrimDown(e, clip, 'right')} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40 group-hover:bg-white/20" />
    </div>
  );
});

// ------------------------------------------------------------------ timeline

interface DragState {
  mode: 'move' | 'trim-left' | 'trim-right';
  clipId: string;
  pointerX: number;
  pointerY: number;
  origStart: number;
  origDuration: number;
  origTrack: string;
  start: number;
  trackId: string;
  moved: boolean;
  lastDelta: number;
}

function formatRuler(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Timeline() {
  const store = useEditorStore();
  const engine = useEngine();
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const zoom = useEditor((s) => s.zoom);
  const snapping = useEditor((s) => s.snapping);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dropHint, setDropHint] = useState<{ trackId: string; time: number } | null>(null);

  const duration = core.projectDuration(project);
  const contentW = Math.max((duration + 12) * zoom, 800);
  const rows = useMemo(() => {
    let top = RULER_H;
    return project.tracks.map((t) => {
      const h = trackHeight(t);
      const row = { track: t, top, height: h };
      top += h;
      return row;
    });
  }, [project.tracks]);

  // Tête de lecture : mise à jour directe du DOM (60 fps sans re-rendu React).
  useEffect(() => {
    const update = (time: number, playing: boolean) => {
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${time * zoom}px)`;
      // Défilement automatique pendant la lecture.
      const sc = scrollRef.current;
      if (playing && sc) {
        const x = time * zoom + HEADER_W;
        if (x > sc.scrollLeft + sc.clientWidth - 60) sc.scrollLeft = x - HEADER_W - 80;
      }
    };
    update(engine.time, false);
    return engine.subscribe(update);
  }, [engine, zoom]);

  // Zoom à la molette (Ctrl) centré sur la souris.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - HEADER_W + el.scrollLeft;
      const time = mouseX / zoom;
      const next = Math.min(400, Math.max(4, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      store.setZoom(next);
      requestAnimationFrame(() => {
        el.scrollLeft = time * next - (e.clientX - rect.left - HEADER_W);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, store]);

  const timeFromClientX = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - HEADER_W + el.scrollLeft) / zoom);
  };

  const trackFromClientY = (clientY: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const y = clientY - rect.top + el.scrollTop;
    return rows.find((r) => y >= r.top && y < r.top + r.height)?.track || null;
  };

  const clientYRel = (clientY: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return clientY - rect.top + el.scrollTop;
  };

  /** Points d'aimantation : 0, tête de lecture, bords des autres clips. */
  const snapPoints = (excludeId: string) => {
    const pts = [0, engine.time];
    for (const c of project.clips) if (c.id !== excludeId) pts.push(c.start, core.clipEnd(c));
    return pts;
  };

  const snap = (value: number, excludeId: string, length = 0) => {
    if (!snapping) return value;
    const threshold = 8 / zoom;
    let best = value;
    let bestDist = threshold;
    for (const p of snapPoints(excludeId)) {
      if (Math.abs(p - value) < bestDist) {
        best = p;
        bestDist = Math.abs(p - value);
      }
      if (length && Math.abs(p - (value + length)) < bestDist) {
        best = p - length;
        bestDist = Math.abs(p - (value + length));
      }
    }
    return best;
  };

  const onBodyDown = (e: React.PointerEvent, clip: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (!selection.clipIds.includes(clip.id) || e.shiftKey) store.select([clip.id], e.shiftKey);
    if (track?.locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const d: DragState = { mode: 'move', clipId: clip.id, pointerX: e.clientX, pointerY: e.clientY, origStart: clip.start, origDuration: clip.duration, origTrack: clip.trackId, start: clip.start, trackId: clip.trackId, moved: false, lastDelta: 0 };
    dragRef.current = d;
  };

  const onTrimDown = (e: React.PointerEvent, clip: Clip, side: 'left' | 'right') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    store.select([clip.id]);
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode: side === 'left' ? 'trim-left' : 'trim-right', clipId: clip.id, pointerX: e.clientX, pointerY: e.clientY, origStart: clip.start, origDuration: clip.duration, origTrack: clip.trackId, start: clip.start, trackId: clip.trackId, moved: false, lastDelta: 0 };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.pointerX;
      if (!d.moved && Math.abs(dx) < 3 && Math.abs(e.clientY - d.pointerY) < 3) return;
      d.moved = true;
      const clip = store.clip(d.clipId);
      if (!clip) return;
      if (d.mode === 'move') {
        const y = clientYRel(e.clientY);
        const lastBottom = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : RULER_H;
        const target = trackFromClientY(e.clientY);
        let trackId = d.trackId;
        if (target && compatible(clip, target) && !target.locked) {
          trackId = target.id;
        } else if (clip.type === 'audio' && y >= lastBottom - 4) {
          const origT = project.tracks.find((t) => t.id === d.origTrack);
          const isShortOrSfx = (origT && isSfxTrack(origT)) || (clip.duration || 0) <= 10 || String(clip.src || '').includes('/sfx/');
          trackId = isShortOrSfx ? '__new_sfx__' : '__new_audio__';
        } else if (core.isVisual(clip) && y < RULER_H + 10) {
          trackId = '__new_visual__';
        }
        const start = snap(Math.max(0, d.origStart + dx / zoom), clip.id, clip.duration);
        const next = { ...d, start, trackId };
        dragRef.current = next;
        setDrag(next);
      } else {
        // Rognage en direct (fusionné en une seule étape d'historique).
        const raw = dx / zoom;
        const origEnd = d.origStart + d.origDuration;
        const delta = d.mode === 'trim-left' ? snap(d.origStart + raw, clip.id) - d.origStart : snap(origEnd + raw, clip.id) - origEnd;
        const step = delta - d.lastDelta;
        if (Math.abs(step) > 1e-4) {
          store.trimClip(d.clipId, d.mode === 'trim-left' ? 'left' : 'right', step);
          d.lastDelta = delta;
        }
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d || !d.moved || d.mode !== 'move') return;
      const track = project.tracks.find((t) => t.id === d.trackId);
      // Piste principale : on se place juste avant le clip visé pour fixer l'ordre.
      store.moveClip(d.clipId, track?.main ? d.start - 0.001 : d.start, d.trackId);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });

  // Défilement de la tête de lecture en cliquant / glissant sur la règle.
  const scrubbing = useRef(false);
  const onRulerDown = (e: React.PointerEvent) => {
    scrubbing.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    engine.seek(timeFromClientX(e.clientX));
  };

  const onLaneDrop = (e: React.DragEvent, track?: Track, forceNewRole?: 'sfx' | 'audio') => {
    e.preventDefault();
    setDropHint(null);
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    const payload = JSON.parse(raw) as DragPayload;
    const time = timeFromClientX(e.clientX);
    let targetTrackId = track?.id;
    if (forceNewRole) {
      targetTrackId = store.addTrack('audio', forceNewRole === 'sfx' ? 'sfx' : undefined);
    }
    if (payload.type === 'media') {
      const m = payload.media;
      const ok = track ? (m.kind === 'audio' ? track.kind === 'audio' : track.kind === 'visual') : true;
      store.addMedia(m, time, ok ? targetTrackId : undefined);
    } else if (payload.type === 'sfx') {
      if (!targetTrackId && !track) targetTrackId = store.addTrack('audio', 'sfx');
      store.addMedia({ ...payload.sfx, kind: 'audio' } as any, time, (!track || track.kind === 'audio') ? targetTrackId : undefined);
    } else if (payload.type === 'text') {
      engine.seek(time);
      store.addText(payload.presetId);
    } else if (payload.type === 'sticker') {
      engine.seek(time);
      store.addSticker(payload.emoji);
    }
  };

  const ticks = useMemo(() => {
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const major = steps.find((s) => s * zoom >= 80) || 300;
    const minor = major / (major >= 1 ? 5 : 2);
    const out: { t: number; major: boolean }[] = [];
    const end = contentW / zoom;
    for (let t = 0; t <= end; t += minor) out.push({ t: Math.round(t * 1000) / 1000, major: Math.abs(t / major - Math.round(t / major)) < 1e-6 });
    return out;
  }, [zoom, contentW]);

  const main = core.mainTrack(project);
  const mainClips = main ? core.clipsOnTrack(project, main.id) : [];

  return (
    <div ref={scrollRef} className="h-full overflow-auto relative bg-zinc-950 select-none" onPointerUp={() => (scrubbing.current = false)}>
      <div className="relative" style={{ width: contentW + HEADER_W, height: rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height + 60 : 200 }}>
        {/* Règle */}
        <div className="sticky top-0 z-30 flex" style={{ height: RULER_H }}>
          <div className="sticky left-0 z-40 bg-zinc-950 border-b border-r border-white/10 flex items-center px-2 gap-1" style={{ width: HEADER_W, minWidth: HEADER_W }}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Pistes</span>
          </div>
          <div
            className="relative flex-1 bg-zinc-900 border-b border-white/10 cursor-pointer"
            onPointerDown={onRulerDown}
            onPointerMove={(e) => scrubbing.current && engine.seek(timeFromClientX(e.clientX))}
            onPointerUp={() => (scrubbing.current = false)}
          >
            {ticks.map((tk) => (
              <div key={tk.t} className="absolute bottom-0" style={{ left: tk.t * zoom }}>
                <div className={`w-px ${tk.major ? 'h-3 bg-zinc-400' : 'h-1.5 bg-zinc-600'}`} />
                {tk.major && <span className="absolute -top-0.5 left-1 text-[10px] font-mono text-zinc-400 whitespace-nowrap">{formatRuler(tk.t)}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Piste fantôme supérieure lors du déplacement d'un calque visuel au-dessus */}
        {drag && drag.mode === 'move' && drag.trackId === '__new_visual__' && (() => {
          const clip = store.clip(drag.clipId);
          return clip ? (
            <div className="flex" style={{ height: 46 }}>
              <div className="sticky left-0 z-20 bg-sky-950/60 border-b border-r border-sky-400/30 flex items-center gap-1.5 px-2" style={{ width: HEADER_W, minWidth: HEADER_W }}>
                <Plus className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-[11px] font-semibold text-sky-300 truncate">Nouvelle piste vidéo</span>
              </div>
              <div className="relative flex-1 border-b border-sky-400/20 bg-sky-500/10">
                <ClipView clip={clip} left={drag.start * zoom} width={clip.duration * zoom} height={46} selected dragging onBodyDown={() => { }} onTrimDown={() => { }} />
              </div>
            </div>
          ) : null;
        })()}

        {/* Pistes */}
        {rows.map(({ track, height }) => {
          const clips = core.clipsOnTrack(project, track.id);
          const sfxLane = isSfxTrack(track);
          const Icon = track.kind === 'audio' ? Music : track.kind === 'caption' ? Captions : track.main ? Film : Type;
          return (
            <div key={track.id} className="flex" style={{ height }}>
              <div className="sticky left-0 z-20 bg-zinc-900 border-b border-r border-white/10 flex items-center gap-1.5 px-2 group" style={{ width: HEADER_W, minWidth: HEADER_W }}>
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${track.main ? 'text-sky-400' : sfxLane ? 'text-emerald-400' : 'text-zinc-500'}`} />
                <span className={`text-[11px] font-semibold truncate flex-1 ${track.hidden || track.muted ? 'text-zinc-600' : 'text-zinc-300'}`} title={track.name}>{track.name}</span>
                {track.kind !== 'audio' && (
                  <button onClick={() => store.patchTrack(track.id, { hidden: !track.hidden })} className="text-zinc-500 hover:text-white" title={track.hidden ? 'Afficher' : 'Masquer'}>
                    {track.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
                {(track.kind === 'audio' || track.main) && (
                  <button onClick={() => store.patchTrack(track.id, { muted: !track.muted })} className="text-zinc-500 hover:text-white" title={track.muted ? 'Activer le son' : 'Couper le son'}>
                    {track.muted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button onClick={() => store.patchTrack(track.id, { locked: !track.locked })} className="text-zinc-500 hover:text-white" title={track.locked ? 'Déverrouiller' : 'Verrouiller'}>
                  {track.locked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100" />}
                </button>
                {!track.main && (
                  <button onClick={() => store.removeTrack(track.id)} className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100" title="Supprimer la piste">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div
                className={`relative flex-1 border-b border-white/5 ${track.main ? 'bg-sky-500/[0.04]' : ''} ${dropHint?.trackId === track.id ? 'bg-cyan-500/10' : ''}`}
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  store.clearSelection();
                  engine.seek(timeFromClientX(e.clientX));
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DND_MIME)) return;
                  e.preventDefault();
                  setDropHint({ trackId: track.id, time: timeFromClientX(e.clientX) });
                }}
                onDragLeave={() => setDropHint(null)}
                onDrop={(e) => onLaneDrop(e, track)}
              >
                {clips.map((clip) => {
                  const isDragged = drag?.clipId === clip.id && drag.mode === 'move';
                  if (isDragged && drag!.trackId !== track.id) return null;
                  const start = isDragged ? drag!.start : clip.start;
                  return (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      left={start * zoom}
                      width={clip.duration * zoom}
                      height={height}
                      selected={selection.clipIds.includes(clip.id)}
                      dragging={isDragged}
                      onBodyDown={onBodyDown}
                      onTrimDown={onTrimDown}
                    />
                  );
                })}
                {/* Clip déplacé vers cette piste depuis une autre */}
                {drag && drag.mode === 'move' && drag.trackId === track.id && drag.origTrack !== track.id && (() => {
                  const clip = store.clip(drag.clipId);
                  return clip ? <ClipView clip={clip} left={drag.start * zoom} width={clip.duration * zoom} height={height} selected dragging onBodyDown={() => { }} onTrimDown={() => { }} /> : null;
                })()}
                {/* Jonctions de la piste principale (transitions) */}
                {track.main &&
                  mainClips.slice(1).map((b, i) => {
                    const a = mainClips[i];
                    const tr = core.transitionBetween(project, a.id, b.id);
                    const x = tr ? (b.start + core.clipEnd(a)) / 2 : b.start;
                    const active = selection.junction?.fromId === a.id && selection.junction?.toId === b.id;
                    return (
                      <button
                        key={`${a.id}-${b.id}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => store.selectJunction(a.id, b.id)}
                        title={tr ? `Transition : ${core.TRANSITIONS.find((x2) => x2.id === tr.type)?.name || tr.type}` : 'Ajouter une transition'}
                        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 w-5 h-5 rounded-md rotate-45 border flex items-center justify-center transition-colors ${active ? 'bg-cyan-500 border-white' : tr ? 'bg-white border-white' : 'bg-zinc-800 border-white/30 hover:bg-zinc-600'
                          }`}
                        style={{ left: x * zoom }}
                      >
                        <span className={`-rotate-45 text-[10px] font-black leading-none ${tr && !active ? 'text-black' : 'text-white'}`}>{tr ? '⇄' : '+'}</span>
                      </button>
                    );
                  })}
                {track.main && clips.length === 0 && (
                  <div className="absolute inset-0 flex items-center pl-4 text-xs text-zinc-600 pointer-events-none">Glissez une vidéo ou une image ici</div>
                )}
              </div>
            </div>
          );
        })}

        {/* Piste fantôme inférieure lors du déplacement d'un son sous les pistes existantes (style CapCut) */}
        {drag && drag.mode === 'move' && (drag.trackId === '__new_sfx__' || drag.trackId === '__new_audio__') && (() => {
          const clip = store.clip(drag.clipId);
          return clip ? (
            <div className="flex" style={{ height: 44 }}>
              <div className="sticky left-0 z-20 bg-emerald-950/60 border-b border-r border-emerald-400/30 flex items-center gap-1.5 px-2" style={{ width: HEADER_W, minWidth: HEADER_W }}>
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[11px] font-semibold text-emerald-300 truncate">
                  {drag.trackId === '__new_sfx__' ? '+ Effets sonores' : '+ Piste Audio'}
                </span>
              </div>
              <div className="relative flex-1 border-b border-emerald-400/20 bg-emerald-500/10">
                <ClipView clip={clip} left={drag.start * zoom} width={clip.duration * zoom} height={44} selected dragging onBodyDown={() => { }} onTrimDown={() => { }} />
              </div>
            </div>
          ) : null;
        })()}

        {/* Zone de dépôt inférieure + Ajout de pistes à l'infini */}
        <div className="flex" style={{ minHeight: 40 }}>
          <div className="sticky left-0 z-20 bg-zinc-950 border-r border-white/10 flex flex-wrap items-center gap-1 p-1.5" style={{ width: HEADER_W, minWidth: HEADER_W }}>
            <button onClick={() => store.addTrack('visual')} className="flex items-center gap-0.5 text-[10px] font-semibold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded px-1.5 py-1" title="Ajouter une piste vidéo / calque">
              <Plus className="w-3 h-3" />
              Vidéo
            </button>
            <button onClick={() => store.addTrack('audio')} className="flex items-center gap-0.5 text-[10px] font-semibold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded px-1.5 py-1" title="Ajouter une nouvelle piste Audio">
              <Plus className="w-3 h-3" />
              Audio
            </button>
            <button onClick={() => store.addTrack('audio', 'sfx')} className="flex items-center gap-0.5 text-[10px] font-semibold text-emerald-400 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded px-1.5 py-1" title="Ajouter une nouvelle ligne Effets sonores (SFX)">
              <Plus className="w-3 h-3" />
              SFX
            </button>
            <button onClick={() => store.addTrack('caption')} className="flex items-center gap-0.5 text-[10px] font-semibold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded px-1.5 py-1" title="Ajouter une piste Sous-titres">
              <Plus className="w-3 h-3" />
              Sous-titres
            </button>
          </div>
          <div
            className={`relative flex-1 border-b border-dashed border-white/5 flex items-center pl-4 text-[11px] text-zinc-600 transition-colors ${dropHint?.trackId === '__bottom_drop__' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/30' : 'hover:bg-white/[0.01]'}`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DND_MIME)) return;
              e.preventDefault();
              setDropHint({ trackId: '__bottom_drop__', time: timeFromClientX(e.clientX) });
            }}
            onDragLeave={() => setDropHint(null)}
            onDrop={(e) => onLaneDrop(e, undefined, 'sfx')}
          >
            Glissez un audio ou effet sonore ici pour créer une nouvelle ligne
          </div>
        </div>

        {/* Tête de lecture */}
        <div ref={playheadRef} className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: HEADER_W }}>
          <div className="w-px h-full bg-cyan-400 shadow-[0_0_6px_rgba(232,121,249,0.8)]" />
          <div className="absolute -top-0 -left-[5px] w-[11px] h-3 bg-cyan-400 rounded-b-sm" />
        </div>
        {dropHint && <div className="absolute top-0 bottom-0 w-px bg-white/60 z-30 pointer-events-none" style={{ left: HEADER_W + dropHint.time * zoom }} />}
      </div>
    </div>
  );
}

