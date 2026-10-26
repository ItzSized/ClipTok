'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wand2, Loader2, UploadCloud } from 'lucide-react';
import * as core from '@shared/editorCore';
import { listMedia, createEditorProject } from '@/lib/api';
import type { Media } from '@/lib/types';
import UploadDropzone from '@/components/media/UploadDropzone';
import { useToast } from '@/components/ToastProvider';
import { describeUpload, dragHasFiles, filesFromDrop, filesFromPaste, uploadMany, type UploadInfo } from '@/lib/mediaFiles';
import { getJSON, setJSON } from '@/lib/storage';
import { AiModelPicker, useAiPrefs } from './AiModelPicker';
import { BulkMediaBar, MediaPreview, MediaTile, SortSelect, sortMedia, useMediaRemover, type SortMode } from './MediaLibrary';

const CREATE_PREFS_KEY = 'cliptok:ai-create-prefs';

const EXAMPLES = [
  'Fais une vidéo TikTok dynamique avec ces clips : transitions rapides, un titre accrocheur, des sous-titres Hormozi et un whoosh à chaque transition',
  'Monte un résumé de 30 secondes avec les meilleurs moments, ajoute la musique en fond à 20 % et un filtre cinéma',
  'Coupe les silences, ajoute des sous-titres karaoké et un zoom lent sur toute la vidéo',
];

