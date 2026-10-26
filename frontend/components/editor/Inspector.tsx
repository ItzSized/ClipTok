'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Diamond, FlipHorizontal, FlipVertical, RotateCcw, Trash2, Unlink, Pipette, ChevronLeft, ChevronRight, AlignLeft, AlignCenter, AlignRight, X, Play, Square, RefreshCw, Plus, Volume2, VolumeX, Upload } from 'lucide-react';
import * as core from '@shared/editorCore';
import * as captionEngine from '@shared/captionEngine';
import type { Clip, KeyframeProp, TextStyle } from '@shared/editorCore';
import type { CaptionStyle } from '@shared/captionEngine';
import { useEditor, useEditorStore, isSfxTrack } from './store';
import { useEngine, usePlayback } from './engineContext';
import { Section, Slider, ColorInput, Toggle, Segmented, Select, Field, formatTime } from '@/components/ui/controls';
import CaptionStylePanel from '@/components/captions/CaptionStylePanel';
import TranscriptEditor from '@/components/captions/TranscriptEditor';
import { ensureAllFonts, fontFamilyFor } from '@/lib/fonts';
import { listMedia, getSfx, uploadMedia, absoluteFileUrl } from '@/lib/api';
import type { FontInfo, Media, SfxItem } from '@/lib/types';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const sec = (v: number) => `${v.toFixed(1)} s`;

function baseState(clip: Clip, local: number) {
  return core.visualStateAt({ ...clip, animIn: null, animOut: null, animLoop: null, effects: [] }, Math.max(0, Math.min(local, clip.duration)));
}

// ------------------------------------------------------------------ transformations + images clés

function KeyButton({ clip, prop, local }: { clip: Clip; prop: KeyframeProp; local: number }) {
  const store = useEditorStore();
  const keys = clip.keyframes?.[prop] || [];
  const onKey = keys.some((k) => Math.abs(k.t - local) < 1 / 30);
  return (
    <button
      type="button"
      onClick={() => store.toggleKeyframe(clip.id, prop)}
      title={onKey ? 'Retirer l’image clé' : keys.length ? 'Ajouter une image clé ici' : 'Animer avec des images clés'}
      className={`p-1 rounded ${onKey ? 'text-sky-300' : keys.length ? 'text-sky-500/70' : 'text-zinc-600 hover:text-zinc-300'}`}
    >
      <Diamond className={`w-3.5 h-3.5 ${onKey ? 'fill-sky-300' : ''}`} />
    </button>
  );
}

