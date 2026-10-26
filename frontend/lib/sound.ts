'use client';

// Petit moteur audio synthétisé (Web Audio API) : aucun fichier son externe à charger,
// ça marche instantanément et hors-ligne. On génère des carillons via des oscillateurs.

const SOUND_PREF_KEY = 'cliptok:sound-enabled';

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) audioCtx = new AudioContextClass();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(SOUND_PREF_KEY);
  return stored === null ? true : stored === '1';
}

export function setSoundEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SOUND_PREF_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new CustomEvent('cliptok:sound-changed', { detail: enabled }));
}

function tone(
  ctx: AudioContext,
  freq: number,
  offset: number,
  duration: number,
  type: OscillatorType = 'sine',
  peakGain = 0.16
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);

  const t0 = ctx.currentTime + offset;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Petit carillon ascendant (do-mi-sol-do) joué quand une génération se termine. */
export function playSuccessChime() {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;
  tone(ctx, 523.25, 0, 0.16); // C5
  tone(ctx, 659.25, 0.09, 0.16); // E5
  tone(ctx, 783.99, 0.18, 0.2); // G5
  tone(ctx, 1046.5, 0.3, 0.35, 'sine', 0.14); // C6
}

/** Deux notes descendantes graves pour signaler une erreur. */
export function playErrorTone() {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;
  tone(ctx, 392.0, 0, 0.16, 'sine', 0.12); // G4
  tone(ctx, 293.66, 0.13, 0.3, 'sine', 0.12); // D4
}

/** Clic léger pour les micro-interactions (ex: bouton "Nouveau projet"). */
export function playClick() {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;
  tone(ctx, 880, 0, 0.06, 'sine', 0.08);
}
