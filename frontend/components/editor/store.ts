'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import * as core from '@shared/editorCore';
import type { Clip, EditorProject, KeyframeProp, Transform, Track } from '@shared/editorCore';
import type { Media, SfxItem, TranscriptWord } from '@/lib/types';

/**
 * Store de l'éditeur : projet + sélection + historique (annuler / rétablir).
 * Le temps de lecture n'est PAS ici (il vit dans PreviewEngine) pour éviter de
 * re-rendre toute l'interface à chaque image.
 */

export interface Selection {
  clipIds: string[];
  transitionId: string | null;
  /** Jonction sélectionnée sur la piste principale (pour ajouter une transition). */
  junction: { fromId: string; toId: string } | null;
}

export interface EditorState {
  project: EditorProject;
  selection: Selection;
  zoom: number; // pixels par seconde
  snapping: boolean;
  canUndo: boolean;
  canRedo: boolean;
  revision: number; // incrémenté à chaque modification du projet (autosave)
}

const EMPTY_SELECTION: Selection = { clipIds: [], transitionId: null, junction: null };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export const isSfxTrack = (t: Track) => t.kind === 'audio' && /effet|sfx|son/i.test(t.name);

/**
 * Trouve une piste libre sur [start, start + duration] du même rôle que `preferred`
 * (ou crée une nouvelle ligne juste en dessous, façon CapCut, sans jamais décaler le temps du clip).
 */
export function ensureFreeTrackIn(
  p: EditorProject,
  preferred: Track,
  start: number,
  duration: number,
  ignoreClipId?: string,
  preferSfxRole?: boolean
): Track {
  if (preferred.main) return preferred;
  const end = start + duration;
  const isFree = (t: Track) =>
    !t.locked &&
    !core.clipsOnTrack(p, t.id).some((c) => c.id !== ignoreClipId && start < core.clipEnd(c) - 1e-3 && end > c.start + 1e-3);

  const wantSfx = preferSfxRole ?? isSfxTrack(preferred);
  // Si la piste préférée correspond au rôle voulu et est libre, on la garde.
  if (isFree(preferred) && (preferred.kind !== 'audio' || isSfxTrack(preferred) === wantSfx)) return preferred;

  const sameRole = (t: Track) => {
    if (t.main || t.kind !== preferred.kind) return false;
    if (t.kind === 'audio') return isSfxTrack(t) === wantSfx;
    return true;
  };
  const candidates = p.tracks.filter(sameRole);
  const prefIdx = candidates.findIndex((t) => t.id === preferred.id);
  const ordered = prefIdx >= 0 ? [...candidates.slice(prefIdx), ...candidates.slice(0, prefIdx)] : candidates;
  const found = ordered.find(isFree);
  if (found) return found;

  // Aucune piste libre : on crée une nouvelle ligne du même type juste après la dernière ligne de ce rôle.
  const baseName = preferred.kind === 'audio' ? (wantSfx ? 'Effets sonores' : 'Audio') : preferred.kind === 'caption' ? 'Sous-titres' : 'Incrustation';
  const nextNum = candidates.length + 1;
  const newTrack: Track = { id: core.uid('trk'), kind: preferred.kind, name: nextNum === 1 ? baseName : `${baseName} ${nextNum}` };
  if (preferred.kind === 'audio') {
    const lastSameIdx = p.tracks.reduce((acc, t, idx) => (sameRole(t) ? idx : acc), -1);
    if (lastSameIdx >= 0) p.tracks.splice(lastSameIdx + 1, 0, newTrack);
    else p.tracks.push(newTrack);
  } else {
    p.tracks.splice(preferred.kind === 'caption' ? 0 : Math.max(0, p.tracks.findIndex((t) => t.kind === 'visual')), 0, newTrack);
  }
  return newTrack;
}

/**
 * Sépare automatiquement les clips qui se chevauchent sur une même piste non-principale
 * en les plaçant sur des pistes parallèles (Audio 2, Effets sonores 2, 3...) au même instant.
 */