function TransformSection({ clip, local }: { clip: Clip; local: number }) {
  const store = useEditorStore();
  const engine = useEngine();
  const s = baseState(clip, local);
  const row = (prop: KeyframeProp, label: string, min: number, max: number, step: number, format: (v: number) => string) => (
    <div className="flex items-end gap-1">
      <div className="flex-1">
        <Slider label={label} value={s[prop]} min={min} max={max} step={step} onChange={(v) => store.setTransformProp(clip.id, prop, v)} format={format} />
      </div>
      <KeyButton clip={clip} prop={prop} local={local} />
    </div>
  );
  const allKeys = [...new Set(Object.values(clip.keyframes || {}).flatMap((list) => (list || []).map((k) => Math.round(k.t * 1000) / 1000)))].sort((a, b) => a - b);
  const prevKey = [...allKeys].reverse().find((t) => t < local - 1e-3);
  const nextKey = allKeys.find((t) => t > local + 1e-3);
  return (
    <Section
      title="Position & taille"
      right={
        allKeys.length > 0 ? (
          <span className="flex items-center gap-0.5 text-[10px] text-sky-300">
            <button disabled={prevKey === undefined} onClick={() => prevKey !== undefined && engine.seek(clip.start + prevKey)} className="p-1 disabled:opacity-30" title="Image clé précédente">
              <ChevronLeft className="w-3 h-3" />
            </button>
            {allKeys.length} clé{allKeys.length > 1 ? 's' : ''}
            <button disabled={nextKey === undefined} onClick={() => nextKey !== undefined && engine.seek(clip.start + nextKey)} className="p-1 disabled:opacity-30" title="Image clé suivante">
              <ChevronRight className="w-3 h-3" />
            </button>
          </span>
        ) : undefined
      }
    >
      {row('scale', 'Échelle', 0.05, 4, 0.01, pct)}
      {row('x', 'Position horizontale', -0.5, 1.5, 0.001, pct)}
      {row('y', 'Position verticale', -0.5, 1.5, 0.001, pct)}
      {row('rotation', 'Rotation', -180, 180, 0.5, (v) => `${Math.round(v)}°`)}
      {row('opacity', 'Opacité', 0, 1, 0.01, pct)}
      <div className="flex gap-2">
        <button
          onClick={() => store.patchClip(clip.id, (c) => (c.transform = { ...core.DEFAULT_TRANSFORM, ...c.transform, flipH: !c.transform?.flipH }))}
          className={`flex-1 py-1.5 rounded-lg border text-xs flex items-center justify-center gap-1 ${clip.transform?.flipH ? 'border-cyan-500 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}
        >
          <FlipHorizontal className="w-3.5 h-3.5" /> Miroir H
        </button>
        <button
          onClick={() => store.patchClip(clip.id, (c) => (c.transform = { ...core.DEFAULT_TRANSFORM, ...c.transform, flipV: !c.transform?.flipV }))}
          className={`flex-1 py-1.5 rounded-lg border text-xs flex items-center justify-center gap-1 ${clip.transform?.flipV ? 'border-cyan-500 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}
        >
          <FlipVertical className="w-3.5 h-3.5" /> Miroir V
        </button>
        <button
          onClick={() =>
            store.patchClip(clip.id, (c) => {
              c.transform = { ...core.DEFAULT_TRANSFORM };
              c.keyframes = {};
            })
          }
          className="px-2 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white"
          title="Réinitialiser"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
      {(clip.type === 'video' || clip.type === 'image') && (
        <Segmented
          value={clip.fit || 'contain'}
          onChange={(fit) => store.patchClip(clip.id, { fit })}
          options={[
            { value: 'contain', label: 'Ajuster' },
            { value: 'cover', label: 'Remplir le cadre' },
          ]}
        />
      )}
      {Object.keys(clip.keyframes || {}).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(Object.keys(clip.keyframes || {}) as KeyframeProp[]).map((p) => (
            <button key={p} onClick={() => store.clearKeyframes(clip.id, p)} className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 hover:bg-red-500/20 hover:text-red-300 flex items-center gap-1" title="Supprimer toutes les images clés de cette propriété">
              {p} <X className="w-2.5 h-2.5" />
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

function CropSection({ clip }: { clip: Clip }) {
  const store = useEditorStore();
  const crop = { ...core.DEFAULT_CROP, ...clip.crop };
  const set = (k: keyof typeof crop, v: number) => store.patchClip(clip.id, (c) => (c.crop = { ...core.DEFAULT_CROP, ...c.crop, [k]: v }), `crop:${clip.id}:${k}`);
  return (
    <Section title="Recadrage" defaultOpen={false}>
      <Slider label="Gauche" value={crop.left} min={0} max={0.9 - crop.right} onChange={(v) => set('left', v)} format={pct} />
      <Slider label="Droite" value={crop.right} min={0} max={0.9 - crop.left} onChange={(v) => set('right', v)} format={pct} />
      <Slider label="Haut" value={crop.top} min={0} max={0.9 - crop.bottom} onChange={(v) => set('top', v)} format={pct} />
      <Slider label="Bas" value={crop.bottom} min={0} max={0.9 - crop.top} onChange={(v) => set('bottom', v)} format={pct} />
    </Section>
  );
}

// ------------------------------------------------------------------ audio / vitesse

function AudioSection({ clip }: { clip: Clip }) {
  const store = useEditorStore();
  const project = useEditor((s) => s.project);
  const [showReplace, setShowReplace] = useState(false);
  const [search, setSearch] = useState('');
  const [media, setMedia] = useState<Media[]>([]);
  const [sfx, setSfx] = useState<SfxItem[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!showReplace) return;
    listMedia().then((m) => setMedia(m.filter((x) => x.kind === 'audio'))).catch(() => {});
    getSfx().then(setSfx).catch(() => {});
  }, [showReplace]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const previewSound = (id: string, src: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const a = new Audio(absoluteFileUrl(src));
    a.onended = () => setPlayingId(null);
    a.onerror = () => setPlayingId(null);
    a.play().catch(() => setPlayingId(null));
    audioRef.current = a;
    setPlayingId(id);
  };

  const onUploadReplacement = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const { media: uploaded } = await uploadMedia(Array.from(files));
    const first = uploaded.find((m) => m.kind === 'audio') || uploaded[0];
    if (first) {
      store.replaceClipAudio(clip.id, { id: first.id, name: first.name, src: first.url, duration: first.duration });
      setMedia((prev) => [first, ...prev]);
      setShowReplace(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filteredMedia = media.filter((m) => !q || m.name.toLowerCase().includes(q));
  const filteredSfx = sfx.filter((s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q));
  const audioTracks = project.tracks.filter((t) => t.kind === 'audio');
  const currentTrack = project.tracks.find((t) => t.id === clip.trackId);

  return (
    <>
      <Section title="Volume & Son">
        <Slider label="Volume" value={clip.volume ?? 1} min={0} max={2} step={0.01} onChange={(v) => store.patchClip(clip.id, { volume: v }, `vol:${clip.id}`)} format={pct} />
        <div className="grid grid-cols-6 gap-1">
          {[
            { label: 'Muet', v: 0 },
            { label: 'Fond 15%', v: 0.15 },
            { label: 'Doux 40%', v: 0.4 },
            { label: '100%', v: 1 },
            { label: '150%', v: 1.5 },
            { label: 'Max 200%', v: 2 },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => store.patchClip(clip.id, { volume: preset.v, muted: preset.v === 0 })}
              className={`py-1 rounded text-[10px] font-bold border transition-colors ${
                Math.abs((clip.muted ? 0 : (clip.volume ?? 1)) - preset.v) < 0.03 ? 'border-cyan-500 bg-cyan-500/15 text-white' : 'border-white/10 text-zinc-400 hover:text-white'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <Toggle label="Couper le son" checked={Boolean(clip.muted)} onChange={(v) => store.patchClip(clip.id, { muted: v })} />
        <Slider label="Fondu d'entrée" value={clip.fadeIn || 0} min={0} max={Math.min(10, clip.duration / 2)} step={0.05} onChange={(v) => store.patchClip(clip.id, { fadeIn: v }, `fi:${clip.id}`)} format={sec} />
        <Slider label="Fondu de sortie" value={clip.fadeOut || 0} min={0} max={Math.min(10, clip.duration / 2)} step={0.05} onChange={(v) => store.patchClip(clip.id, { fadeOut: v }, `fo:${clip.id}`)} format={sec} />
        {clip.type === 'video' && clip.hasAudio !== false && (
          <button onClick={() => store.detachAudio(clip.id)} className="py-2 rounded-lg border border-white/10 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/5 flex items-center justify-center gap-2">
            <Unlink className="w-3.5 h-3.5" /> Extraire l'audio sur une piste séparée
          </button>
        )}
      </Section>

      {clip.type === 'audio' && (
        <>
          <Section title="Ligne / Piste (Audio ou Effets sonores)">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => store.moveClipToRole(clip.id, 'audio')}
                className={`py-1.5 px-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  currentTrack && !isSfxTrack(currentTrack) ? 'border-cyan-500 bg-cyan-500/10 text-white' : 'border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                🎵 Piste Audio / Musique
              </button>
              <button
                type="button"
                onClick={() => store.moveClipToRole(clip.id, 'sfx')}
                className={`py-1.5 px-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  currentTrack && isSfxTrack(currentTrack) ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200' : 'border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                ⚡ Effets sonores (SFX)
              </button>
              <button
                type="button"
                onClick={() => store.moveClipToRole(clip.id, 'new_audio')}
                className="py-1.5 px-2 rounded-lg border border-white/10 hover:border-white/30 text-[11px] font-semibold text-zinc-300 hover:text-white flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" /> Nouvelle ligne Audio
              </button>
              <button
                type="button"
                onClick={() => store.moveClipToRole(clip.id, 'new_sfx')}
                className="py-1.5 px-2 rounded-lg border border-emerald-500/20 hover:border-emerald-400/50 text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" /> Nouvelle ligne SFX
              </button>
            </div>
            {audioTracks.length > 1 && (
              <Field label="Choisir la ligne exacte">
                <Select
                  value={clip.trackId}
                  onChange={(tid) => store.moveClip(clip.id, clip.start, tid)}
                  options={audioTracks.map((t) => ({ value: t.id, label: t.name }))}
                />
              </Field>
            )}
          </Section>

          <Section title="Changer le son / Musique / SFX">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setShowReplace((v) => !v)}
                className="flex-1 py-2 px-3 rounded-lg bg-cyan-500/15 border border-cyan-500/30 hover:bg-cyan-500/25 text-xs font-bold text-cyan-200 flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> {showReplace ? 'Fermer la liste des sons' : 'Remplacer par un autre son / SFX'}
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="py-2 px-3 rounded-lg border border-white/15 hover:bg-white/10 text-xs font-semibold text-zinc-200 flex items-center gap-1"
                title="Importer un fichier audio pour remplacer ce son"
              >
                <Upload className="w-3.5 h-3.5" /> Importer
              </button>
              <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => onUploadReplacement(e.target.files)} />
            </div>

            {showReplace && (
              <div className="mt-2 flex flex-col gap-2 bg-black/40 border border-white/10 rounded-xl p-2.5 max-h-72 overflow-y-auto">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher une musique, voix ou SFX..."
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                />
                {filteredMedia.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Vos sons & musiques importés</p>
                    <div className="flex flex-col gap-1">
                      {filteredMedia.map((m) => (
                        <div
                          key={m.id}
                          onClick={() => {
                            store.replaceClipAudio(clip.id, { id: m.id, name: m.name, src: m.url, duration: m.duration });
                            setShowReplace(false);
                          }}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-cyan-500/15 border border-transparent hover:border-cyan-500/30 cursor-pointer text-xs"
                        >
                          <button
                            type="button"
                            onClick={(e) => previewSound(m.id, m.url, e)}
                            className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center flex-shrink-0"
                            title="Écouter"
                          >
                            {playingId === m.id ? <Square className="w-2.5 h-2.5 text-cyan-300" /> : <Play className="w-2.5 h-2.5 ml-0.5 text-white" />}
                          </button>
                          <span className="truncate flex-1 font-medium text-zinc-200">{m.name}</span>
                          <span className="text-[10px] font-mono text-zinc-500">{formatTime(m.duration || 0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {filteredSfx.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1 mt-1">Effets sonores (SFX)</p>
                    <div className="flex flex-col gap-1">
                      {filteredSfx.map((s) => (
                        <div
                          key={s.id}
                          onClick={() => {
                            store.replaceClipAudio(clip.id, { id: s.id, name: s.name, src: s.url, duration: s.duration });
                            setShowReplace(false);
                          }}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-emerald-500/15 border border-transparent hover:border-emerald-500/30 cursor-pointer text-xs"
                        >
                          <button
                            type="button"
                            onClick={(e) => previewSound(s.id, s.url, e)}
                            className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center flex-shrink-0"
                            title="Écouter"
                          >
                            {playingId === s.id ? <Square className="w-2.5 h-2.5 text-emerald-300" /> : <Play className="w-2.5 h-2.5 ml-0.5 text-white" />}
                          </button>
                          <span className="truncate flex-1 font-medium text-zinc-200">{s.name}</span>
                          <span className="text-[10px] text-zinc-500">{s.category}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}

function SpeedSection({ clip }: { clip: Clip }) {
  const store = useEditorStore();
  const setSpeed = (speed: number) =>
    store.patchClip(
      clip.id,
      (c) => {
        const span = c.duration * (c.speed || 1);
        c.speed = Math.round(speed * 100) / 100;
        c.duration = Math.max(0.1, Math.min(span / c.speed, core.maxClipDuration(c)));
      },
      `speed:${clip.id}`
    );
  return (
    <Section title="Vitesse">
      <Slider label="Vitesse" value={clip.speed || 1} min={0.1} max={4} step={0.05} onChange={setSpeed} format={(v) => `${v.toFixed(2)}x`} />
      <div className="grid grid-cols-6 gap-1">
        {[0.25, 0.5, 1, 1.5, 2, 3].map((v) => (
          <button key={v} onClick={() => setSpeed(v)} className={`py-1.5 rounded-md text-[11px] font-bold border ${(clip.speed || 1) === v ? 'border-cyan-500 text-white bg-cyan-500/10' : 'border-white/10 text-zinc-400 hover:text-white'}`}>
            {v}x
          </button>
        ))}
      </div>
      <p className="text-[11px] text-zinc-600">La hauteur de la voix est conservée. Durée : {clip.duration.toFixed(2)} s.</p>
    </Section>
  );
}

// ------------------------------------------------------------------ animations

function AnimGrid({ items, value, onPick }: { items: { id: string; name: string }[]; value: string | null; onPick: (id: string | null) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      <button onClick={() => onPick(null)} className={`px-1 py-2 rounded-md text-[11px] font-semibold border ${!value ? 'border-cyan-500 text-white bg-cyan-500/10' : 'border-white/10 text-zinc-400 hover:text-white'}`}>
        Aucune
      </button>
      {items.map((a) => (
        <button key={a.id} onClick={() => onPick(a.id)} className={`px-1 py-2 rounded-md text-[11px] font-semibold border truncate ${value === a.id ? 'border-cyan-500 text-white bg-cyan-500/10' : 'border-white/10 text-zinc-400 hover:text-white'}`}>
          {a.name}
        </button>
      ))}
    </div>
  );
}

function AnimationSection({ clip }: { clip: Clip }) {
  const store = useEditorStore();
  const engine = useEngine();
  const maxDur = Math.max(0.1, Math.min(3, clip.duration / 2));
  /** Joue un extrait du clip pour visualiser l'animation choisie. */
  const preview = (from: number, length: number) => {
    engine.seek(Math.max(0, from));
    engine.play();
    setTimeout(() => engine.pause(), Math.max(400, length * 1000 + 300));
  };
  return (
    <>
      <Section title="Entrée">
        <AnimGrid
          items={core.ANIMATIONS_IN}
          value={clip.animIn?.type || null}
          onPick={(type) => {
            const duration = clip.animIn?.duration || Math.min(0.5, maxDur);
            store.patchClip(clip.id, { animIn: type ? { type, duration } : null });
            if (type) preview(clip.start, duration);
          }}
        />
        {clip.animIn && <Slider label="Durée" value={clip.animIn.duration} min={0.1} max={maxDur} step={0.05} onChange={(v) => store.patchClip(clip.id, { animIn: { ...clip.animIn!, duration: v } }, `ai:${clip.id}`)} format={sec} />}
      </Section>
      <Section title="Sortie">
        <AnimGrid
          items={core.ANIMATIONS_OUT}
          value={clip.animOut?.type || null}
          onPick={(type) => {
            const duration = clip.animOut?.duration || Math.min(0.5, maxDur);
            store.patchClip(clip.id, { animOut: type ? { type, duration } : null });
            if (type) preview(core.clipEnd(clip) - duration - 0.2, duration + 0.2);
          }}
        />
        {clip.animOut && <Slider label="Durée" value={clip.animOut.duration} min={0.1} max={maxDur} step={0.05} onChange={(v) => store.patchClip(clip.id, { animOut: { ...clip.animOut!, duration: v } }, `ao:${clip.id}`)} format={sec} />}
      </Section>
      <Section title="Boucle (combo)">
        <AnimGrid
          items={core.ANIMATIONS_LOOP}
          value={clip.animLoop?.type || null}
          onPick={(type) => {
            store.patchClip(clip.id, { animLoop: type ? { type, speed: clip.animLoop?.speed || 1 } : null });
            if (type) preview(engine.time >= clip.start && engine.time < core.clipEnd(clip) ? engine.time : clip.start, Math.min(2, clip.duration));
          }}
        />
        {clip.animLoop && <Slider label="Vitesse" value={clip.animLoop.speed} min={0.2} max={4} step={0.1} onChange={(v) => store.patchClip(clip.id, { animLoop: { ...clip.animLoop!, speed: v } }, `al:${clip.id}`)} format={(v) => `${v.toFixed(1)}x`} />}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ couleur / effets / chroma

function AdjustSection({ clip }: { clip: Clip }) {
  const store = useEditorStore();
  const a = { ...core.DEFAULT_ADJUST, ...clip.adjust };
  const set = (k: keyof typeof a, v: number) => store.patchClip(clip.id, (c) => (c.adjust = { ...core.DEFAULT_ADJUST, ...c.adjust, [k]: v }), `adj:${clip.id}:${k}`);
  return (
    <>
      <Section title="Filtre">
        <Select value={clip.filter?.id || 'none'} onChange={(id) => store.patchClip(clip.id, { filter: { id, intensity: clip.filter?.intensity ?? 1 } })} options={core.FILTER_PRESETS.map((f) => ({ value: f.id, label: f.name }))} />
        {clip.filter && clip.filter.id !== 'none' && (
          <Slider label="Intensité" value={clip.filter.intensity} min={0} max={1} onChange={(v) => store.patchClip(clip.id, { filter: { ...clip.filter!, intensity: v } }, `fint:${clip.id}`)} format={pct} />
        )}
      </Section>
      <Section
        title="Ajustements"
        right={
          <button onClick={() => store.patchClip(clip.id, { adjust: { ...core.DEFAULT_ADJUST } })} className="text-zinc-500 hover:text-white p-1" title="Réinitialiser">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        }
      >
        <Slider label="Luminosité" value={a.brightness} min={-1} max={1} onChange={(v) => set('brightness', v)} format={pct} />
        <Slider label="Contraste" value={a.contrast} min={-1} max={1} onChange={(v) => set('contrast', v)} format={pct} />
        <Slider label="Saturation" value={a.saturation} min={-1} max={1} onChange={(v) => set('saturation', v)} format={pct} />
        <Slider label="Température" value={a.temperature} min={-1} max={1} onChange={(v) => set('temperature', v)} format={pct} />
        <Slider label="Teinte (vert ↔ magenta)" value={a.tint} min={-1} max={1} onChange={(v) => set('tint', v)} format={pct} />
        <Slider label="Rotation des couleurs" value={a.hue} min={-180} max={180} step={1} onChange={(v) => set('hue', v)} format={(v) => `${Math.round(v)}°`} />
        <Slider label="Flou" value={a.blur} min={0} max={1} onChange={(v) => set('blur', v)} format={pct} />
        <Slider label="Vignettage" value={a.vignette} min={0} max={1} onChange={(v) => set('vignette', v)} format={pct} />
        <Slider label="Netteté" value={a.sharpen} min={0} max={1} onChange={(v) => set('sharpen', v)} format={pct} />
      </Section>
    </>
  );
}

function EffectsSection({ clip }: { clip: Clip }) {
  const store = useEditorStore();
  const list = clip.effects || [];
  return (
    <Section title="Effets appliqués">
      {list.length === 0 && <p className="text-[11px] text-zinc-500">Aucun effet. Ajoutez-en depuis l'onglet « Effets » à gauche.</p>}
      {list.map((fx, i) => {
        const def = core.EFFECTS.find((e) => e.id === fx.id);
        return (
          <div key={`${fx.id}-${i}`} className="flex items-end gap-2">
            <div className="flex-1">
              <Slider
                label={def?.name || fx.id}
                value={fx.intensity ?? 0.6}
                min={0}
                max={1}
                onChange={(v) => store.patchClip(clip.id, (c) => (c.effects = (c.effects || []).map((e, k) => (k === i ? { ...e, intensity: v } : e))), `fx:${clip.id}:${i}`)}
                format={pct}
              />
            </div>
            <button onClick={() => store.patchClip(clip.id, (c) => (c.effects = (c.effects || []).filter((_, k) => k !== i)))} className="p-1 text-zinc-500 hover:text-red-400" title="Retirer">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </Section>
  );
}

function ChromaSection({ clip }: { clip: Clip }) {
  const store = useEditorStore();
  const ck = clip.chromaKey || { enabled: false, color: '#00FF00', similarity: 0.3, blend: 0.1 };
  const set = (patch: Partial<typeof ck>) => store.patchClip(clip.id, { chromaKey: { ...ck, ...patch } }, `ck:${clip.id}`);
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  return (
    <Section title="Incrustation (fond vert)" defaultOpen={false}>
      <Toggle label="Supprimer une couleur" checked={ck.enabled} onChange={(enabled) => set({ enabled })} />
      {ck.enabled && (
        <>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <ColorInput label="Couleur à retirer" value={ck.color} onChange={(color) => set({ color })} />
            </div>
            {hasEyeDropper && (
              <button
                onClick={async () => {
                  try {
                    const res = await new (window as any).EyeDropper().open();
                    set({ color: String(res.sRGBHex).toUpperCase() });
                  } catch {}
                }}
                className="p-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
                title="Pipette"
              >
                <Pipette className="w-4 h-4" />
              </button>
            )}
          </div>
          <Slider label="Tolérance" value={ck.similarity} min={0.01} max={0.8} onChange={(similarity) => set({ similarity })} format={pct} />
          <Slider label="Adoucissement" value={ck.blend} min={0} max={0.5} onChange={(blend) => set({ blend })} format={pct} />
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ texte

function TextSection({ clip }: { clip: Clip }) {
  const store = useEditorStore();
  const [fonts, setFonts] = useState<FontInfo[]>([]);
  useEffect(() => {
    ensureAllFonts().then(setFonts).catch(() => {});
  }, []);
  const s: TextStyle = { ...core.DEFAULT_TEXT_STYLE, ...clip.textStyle };
  const set = <K extends keyof TextStyle>(k: K, v: TextStyle[K]) => store.patchClip(clip.id, (c) => (c.textStyle = { ...core.DEFAULT_TEXT_STYLE, ...c.textStyle, [k]: v }), `txt:${clip.id}:${k}`);
  return (
    <>
      <Section title="Texte">
        <textarea
          value={clip.text || ''}
          onChange={(e) => store.patchClip(clip.id, { text: e.target.value }, `text:${clip.id}`)}
          rows={3}
          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500 resize-y"
          placeholder="Votre texte (Entrée pour une nouvelle ligne)"
        />
        <div className="grid grid-cols-3 gap-1.5">
          {core.TEXT_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => store.patchClip(clip.id, (c) => (c.textStyle = { ...core.DEFAULT_TEXT_STYLE, ...p.style }))}
              className="py-1.5 rounded-md border border-white/10 text-[11px] text-zinc-300 hover:border-cyan-400 truncate px-1"
              style={{ fontFamily: `"${fontFamilyFor(p.style.fontId || core.DEFAULT_TEXT_STYLE.fontId)}", sans-serif` }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Police">
        <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
          {fonts.map((f) => (
            <button
              key={f.id}
              onClick={() => set('fontId', f.id)}
              className={`px-2 py-1.5 rounded-lg text-sm truncate border ${s.fontId === f.id ? 'border-cyan-500 bg-cyan-500/10 text-white' : 'border-white/10 text-zinc-300 hover:border-white/30'}`}
              style={{ fontFamily: `"${fontFamilyFor(f.id)}", sans-serif` }}
            >
              {f.fullName}
            </button>
          ))}
        </div>
        <Slider label="Taille" value={s.fontSize} min={0.02} max={0.3} step={0.001} onChange={(v) => set('fontSize', v)} format={pct} />
        <Segmented
          value={s.align}
          onChange={(v) => set('align', v)}
          options={[
            { value: 'left', label: <AlignLeft className="w-4 h-4" /> },
            { value: 'center', label: <AlignCenter className="w-4 h-4" /> },
            { value: 'right', label: <AlignRight className="w-4 h-4" /> },
          ]}
        />
        <Slider label="Espacement des lettres" value={s.letterSpacing} min={-0.1} max={0.5} onChange={(v) => set('letterSpacing', v)} format={pct} />
        <Slider label="Interligne" value={s.lineHeight} min={0.8} max={2} onChange={(v) => set('lineHeight', v)} format={(v) => v.toFixed(2)} />
        <div className="grid grid-cols-3 gap-2">
          <Toggle label="MAJ" checked={s.uppercase} onChange={(v) => set('uppercase', v)} />
          <Toggle label="Italique" checked={s.italic} onChange={(v) => set('italic', v)} />
          <Toggle label="Souligné" checked={s.underline} onChange={(v) => set('underline', v)} />
        </div>
      </Section>
      <Section title="Couleurs">
        <ColorInput label="Texte" value={s.color} onChange={(v) => set('color', v)} />
        <ColorInput label="Contour" value={s.strokeColor} onChange={(v) => set('strokeColor', v)} />
        <Slider label="Épaisseur du contour" value={s.strokeWidth} min={0} max={0.3} step={0.005} onChange={(v) => set('strokeWidth', v)} format={pct} />
      </Section>
      <Section title="Ombre & lueur" defaultOpen={false}>
        <ColorInput label="Couleur" value={s.shadowColor} onChange={(v) => set('shadowColor', v)} />
        <Slider label="Opacité" value={s.shadowOpacity} min={0} max={1} onChange={(v) => set('shadowOpacity', v)} format={pct} />
        <Slider label="Flou" value={s.shadowBlur} min={0} max={1} onChange={(v) => set('shadowBlur', v)} format={pct} />
        <Slider label="Décalage" value={s.shadowOffset} min={0} max={0.3} onChange={(v) => set('shadowOffset', v)} format={pct} />
      </Section>
      <Section title="Fond" defaultOpen={false}>
        <ColorInput label="Couleur" value={s.bgColor} onChange={(v) => set('bgColor', v)} />
        <Slider label="Opacité" value={s.bgOpacity} min={0} max={1} onChange={(v) => set('bgOpacity', v)} format={pct} />
        <Slider label="Marge" value={s.bgPadding} min={0} max={1} onChange={(v) => set('bgPadding', v)} format={pct} />
        <Slider label="Arrondi" value={s.bgRadius} min={0} max={1} onChange={(v) => set('bgRadius', v)} format={pct} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ inspecteurs

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-x-1 border-b border-white/5 px-3 pt-2 flex-shrink-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-2.5 py-2 text-xs font-bold whitespace-nowrap border-b-2 -mb-px ${value === t.id ? 'border-cyan-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ClipInspector({ clip }: { clip: Clip }) {
  const engine = useEngine();
  const store = useEditorStore();
  const { time } = usePlayback(12);
  const local = time - clip.start;

  const tabs = useMemo(() => {
    switch (clip.type) {
      case 'video':
        return [
          { id: 'basic', label: 'Vidéo' },
          { id: 'audio', label: 'Audio' },
          { id: 'speed', label: 'Vitesse' },
          { id: 'anim', label: 'Animation' },
          { id: 'adjust', label: 'Ajuster' },
          { id: 'fx', label: 'Effets' },
        ];
      case 'image':
        return [
          { id: 'basic', label: 'Image' },
          { id: 'anim', label: 'Animation' },
          { id: 'adjust', label: 'Ajuster' },
          { id: 'fx', label: 'Effets' },
        ];
      case 'text':
        return [
          { id: 'text', label: 'Texte' },
          { id: 'basic', label: 'Position' },
          { id: 'anim', label: 'Animation' },
          { id: 'fx', label: 'Effets' },
        ];
      case 'sticker':
        return [
          { id: 'basic', label: 'Sticker' },
          { id: 'anim', label: 'Animation' },
        ];
      case 'audio':
        return [
          { id: 'audio', label: 'Audio' },
          { id: 'speed', label: 'Vitesse' },
        ];
      case 'caption':
        return [
          { id: 'style', label: 'Style' },
          { id: 'words', label: 'Texte' },
        ];
      default:
        return [];
    }
  }, [clip.type]);
  const [tab, setTab] = useState(tabs[0]?.id || 'basic');
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0]?.id || 'basic');
  }, [tabs, tab]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-3 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded">{clip.type}</span>
        <span className="text-sm font-bold text-white truncate">{clip.type === 'text' ? clip.text : clip.name}</span>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4">
        {tab === 'basic' && (
          <>
            {clip.type === 'sticker' && (
              <Section title="Emoji">
                <input
                  value={clip.emoji || ''}
                  onChange={(e) => store.patchClip(clip.id, { emoji: e.target.value, name: e.target.value })}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-2xl text-center outline-none focus:border-cyan-500"
                />
              </Section>
            )}
            <TransformSection clip={clip} local={local} />
            {(clip.type === 'video' || clip.type === 'image') && <CropSection clip={clip} />}
            {(clip.type === 'video' || clip.type === 'image') && <ChromaSection clip={clip} />}
          </>
        )}
        {tab === 'text' && <TextSection clip={clip} />}
        {tab === 'audio' && <AudioSection clip={clip} />}
        {tab === 'speed' && <SpeedSection clip={clip} />}
        {tab === 'anim' && <AnimationSection clip={clip} />}
        {tab === 'adjust' && <AdjustSection clip={clip} />}
        {tab === 'fx' && <EffectsSection clip={clip} />}
        {tab === 'style' && (
          <CaptionStylePanel
            style={captionEngine.resolveStyle(clip.captionStyle || {})}
            onChange={(style: CaptionStyle) => store.patchClip(clip.id, { captionStyle: style as any }, `cap:${clip.id}`)}
          />
        )}
        {tab === 'words' && (
          <div className="h-[calc(100vh-260px)] py-3">
            <TranscriptEditor
              words={clip.words || []}
              onChange={(words) => store.patchClip(clip.id, { words }, `words:${clip.id}`)}
              currentTime={local}
              onSeek={(t) => engine.seek(clip.start + t)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TransitionInspector({ id }: { id: string }) {
  const store = useEditorStore();
  const project = useEditor((s) => s.project);
  const tr = project.transitions.find((t) => t.id === id);
  if (!tr) return null;
  const a = project.clips.find((c) => c.id === tr.fromId);
  const b = project.clips.find((c) => c.id === tr.toId);
  const max = a && b ? core.maxTransitionDuration(a, b) : 2;
  return (
    <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto">
      <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">Transition</span>
      <Field label="Type">
        <Select value={tr.type} onChange={(type) => store.patchTransition(id, { type })} options={core.TRANSITIONS.map((t) => ({ value: t.id, label: `${t.category} · ${t.name}` }))} />
      </Field>
      <Slider label="Durée" value={tr.duration} min={0.1} max={Math.max(0.1, max)} step={0.05} onChange={(duration) => store.patchTransition(id, { duration })} format={sec} />
      <p className="text-[11px] text-zinc-500">Les deux clips se chevauchent pendant la transition ; l'audio fait un fondu enchaîné automatique.</p>
      <button onClick={() => store.deleteSelection()} className="py-2 rounded-lg border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/10 flex items-center justify-center gap-2">
        <Trash2 className="w-3.5 h-3.5" /> Supprimer la transition
      </button>
    </div>
  );
}

function ProjectInspector() {
  const store = useEditorStore();
  const engine = useEngine();
  const project = useEditor((s) => s.project);
  const st = project.settings;
  const audioClips = project.clips.filter((c) => c.type === 'audio').sort((a, b) => a.start - b.start);
  return (
    <div className="px-4 py-3 overflow-y-auto h-full">
      {audioClips.length > 0 && (
        <Section title={`Sons, Musiques & SFX (${audioClips.length})`}>
          <div className="flex flex-col gap-2">
            {audioClips.map((c) => {
              const tr = project.tracks.find((t) => t.id === c.trackId);
              const sfxLane = tr ? isSfxTrack(tr) : false;
              return (
                <div key={c.id} className="bg-black/40 border border-white/10 rounded-xl p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${sfxLane ? 'bg-emerald-500/20 text-emerald-300' : 'bg-cyan-500/20 text-cyan-300'}`}>
                      {tr?.name || 'Audio'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        engine.seek(c.start);
                        store.select([c.id]);
                      }}
                      className="text-xs font-semibold text-white hover:text-cyan-300 truncate flex-1 text-left"
                      title="Cliquer pour sélectionner ou remplacer ce son"
                    >
                      {c.name}
                    </button>
                    <span className="text-[10px] font-mono text-zinc-500">{formatTime(c.start)}</span>
                    <button
                      type="button"
                      onClick={() => store.patchClip(c.id, { muted: !c.muted })}
                      className="text-zinc-400 hover:text-white p-0.5"
                      title={c.muted ? 'Activer le son' : 'Couper le son'}
                    >
                      {c.muted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        engine.seek(c.start);
                        store.select([c.id]);
                      }}
                      className="text-[10px] font-bold text-cyan-300 hover:text-white bg-cyan-500/15 hover:bg-cyan-500/30 rounded px-1.5 py-0.5"
                      title="Changer / régler ce son"
                    >
                      Changer
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.01}
                      value={c.muted ? 0 : (c.volume ?? 1)}
                      onChange={(e) => store.patchClip(c.id, { volume: Number(e.target.value), muted: Number(e.target.value) === 0 }, `vol:${c.id}`)}
                      className="flex-1 accent-cyan-500 h-1.5"
                    />
                    <span className="text-[10px] font-mono text-zinc-300 w-10 text-right">{pct(c.muted ? 0 : (c.volume ?? 1))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
      <Section title="Format">
        <div className="grid grid-cols-2 gap-1.5">
          {core.ASPECT_RATIOS.map((r) => (
            <button
              key={r.id}
              onClick={() => store.patchSettings({ aspect: r.id, width: r.width, height: r.height })}
              className={`py-2 px-2 rounded-lg text-xs font-semibold border text-left ${st.aspect === r.id ? 'border-cyan-500 bg-cyan-500/10 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}
            >
              {r.name}
            </button>
          ))}
        </div>
        <Field label="Images par seconde">
          <Select value={String(st.fps)} onChange={(v) => store.patchSettings({ fps: Number(v) })} options={[24, 25, 30, 50, 60].map((f) => ({ value: String(f), label: `${f} i/s` }))} />
        </Field>
      </Section>
      <Section title="Fond du cadre">
        <Segmented
          value={st.background.type}
          onChange={(type) => store.patchSettings({ background: { ...st.background, type } })}
          options={[
            { value: 'color', label: 'Couleur' },
            { value: 'blur', label: 'Flou de la vidéo' },
          ]}
        />
        <ColorInput label="Couleur" value={st.background.color} onChange={(color) => store.patchSettings({ background: { ...st.background, color } }, 'bgcolor')} />
      </Section>
      <Section title="Audio">
        <Toggle label="Normaliser le volume (-14 LUFS)" checked={st.normalizeAudio} onChange={(normalizeAudio) => store.patchSettings({ normalizeAudio })} />
      </Section>
      <p className="text-[11px] text-zinc-600 mt-3">Sélectionnez un élément de la timeline pour le modifier. Raccourcis : Espace (lecture), S (couper), Suppr, Ctrl+Z/Y, Ctrl+D (dupliquer), Ctrl+C/V, ←/→ (image par image).</p>
    </div>
  );
}

export default function Inspector() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  if (selection.transitionId) return <TransitionInspector id={selection.transitionId} />;
  if (selection.junction) {
    return (
      <div className="px-4 py-6 text-xs text-zinc-400">
        Jonction sélectionnée : choisissez une transition dans l'onglet <b className="text-white">Transitions</b> à gauche.
      </div>
    );
  }
  if (selection.clipIds.length === 1) {
    const clip = project.clips.find((c) => c.id === selection.clipIds[0]);
    if (clip) return <ClipInspector key={clip.id} clip={clip} />;
  }
  if (selection.clipIds.length > 1) {
    return <div className="px-4 py-6 text-xs text-zinc-400">{selection.clipIds.length} éléments sélectionnés. Utilisez Suppr pour les supprimer, Ctrl+D pour les dupliquer ou appliquez un filtre / effet depuis la gauche.</div>;
  }
  return <ProjectInspector />;
}
