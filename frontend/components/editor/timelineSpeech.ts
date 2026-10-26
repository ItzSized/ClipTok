/**
 * Outils de parole sur la timeline : transcription des médias utilisés,
 * sous-titres automatiques et coupe des silences. Utilisés par le panneau
 * Sous-titres et par l'Éditeur IA.
 */
import * as core from '@shared/editorCore';
import * as captionEngine from '@shared/captionEngine';
import type { Clip } from '@shared/editorCore';
import { getMedia, transcribeMedia, waitForJob } from '@/lib/api';
import type { TranscriptWord } from '@/lib/types';
import type { EditorStore } from './store';

export type Progress = (message: string, percent: number) => void;

export interface TranscribeOptions {
  language?: string;
  model?: string;
  /** Voix traduite en anglais par Whisper (sous-titres) au lieu de la langue d'origine. */
  translate?: boolean;
  onProgress?: Progress;
  /** Reçoit l'identifiant de chaque tâche serveur (pour pouvoir l'annuler). */
  onJob?: (jobId: string) => void;
}

/** Clips porteurs de parole (vidéos non muettes et sons importés, hors effets sonores). */
export function speechClips(clips: Clip[]) {
  return clips.filter((c) => c.mediaId && !c.src?.startsWith('/sfx/') && !c.muted && ((c.type === 'video' && c.hasAudio !== false) || c.type === 'audio'));
}

/** Transcriptions (mots en temps source) des médias demandés ; transcrit ceux qui ne le sont pas encore. */
export async function ensureTranscripts(mediaIds: string[], opts: TranscribeOptions = {}) {
  const transcripts = new Map<string, TranscriptWord[]>();
  const failed: string[] = [];
  const unique = [...new Set(mediaIds)];
  for (let i = 0; i < unique.length; i++) {
    const id = unique[i];
    const media = await getMedia(id);
    const existing = opts.translate ? media.transcriptEn : media.transcript;
    if (existing) {
      transcripts.set(id, existing.words || []);
      continue;
    }
    const label = `${opts.translate ? 'Traduction anglaise' : 'Transcription'} ${i + 1}/${unique.length} : ${media.name}`;
    opts.onProgress?.(label, 0);
    try {
      const { jobId } = await transcribeMedia(id, { language: opts.language || 'auto', model: opts.model || 'small', translate: opts.translate });
      opts.onJob?.(jobId);
      const result = await waitForJob<{ transcript: { words: TranscriptWord[] } }>(jobId, (msg, pct) => opts.onProgress?.(`${label} — ${msg}`, pct));
      transcripts.set(id, result.transcript.words);
    } catch {
      failed.push(media.name);
    }
  }
  return { transcripts, failed };
}

/** Projette les mots de chaque clip source sur la timeline (point d'entrée, vitesse, position). */
export function timelineWords(clips: Clip[], transcripts: Map<string, TranscriptWord[]>) {
  const words: TranscriptWord[] = [];
  for (const c of clips) {
    const list = transcripts.get(c.mediaId!) || [];
    const speed = c.speed || 1;
    const from = c.trimStart || 0;
    const to = from + c.duration * speed;
    for (const w of list) {
      if (w.start < from || w.end > to + 0.05) continue;
      words.push({ ...w, start: c.start + (w.start - from) / speed, end: c.start + (Math.min(w.end, to) - from) / speed });
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

/**
 * Sous-titres automatiques de toute la timeline. Le style existant est conservé,
 * sinon `preset` est appliqué. Retourne le nombre de mots et les sources en échec.
 */
export async function generateTimelineCaptions(store: EditorStore, opts: TranscribeOptions & { preset?: string } = {}) {
  const project = store.getState().project;
  const sources = speechClips(project.clips);
  if (sources.length === 0) throw new Error('Aucune vidéo ou voix avec du son dans la timeline.');
  const { transcripts, failed } = await ensureTranscripts(sources.map((c) => c.mediaId!), opts);
  const words = timelineWords(speechClips(store.getState().project.clips), transcripts);
  if (words.length === 0) throw new Error('Aucune parole détectée dans les clips de la timeline.');
  const existing = store.getState().project.clips.find((c) => c.type === 'caption');
  const style = existing?.captionStyle && !opts.preset ? captionEngine.resolveStyle(existing.captionStyle) : captionEngine.applyPreset(opts.preset || 'hormozi');
  store.setCaptions(words, style as unknown as Record<string, unknown>);
  return { wordCount: words.length, failed };
}

/** Segments à garder (temps source) : la parole, avec une petite marge, en sautant les silences. */
function speechSegments(words: TranscriptWord[], from: number, to: number, minSilence: number) {
  const inside = words.filter((w) => w.end > from && w.start < to).sort((a, b) => a.start - b.start);
  const segments: { start: number; end: number }[] = [];
  for (const w of inside) {
    const start = Math.max(from, w.start - 0.08);
    const end = Math.min(to, w.end + 0.15);
    const last = segments[segments.length - 1];
    if (last && start - last.end < minSilence) last.end = Math.max(last.end, end);
    else segments.push({ start, end });
  }
  return segments.filter((s) => s.end - s.start > 0.1);
}

/**
 * Coupe les silences des clips donnés (comme « Supprimer les silences » de CapCut) :
 * chaque clip est remplacé par une suite de morceaux ne contenant que la parole.
 */
export async function cutSilences(store: EditorStore, clipIds: string[], minSilence = 0.5, opts: TranscribeOptions = {}) {
  const project = store.getState().project;
  const targets = project.clips.filter((c) => clipIds.includes(c.id) && c.mediaId && (c.type === 'video' || c.type === 'audio'));
  if (targets.length === 0) throw new Error('Aucun clip vidéo ou audio à traiter.');
  const { transcripts, failed } = await ensureTranscripts(targets.map((c) => c.mediaId!), opts);
  let removed = 0;
  store.update((p) => {
    for (const target of targets) {
      const clip = p.clips.find((c) => c.id === target.id);
      if (!clip) continue;
      const speed = clip.speed || 1;
      const from = clip.trimStart || 0;
      const to = from + clip.duration * speed;
      const segments = speechSegments(transcripts.get(clip.mediaId!) || [], from, to, minSilence);
      if (segments.length === 0) continue;
      const kept = segments.reduce((acc, s) => acc + (s.end - s.start), 0);
      removed += (to - from - kept) / speed;
      const track = p.tracks.find((t) => t.id === clip.trackId);
      let cursor = clip.start;
      const pieces = segments.map((s, i) => {
        const piece: Clip = JSON.parse(JSON.stringify(clip));
        piece.id = core.uid('clp');
        piece.trimStart = s.start;
        piece.duration = (s.end - s.start) / speed;
        // Piste principale : l'ordre est donné par le début (le magnétisme recolle tout).
        piece.start = track?.main ? clip.start + i * 0.0001 : cursor;
        piece.animIn = i === 0 ? clip.animIn : null;
        piece.animOut = i === segments.length - 1 ? clip.animOut : null;
        piece.fadeIn = 0;
        piece.fadeOut = 0;
        piece.keyframes = {};
        cursor += piece.duration;
        return piece;
      });
      p.transitions = p.transitions.filter((t) => t.fromId !== clip.id && t.toId !== clip.id);
      p.clips = p.clips.filter((c) => c.id !== clip.id).concat(pieces);
    }
  });
  return { removedSeconds: removed, failed };
}
