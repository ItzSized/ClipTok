'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Type, Check, Wand2, Loader2 } from 'lucide-react';
import * as core from '@shared/editorCore';
import * as captionEngine from '@shared/captionEngine';
import { useEditor, useEditorStore } from '../store';
import { DND_MIME } from '../engineContext';
import { ensureAllFonts, fontFamilyFor } from '@/lib/fonts';
import { useToast } from '@/components/ToastProvider';
import { Select, ProgressBar, Field } from '@/components/ui/controls';
import { cancelJob, mediaThumbnailUrl, absoluteFileUrl } from '@/lib/api';
import { speechClips, generateTimelineCaptions } from '../timelineSpeech';
import { PresetCard } from '@/components/captions/CaptionStylePanel';

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-zinc-500 leading-relaxed">{children}</p>;
}

/** Clips visuels sélectionnés (médias, textes, stickers). */
function useSelectedVisual() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  return useMemo(() => project.clips.filter((c) => selection.clipIds.includes(c.id) && core.isVisual(c)), [project, selection]);
}

// ------------------------------------------------------------------ texte

export function TextPanel() {
  const store = useEditorStore();
  const [, setReady] = useState(false);
  useEffect(() => {
    ensureAllFonts().then(() => setReady(true)).catch(() => {});
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <button
        draggable
        onDragStart={(e) => e.dataTransfer.setData(DND_MIME, JSON.stringify({ type: 'text' }))}
        onClick={() => store.addText()}
        className="w-full py-3 rounded-xl bg-white text-black font-bold text-sm flex items-center justify-center gap-2 hover:bg-cyan-100"
      >
        <Type className="w-4 h-4" /> Ajouter un texte
      </button>
      <Hint>Styles prêts à l'emploi — cliquez ou glissez dans la timeline. Double-cliquez sur le texte dans l'aperçu… ou modifiez-le dans le panneau de droite.</Hint>
      <div className="grid grid-cols-2 gap-2">
        {core.TEXT_PRESETS.map((p) => {
          const s = { ...core.DEFAULT_TEXT_STYLE, ...p.style };
          return (
            <button
              key={p.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(DND_MIME, JSON.stringify({ type: 'text', presetId: p.id }))}
              onClick={() => store.addText(p.id)}
              className="h-16 rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-900 border border-white/10 hover:border-cyan-400 flex items-center justify-center overflow-hidden px-1"
              title={p.name}
            >
              <span
                className="text-lg leading-none truncate"
                style={{
                  fontFamily: `"${fontFamilyFor(s.fontId)}", sans-serif`,
                  color: s.color,
                  WebkitTextStroke: s.strokeWidth > 0 ? `${Math.max(1, s.strokeWidth * 12)}px ${s.strokeColor}` : undefined,
                  paintOrder: 'stroke fill',
                  textShadow: s.shadowOpacity > 0 ? `0 0 ${s.shadowBlur * 20}px ${s.shadowColor}` : undefined,
                  background: s.bgOpacity > 0 ? s.bgColor : undefined,
                  padding: s.bgOpacity > 0 ? '2px 6px' : undefined,
                  borderRadius: 4,
                  letterSpacing: `${s.letterSpacing}em`,
                  textTransform: s.uppercase ? 'uppercase' : undefined,
                }}
              >
                {p.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ stickers

const EMOJIS: Record<string, string[]> = {
  Réactions: ['😂', '🤣', '😍', '🥹', '😭', '😱', '🤯', '😡', '🥶', '😎', '🤔', '🙄', '😏', '🥲', '😳', '🫠', '🤡', '💀', '👻', '🤖'],
  Gestes: ['👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '🫵', '👉', '👈', '👆', '👇', '✌️', '🤞', '🤝', '✍️', '🫶', '🤌', '🖐️', '👋'],
  Symboles: ['🔥', '💯', '✨', '⭐', '⚡', '💥', '❤️', '💔', '💚', '💙', '✅', '❌', '⚠️', '❗', '❓', '🚨', '🎯', '🏆', '🥇', '💎'],
  Objets: ['💰', '💸', '📈', '📉', '🎁', '🎉', '🎊', '📱', '💻', '🎮', '🎧', '🎬', '📸', '🍿', '☕', '🍕', '🚀', '🏎️', '⏰', '🔔'],
  Flèches: ['⬆️', '⬇️', '⬅️', '➡️', '↗️', '↘️', '↙️', '↖️', '🔄', '🔁', '🔀', '↩️', '⤴️', '⤵️', '🔝', '🆕', '🆗', '🆒', '🆓', '🔞'],
};

export function StickersPanel() {
  const store = useEditorStore();
  return (
    <div className="flex flex-col gap-4">
      {Object.entries(EMOJIS).map(([cat, list]) => (
        <div key={cat}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">{cat}</h3>
          <div className="grid grid-cols-5 gap-1">
            {list.map((e) => (
              <button
                key={e}
                draggable
                onDragStart={(ev) => ev.dataTransfer.setData(DND_MIME, JSON.stringify({ type: 'sticker', emoji: e }))}
                onClick={() => store.addSticker(e)}
                className="aspect-square rounded-lg hover:bg-white/10 text-2xl flex items-center justify-center transition-transform hover:scale-110"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ effets

export function EffectsPanel() {
  const store = useEditorStore();
  const selected = useSelectedVisual();
  const categories = useMemo(() => [...new Set(core.EFFECTS.map((e) => e.category))], []);
  const has = (id: string) => selected.length > 0 && selected.every((c) => (c.effects || []).some((e) => e.id === id));
  const toggle = (id: string) => {
    if (selected.length === 0) return;
    const on = has(id);
    store.patchClips(
      selected.map((c) => c.id),
      (c) => {
        c.effects = on ? (c.effects || []).filter((e) => e.id !== id) : [...(c.effects || []), { id, intensity: 0.6 }];
      }
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {selected.length === 0 && <Hint>Sélectionnez une vidéo, une image ou un texte dans la timeline pour lui appliquer des effets.</Hint>}
      {categories.map((cat) => (
        <div key={cat}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">{cat}</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {core.EFFECTS.filter((e) => e.category === cat).map((e) => (
              <button
                key={e.id}
                disabled={selected.length === 0}
                onClick={() => toggle(e.id)}
                className={`px-2 py-2.5 rounded-lg text-xs font-semibold border flex items-center justify-between gap-1 disabled:opacity-40 ${
                  has(e.id) ? 'border-cyan-500 bg-cyan-500/15 text-white' : 'border-white/10 bg-black/30 text-zinc-300 hover:border-white/30'
                }`}
              >
                {e.name}
                {has(e.id) && <Check className="w-3.5 h-3.5 text-cyan-300" />}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ filtres

export function FiltersPanel() {
  const store = useEditorStore();
  const selected = useSelectedVisual();
  const sample = selected.find((c) => c.type === 'video' || c.type === 'image');
  const thumb = sample ? (sample.type === 'video' && sample.mediaId ? mediaThumbnailUrl(sample.mediaId) : sample.src ? absoluteFileUrl(sample.src) : null) : null;
  const current = selected[0]?.filter?.id || 'none';

  /** Approximation CSS de chaque filtre pour la vignette d'aperçu. */
  const cssFor = (id: string) => {
    const f = core.FILTER_PRESETS.find((x) => x.id === id);
    if (!f) return 'none';
    const a = { ...core.DEFAULT_ADJUST, ...f.adjust };
    return `brightness(${1 + a.brightness * 0.6}) contrast(${1 + a.contrast}) saturate(${1 + a.saturation}) hue-rotate(${a.hue + a.tint * 20}deg) sepia(${(f.sepia || 0) + Math.max(0, a.temperature) * 0.4})`;
  };

  return (
    <div className="flex flex-col gap-3">
      {selected.length === 0 && <Hint>Sélectionnez un clip pour appliquer un filtre. Réglez ensuite son intensité dans le panneau de droite (onglet Ajuster).</Hint>}
      <div className="grid grid-cols-3 gap-2">
        {core.FILTER_PRESETS.map((f) => (
          <button
            key={f.id}
            disabled={selected.length === 0}
            onClick={() =>
              store.patchClips(
                selected.map((c) => c.id),
                (c) => {
                  c.filter = { id: f.id, intensity: c.filter?.intensity ?? 1 };
                }
              )
            }
            className={`rounded-lg overflow-hidden border text-left disabled:opacity-40 ${current === f.id && selected.length ? 'border-cyan-500 ring-1 ring-cyan-500' : 'border-white/10 hover:border-white/30'}`}
          >
            <div className="aspect-square bg-gradient-to-br from-orange-300 via-pink-400 to-sky-500" style={{ filter: cssFor(f.id) }}>
              {thumb && <img src={thumb} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="text-[10px] font-semibold text-zinc-300 px-1.5 py-1 truncate">{f.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ transitions

export function TransitionsPanel() {
  const store = useEditorStore();
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const main = core.mainTrack(project);
  const mainClips = main ? core.clipsOnTrack(project, main.id) : [];

  // Jonction ciblée : celle sélectionnée, sinon celle qui suit le clip sélectionné.
  let junction = selection.junction;
  if (!junction && selection.clipIds.length === 1) {
    const idx = mainClips.findIndex((c) => c.id === selection.clipIds[0]);
    if (idx >= 0 && idx < mainClips.length - 1) junction = { fromId: mainClips[idx].id, toId: mainClips[idx + 1].id };
  }
  const current = junction ? core.transitionBetween(project, junction.fromId, junction.toId) : null;
  const categories = [...new Set(core.TRANSITIONS.map((t) => t.category))];

  return (
    <div className="flex flex-col gap-3">
      {mainClips.length < 2 ? (
        <Hint>Ajoutez au moins deux clips sur la piste principale pour utiliser des transitions.</Hint>
      ) : !junction ? (
        <Hint>Cliquez sur le losange ◇ entre deux clips de la piste principale (ou sélectionnez un clip) pour choisir sa transition.</Hint>
      ) : (
        <Hint>Transition {current ? 'sélectionnée' : 'à ajouter'} entre deux clips. Durée réglable dans le panneau de droite.</Hint>
      )}
      <button
        disabled={mainClips.length < 2}
        onClick={() => store.setTransitionEverywhere(current?.type || 'fade')}
        className="py-2 rounded-lg border border-white/10 text-xs font-bold text-zinc-300 hover:text-white hover:bg-white/5 disabled:opacity-40"
      >
        Appliquer « {core.TRANSITIONS.find((t) => t.id === (current?.type || 'fade'))?.name} » à toutes les jonctions
      </button>
      {categories.map((cat) => (
        <div key={cat}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">{cat}</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {core.TRANSITIONS.filter((t) => t.category === cat).map((t) => (
              <button
                key={t.id}
                disabled={!junction}
                onClick={() => junction && store.setTransition(junction.fromId, junction.toId, t.id)}
                className={`px-2 py-2.5 rounded-lg text-xs font-semibold border disabled:opacity-40 text-left ${
                  current?.type === t.id ? 'border-cyan-500 bg-cyan-500/15 text-white' : 'border-white/10 bg-black/30 text-zinc-300 hover:border-white/30'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ sous-titres automatiques

const LANGS = [
  { value: 'auto', label: 'Détection automatique' },
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'Anglais' },
  { value: 'es', label: 'Espagnol' },
  { value: 'de', label: 'Allemand' },
  { value: 'it', label: 'Italien' },
  { value: 'pt', label: 'Portugais' },
  { value: 'ar', label: 'Arabe' },
];

export function CaptionsPanel() {
  const store = useEditorStore();
  const project = useEditor((s) => s.project);
  const { showToast } = useToast();
  const [, setFontsReady] = useState(false);
  // Les aperçus de styles utilisent les vraies polices.
  useEffect(() => {
    ensureAllFonts().then(() => setFontsReady(true)).catch(() => {});
  }, []);
  const [language, setLanguage] = useState('auto');
  const [translate, setTranslate] = useState(true);
  const [model, setModel] = useState('small');
  const [preset, setPreset] = useState('hormozi');
  const [status, setStatus] = useState('');
  const [percent, setPercent] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<string | null>(null);
  const sources = speechClips(project.clips);
  const existing = project.clips.find((c) => c.type === 'caption');

  const generate = async () => {
    setWorking(true);
    setError(null);
    try {
      const { wordCount, failed } = await generateTimelineCaptions(store, {
        language,
        model,
        translate,
        preset: existing ? undefined : preset,
        onProgress: (message, pct) => {
          setStatus(message);
          setPercent(pct);
        },
        onJob: (id) => (jobRef.current = id),
      });
      showToast({ type: 'success', message: `${wordCount} mots ajoutés en sous-titres.` });
      if (failed.length) showToast({ type: 'error', message: `Transcription impossible pour : ${failed.join(', ')}` });
    } catch (err: any) {
      setError(err.message || 'Erreur');
    } finally {
      setWorking(false);
      setStatus('');
      jobRef.current = null;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Hint>Transcrit automatiquement la voix des vidéos et sons de la timeline, puis crée une piste de sous-titres animés synchronisés mot à mot.</Hint>
      <Field label="Langue">
        <Select value={language} onChange={setLanguage} options={LANGS} />
      </Field>
      <Field label="Sous-titres en">
        <Select
          value={translate ? 'en' : 'source'}
          onChange={(v) => setTranslate(v === 'en')}
          options={[
            { value: 'en', label: 'Anglais (traduction automatique)' },
            { value: 'source', label: 'Langue de la vidéo' },
          ]}
        />
      </Field>
      <Field label="Précision">
        <Select
          value={model}
          onChange={setModel}
          options={[
            { value: 'base', label: 'Rapide' },
            { value: 'small', label: 'Équilibrée (recommandé)' },
            { value: 'medium', label: 'Précise' },
            { value: 'large-v3', label: 'Maximum (lent)' },
          ]}
        />
      </Field>
      {!existing && (
        <Field label="Style">
          <div className="grid grid-cols-2 gap-1.5">
            {captionEngine.PRESETS.map((p) => (
              <PresetCard key={p.id} preset={p} active={preset === p.id} onClick={() => setPreset(p.id)} />
            ))}
          </div>
        </Field>
      )}
      {working ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-400 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {status || 'Préparation...'}
          </p>
          <ProgressBar percent={percent} />
          <button onClick={() => jobRef.current && cancelJob(jobRef.current)} className="text-xs font-bold text-red-400 self-end">
            Annuler
          </button>
        </div>
      ) : (
        <button
          disabled={sources.length === 0}
          onClick={generate}
          className="py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-400 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Wand2 className="w-4 h-4" /> {existing ? 'Régénérer les sous-titres' : 'Générer les sous-titres'}
        </button>
      )}
      {error && !working && <p className="text-[11px] text-red-400 whitespace-pre-wrap max-h-32 overflow-auto">{error}</p>}
      {sources.length === 0 && <Hint>Ajoutez une vidéo avec du son (ou une voix off) à la timeline.</Hint>}
      {existing && <Hint>Sélectionnez le clip de sous-titres dans la timeline pour changer son style ou corriger le texte. Régénérer remplace le texte (le style est conservé).</Hint>}
      <button onClick={() => store.addTrack('caption')} className="text-[11px] text-zinc-500 hover:text-white flex items-center gap-1 self-start">
        <Plus className="w-3 h-3" /> Ajouter une piste de sous-titres
      </button>
    </div>
  );
}
