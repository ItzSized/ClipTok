'use client';

import { useEffect, useRef, useState } from 'react';
import { GripHorizontal } from 'lucide-react';
import { getJSON, setJSON } from '@/lib/storage';
import Timeline from './Timeline';
import Toolbar from './Toolbar';

const HEIGHT_KEY = 'cliptok:timeline-height';
const MIN_H = 140;

/**
 * Timeline + barre d'outils avec une poignée bien visible pour la monter ou la
 * descendre (glisser ; double-clic : taille par défaut). Hauteur mémorisée.
 */
export default function ResizableTimeline({ defaultHeight = 300 }: { defaultHeight?: number }) {
  const [height, setHeight] = useState(defaultHeight);
  const [width, setWidth] = useState(1200);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const maxH = () => Math.round(window.innerHeight * 0.8);

  useEffect(() => {
    const saved = getJSON<number>(HEIGHT_KEY, 0);
    if (saved) setHeight(Math.min(maxH(), Math.max(MIN_H, saved)));
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const apply = (h: number) => {
    const next = Math.min(maxH(), Math.max(MIN_H, Math.round(h)));
    setHeight(next);
    setJSON(HEIGHT_KEY, next);
  };

  return (
    <>
      <div
        className="group h-3 flex-shrink-0 cursor-row-resize flex items-center justify-center bg-white/[0.03] hover:bg-cyan-500/20 border-t border-white/10 touch-none select-none"
        title="Glisser pour agrandir ou réduire la timeline (double-clic : taille par défaut)"
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, h: height };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) apply(drag.current.h - (e.clientY - drag.current.y));
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => apply(defaultHeight)}
      >
        <GripHorizontal className="w-5 h-3 text-zinc-500 group-hover:text-cyan-300" />
      </div>
      <div ref={wrap} className="flex flex-col flex-shrink-0" style={{ height }}>
        <Toolbar timelineWidth={width} />
        <div className="flex-1 min-h-0">
          <Timeline />
        </div>
      </div>
    </>
  );
}
