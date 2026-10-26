/**
 * Éditeur IA — côté navigateur.
 *
 *  1. buildAiContext : résumé compact du projet et de la médiathèque envoyé à
 *     l'IA, avec des identifiants courts ("c1", "m1") plus fiables pour les
 *     petits modèles gratuits que les identifiants internes.
 *  2. applyAiActions : valide et exécute le plan d'actions renvoyé par l'IA
 *     (voir shared/aiEditor.js). Les actions synchrones forment une seule étape
 *     d'historique ; les actions longues (sous-titres, coupe des silences)
 *     s'exécutent ensuite.
 *  3. autoBroll : B-roll automatique — la voix est transcrite, l'IA associe ce
 *     qui est dit aux médias décrits visuellement et les incruste au bon moment.
 */
import * as core from '@shared/editorCore';
import * as captionEngine from '@shared/captionEngine';
import type { Clip, EditorProject, Track } from '@shared/editorCore';
import type { Media, SfxItem } from '@/lib/types';
import { aiBroll, describeMedia, listMedia, type AiMemory, type AiMode } from '@/lib/api';
import type { EditorStore } from './store';
import type { PreviewEngine } from '@/lib/editor/engine';
import { generateTimelineCaptions, cutSilences, ensureTranscripts, speechClips, timelineWords, type Progress } from './timelineSpeech';

type TrackRole = 'main' | 'overlay' | 'text' | 'audio' | 'sfx' | 'captions';

