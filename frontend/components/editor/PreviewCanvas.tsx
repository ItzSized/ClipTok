'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Maximize, Shield, ChevronsLeft, ChevronsRight, RotateCw } from 'lucide-react';
import * as core from '@shared/editorCore';
import type { Clip } from '@shared/editorCore';
import { useEditor, useEditorStore } from './store';
import { useEngine, usePlayback } from './engineContext';
import { formatTime } from '@/components/ui/controls';

type Gesture =
  | { kind: 'move'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: 'scale'; id: string; cx: number; cy: number; startDist: number; origScale: number }
  | { kind: 'rotate'; id: string; cx: number; cy: number; startAngle: number; origRotation: number }
  | { kind: 'caption'; id: string; moved: boolean; sx: number; sy: number }
  | { kind: 'tap'; sx: number; sy: number };

/** Valeurs de base (images clés incluses, animations exclues) : c'est ce qu'on édite. */
function baseState(clip: Clip, local: number) {
  return core.visualStateAt({ ...clip, animIn: null, animOut: null, animLoop: null, effects: [] }, Math.max(0, Math.min(local, clip.duration)));
}

export default function PreviewCanvas() {
  const store = useEditorStore();
  const engine = useEngine();
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const { time, playing } = usePlayback(20);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 270, h: 480 });
  const [safe, setSafe] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const [, force] = useState(0);
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const { width: PW, height: PH } = project.settings;

  useEffect(() => {
    if (canvasRef.current) engine.attach(canvasRef.current);
  }, [engine]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const ratio = PW / PH;
      let w = el.clientWidth - 16;
      let h = w / ratio;
      if (h > el.clientHeight - 16) {
        h = el.clientHeight - 16;
        w = h * ratio;
      }
      setBox({ w: Math.max(40, Math.floor(w)), h: Math.max(40, Math.floor(h)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [PW, PH]);

  useEffect(() => {
    engine.requestRender();
  }, [box, engine]);

  // Redessine l'encadré de sélection quand le moteur avance (pendant la lecture).
  useEffect(() => engine.subscribe(() => force((n) => (n + 1) % 1e6)), [engine]);

  const selectedClip = selection.clipIds.length === 1 ? project.clips.find((c) => c.id === selection.clipIds[0]) : null;
  const geo = selectedClip && core.isVisual(selectedClip) ? engine.geometry(selectedClip, time) : null;

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr, fx: (e.clientX - rect.left) / rect.width, fy: (e.clientY - rect.top) / rect.height };
  };

  const startMove = (e: React.PointerEvent, clip: Clip) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const b = baseState(clip, engine.time - clip.start);
    gesture.current = { kind: 'move', id: clip.id, sx: e.clientX, sy: e.clientY, ox: b.x, oy: b.y, moved: false };
  };

  const startScale = (e: React.PointerEvent, clip: Clip) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const g = engine.geometry(clip)!;
    const p = toCanvas(e);
    gesture.current = { kind: 'scale', id: clip.id, cx: g.cx, cy: g.cy, startDist: Math.hypot(p.x - g.cx, p.y - g.cy) || 1, origScale: baseState(clip, engine.time - clip.start).scale };
  };

  const startRotate = (e: React.PointerEvent, clip: Clip) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const g = engine.geometry(clip)!;
    const p = toCanvas(e);
    gesture.current = { kind: 'rotate', id: clip.id, cx: g.cx, cy: g.cy, startAngle: Math.atan2(p.y - g.cy, p.x - g.cx), origRotation: baseState(clip, engine.time - clip.start).rotation };
  };

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    if (g.kind === 'move') {
      const dx = (e.clientX - g.sx) / rect.width;
      const dy = (e.clientY - g.sy) / rect.height;
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return;
      g.moved = true;
      // Aimantation au centre du cadre.
      let x = g.ox + dx;
      let y = g.oy + dy;
      if (Math.abs(x - 0.5) < 0.012) x = 0.5;
      if (Math.abs(y - 0.5) < 0.012) y = 0.5;
      store.setTransformProps(g.id, { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 });
    } else if (g.kind === 'scale') {
      const p = toCanvas(e);
      const ratio = Math.hypot(p.x - g.cx, p.y - g.cy) / g.startDist;
      store.setTransformProp(g.id, 'scale', Math.max(0.02, Math.round(g.origScale * ratio * 1000) / 1000));
    } else if (g.kind === 'rotate') {
      const p = toCanvas(e);
      let deg = g.origRotation + ((Math.atan2(p.y - g.cy, p.x - g.cx) - g.startAngle) * 180) / Math.PI;
      for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snap) < 4) deg = snap;
      store.setTransformProp(g.id, 'rotation', Math.round(deg * 10) / 10);
    } else if (g.kind === 'caption') {
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) return;
      g.moved = true;
      const p = toCanvas(e);
      store.patchClip(g.id, (c) => {
        c.captionStyle = { ...(c.captionStyle || {}), positionX: Math.min(0.9, Math.max(0.1, p.fx)), positionY: Math.min(0.95, Math.max(0.05, p.fy)) };
      });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'tap' || (g.kind === 'move' && !g.moved) || (g.kind === 'caption' && !g.moved)) {
      const p = toCanvas(e);
      const hit = engine.hitTest(p.x, p.y);
      if (hit) store.select([hit], e.shiftKey);
      else if (g.kind !== 'caption') {
        // Clic sur les sous-titres (zone basse/milieu) : sélection du clip de sous-titres actif.
        const cap = project.clips.find((c) => c.type === 'caption' && engine.time >= c.start && engine.time < core.clipEnd(c));
        if (cap) store.select([cap.id]);
        else store.clearSelection();
      }
    }
  };

  const onCanvasDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (selectedClip?.type === 'caption') gesture.current = { kind: 'caption', id: selectedClip.id, moved: false, sx: e.clientX, sy: e.clientY };
    else gesture.current = { kind: 'tap', sx: e.clientX, sy: e.clientY };
  };

  const fps = project.settings.fps || 30;
  const duration = core.projectDuration(project);

  return (
    <div ref={containerRef} className="flex flex-col h-full min-h-0 bg-zinc-950">
      <div ref={wrapRef} className="flex-1 min-h-0 flex items-center justify-center relative overflow-hidden" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
        <div className="relative" style={{ width: box.w, height: box.h }}>
          <canvas
            ref={canvasRef}
            width={Math.round(box.w * dpr)}
            height={Math.round(box.h * dpr)}
            style={{ width: box.w, height: box.h }}
            className="block shadow-2xl touch-none"
            onPointerDown={onCanvasDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />

          {safe && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-x-0 top-0 bg-red-500/15 border-b border-dashed border-red-400/60" style={{ height: '8%' }} />
              <div className="absolute inset-x-0 bottom-0 bg-red-500/15 border-t border-dashed border-red-400/60" style={{ height: '20%' }} />
              <div className="absolute right-0 bg-red-500/15 border-l border-dashed border-red-400/60" style={{ top: '40%', height: '40%', width: '13%' }} />
              <span className="absolute top-1 left-1 text-[9px] font-bold text-red-300">Zones masquées par TikTok / Reels</span>
            </div>
          )}

          {geo && selectedClip && (
            <div
              className="absolute border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.5)] cursor-move touch-none"
              style={{
                left: geo.cx / dpr - geo.w / dpr / 2,
                top: geo.cy / dpr - geo.h / dpr / 2,
                width: geo.w / dpr,
                height: geo.h / dpr,
                transform: `rotate(${geo.rotation}deg)`,
              }}
              onPointerDown={(e) => startMove(e, selectedClip)}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <div
                  key={corner}
                  onPointerDown={(e) => startScale(e, selectedClip)}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className="absolute w-3 h-3 bg-white rounded-full border border-black/40 touch-none"
                  style={{
                    left: corner.includes('w') ? -7 : undefined,
                    right: corner.includes('e') ? -7 : undefined,
                    top: corner.includes('n') ? -7 : undefined,
                    bottom: corner.includes('s') ? -7 : undefined,
                    cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                  }}
                />
              ))}
              <div
                onPointerDown={(e) => startRotate(e, selectedClip)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className="absolute left-1/2 -translate-x-1/2 -top-8 w-6 h-6 rounded-full bg-white text-black flex items-center justify-center cursor-grab touch-none shadow"
                title="Pivoter"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 px-3 py-2 border-t border-white/5">
        <TimeInput time={time} duration={duration} onSeek={(t) => engine.seek(t)} />
        <button onClick={() => engine.seek(0)} className="p-1.5 text-zinc-400 hover:text-white" title="Début (Origine)">
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button onClick={() => engine.seek(engine.time - 1 / fps)} className="p-1.5 text-zinc-400 hover:text-white" title="Image précédente (←)">
          <SkipBack className="w-4 h-4" />
        </button>
        <button onClick={() => engine.toggle()} className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform" title="Lecture / pause (Espace)">
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <button onClick={() => engine.seek(engine.time + 1 / fps)} className="p-1.5 text-zinc-400 hover:text-white" title="Image suivante (→)">
          <SkipForward className="w-4 h-4" />
        </button>
        <button onClick={() => engine.seek(duration)} className="p-1.5 text-zinc-400 hover:text-white" title="Fin (Fin)">
          <ChevronsRight className="w-4 h-4" />
        </button>
        <div className="flex justify-start items-center gap-1">
          <select
            value={project.settings.aspect}
            onChange={(e) => {
              const r = core.ASPECT_RATIOS.find((x) => x.id === e.target.value);
              if (r) store.patchSettings({ aspect: r.id, width: r.width, height: r.height });
            }}
            className="bg-white/5 border border-white/10 rounded-md px-1.5 py-1 text-[11px] font-semibold text-zinc-300 outline-none hover:bg-white/10"
            title="Format du cadre (Ratio)"
          >
            {core.ASPECT_RATIOS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
          <button onClick={() => setSafe((s) => !s)} className={`p-1.5 rounded ${safe ? 'text-cyan-300 bg-cyan-500/10' : 'text-zinc-400 hover:text-white'}`} title="Zones de sécurité TikTok">
            <Shield className="w-4 h-4" />
          </button>
          <button onClick={() => containerRef.current?.requestFullscreen?.()} className="p-1.5 text-zinc-400 hover:text-white" title="Plein écran">
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** « 1:02.5 », « 62.5 », « 1:02 », « 0:01:02 » → secondes (null si illisible). */
function parseTime(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => p.trim() === '' || !/^\d*\.?\d*$/.test(p.trim()))) return null;
  const value = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  return Number.isFinite(value) ? value : null;
}