/** « Créer avec l'IA » : décrire la vidéo, choisir les clips, l'IA fait le montage. */
export default function AiCreateCard() {
  const router = useRouter();
  const { showToast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('9:16');
  const [theme, setTheme] = useState('');
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const ai = useAiPrefs();
  const [media, setMedia] = useState<Media[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<SortMode>('recent');
  const [showAll, setShowAll] = useState(false);
  const [preview, setPreview] = useState<Media | null>(null);
  const removeMedia = useMediaRemover();

  useEffect(() => {
    listMedia().then(setMedia).catch(() => {});
    // Dernières options utilisées (format, thème) ; le modèle et le mode sont mémorisés par useAiPrefs.
    const saved = getJSON<{ aspect?: string; theme?: string }>(CREATE_PREFS_KEY, {});
    if (saved.aspect) setAspect(saved.aspect);
    if (saved.theme !== undefined) setTheme(saved.theme);
    setPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (prefsLoaded) setJSON(CREATE_PREFS_KEY, { aspect, theme });
  }, [aspect, theme, prefsLoaded]);

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [uploadInfo, setUploadInfo] = useState<UploadInfo | null>(null);
  const dragDepth = useRef(0);

  /** Fichiers déposés n'importe où sur la carte ou collés : importés et sélectionnés pour l'IA. */
  const importFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(0);
    setUploadInfo(null);
    try {
      const { media: added, errors } = await uploadMany(
        files,
        (pct, info) => {
          setUploading(pct);
          setUploadInfo(info);
        },
        // Chaque fichier apparaît (et est sélectionné) dès qu'il est prêt.
        (ready) => {
          setMedia((m) => [...ready, ...m.filter((x) => !ready.some((a) => a.id === x.id))]);
          setSelected((s) => [...s, ...ready.map((x) => x.id).filter((id) => !s.includes(id))]);
        }
      );
      errors.slice(0, 5).forEach((err) => showToast({ type: 'error', message: `${err.name} : ${err.error}` }));
      if (added.length) showToast({ type: 'success', message: `${added.length} fichier(s) importé(s) et sélectionné(s).` });
    } finally {
      setUploading(null);
      setUploadInfo(null);
    }
  };
  const importRef = useRef(importFiles);
  importRef.current = importFiles;

  // Ctrl+V d'une capture d'écran.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = filesFromPaste(e);
      if (files.length === 0) return;
      e.preventDefault();
      importRef.current(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const sorted = useMemo(() => sortMedia(media, sort), [media, sort]);
  const visible = showAll ? sorted : sorted.slice(0, 23);

  const remove = async (m: Media) => {
    if (!(await removeMedia(m))) return;
    setMedia((list) => list.filter((x) => x.id !== m.id));
    setSelected((s) => s.filter((x) => x !== m.id));
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const create = async () => {
    if (!prompt.trim()) return;
    setCreating(true);
    try {
      const doc = await createEditorProject({ name: prompt.trim().slice(0, 60), aspect });
      const chosen = core.THEMES.find((t) => t.id === theme);
      const request = chosen ? `${prompt.trim()}\n\nThème : ${chosen.name} (action "theme" "${chosen.id}").` : prompt.trim();
      const params = new URLSearchParams({ ai: request });
      if (selected.length) params.set('media', selected.join(','));
      router.push(`/ai-editor/${doc.id}?${params.toString()}`);
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
      setCreating(false);
    }
  };

  return (
    <div
      className="relative rounded-3xl p-[1px] bg-gradient-to-br from-fuchsia-500 via-orange-400 to-sky-500 mb-10"
      onDragEnter={(e) => {
        if (!dragHasFiles(e)) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (dragHasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      // Phase de capture : le cadre disparaît même si la petite zone « Importer » traite le dépôt elle-même.
      onDropCapture={() => {
        dragDepth.current = 0;
        setDragging(false);
      }}
      onDrop={async (e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        importFiles(await filesFromDrop(e.dataTransfer));
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 rounded-3xl bg-fuchsia-500/15 border-4 border-dashed border-fuchsia-400 flex flex-col items-center justify-center gap-2 backdrop-blur-[1px]">
          <UploadCloud className="w-12 h-12 text-fuchsia-300" />
          <p className="text-lg font-black text-white">Déposez vos clips, sons, captures ou dossiers</p>
          <p className="text-sm text-zinc-300">Ils seront importés et sélectionnés pour l'IA</p>
        </div>
      )}
      <div className="rounded-3xl bg-zinc-950 p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center">
            <Wand2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-black text-white text-lg">Créer avec l'IA</h2>
            <p className="text-xs text-zinc-400">Décrivez la vidéo, choisissez vos clips : l'IA fait le montage (modèles gratuits). Vous pourrez ensuite affiner à la main dans l'éditeur.</p>
          </div>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Ex. : fais une vidéo de 30 s avec ces clips, ajoute un titre au début, des sous-titres et une musique douce…"
          className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-500 resize-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => setPrompt(e)} className="text-[11px] text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1 text-left">
              {e.length > 70 ? `${e.slice(0, 70)}…` : e}
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-400">Clips à utiliser {selected.length > 0 && <span className="text-fuchsia-300">({selected.length} sélectionné{selected.length > 1 ? 's' : ''})</span>}</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-600 hidden sm:inline">Sans sélection, l'IA choisit dans toute votre médiathèque</span>
              <SortSelect value={sort} onChange={setSort} />
            </div>
          </div>
          {uploading !== null && (
            <div className="mb-2 flex items-center gap-2 text-xs text-fuchsia-200">
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> <b>{Math.round(uploading)} %</b>
              <span className="text-zinc-400 truncate">{describeUpload(uploadInfo)}</span>
              <div className="flex-1 max-w-xs h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${uploading}%` }} />
              </div>
            </div>
          )}
          <div className="mb-2">
            <BulkMediaBar
              media={media}
              selected={selected}
              onSelect={setSelected}
              onDeleted={(ids) => {
                setMedia((list) => list.filter((m) => !ids.includes(m.id)));
                setSelected((s) => s.filter((id) => !ids.includes(id)));
              }}
            />
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
            <UploadDropzone
              compact
              onUploaded={(list) => {
                setMedia((m) => [...list, ...m]);
                setSelected((s) => [...s, ...list.map((x) => x.id)]);
              }}
              title="Importer"
              subtitle="vidéos, sons…"
            />
            {visible.map((m) => (
              <MediaTile key={m.id} media={m} rounded="rounded-xl" selected={selected.includes(m.id)} onToggle={() => toggle(m.id)} onPreview={() => setPreview(m)} onDelete={() => remove(m)} />
            ))}
          </div>
          {sorted.length > 23 && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-[11px] text-zinc-400 hover:text-white">
              {showAll ? 'Afficher moins' : `Afficher tout (${sorted.length})`}
            </button>
          )}
          <p className="mt-1 text-[11px] text-zinc-600">Survolez un clip : ▶ pour l'écouter / le regarder, 🗑 pour le supprimer. Glissez vos fichiers ou dossiers n'importe où sur ce cadre, ou collez une capture avec Ctrl+V.</p>
        </div>
        {preview && <MediaPreview media={preview} onClose={() => setPreview(null)} />}

        <div>
          <span className="text-xs font-semibold text-zinc-400">Thème</span>
          <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
            <button
              onClick={() => setTheme('')}
              className={`rounded-xl border p-2 text-left ${theme === '' ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'border-white/10 hover:border-white/30'}`}
            >
              <div className="h-6 rounded-md bg-gradient-to-r from-zinc-700 to-zinc-800 mb-1.5" />
              <p className="text-[11px] font-bold text-white">L'IA choisit</p>
            </button>
            {core.THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                title={t.description}
                className={`rounded-xl border p-2 text-left ${theme === t.id ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'border-white/10 hover:border-white/30'}`}
              >
                <div className="flex h-6 rounded-md overflow-hidden mb-1.5">
                  {t.colors.map((c) => (
                    <span key={c} className="flex-1" style={{ background: c }} />
                  ))}
                </div>
                <p className="text-[11px] font-bold text-white truncate">{t.name}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-xs font-semibold text-zinc-400">Modèle d'IA (mémorisé)</span>
          <div className="mt-2">
            <AiModelPicker ai={ai} size="md" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-fuchsia-500">
            {core.ASPECT_RATIOS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            onClick={create}
            disabled={!prompt.trim() || creating}
            className="flex-1 min-w-[220px] py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} Créer la vidéo avec l'IA
          </button>
        </div>
      </div>
    </div>
  );
}