export interface AiAliases {
  clips: Map<string, string>; // "c1" -> id interne
  media: Map<string, Media>; // "m1" -> média
  mediaById: Map<string, string>; // id interne -> "m1"
  memory: Map<string, string>; // "k1" -> id du souvenir
  memoryAudio: Media[]; // sons liés aux souvenirs de l'utilisateur
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Rôle d'une piste, tel que présenté à l'IA. */
function roleOf(project: EditorProject, track: Track): TrackRole {
  if (track.main) return 'main';
  if (track.kind === 'caption') return 'captions';
  if (track.kind === 'audio') return /effet|sfx|son/i.test(track.name) ? 'sfx' : 'audio';
  return /incrust|overlay/i.test(track.name) ? 'overlay' : 'text';
}

export function buildAiContext(store: EditorStore, engine: PreviewEngine, media: Media[], sfx: SfxItem[], selectedMediaIds: string[] = [], memory: AiMemory[] = []) {
  const p = store.getState().project;
  const aliases: AiAliases = { clips: new Map(), media: new Map(), mediaById: new Map(), memory: new Map(), memoryAudio: [] };
  const mediaAlias = aliases.mediaById;
  media.forEach((m, i) => {
    const alias = `m${i + 1}`;
    aliases.media.set(alias, m);
    mediaAlias.set(m.id, alias);
  });
  const byId = new Map(media.map((m) => [m.id, m]));
  for (const k of memory) {
    for (const ref of k.media || []) {
      const m = byId.get(ref.id) || media.find((x) => x.kind === 'audio' && x.name.toLowerCase() === ref.name.toLowerCase());
      if (m && m.kind === 'audio' && !aliases.memoryAudio.some((x) => x.id === m.id)) aliases.memoryAudio.push(m);
    }
  }
  const clipAlias = new Map<string, string>();
  const ordered = p.tracks.flatMap((t) => core.clipsOnTrack(p, t.id));
  ordered.forEach((c, i) => {
    const alias = `c${i + 1}`;
    aliases.clips.set(alias, c.id);
    clipAlias.set(c.id, alias);
  });

  const clips = ordered.map((c) => {
    const track = p.tracks.find((t) => t.id === c.trackId)!;
    const base: Record<string, unknown> = { id: clipAlias.get(c.id), type: c.type, track: roleOf(p, track), start: r2(c.start), duration: r2(c.duration) };
    if (c.mediaId && mediaAlias.has(c.mediaId)) base.media = mediaAlias.get(c.mediaId);
    if (c.type === 'video' || c.type === 'audio') {
      base.trim_start = r2(c.trimStart || 0);
      if ((c.speed || 1) !== 1) base.speed = c.speed;
      if ((c.volume ?? 1) !== 1) base.volume = c.volume;
      if (c.muted) base.muted = true;
    }
    if (c.src?.startsWith('/sfx/')) base.sfx = c.src.replace('/sfx/', '').replace('.mp3', '');
    if (c.type === 'text') base.text = c.text;
    if (c.type === 'sticker') base.emoji = c.emoji;
    if (c.type === 'caption') base.words = (c.words || []).length;
    if (c.filter && c.filter.id !== 'none') base.filter = c.filter.id;
    if (c.effects?.length) base.effects = c.effects.map((e) => e.id);
    if (c.animIn) base.anim_in = c.animIn.type;
    if (c.animOut) base.anim_out = c.animOut.type;
    if (c.animLoop) base.anim_loop = c.animLoop.type;
    if (core.isVisual(c) && c.transform) {
      const t = c.transform;
      if (t.x !== 0.5 || t.y !== 0.5) Object.assign(base, { x: r2(t.x), y: r2(t.y) });
      if (t.scale !== 1) base.scale = r2(t.scale);
    }
    return base;
  });

  const context = {
    project: {
      aspect: p.settings.aspect,
      width: p.settings.width,
      height: p.settings.height,
      fps: p.settings.fps,
      background: p.settings.background.type === 'blur' ? 'blur' : p.settings.background.color,
      duration: r2(core.projectDuration(p)),
    },
    playhead: r2(engine.time),
    selection: store.getState().selection.clipIds.map((id) => clipAlias.get(id)).filter(Boolean),
    clips,
    transitions: p.transitions.map((t) => ({ from: clipAlias.get(t.fromId), to: clipAlias.get(t.toId), type: t.type, duration: r2(t.duration) })),
    media: media.map((m) => ({
      id: mediaAlias.get(m.id),
      name: m.name,
      kind: m.kind,
      duration: r2(m.duration),
      ...(m.kind !== 'audio' ? { size: `${m.width}x${m.height}` } : {}),
      ...(m.transcript ? { transcribed: true, words: m.transcript.wordCount } : {}),
      ...(m.vision ? { desc: m.vision.description.slice(0, 140), tags: m.vision.tags.slice(0, 8).join(', ') } : {}),
    })),
    selectedMedia: selectedMediaIds.map((id) => mediaAlias.get(id)).filter(Boolean),
    sfx: sfx.map((s) => s.id),
    // Souvenirs de l'utilisateur (préférences, ses sons…) avec leurs médias en alias courts actuels + noms.
    memory: memory.map((k, i) => {
      aliases.memory.set(`k${i + 1}`, k.id);
      const linked = k.media.map((m) => {
        const alias = mediaAlias.get(m.id) || (() => {
          const byName = media.find((x) => x.name.toLowerCase() === m.name.toLowerCase());
          return byName ? mediaAlias.get(byName.id) : null;
        })();
        return alias ? `${alias} (${m.name})` : `${m.name} (supprimé)`;
      });
      // Nettoie les anciens numéros mX figés dans le texte pour éviter toute confusion après de nouveaux imports.
      const cleanText = k.text.replace(/\s*\(\s*m\d+(?:\s*[-àa]\s*m\d+)?\s*\)/gi, '').trim();
      return { id: `k${i + 1}`, text: cleanText || k.text, ...(linked.length ? { media: linked } : {}) };
    }),
  };
  return { context, aliases };
}

// ------------------------------------------------------------------ exécution

export interface ApplyResult {
  done: string[];
  warnings: string[];
}

const num = (v: unknown, fallback?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
const clampN = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

const POSITIONS: Record<string, [number, number]> = {
  top: [0.5, 0.2],
  center: [0.5, 0.5],
  middle: [0.5, 0.5],
  bottom: [0.5, 0.78],
  'top-left': [0.22, 0.15],
  'top-right': [0.78, 0.15],
  'bottom-left': [0.22, 0.82],
  'bottom-right': [0.78, 0.82],
};

function inCatalog(list: { id: string }[], id: unknown): id is string {
  return typeof id === 'string' && list.some((x) => x.id === id);
}

/** Piste du rôle demandé (créée si nécessaire). Pour toute piste hors main, choisit ou crée une piste libre sur [start, end]. */
function trackFor(p: EditorProject, role: TrackRole, start = 0, end = 0): Track {
  const main = core.mainTrack(p)!;
  if (role === 'main') return main;
  const free = (t: Track) => !t.locked && !core.clipsOnTrack(p, t.id).some((c) => start < core.clipEnd(c) - 1e-3 && end > c.start + 1e-3);
  const byRole = p.tracks.filter((t) => roleOf(p, t) === role);
  const candidate = byRole.find(free);
  if (candidate) return candidate;
  const kind = role === 'audio' || role === 'sfx' ? 'audio' : role === 'captions' ? 'caption' : 'visual';
  const names: Record<TrackRole, string> = { main: 'Vidéo', overlay: 'Incrustation', text: 'Texte', audio: 'Audio', sfx: 'Effets sonores', captions: 'Sous-titres' };
  const track: Track = { id: core.uid('trk'), kind, name: `${names[role]} ${byRole.length + 1}` };
  if (kind === 'audio') p.tracks.push(track);
  else p.tracks.splice(kind === 'caption' ? 0 : Math.max(0, p.tracks.findIndex((t) => t.kind === 'visual')), 0, track);
  return track;
}

function mediaLike(m: Media) {
  return { id: m.id, kind: m.kind, url: m.url, duration: m.duration, width: m.width, height: m.height, hasAudio: m.hasAudio, name: m.name };
}

export async function applyAiActions(
  store: EditorStore,
  engine: PreviewEngine,
  actions: Record<string, any>[],
  aliases: AiAliases,
  sfx: SfxItem[],
  onProgress?: Progress,
  aiOptions: AiCallOptions = {}
): Promise<ApplyResult> {
  const done: string[] = [];
  const warnings: string[] = [];
  const refs = new Map<string, string>();
  const deferred: (() => Promise<void>)[] = [];
  const finalizers: (() => void)[] = [];
  let seekTo: number | null = null;
  let appendCursor: number | null = null; // ordre des ajouts successifs sur la piste principale

  const project = () => store.getState().project;
  const clipById = (id: string) => project().clips.find((c) => c.id === id);

  /** Résout une référence de clip ("c3", "$titre", "all_main", tableau...) en identifiants internes. */
  const resolve = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.flatMap(resolve);
    if (typeof v !== 'string') return [];
    const p = project();
    const main = core.mainTrack(p);
    if (v === 'all_main') return main ? core.clipsOnTrack(p, main.id).map((c) => c.id) : [];
    if (v === 'all_text') return p.clips.filter((c) => c.type === 'text').map((c) => c.id);
    if (v === 'all') return p.clips.filter((c) => core.isVisual(c)).map((c) => c.id);
    if (v === 'selection') return store.getState().selection.clipIds;
    if (v.startsWith('$')) return refs.has(v.slice(1)) ? [refs.get(v.slice(1))!] : [];
    if (aliases.clips.has(v)) {
      const id = aliases.clips.get(v)!;
      return clipById(id) ? [id] : [];
    }
    return clipById(v) ? [v] : [];
  };
  const one = (v: unknown, what: string) => {
    const list = resolve(v);
    if (list.length === 0) throw new Error(`${what} introuvable (${JSON.stringify(v)})`);
    return list[0];
  };
  const stripExt = (s: string) => s.replace(/\.[a-z0-9]{2,5}$/i, '').trim().toLowerCase();
  const norm = (s: string) => stripExt(s).replace(/[\s_-]+/g, ' ');
  const mediaFor = (v: unknown, preferKind?: Media['kind']): Media => {
    const raw = String(v ?? '').trim();
    if (aliases.media.has(raw)) {
      const m = aliases.media.get(raw)!;
      // Si un ancien alias "m16" pointait vers un son mais pointe désormais vers une vidéo après un import,
      // et qu'on cherche un son, on pioche dans les sons mémorisés ou importés par l'utilisateur.
      if (preferKind === 'audio' && m.kind !== 'audio') {
        const audioPool = aliases.memoryAudio.length ? aliases.memoryAudio : [...aliases.media.values()].filter((x) => x.kind === 'audio');
        if (audioPool.length) {
          const idx = Math.max(0, (parseInt(raw.slice(1), 10) || 1) - 1) % audioPool.length;
          return audioPool[idx];
        }
      }
      return m;
    }
    const all = [...aliases.media.values()];
    const pool = preferKind ? [...all.filter((m) => m.kind === preferKind), ...all.filter((m) => m.kind !== preferKind)] : all;
    const needle = raw.toLowerCase();
    const needleBase = norm(raw);
    const found =
      pool.find((m) => m.id === raw || m.name === raw) ||
      pool.find((m) => m.name.toLowerCase() === needle || norm(m.name) === needleBase) ||
      (needleBase.length >= 2 ? pool.find((m) => norm(m.name).includes(needleBase) || needleBase.includes(norm(m.name))) : undefined);
    if (!found) throw new Error(`média introuvable (${JSON.stringify(v)})`);
    return found;
  };
  /** Résout un effet sonore : média audio de l'utilisateur ("m4", "Pop.mp3"...) OU sfx intégré ("whoosh"...). */
  const resolveSfxOne = (v: unknown): { id: string; name: string; url: string; duration: number; isMedia: boolean } => {
    const raw = String(v ?? '').trim();
    if (!raw) throw new Error('effet sonore manquant');
    // 1. Alias explicite de média ("m16") ou ID interne de média
    if (aliases.media.has(raw) || [...aliases.media.values()].some((m) => m.id === raw)) {
      const m = mediaFor(raw, 'audio');
      return { id: m.id, name: m.name, url: m.url, duration: m.duration || 1, isMedia: true };
    }
    // 2. Médias audio importés par l'utilisateur ayant ce nom (prioritaires sur les sons synthétiques intégrés)
    const userAudios = [...aliases.media.values()].filter((m) => m.kind === 'audio');
    const needle = raw.toLowerCase();
    const needleBase = norm(raw);
    const userMatch =
      userAudios.find((m) => m.name.toLowerCase() === needle || norm(m.name) === needleBase) ||
      (needleBase.length >= 3 ? userAudios.find((m) => norm(m.name).includes(needleBase) || needleBase.includes(norm(m.name))) : undefined);
    if (userMatch) return { id: userMatch.id, name: userMatch.name, url: userMatch.url, duration: userMatch.duration || 1, isMedia: true };
    // 3. Catalogue des effets sonores intégrés (/api/sfx)
    const builtin =
      sfx.find((x) => x.id.toLowerCase() === needle || x.name.toLowerCase() === needle) ||
      sfx.find((x) => norm(x.name).includes(needleBase) || x.id.toLowerCase().includes(needleBase));
    if (builtin) return { id: builtin.id, name: builtin.name, url: builtin.url, duration: builtin.duration, isMedia: false };
    // 4. Dernier recours : recherche souple parmi les médias audio
    try {
      const m = mediaFor(raw, 'audio');
      if (m.kind === 'audio' || m.hasAudio) return { id: m.id, name: m.name, url: m.url, duration: m.duration || 1, isMedia: true };
    } catch { }
    throw new Error(`effet sonore inconnu (${raw})`);
  };
  const timeOf = (v: unknown, fallback: number) => {
    if (v === 'playhead') return engine.time;
    if (v === 'end') return core.projectDuration(project());
    return Math.max(0, num(v, fallback)!);
  };
  const animPatch = (c: Clip, a: Record<string, any>) => {
    const maxD = Math.max(0.1, c.duration / 2);
    if (a.in !== undefined || a.anim_in !== undefined) {
      const t = a.in ?? a.anim_in;
      c.animIn = t === 'none' || t === null ? null : inCatalog(core.ANIMATIONS_IN, t) ? { type: t, duration: clampN(num(a.in_duration, 0.5)!, 0.1, maxD) } : c.animIn;
    }
    if (a.out !== undefined || a.anim_out !== undefined) {
      const t = a.out ?? a.anim_out;
      c.animOut = t === 'none' || t === null ? null : inCatalog(core.ANIMATIONS_OUT, t) ? { type: t, duration: clampN(num(a.out_duration, 0.5)!, 0.1, maxD) } : c.animOut;
    }
    if (a.loop !== undefined || a.anim_loop !== undefined) {
      const t = a.loop ?? a.anim_loop;
      c.animLoop = t === 'none' || t === null ? null : inCatalog(core.ANIMATIONS_LOOP, t) ? { type: t, speed: clampN(num(a.loop_speed, 1)!, 0.2, 4) } : c.animLoop;
    }
  };
  const visualTargets = (v: unknown) => resolve(v).filter((id) => {
    const c = clipById(id);
    return c && core.isVisual(c);
  });

  store.beginBatch();
  try {
    for (const a of actions) {
      try {
        switch (a.type) {
          case 'add_media': {
            const wantAudio = a.track === 'audio' || a.track === 'sfx' || a.at === 'transitions' || a.at === 'junctions';
            const m = mediaFor(a.media ?? a.sfx ?? a.id, wantAudio ? 'audio' : undefined);
            if (a.at === 'transitions' || a.at === 'junctions') {
              finalizers.push(() => {
                const p = project();
                const main = core.mainTrack(p);
                const clips = main ? core.clipsOnTrack(p, main.id) : [];
                const dur = num(a.duration) ?? m.duration ?? 1;
                const times = clips.slice(1).map((b, i) => {
                  const tr = core.transitionBetween(p, clips[i].id, b.id);
                  const junction = tr ? (b.start + core.clipEnd(clips[i])) / 2 : b.start;
                  return Math.max(0, junction - Math.min(0.3, dur / 2));
                });
                store.update((draft) => {
                  for (const at of times) {
                    const track = trackFor(draft, 'sfx', at, at + dur);
                    const clip = core.createMediaClip(mediaLike(m), track.id, at);
                    if (m.kind !== 'audio') Object.assign(clip, { type: 'audio' });
                    clip.duration = clampN(dur, 0.1, core.maxClipDuration(clip));
                    clip.volume = clampN(num(a.volume, 1)!, 0, 2);
                    draft.clips.push(clip);
                  }
                });
                done.push(`Son « ${m.name} » sur ${times.length} transition(s)`);
              });
              break;
            }
            const isShortSound = m.kind === 'audio' && m.duration > 0 && m.duration <= 8;
            const role: TrackRole =
              a.track === 'sfx'
                ? 'sfx'
                : a.track === 'audio'
                  ? 'audio'
                  : m.kind === 'audio'
                    ? isShortSound
                      ? 'sfx'
                      : 'audio'
                    : a.track === 'overlay'
                      ? 'overlay'
                      : 'main';
            if ((role === 'audio' || role === 'sfx') && m.kind !== 'audio' && !m.hasAudio) throw new Error(`« ${m.name} » n'a pas de son`);
            let id = '';
            store.update((p) => {
              const track = role === 'main' ? core.mainTrack(p)! : trackFor(p, role, timeOf(a.at, engine.time), timeOf(a.at, engine.time) + (num(a.duration) ?? m.duration));
              const clip = core.createMediaClip(mediaLike(m), track.id, 0);
              if ((role === 'audio' || role === 'sfx') && m.kind !== 'audio') {
                // Utiliser la bande-son d'une vidéo comme piste audio.
                Object.assign(clip, { type: 'audio' });
              }
              const trim = num(a.trim_start);
              if (trim !== undefined && clip.mediaDuration) clip.trimStart = clampN(trim, 0, Math.max(0, clip.mediaDuration - 0.1));
              if (clip.type === 'image') clip.duration = clampN(num(a.duration, 3)!, 0.2, 600);
              else clip.duration = core.maxClipDuration(clip);
              const d = num(a.duration);
              if (d !== undefined) clip.duration = clampN(d, 0.1, core.maxClipDuration(clip));
              if (num(a.volume) !== undefined) clip.volume = clampN(num(a.volume)!, 0, 2);
              if (num(a.fade_in) !== undefined) clip.fadeIn = clampN(num(a.fade_in)!, 0, clip.duration / 2);
              if (num(a.fade_out) !== undefined) clip.fadeOut = clampN(num(a.fade_out)!, 0, clip.duration / 2);
              if (track.main) {
                const clips = core.clipsOnTrack(p, track.id);
                if (a.at === undefined || a.at === 'end') {
                  appendCursor = appendCursor === null ? Number.MAX_SAFE_INTEGER / 2 : appendCursor + 1;
                  clip.start = appendCursor;
                } else {
                  const t = timeOf(a.at, 0);
                  const after = clips.find((c) => t < c.start + c.duration / 2);
                  clip.start = after ? after.start - 0.001 : core.projectDuration(p) + 1;
                }
              } else {
                clip.start = timeOf(a.at, engine.time);
              }
              p.clips.push(clip);
              id = clip.id;
            });
            if (a.ref) refs.set(String(a.ref), id);
            done.push(`Ajout de « ${m.name} »`);
            break;
          }
          case 'add_sfx': {
            const rawTarget = a.sfx ?? a.media ?? a.id ?? a.name;
            const list = (Array.isArray(rawTarget) ? rawTarget : [rawTarget]).map(resolveSfxOne);
            const s = list[0];
            if (a.at === 'transitions' || a.at === 'junctions') {
              // Placé après toutes les autres actions : les transitions ont alors décalé les clips.
              finalizers.push(() => {
                const p = project();
                const main = core.mainTrack(p);
                const clips = main ? core.clipsOnTrack(p, main.id) : [];
                const items = clips.slice(1).map((b, i) => {
                  const item = list[i % list.length];
                  const tr = core.transitionBetween(p, clips[i].id, b.id);
                  const junction = tr ? (b.start + core.clipEnd(clips[i])) / 2 : b.start;
                  return { item, at: Math.max(0, junction - Math.min(0.3, item.duration / 2)) };
                });
                store.update((draft) => {
                  for (const { item, at } of items) {
                    const track = trackFor(draft, 'sfx', at, at + item.duration);
                    const clip = core.createMediaClip({ id: item.id, kind: 'audio', url: item.url, duration: item.duration, name: item.name }, track.id, at);
                    if (!item.isMedia) delete clip.mediaId;
                    clip.volume = clampN(num(a.volume, 1)!, 0, 2);
                    draft.clips.push(clip);
                  }
                });
                done.push(`Son « ${list.map((x) => x.name).join(', ')} » sur ${items.length} transition(s)`);
              });
              break;
            }
            const at = timeOf(a.at, engine.time);
            let id = '';
            store.update((p) => {
              const track = trackFor(p, 'sfx', at, at + s.duration);
              const clip = core.createMediaClip({ id: s.id, kind: 'audio', url: s.url, duration: s.duration, name: s.name }, track.id, at);
              if (!s.isMedia) delete clip.mediaId;
              if (num(a.duration) !== undefined) clip.duration = clampN(num(a.duration)!, 0.1, core.maxClipDuration(clip));
              clip.volume = clampN(num(a.volume, 1)!, 0, 2);
              p.clips.push(clip);
              id = clip.id;
            });
            if (a.ref) refs.set(String(a.ref), id);
            done.push(`Son « ${s.name} » à ${r2(at)} s`);
            break;
          }
          case 'add_text':
          case 'add_sticker': {
            const at = timeOf(a.at, engine.time);
            const duration = clampN(num(a.duration, 3)!, 0.2, 600);
            let id = '';
            store.update((p) => {
              const track = trackFor(p, 'text', at, at + duration);
              const clip =
                a.type === 'add_text'
                  ? core.createTextClip(track.id, at, String(a.text || 'Texte').slice(0, 300), inCatalog(core.TEXT_PRESETS, a.preset) ? a.preset : 'title')
                  : core.createStickerClip(track.id, at, String(a.emoji || '⭐').slice(0, 8));
              clip.duration = duration;
              const pos = typeof a.position === 'string' ? POSITIONS[a.position] : null;
              if (pos) clip.transform = { ...core.DEFAULT_TRANSFORM, x: pos[0], y: pos[1] };
              if (num(a.x) !== undefined || num(a.y) !== undefined) clip.transform = { ...core.DEFAULT_TRANSFORM, ...clip.transform, x: num(a.x, clip.transform?.x)!, y: num(a.y, clip.transform?.y)! };
              if (num(a.scale) !== undefined) clip.transform = { ...core.DEFAULT_TRANSFORM, ...clip.transform, scale: clampN(num(a.scale)!, 0.05, 5) };
              if (clip.type === 'text' && clip.textStyle) {
                if (isHex(a.color)) clip.textStyle.color = a.color.toUpperCase();
                if (num(a.size) !== undefined) clip.textStyle.fontSize = clampN(num(a.size)!, 0.02, 0.3);
              }
              if (clip.type === 'sticker' && !a.anim_in) clip.animIn = { type: 'pop', duration: 0.4 };
              animPatch(clip, a);
              p.clips.push(clip);
              id = clip.id;
            });
            if (a.ref) refs.set(String(a.ref), id);
            done.push(a.type === 'add_text' ? `Texte « ${String(a.text || '').slice(0, 40)} »` : `Sticker ${a.emoji}`);
            break;
          }
          case 'update_clip': {
            const ids = resolve(a.clip);
            if (!ids.length) throw new Error(`clip introuvable (${JSON.stringify(a.clip)})`);
            store.patchClips(ids, (c) => {
              if (num(a.start) !== undefined) c.start = Math.max(0, num(a.start)!);
              if (num(a.trim_start) !== undefined && c.mediaDuration) c.trimStart = clampN(num(a.trim_start)!, 0, c.mediaDuration - 0.1);
              if (num(a.speed) !== undefined) {
                const span = c.duration * (c.speed || 1);
                c.speed = clampN(num(a.speed)!, 0.1, 4);
                c.duration = span / c.speed;
              }
              if (num(a.duration) !== undefined) c.duration = clampN(num(a.duration)!, 0.1, core.maxClipDuration(c));
              c.duration = Math.min(c.duration, core.maxClipDuration(c));
              if (num(a.volume) !== undefined) c.volume = clampN(num(a.volume)!, 0, 2);
              if (typeof a.muted === 'boolean') c.muted = a.muted;
              if (num(a.fade_in) !== undefined) c.fadeIn = clampN(num(a.fade_in)!, 0, c.duration / 2);
              if (num(a.fade_out) !== undefined) c.fadeOut = clampN(num(a.fade_out)!, 0, c.duration / 2);
              if (c.type === 'text') {
                if (typeof a.text === 'string') c.text = a.text.slice(0, 300);
                c.textStyle = { ...core.DEFAULT_TEXT_STYLE, ...c.textStyle };
                if (isHex(a.color)) c.textStyle.color = a.color.toUpperCase();
                if (num(a.size) !== undefined) c.textStyle.fontSize = clampN(num(a.size)!, 0.02, 0.3);
              }
              if (core.isVisual(c)) {
                const t = { ...core.DEFAULT_TRANSFORM, ...c.transform };
                if (num(a.x) !== undefined) t.x = num(a.x)!;
                if (num(a.y) !== undefined) t.y = num(a.y)!;
                if (num(a.scale) !== undefined) t.scale = clampN(num(a.scale)!, 0.02, 5);
                if (num(a.rotation) !== undefined) t.rotation = num(a.rotation)!;
                if (num(a.opacity) !== undefined) t.opacity = clampN(num(a.opacity)!, 0, 1);
                if (typeof a.flip_h === 'boolean') t.flipH = a.flip_h;
                c.transform = t;
                if (a.fit === 'cover' || a.fit === 'contain') c.fit = a.fit;
              }
              animPatch(c, a);
            });
            done.push(`Modification de ${ids.length} clip(s)`);
            break;
          }
          case 'delete_clip': {
            const ids = new Set(resolve(a.clip));
            if (!ids.size) throw new Error(`clip introuvable (${JSON.stringify(a.clip)})`);
            store.update((p) => {
              p.clips = p.clips.filter((c) => !ids.has(c.id));
            });
            done.push(`Suppression de ${ids.size} clip(s)`);
            break;
          }
          case 'split': {
            const t = timeOf(a.time, engine.time);
            if (a.clip) store.select(resolve(a.clip));
            else store.clearSelection();
            store.splitAt(t);
            done.push(`Coupe à ${r2(t)} s`);
            break;
          }
          case 'transition': {
            const type = inCatalog(core.TRANSITIONS, a.transition) ? a.transition : inCatalog(core.TRANSITIONS, a.name) ? a.name : 'fade';
            const duration = clampN(num(a.duration, 0.5)!, 0.1, 3);
            if (a.all) {
              store.setTransitionEverywhere(type, duration);
              done.push(`Transition « ${type} » sur toutes les jonctions`);
            } else {
              const from = one(a.from, 'clip de départ');
              const to = one(a.to, "clip d'arrivée");
              const p = project();
              const main = core.mainTrack(p)!;
              const clips = core.clipsOnTrack(p, main.id);
              const ia = clips.findIndex((c) => c.id === from);
              if (ia < 0 || clips[ia + 1]?.id !== to) throw new Error('une transition relie deux clips voisins de la vidéo principale');
              store.setTransition(from, to, type, duration);
              done.push(`Transition « ${type} »`);
            }
            break;
          }
          case 'remove_transition': {
            store.update((p) => {
              if (a.all) p.transitions = [];
              else {
                const from = one(a.from, 'clip');
                const to = one(a.to, 'clip');
                p.transitions = p.transitions.filter((t) => !(t.fromId === from && t.toId === to));
              }
            });
            done.push('Transition retirée');
            break;
          }
          case 'animation': {
            const ids = visualTargets(a.clip);
            if (!ids.length) throw new Error('aucun clip visuel ciblé');
            store.patchClips(ids, (c) => animPatch(c, a));
            done.push(`Animation sur ${ids.length} clip(s)`);
            break;
          }
          case 'filter': {
            const ids = visualTargets(a.clip ?? 'all_main');
            if (!inCatalog(core.FILTER_PRESETS, a.filter)) throw new Error(`filtre inconnu (${a.filter})`);
            store.patchClips(ids, (c) => {
              c.filter = { id: a.filter, intensity: clampN(num(a.intensity, 1)!, 0, 1) };
            });
            done.push(`Filtre « ${a.filter} » sur ${ids.length} clip(s)`);
            break;
          }
          case 'adjust': {
            const ids = visualTargets(a.clip ?? 'all_main');
            const keys = Object.keys(core.DEFAULT_ADJUST) as (keyof typeof core.DEFAULT_ADJUST)[];
            store.patchClips(ids, (c) => {
              const adj = { ...core.DEFAULT_ADJUST, ...c.adjust };
              for (const k of keys) if (num(a[k]) !== undefined) adj[k] = k === 'hue' ? clampN(num(a[k])!, -180, 180) : clampN(num(a[k])!, k === 'blur' || k === 'vignette' || k === 'sharpen' ? 0 : -1, 1);
              c.adjust = adj;
            });
            done.push(`Réglages couleur sur ${ids.length} clip(s)`);
            break;
          }
          case 'effect': {
            const ids = visualTargets(a.clip ?? 'all_main');
            if (!inCatalog(core.EFFECTS, a.effect)) throw new Error(`effet inconnu (${a.effect})`);
            store.patchClips(ids, (c) => {
              const list = (c.effects || []).filter((e) => e.id !== a.effect);
              c.effects = a.remove ? list : [...list, { id: a.effect, intensity: clampN(num(a.intensity, 0.6)!, 0, 1) }];
            });
            done.push(`${a.remove ? 'Retrait' : 'Effet'} « ${a.effect} » sur ${ids.length} clip(s)`);
            break;
          }
          case 'keyframes': {
            const id = one(a.clip, 'clip');
            if (!core.KEYFRAME_PROPS.includes(a.prop)) throw new Error(`propriété inconnue (${a.prop})`);
            const keys = (Array.isArray(a.keys) ? a.keys : [])
              .map((k: any) => ({ t: num(k?.t), v: num(k?.v) }))
              .filter((k: { t?: number; v?: number }) => k.t !== undefined && k.v !== undefined) as { t: number; v: number }[];
            if (keys.length === 0) throw new Error('aucune image clé valide');
            store.patchClip(id, (c) => {
              c.keyframes = { ...(c.keyframes || {}), [a.prop]: keys.map((k) => ({ t: clampN(k.t, 0, c.duration), v: k.v })).sort((x, y) => x.t - y.t) };
            });
            done.push(`${keys.length} images clés (${a.prop})`);
            break;
          }
          case 'captions': {
            // Sans style demandé : celui du thème du projet.
            const themeCap = core.THEMES.find((t) => t.id === project().settings.theme)?.captionPreset;
            const preset = inCatalog(captionEngine.PRESETS, a.preset) ? a.preset : themeCap;
            const restyle = () => {
              const caps = project().clips.filter((c) => c.type === 'caption');
              if (!caps.length) return false;
              store.patchClips(caps.map((c) => c.id), (c) => {
                let style = preset ? captionEngine.applyPreset(preset) : captionEngine.resolveStyle(c.captionStyle || {});
                const pos = typeof a.position === 'string' ? POSITIONS[a.position] : null;
                if (pos) style = { ...style, positionY: pos[1] === 0.78 ? 0.72 : pos[1] };
                if (isHex(a.color)) style = { ...style, textColor: a.color.toUpperCase() };
                if (isHex(a.highlight)) style = { ...style, highlightColors: [a.highlight.toUpperCase()] };
                c.captionStyle = style as any;
              });
              return true;
            };
            // Pas encore de sous-titres : on les génère (même si l'IA a oublié "generate").
            if (a.generate || !project().clips.some((c) => c.type === 'caption')) {
              deferred.push(async () => {
                // Anglais par défaut (traduction Whisper), sauf "translate": false.
                const translate = a.translate !== false;
                const { wordCount, failed } = await generateTimelineCaptions(store, { language: typeof a.language === 'string' ? a.language : 'auto', translate, preset, onProgress });
                restyle();
                done.push(`Sous-titres générés${translate ? ' en anglais' : ''} (${wordCount} mots)`);
                if (failed.length) warnings.push(`Transcription impossible : ${failed.join(', ')}`);
              });
            } else if (restyle()) done.push('Style des sous-titres modifié');
            else throw new Error('aucun sous-titre à modifier (demandez d’abord de les générer)');
            break;
          }
          case 'cut_silences': {
            const ids = resolve(a.clip ?? 'all_main');
            const min = clampN(num(a.min_silence, 0.5)!, 0.2, 3);
            deferred.push(async () => {
              const { removedSeconds, failed } = await cutSilences(store, ids, min, { onProgress });
              done.push(`Silences supprimés (${r2(removedSeconds)} s gagnées)`);
              if (failed.length) warnings.push(`Transcription impossible : ${failed.join(', ')}`);
              if (store.getState().project.clips.some((c) => c.type === 'caption')) warnings.push('Les sous-titres existants ne sont plus calés : demandez de les régénérer.');
            });
            break;
          }
          case 'theme': {
            if (!inCatalog(core.THEMES, a.theme)) throw new Error(`thème inconnu (${a.theme})`);
            // Appliqué à la fin : il habille aussi les clips ajoutés par les autres actions du plan.
            finalizers.push(() => {
              applyTheme(store, a.theme, sfx, { sfx: a.sfx !== false });
            });
            done.push(`Thème « ${core.THEMES.find((t) => t.id === a.theme)!.name} »`);
            break;
          }
          case 'broll': {
            const ids = (Array.isArray(a.media) ? a.media : a.media ? [a.media] : []).map((v: unknown) => mediaFor(v).id);
            deferred.push(async () => {
              const { placed, failed } = await autoBroll(store, { ...aiOptions, mediaIds: ids, instructions: typeof a.instructions === 'string' ? a.instructions : '', onProgress });
              done.push(placed ? `B-roll : ${placed} clip(s) calé(s) sur la voix` : 'B-roll : aucun média ne correspond à ce qui est dit');
              if (failed.length) warnings.push(`Transcription impossible : ${failed.join(', ')}`);
            });
            break;
          }
          case 'reorder':
          case 'sort': {
            const p = project();
            const main = core.mainTrack(p);
            if (!main) throw new Error('pas de vidéo principale');
            const clips = core.clipsOnTrack(p, main.id);
            let ordered: Clip[];
            if (a.type === 'reorder') {
              const wanted = resolve(a.order);
              const picked = wanted.map((id) => clips.find((c) => c.id === id)).filter(Boolean) as Clip[];
              ordered = [...picked, ...clips.filter((c) => !wanted.includes(c.id))];
            } else {
              const by = String(a.by || 'name');
              ordered = clips.slice();
              if (by === 'name') ordered.sort((x, y) => (x.name || '').localeCompare(y.name || '', 'fr', { numeric: true }));
              else if (by === 'duration') ordered.sort((x, y) => x.duration - y.duration);
              else if (by === 'duration_desc') ordered.sort((x, y) => y.duration - x.duration);
              else if (by === 'reverse') ordered.reverse();
              else throw new Error(`tri inconnu (${by})`);
            }
            // Nouvel ordre : la piste magnétique recolle les clips ; les transitions entre anciens voisins sont retirées.
            store.update((draft) => {
              ordered.forEach((c, i) => {
                const d = draft.clips.find((x) => x.id === c.id);
                if (d) d.start = i * 0.001;
              });
              const pairs = new Set(ordered.slice(1).map((c, i) => `${ordered[i].id}>${c.id}`));
              draft.transitions = draft.transitions.filter((t) => pairs.has(`${t.fromId}>${t.toId}`));
            });
            done.push(a.type === 'sort' ? `Clips triés (${a.by})` : `Clips réordonnés (${ordered.length})`);
            break;
          }
          case 'project': {
            const patch: Partial<EditorProject['settings']> = {};
            const ratio = core.ASPECT_RATIOS.find((x) => x.id === a.aspect);
            if (ratio) Object.assign(patch, { aspect: ratio.id, width: ratio.width, height: ratio.height });
            if (a.background === 'blur') patch.background = { ...project().settings.background, type: 'blur' };
            else if (isHex(a.background)) patch.background = { type: 'color', color: a.background.toUpperCase() };
            if ([24, 25, 30, 50, 60].includes(num(a.fps) as number)) patch.fps = num(a.fps);
            if (typeof a.normalize_audio === 'boolean') patch.normalizeAudio = a.normalize_audio;
            store.patchSettings(patch);
            done.push('Réglages du projet');
            break;
          }
          case 'seek':
            seekTo = timeOf(a.time, engine.time);
            break;
          default:
            warnings.push(`Action inconnue ignorée : ${a.type}`);
        }
      } catch (err: any) {
        warnings.push(`${a.type} : ${err.message}`);
      }
    }
    for (const run of finalizers) {
      try {
        run();
      } catch (err: any) {
        warnings.push(err.message);
      }
    }
  } finally {
    store.endBatch();
  }

  for (const run of deferred) {
    try {
      await run();
    } catch (err: any) {
      warnings.push(err.message);
    }
  }
  if (seekTo !== null) engine.seek(seekTo);
  return { done, warnings };
}

// ------------------------------------------------------------------ B-roll

export interface AiCallOptions {
  provider?: string;
  model?: string;
  mode?: AiMode;
}

/** Découpe la voix en courtes phrases horodatées (pause, ponctuation ou 8 mots). */
function phrases(words: { text: string; start: number; end: number }[]) {
  const out: { start: number; end: number; text: string }[] = [];
  let cur: { start: number; end: number; words: string[] } | null = null;
  const flush = () => {
    if (cur) out.push({ start: r2(cur.start), end: r2(cur.end), text: cur.words.join(' ') });
    cur = null;
  };
  for (const w of words) {
    if (cur && (w.start - cur.end > 0.35 || cur.words.length >= 8)) flush();
    if (!cur) cur = { start: w.start, end: w.end, words: [] };
    cur.words.push(w.text);
    cur.end = w.end;
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return out;
}

/**
 * B-roll automatique : illustre ce qui est dit avec les médias qui le montrent
 * (« l'appareil photo » → le clip où l'on voit un appareil photo). Les médias
 * sont incrustés en plein écran, sans son, sur une piste « B-roll » placée
 * juste au-dessus de la vidéo principale (sous les textes et sous-titres).
 */
export async function autoBroll(
  store: EditorStore,
  opts: AiCallOptions & { mediaIds?: string[]; instructions?: string; onProgress?: Progress; signal?: AbortSignal } = {}
) {
  const project = () => store.getState().project;
  const sources = speechClips(project().clips);
  if (sources.length === 0) throw new Error('B-roll : aucune voix dans la timeline (ajoutez une vidéo ou une voix off).');
  const { transcripts, failed } = await ensureTranscripts(sources.map((c) => c.mediaId!), { onProgress: opts.onProgress });
  const segments = phrases(timelineWords(speechClips(project().clips), transcripts));
  if (segments.length === 0) throw new Error('B-roll : aucune parole détectée.');

  // Candidats : les médias demandés, sinon tous les visuels absents de la vidéo principale.
  const all = await listMedia();
  const main = core.mainTrack(project());
  const onMain = new Set(main ? core.clipsOnTrack(project(), main.id).map((c) => c.mediaId) : []);
  let candidates = all.filter((m) => m.kind !== 'audio' && (opts.mediaIds?.length ? opts.mediaIds.includes(m.id) : !onMain.has(m.id)));
  if (candidates.length === 0) throw new Error('B-roll : importez des clips ou des captures à montrer.');
  candidates = candidates.slice(0, 60);

  // L'IA « regarde » les médias pas encore analysés.
  const missing = candidates.filter((m) => !m.vision).map((m) => m.id);
  if (missing.length) {
    opts.onProgress?.(`L’IA regarde vos médias (${missing.length})…`, 0);
    const { media: described } = await describeMedia(missing, opts.signal);
    const byId = new Map(described.map((m) => [m.id, m]));
    candidates = candidates.map((m) => byId.get(m.id) || m);
  }

  opts.onProgress?.('L’IA associe la voix aux images…', 50);
  const alias = new Map(candidates.map((m, i) => [`b${i + 1}`, m]));
  const duration = core.projectDuration(project());
  const { placements } = await aiBroll(
    {
      segments,
      media: [...alias].map(([id, m]) => ({ id, name: m.name, kind: m.kind, duration: r2(m.duration), desc: m.vision?.description, tags: m.vision?.tags, text: m.vision?.text })),
      duration,
      instructions: opts.instructions,
      provider: opts.provider,
      model: opts.model,
      mode: opts.mode,
    },
    opts.signal
  );

  // Validation : dans la vidéo, durées raisonnables, sans chevauchement.
  const valid: { m: Media; start: number; duration: number; trim: number }[] = [];
  for (const pl of placements.slice().sort((x, y) => num(x.start, 0)! - num(y.start, 0)!)) {
    const m = alias.get(pl.media);
    const start = num(pl.start);
    if (!m || start === undefined || start < 0 || start >= duration - 0.3) continue;
    let d = clampN(num(pl.duration, 3)!, 0.8, 8);
    let trim = 0;
    if (m.kind === 'video') {
      trim = clampN(num(pl.trim_start, 0)!, 0, Math.max(0, m.duration - 0.5));
      d = Math.min(d, m.duration - trim);
    }
    d = Math.min(d, duration - start);
    const last = valid[valid.length - 1];
    if (last && start < last.start + last.duration - 0.05) continue;
    if (d >= 0.5) valid.push({ m, start, duration: d, trim });
  }
  if (valid.length === 0) return { placed: 0, failed };

  let placed = 0;
  store.update((p) => {
    let track = p.tracks.find((t) => t.name === 'B-roll' && t.kind === 'visual');
    if (!track) {
      track = { id: core.uid('trk'), kind: 'visual', name: 'B-roll' } as Track;
      const mainIndex = p.tracks.findIndex((t) => t.main);
      p.tracks.splice(mainIndex < 0 ? p.tracks.length : mainIndex, 0, track);
    }
    const busy = core.clipsOnTrack(p, track.id);
    for (const v of valid) {
      if (busy.some((c) => v.start < core.clipEnd(c) - 1e-3 && v.start + v.duration > c.start + 1e-3)) continue;
      const clip = core.createMediaClip(mediaLike(v.m), track.id, v.start);
      clip.trimStart = v.trim;
      clip.duration = v.duration;
      clip.muted = true;
      clip.fit = 'cover';
      clip.animIn = { type: 'fade', duration: Math.min(0.2, v.duration / 4) };
      clip.animOut = { type: 'fade', duration: Math.min(0.2, v.duration / 4) };
      p.clips.push(clip);
      busy.push(clip);
      placed += 1;
    }
  });
  return { placed, failed };
}

// ------------------------------------------------------------------ thèmes

const THEME_SFX_PREFIX = 'Thème · ';

/**
 * Applique un thème (core.THEMES) à tout le projet en une étape annulable :
 * filtre sur les visuels, effet sur la vidéo principale, transitions sur toutes
 * les jonctions, style des sous-titres et des textes, animation d'entrée des
 * textes et son sur chaque transition. Réappliquer un autre thème remplace le
 * précédent (ses effets et ses sons sont retirés).
 */
export function applyTheme(store: EditorStore, themeId: string, sfx: SfxItem[], opts: { sfx?: boolean } = {}) {
  const theme = core.THEMES.find((t) => t.id === themeId);
  if (!theme) throw new Error(`thème inconnu (${themeId})`);
  const themeEffects = new Set(core.THEMES.map((t) => t.effect).filter(Boolean) as string[]);
  const textPreset = core.TEXT_PRESETS.find((p) => p.id === theme.textPreset);
  store.beginBatch();
  try {
    store.update((p) => {
      const main = core.mainTrack(p);
      for (const c of p.clips) {
        if (c.type === 'video' || c.type === 'image') {
          c.filter = { id: theme.filter, intensity: theme.filterIntensity };
          const kept = (c.effects || []).filter((e) => !themeEffects.has(e.id));
          c.effects = theme.effect && c.trackId === main?.id ? [...kept, { id: theme.effect, intensity: theme.effectIntensity ?? 0.5 }] : kept;
        }
        if (c.type === 'caption') {
          const prev = captionEngine.resolveStyle(c.captionStyle || {});
          c.captionStyle = captionEngine.applyPreset(theme.captionPreset, prev) as any;
        }
        if (c.type === 'text' && textPreset) {
          c.textStyle = { ...core.DEFAULT_TEXT_STYLE, ...textPreset.style } as any;
          c.animIn = { type: theme.textAnim, duration: Math.min(0.5, Math.max(0.1, c.duration / 3)) };
        }
      }
      p.settings.theme = theme.id;
      // Sons du thème précédent retirés.
      p.clips = p.clips.filter((c) => !(c.name || '').startsWith(THEME_SFX_PREFIX));
    });
    store.setTransitionEverywhere(theme.transition, theme.transitionDuration);
    const s = theme.sfx && opts.sfx !== false ? sfx.find((x) => x.id === theme.sfx) : null;
    if (s) {
      const p = store.getState().project;
      const main = core.mainTrack(p);
      const clips = main ? core.clipsOnTrack(p, main.id) : [];
      const times = clips.slice(1).map((b, i) => {
        const tr = core.transitionBetween(p, clips[i].id, b.id);
        const junction = tr ? (b.start + core.clipEnd(clips[i])) / 2 : b.start;
        return Math.max(0, junction - Math.min(0.3, s.duration / 2));
      });
      store.update((draft) => {
        for (const at of times) {
          const track = trackFor(draft, 'sfx', at, at + s.duration);
          const clip = core.createMediaClip({ id: s.id, kind: 'audio', url: s.url, duration: s.duration, name: s.name }, track.id, at);
          delete clip.mediaId;
          clip.name = THEME_SFX_PREFIX + s.name;
          clip.volume = 0.8;
          draft.clips.push(clip);
        }
      });
    }
  } finally {
    store.endBatch();
  }
  return theme;
}
