'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelJob, subscribeToJob } from '@/lib/api';

export interface JobState {
  running: boolean;
  message: string;
  percent: number;
  error: string | null;
}

/**
 * Lance une tâche serveur (fonction qui renvoie { jobId }) et suit sa
 * progression via SSE. `run` résout avec le résultat de l'événement 'done'.
 */
export function useJob<T = any>() {
  const [state, setState] = useState<JobState>({ running: false, message: '', percent: 0, error: null });
  const jobIdRef = useRef<string | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => () => closeRef.current?.(), []);

  const run = useCallback((start: () => Promise<{ jobId: string }>): Promise<T | null> => {
    closeRef.current?.();
    setState({ running: true, message: 'Démarrage...', percent: 0, error: null });
    return new Promise((resolve) => {
      start()
        .then(({ jobId }) => {
          jobIdRef.current = jobId;
          closeRef.current = subscribeToJob(jobId, (event) => {
            const d = event.data || {};
            if (event.type === 'queued') setState((s) => ({ ...s, message: "En file d'attente (une autre tâche est en cours)..." }));
            else if (event.type === 'step' || event.type === 'progress') setState((s) => ({ ...s, message: d.message || s.message, percent: typeof d.percent === 'number' ? d.percent : s.percent }));
            else if (event.type === 'done') {
              setState({ running: false, message: 'Terminé', percent: 100, error: null });
              jobIdRef.current = null;
              resolve(d as T);
            } else if (event.type === 'error') {
              setState({ running: false, message: '', percent: 0, error: d.error || 'Erreur inconnue.' });
              jobIdRef.current = null;
              resolve(null);
            }
          });
        })
        .catch((err) => {
          setState({ running: false, message: '', percent: 0, error: err.message || 'Erreur inconnue.' });
          resolve(null);
        });
    });
  }, []);

  const cancel = useCallback(async () => {
    if (jobIdRef.current) await cancelJob(jobIdRef.current);
  }, []);

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { ...state, run, cancel, clearError };
}