/** Temps courant : cliquer pour taper un temps précis (Entrée pour y aller, Échap pour annuler). */
function TimeInput({ time, duration, onSeek }: { time: number; duration: number; onSeek: (t: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const t = parseTime(text);
    if (t === null) {
      setInvalid(true);
      return;
    }
    onSeek(Math.min(Math.max(0, t), duration));
    setEditing(false);
  };
  if (editing) {
    return (
      <span className="text-xs font-mono text-zinc-300 w-28 text-right flex items-center justify-end gap-1">
        <input
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          title="Ex. : 1:02.50, 62.5 ou 0:01:02 — Entrée pour y aller"
          className={`w-16 bg-black/60 border rounded px-1 py-0.5 text-xs font-mono text-white text-right outline-none ${invalid ? 'border-red-500' : 'border-cyan-500'}`}
        />
        <span className="text-zinc-600">/ {formatTime(duration)}</span>
      </span>
    );
  }
  return (
    <button
      onClick={() => {
        setText(formatTime(time, true));
        setInvalid(false);
        setEditing(true);
      }}
      title="Cliquer pour aller à un temps précis"
      className="text-xs font-mono text-zinc-300 w-28 text-right hover:text-cyan-300 rounded"
    >
      <span className="border-b border-dashed border-zinc-600">{formatTime(time, true)}</span> <span className="text-zinc-600">/ {formatTime(duration)}</span>
    </button>
  );
}