export function unpackOverlappingTracks(p: EditorProject) {
  const snapshotTracks = p.tracks.slice();
  for (const track of snapshotTracks) {
    if (track.main) continue;
    const clips = core.clipsOnTrack(p, track.id);
    const placed: Clip[] = [];
    for (const c of clips) {
      const overlaps = placed.some((o) => c.start < core.clipEnd(o) - 1e-3 && core.clipEnd(c) > o.start + 1e-3);
      if (!overlaps) {
        placed.push(c);
        continue;
      }
      const sfxRole = c.type === 'audio' ? isSfxTrack(track) || Boolean(c.src?.startsWith('/sfx/')) || (c.duration > 0 && c.duration <= 8) : undefined;
      const target = ensureFreeTrackIn(p, track, c.start, c.duration, c.id, sfxRole);
      c.trackId = target.id;
    }
  }
}

export class EditorStore {
  private state: EditorState;
  private listeners = new Set<() => void>();
  private past: EditorProject[] = [];
  private future: EditorProject[] = [];
  private lastKey: string | null = null;
  private lastTime = 0;
  private batchDepth = 0; // lots imbriqués : seul le plus externe crée l'étape d'historique
  clipboard: Clip[] = [];
  /** Temps courant fourni par le moteur (pour les opérations "à la tête de lecture"). */
  getTime: () => number = () => 0;

  constructor(project: EditorProject) {
    const p = clone(project);
    core.packMainTrack(p);
    unpackOverlappingTracks(p);
    this.state = { project: p, selection: EMPTY_SELECTION, zoom: 60, snapping: true, canUndo: false, canRedo: false, revision: 0 };
  }

