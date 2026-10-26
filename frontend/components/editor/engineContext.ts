'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { PreviewEngine } from '@/lib/editor/engine';

export const EngineContext = createContext<PreviewEngine | null>(null);

export function useEngine() {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine doit être utilisé dans <EngineContext.Provider>');
  return engine;
}

/**
 * Temps de lecture pour l'interface React, limité à `fps` mises à jour par
 * seconde (la tête de lecture de la timeline se met à jour hors React).
 */
export function usePlayback(fps = 15) {
  const engine = useEngine();
  const [state, setState] = useState({ time: engine.time, playing: engine.playing });
  useEffect(() => {
    let last = 0;
    return engine.subscribe((time, playing) => {
      const now = performance.now();
      if (!playing || now - last > 1000 / fps) {
        last = now;
        setState((s) => (s.time === time && s.playing === playing ? s : { time, playing }));
      }
    });
  }, [engine, fps]);
  return state;
}

/** Glisser-déposer depuis les panneaux vers la timeline. */
export const DND_MIME = 'application/x-cliptok-editor';
export type DragPayload =
  | { type: 'media'; media: import('@/lib/types').Media }
  | { type: 'sfx'; sfx: import('@/lib/types').SfxItem }
  | { type: 'text'; presetId?: string }
  | { type: 'sticker'; emoji: string };
