'use client';

import { useEffect, useRef, useState } from 'react';
import { generateClip, subscribeToJob, cancelJob } from '@/lib/api';
import { playSuccessChime, playErrorTone } from '@/lib/sound';
import type { ClipResult, GenerateClipPayload } from '@/lib/types';

interface RenderProgress {
  current: number;
  total: number;
}

export function useGenerateClip(onComplete: (clips: ClipResult[], projectId: string) => void) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentStep, setCurrentStep] = useState(0);
  const [stepMessage, setStepMessage] = useState('');
  const [stepPercent, setStepPercent] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (loading) {
      interval = setInterval(() => setElapsedTime((prev) => prev + 1), 1000);
    } else {
      setElapsedTime(0);
    }
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    return () => {
      closeRef.current?.();
    };
  }, []);

  const handleEvent = (event: any) => {
    const { type, data } = event;

    if (type === 'step') {
      setCurrentStep(data.step);
      setStepMessage(data.message);
      if (typeof data.percent === 'number') setStepPercent(data.percent);
    } else if (type === 'estimate') {
      setEstimatedTime(data.estimatedSeconds);
    } else if (type === 'progress') {
      setRenderProgress({ current: data.current, total: data.total });
      setStepMessage(data.message);
      if (typeof data.percent === 'number') setStepPercent(data.percent);
    } else if (type === 'done') {
      localStorage.removeItem('activeJobId');
      setLoading(false);
      playSuccessChime();
      onComplete(data.clips, data.projectId);
    } else if (type === 'error') {
      localStorage.removeItem('activeJobId');
      setError(data.error);
      setLoading(false);
      playErrorTone();
    }
  };

  useEffect(() => {
    const savedJobId = localStorage.getItem('activeJobId');
    if (savedJobId) {
      setLoading(true);
      setCurrentJobId(savedJobId);
      closeRef.current = subscribeToJob(savedJobId, handleEvent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setError(null);
    setCurrentStep(0);
    setStepPercent(0);
    setStepMessage('Initialisation...');
    setEstimatedTime(null);
    setRenderProgress(null);
    closeRef.current?.();
    closeRef.current = null;
  };

  const generate = async (payload: GenerateClipPayload) => {
    reset();
    setLoading(true);

    try {
      const { jobId } = await generateClip(payload);
      setCurrentJobId(jobId);
      localStorage.setItem('activeJobId', jobId);

      closeRef.current = subscribeToJob(jobId, handleEvent);
    } catch (err: any) {
      setError(err.message || 'Erreur inconnue.');
      setLoading(false);
      playErrorTone();
    }
  };

  const cancel = async () => {
    if (currentJobId) {
      await cancelJob(currentJobId).catch(() => {});
      localStorage.removeItem('activeJobId');
      setError('Génération annulée.');
      setLoading(false);
      closeRef.current?.();
      closeRef.current = null;
    }
  };

  return {
    loading,
    error,
    currentStep,
    stepMessage,
    stepPercent,
    estimatedTime,
    elapsedTime,
    renderProgress,
    generate,
    cancel,
    reset,
  };
}