  getState = () => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
    for (const fn of this.listeners) fn();
  }

  /**
   * Modifie le projet. `key` regroupe dans une seule étape d'historique les
   * modifications successives rapides d'une même propriété (glisser un curseur).
   */
  update(fn: (p: EditorProject) => void, key?: string) {
    const next = clone(this.state.project);
    fn(next);
    core.packMainTrack(next);
    if (this.batchDepth === 0) unpackOverlappingTracks(next);
    const now = Date.now();
    const merge = key && key === this.lastKey && now - this.lastTime < 800;
    if (!merge && this.batchDepth === 0) {
      this.past.push(this.state.project);
      if (this.past.length > 150) this.past.shift();
    }
    this.future = [];
    this.lastKey = key || null;
    this.lastTime = now;
    const ids = new Set(next.clips.map((c) => c.id));
    const sel = this.state.selection;
    this.set({
      project: next,
      revision: this.state.revision + 1,
      selection: {
        clipIds: sel.clipIds.filter((id) => ids.has(id)),
        transitionId: sel.transitionId && next.transitions.some((t) => t.id === sel.transitionId) ? sel.transitionId : null,
        junction: sel.junction && ids.has(sel.junction.fromId) && ids.has(sel.junction.toId) ? sel.junction : null,
      },
    });
  }

  /**
   * Regroupe toutes les modifications jusqu'à endBatch() en UNE étape
   * d'historique (utilisé par l'Éditeur IA : un Ctrl+Z annule toute la demande).
   */
  beginBatch() {
    if (this.batchDepth++ > 0) return;
    this.past.push(this.state.project);
    if (this.past.length > 150) this.past.shift();
    this.future = [];
    this.lastKey = null;
  }

  endBatch() {
    this.batchDepth = Math.max(0, this.batchDepth - 1);
    if (this.batchDepth > 0) return;
    this.lastKey = null;
    const next = clone(this.state.project);
    unpackOverlappingTracks(next);
    this.set({ project: next });
  }

  undo = () => {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state.project);
    this.lastKey = null;
    this.set({ project: prev, revision: this.state.revision + 1 });
  };

  redo = () => {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.project);
    this.lastKey = null;
    this.set({ project: next, revision: this.state.revision + 1 });
  };

  select(clipIds: string[], additive = false) {
    const ids = additive ? Array.from(new Set([...this.state.selection.clipIds, ...clipIds])) : clipIds;
    this.set({ selection: { clipIds: ids, transitionId: null, junction: null } });
  }

  selectTransition(id: string | null) {
    this.set({ selection: { clipIds: [], transitionId: id, junction: null } });
  }

  selectJunction(fromId: string, toId: string) {
    const existing = core.transitionBetween(this.state.project, fromId, toId);
    this.set({ selection: { clipIds: [], transitionId: existing ? existing.id : null, junction: { fromId, toId } } });
  }

  clearSelection() {
    this.set({ selection: EMPTY_SELECTION });
  }

  setZoom(zoom: number) {
    this.set({ zoom: Math.min(400, Math.max(4, zoom)) });
  }

  setSnapping(snapping: boolean) {
    this.set({ snapping });
  }

  // ------------------------------------------------------------ helpers

  clip(id: string) {
    return this.state.project.clips.find((c) => c.id === id) || null;
  }

  selectedClips() {
    const ids = new Set(this.state.selection.clipIds);
    return this.state.project.clips.filter((c) => ids.has(c.id));
  }

  trackFor(kind: Track['kind'], preferMain = false): Track {
    const p = this.state.project;
    if (preferMain) {
      const main = core.mainTrack(p);
      if (main) return main;
    }
    return p.tracks.find((t) => t.kind === kind && !t.main) || p.tracks.find((t) => t.kind === kind)!;
  }

  /** Piste visuelle "texte" (la plus haute) pour les textes et stickers. */
  private overlayTrack(): Track {
    const p = this.state.project;
    return p.tracks.find((t) => t.kind === 'visual' && !t.main) || core.mainTrack(p)!;
  }

  /** Premier instant libre d'une piste à partir de `from` (évite les chevauchements). */
  private freeSlot(trackId: string, from: number, duration: number) {
    const clips = core.clipsOnTrack(this.state.project, trackId);
    let start = from;
    for (const c of clips) {
      if (start < core.clipEnd(c) && start + duration > c.start) start = core.clipEnd(c);
    }
    return start;
  }

  // ---------------------------------------------------------- opérations

  addMedia(media: Media | (SfxItem & { kind?: 'audio' }), at?: number, trackId?: string) {
    const m = media as Media;
    const kind = m.kind || 'audio';
    const mediaLike = { id: m.id, kind, url: m.url, duration: m.duration, width: m.width, height: m.height, hasAudio: m.hasAudio !== false, name: m.name };
    const time = at ?? this.getTime();
    // Voix off et musiques de la bibliothèque : piste audio, même courtes ; sons courts : piste SFX.
    const isShortSfx =
      kind === 'audio' && (mediaLike.url.startsWith('/sfx/') || m.library === 'sfx' || (!m.library && m.source !== 'tts' && mediaLike.duration > 0 && mediaLike.duration <= 8));
    let clipId = '';
    this.update((p) => {
      let track: Track | undefined = trackId ? p.tracks.find((t) => t.id === trackId) : undefined;
      if (!track) {
        if (kind === 'audio') {
          track =
            (isShortSfx ? p.tracks.find((t) => isSfxTrack(t)) : p.tracks.find((t) => t.kind === 'audio' && !isSfxTrack(t))) ||
            p.tracks.find((t) => t.kind === 'audio')!;
        } else {
          track = core.mainTrack(p)!;
        }
      }
      const clip = core.createMediaClip(mediaLike, track.id, 0);
      // Les effets sonores intégrés ne sont pas des médias en base (pas de forme d'onde / transcription).
      if (mediaLike.url.startsWith('/sfx/')) delete clip.mediaId;
      if (track.main) {
        // Piste principale magnétique : insertion à la jonction la plus proche de la tête de lecture.
        const clips = core.clipsOnTrack(p, track.id);
        const after = clips.find((c) => time < c.start + c.duration / 2);
        clip.start = after ? after.start - 0.001 : core.projectDuration({ ...p, clips } as EditorProject) + 1;
      } else {
        clip.start = Math.max(0, time);
        const targetTrack = ensureFreeTrackIn(p, track, clip.start, clip.duration, clip.id, trackId ? isSfxTrack(track) : isShortSfx);
        clip.trackId = targetTrack.id;
      }
      p.clips.push(clip);
      clipId = clip.id;
    });
    this.select([clipId]);
    return clipId;
  }

  private freeSlotIn(p: EditorProject, trackId: string, from: number, duration: number) {
    let start = Math.max(0, from);
    for (const c of core.clipsOnTrack(p, trackId)) if (start < core.clipEnd(c) && start + duration > c.start) start = core.clipEnd(c);
    return start;
  }

  addText(presetId?: string, text?: string) {
    const track = this.overlayTrack();
    const clip = core.createTextClip(track.id, 0, text || 'Votre texte', presetId);
    clip.start = this.freeSlot(track.id, this.getTime(), clip.duration);
    this.update((p) => {
      p.clips.push(clip);
    });
    this.select([clip.id]);
  }

  addSticker(emoji: string) {
    const track = this.overlayTrack();
    const clip = core.createStickerClip(track.id, 0, emoji);
    clip.start = this.freeSlot(track.id, this.getTime(), clip.duration);
    clip.animIn = { type: 'pop', duration: 0.4 };
    this.update((p) => {
      p.clips.push(clip);
    });
    this.select([clip.id]);
  }

  /** Remplace (ou crée) le clip de sous-titres couvrant le projet. */
  setCaptions(words: TranscriptWord[], captionStyle: Record<string, unknown>) {
    this.update((p) => {
      const track = p.tracks.find((t) => t.kind === 'caption');
      if (!track) return;
      p.clips = p.clips.filter((c) => c.trackId !== track.id);
      const duration = Math.max(core.projectDuration(p), words.length ? words[words.length - 1].end + 0.5 : 1);
      p.clips.push(core.createCaptionClip(track.id, 0, duration, words, captionStyle));
    });
  }

  patchClip(id: string, patch: Partial<Clip> | ((c: Clip) => void), key?: string) {
    this.update((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      if (typeof patch === 'function') patch(c);
      else Object.assign(c, patch);
      const max = core.maxClipDuration(c);
      if (c.duration > max) c.duration = max;
      if (c.duration < 0.05) c.duration = 0.05;
    }, key ?? `patch:${id}`);
  }

  patchClips(ids: string[], fn: (c: Clip) => void, key?: string) {
    const set = new Set(ids);
    this.update((p) => {
      for (const c of p.clips) if (set.has(c.id)) fn(c);
    }, key);
  }

  /**
   * Modifie une propriété de transformation. Si la propriété a des images
   * clés, on crée/met à jour celle sous la tête de lecture (comme CapCut).
   */
  setTransformProp(id: string, prop: KeyframeProp, value: number) {
    this.setTransformProps(id, { [prop]: value });
  }

  setTransformProps(id: string, values: Partial<Record<KeyframeProp, number>>) {
    const time = this.getTime();
    const props = Object.keys(values) as KeyframeProp[];
    this.patchClip(
      id,
      (c) => {
        for (const prop of props) {
          const value = values[prop]!;
          const keys = c.keyframes?.[prop];
          if (keys && keys.length > 0) {
            const local = Math.max(0, Math.min(c.duration, time - c.start));
            const existing = keys.find((k) => Math.abs(k.t - local) < 1 / 60);
            if (existing) existing.v = value;
            else {
              keys.push({ t: local, v: value });
              keys.sort((a, b) => a.t - b.t);
            }
          } else {
            c.transform = { ...core.DEFAULT_TRANSFORM, ...(c.transform || {}), [prop]: value } as Transform;
          }
        }
      },
      `tr:${id}:${props.join(',')}`
    );
  }

  /** Ajoute (ou retire si présente) une image clé pour `prop` sous la tête de lecture. */
  toggleKeyframe(id: string, prop: KeyframeProp) {
    const time = this.getTime();
    this.patchClip(id, (c) => {
      const local = Math.max(0, Math.min(c.duration, time - c.start));
      c.keyframes = c.keyframes || {};
      const keys = c.keyframes[prop] || [];
      const idx = keys.findIndex((k) => Math.abs(k.t - local) < 1 / 30);
      if (idx >= 0) keys.splice(idx, 1);
      else {
        const current = core.visualStateAt({ ...c, animIn: null, animOut: null, animLoop: null, effects: [] }, local)[prop];
        keys.push({ t: local, v: current });
        keys.sort((a, b) => a.t - b.t);
      }
      if (keys.length === 0) delete c.keyframes[prop];
      else c.keyframes[prop] = keys;
    }, `kf:${id}:${prop}:${Date.now()}`);
  }

  clearKeyframes(id: string, prop: KeyframeProp) {
    this.patchClip(id, (c) => {
      if (!c.keyframes?.[prop]) return;
      const v = core.visualStateAt({ ...c, animIn: null, animOut: null, animLoop: null, effects: [] }, 0)[prop];
      delete c.keyframes[prop];
      c.transform = { ...core.DEFAULT_TRANSFORM, ...(c.transform || {}), [prop]: v } as Transform;
    });
  }

  /** Coupe les clips sélectionnés (ou tous ceux sous la tête de lecture) au temps t. */
  splitAt(t = this.getTime()) {
    const selected = this.state.selection.clipIds;
    const newIds: string[] = [];
    this.update((p) => {
      const targets = p.clips.filter((c) => t > c.start + 0.03 && t < core.clipEnd(c) - 0.03 && (selected.length === 0 || selected.includes(c.id)));
      for (const c of targets) {
        const track = p.tracks.find((x) => x.id === c.trackId);
        if (track?.locked) continue;
        const local = t - c.start;
        const right: Clip = clone(c);
        right.id = core.uid('clp');
        right.start = t;
        right.duration = c.duration - local;
        if (right.trimStart !== undefined) right.trimStart = (c.trimStart || 0) + local * (c.speed || 1);
        if (c.type === 'caption' && c.words) {
          right.words = c.words.filter((w) => w.end > local).map((w) => ({ ...w, start: Math.max(0, w.start - local), end: w.end - local }));
          c.words = c.words.filter((w) => w.start < local);
        }
        // Les images clés sont réparties entre les deux morceaux.
        if (c.keyframes) {
          right.keyframes = {};
          for (const [prop, keys] of Object.entries(c.keyframes)) {
            if (!keys) continue;
            (right.keyframes as any)[prop] = keys.filter((k) => k.t >= local).map((k) => ({ ...k, t: k.t - local }));
            (c.keyframes as any)[prop] = keys.filter((k) => k.t < local);
          }
        }
        right.animIn = null;
        c.animOut = null;
        c.duration = local;
        // Une transition qui partait de c part désormais du morceau de droite.
        for (const tr of p.transitions) if (tr.fromId === c.id) tr.fromId = right.id;
        p.clips.push(right);
        newIds.push(right.id);
      }
    });
    if (newIds.length) this.select(newIds);
  }

  deleteSelection() {
    const { clipIds, transitionId } = this.state.selection;
    if (transitionId) {
      this.update((p) => {
        p.transitions = p.transitions.filter((t) => t.id !== transitionId);
      });
      this.clearSelection();
      return;
    }
    if (clipIds.length === 0) return;
    const ids = new Set(clipIds);
    this.update((p) => {
      const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id));
      p.clips = p.clips.filter((c) => !ids.has(c.id) || locked.has(c.trackId));
    });
    this.clearSelection();
  }

  duplicateSelection() {
    const sel = this.selectedClips();
    if (!sel.length) return;
    const created: string[] = [];
    this.update((p) => {
      for (const c of sel) {
        const copy: Clip = clone(c);
        copy.id = core.uid('clp');
        const track = p.tracks.find((t) => t.id === c.trackId);
        copy.start = track?.main ? core.clipEnd(c) - 0.001 : this.freeSlotIn(p, c.trackId, core.clipEnd(c), c.duration);
        p.clips.push(copy);
        created.push(copy.id);
      }
    });
    this.select(created);
  }

  copySelection() {
    this.clipboard = clone(this.selectedClips());
  }

  paste() {
    if (!this.clipboard.length) return;
    const t = this.getTime();
    const base = Math.min(...this.clipboard.map((c) => c.start));
    const created: string[] = [];
    this.update((p) => {
      for (const c of this.clipboard) {
        if (!p.tracks.some((tr) => tr.id === c.trackId)) continue;
        const copy: Clip = clone(c);
        copy.id = core.uid('clp');
        const track = p.tracks.find((tr) => tr.id === c.trackId);
        const wanted = t + (c.start - base);
        copy.start = track?.main ? wanted - 0.001 : this.freeSlotIn(p, c.trackId, wanted, c.duration);
        p.clips.push(copy);
        created.push(copy.id);
      }
    });
    this.select(created);
  }

  /** Déplace un clip (temps + piste). Sur la piste principale, l'ordre suit la position ; sur les autres, crée une nouvelle ligne si besoin (comme CapCut). */
  moveClip(id: string, start: number, trackId: string) {
    this.update((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      c.start = Math.max(0, start);
      if (trackId === '__new_sfx__' || trackId === '__new_audio__' || trackId === '__new_visual__') {
        const wantSfx = trackId === '__new_sfx__';
        const kind: Track['kind'] = trackId === '__new_visual__' ? 'visual' : 'audio';
        const sameCount = p.tracks.filter((t) => (kind === 'audio' ? isSfxTrack(t) === wantSfx && t.kind === 'audio' : t.kind === 'visual' && !t.main)).length;
        const baseName = kind === 'visual' ? 'Incrustation' : wantSfx ? 'Effets sonores' : 'Audio';
        const newTrack: Track = { id: core.uid('trk'), kind, name: `${baseName} ${sameCount + 1}` };
        if (kind === 'audio') p.tracks.push(newTrack);
        else p.tracks.splice(Math.max(0, p.tracks.findIndex((t) => t.kind === 'visual')), 0, newTrack);
        c.trackId = newTrack.id;
        return;
      }
      const target = p.tracks.find((t) => t.id === trackId);
      if (!target || target.locked) return;
      if (target.main) {
        c.trackId = target.id;
      } else {
        const freeTrack = ensureFreeTrackIn(p, target, c.start, c.duration, c.id, isSfxTrack(target));
        c.trackId = freeTrack.id;
      }
    }, `move:${id}`);
  }

  /** Remplace le fichier audio / musique / SFX d'un clip existant en conservant son timestamp et son volume. */
  replaceClipAudio(id: string, source: { id?: string; name: string; src: string; duration?: number }) {
    this.update((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c || c.type !== 'audio') return;
      const newDur = Math.max(0.15, source.duration || c.duration || 2);
      c.mediaId = source.id?.startsWith('sfx-') ? undefined : source.id;
      c.name = source.name;
      c.src = source.src;
      c.trimStart = 0;
      c.mediaDuration = newDur;
      c.duration = newDur / (c.speed || 1);
      const track = p.tracks.find((t) => t.id === c.trackId);
      if (track && !track.main) {
        const freeTrack = ensureFreeTrackIn(p, track, c.start, c.duration, c.id, isSfxTrack(track));
        c.trackId = freeTrack.id;
      }
    });
  }

  /** Bascule un clip audio vers Effets sonores, Audio, ou une toute nouvelle piste en conservant son timestamp. */
  moveClipToRole(id: string, role: 'audio' | 'sfx' | 'new_audio' | 'new_sfx') {
    const c = this.clip(id);
    if (!c) return;
    if (role === 'new_sfx') {
      this.moveClip(id, c.start, '__new_sfx__');
      return;
    }
    if (role === 'new_audio') {
      this.moveClip(id, c.start, '__new_audio__');
      return;
    }
    this.update((p) => {
      const clip = p.clips.find((x) => x.id === id);
      if (!clip) return;
      const wantSfx = role === 'sfx';
      let pref = p.tracks.find((t) => t.kind === 'audio' && !t.locked && isSfxTrack(t) === wantSfx);
      if (!pref) {
        pref = { id: core.uid('trk'), kind: 'audio', name: wantSfx ? 'Effets sonores' : 'Audio' };
        p.tracks.push(pref);
      }
      const free = ensureFreeTrackIn(p, pref, clip.start, clip.duration, clip.id, wantSfx);
      clip.trackId = free.id;
    });
  }

  /** Rognage par le bord gauche ou droit (delta en secondes de timeline). */
  trimClip(id: string, side: 'left' | 'right', delta: number) {
    this.update((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      const speed = c.speed || 1;
      const isMedia = c.type === 'video' || c.type === 'audio';
      if (side === 'left') {
        let d = Math.min(delta, c.duration - 0.1);
        if (isMedia) d = Math.max(d, -(c.trimStart || 0) / speed);
        else d = Math.max(d, -c.start);
        c.start += d;
        c.duration -= d;
        if (isMedia) c.trimStart = (c.trimStart || 0) + d * speed;
        if (c.type === 'caption' && c.words) c.words = c.words.map((w) => ({ ...w, start: w.start - d, end: w.end - d })).filter((w) => w.end > 0);
      } else {
        c.duration = Math.max(0.1, Math.min(core.maxClipDuration(c), c.duration + delta));
      }
    }, `trim:${id}:${side}`);
  }

  setTransition(fromId: string, toId: string, type: string, duration = 0.5) {
    let id = '';
    this.update((p) => {
      const existing = core.transitionBetween(p, fromId, toId);
      if (existing) {
        existing.type = type;
        id = existing.id;
      } else {
        const a = p.clips.find((c) => c.id === fromId);
        const b = p.clips.find((c) => c.id === toId);
        if (!a || !b) return;
        const tr = { id: core.uid('trn'), fromId, toId, type, duration: Math.min(duration, core.maxTransitionDuration(a, b)) };
        p.transitions.push(tr);
        id = tr.id;
      }
    });
    if (id) this.set({ selection: { clipIds: [], transitionId: id, junction: { fromId, toId } } });
  }

  /** Applique une transition à toutes les jonctions de la piste principale. */
  setTransitionEverywhere(type: string, duration = 0.5) {
    this.update((p) => {
      const main = core.mainTrack(p);
      if (!main) return;
      const clips = core.clipsOnTrack(p, main.id);
      for (let i = 1; i < clips.length; i++) {
        const existing = core.transitionBetween(p, clips[i - 1].id, clips[i].id);
        if (existing) existing.type = type;
        else p.transitions.push({ id: core.uid('trn'), fromId: clips[i - 1].id, toId: clips[i].id, type, duration: Math.min(duration, core.maxTransitionDuration(clips[i - 1], clips[i])) });
      }
    });
  }

  patchTransition(id: string, patch: { type?: string; duration?: number }) {
    this.update((p) => {
      const tr = p.transitions.find((t) => t.id === id);
      if (tr) Object.assign(tr, patch);
    }, `trn:${id}`);
  }

  /** Sépare l'audio d'une vidéo : la vidéo devient muette, un clip audio identique est créé. */
  detachAudio(id: string) {
    const c = this.clip(id);
    if (!c || c.type !== 'video' || c.hasAudio === false) return;
    this.update((p) => {
      const v = p.clips.find((x) => x.id === id)!;
      const audioTrack = p.tracks.find((t) => t.kind === 'audio');
      if (!audioTrack) return;
      const audio: Clip = {
        id: core.uid('clp'),
        trackId: audioTrack.id,
        type: 'audio',
        start: v.start,
        duration: v.duration,
        name: `${v.name || 'Audio'} (audio)`,
        mediaId: v.mediaId,
        src: v.src,
        mediaDuration: v.mediaDuration,
        trimStart: v.trimStart,
        speed: v.speed,
        volume: v.volume,
        muted: false,
        fadeIn: v.fadeIn,
        fadeOut: v.fadeOut,
      };
      audio.start = this.freeSlotIn(p, audioTrack.id, v.start, v.duration);
      p.clips.push(audio);
      v.muted = true;
    });
  }

  patchTrack(id: string, patch: Partial<Track>) {
    this.update((p) => {
      const t = p.tracks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    });
  }

  addTrack(kind: Track['kind'], role?: 'sfx'): string {
    const id = core.uid('trk');
    this.update((p) => {
      const isSfx = kind === 'audio' && role === 'sfx';
      const count = p.tracks.filter((t) => (kind === 'audio' ? t.kind === 'audio' && isSfxTrack(t) === isSfx : t.kind === kind && !t.main)).length;
      const base = isSfx ? 'Effets sonores' : kind === 'visual' ? 'Incrustation' : kind === 'audio' ? 'Audio' : 'Sous-titres';
      const track: Track = { id, kind, name: `${base} ${count + 1}` };
      // Pistes visuelles en haut, audio en bas (comme CapCut).
      if (kind === 'audio') p.tracks.push(track);
      else p.tracks.splice(kind === 'caption' ? 0 : p.tracks.findIndex((t) => t.kind === 'visual'), 0, track);
    });
    return id;
  }

  removeTrack(id: string) {
    this.update((p) => {
      const t = p.tracks.find((x) => x.id === id);
      if (!t || t.main) return;
      p.tracks = p.tracks.filter((x) => x.id !== id);
      p.clips = p.clips.filter((c) => c.trackId !== id);
    });
  }

  patchSettings(patch: Partial<EditorProject['settings']>, key?: string) {
    this.update((p) => {
      Object.assign(p.settings, patch);
    }, key);
  }
}

export const EditorContext = createContext<EditorStore | null>(null);

export function useEditorStore() {
  const store = useContext(EditorContext);
  if (!store) throw new Error('useEditorStore doit être utilisé dans <EditorContext.Provider>');
  return store;
}

/** Abonnement à une partie de l'état (re-rendu seulement si la valeur change). */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  const store = useEditorStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState())
  );
}
