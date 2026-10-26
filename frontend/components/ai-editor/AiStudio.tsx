'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Share, Clapperboard, Bot, Images, SlidersHorizontal, Music, Type, Captions, UploadCloud, Loader2, Palette } from 'lucide-react';
import { EditorProviders, SaveIndicator, useAutosave } from '@/components/editor/Editor';
import PreviewCanvas from '@/components/editor/PreviewCanvas';
import Timeline from '@/components/editor/Timeline';
import Toolbar from '@/components/editor/Toolbar';
import ExportDialog from '@/components/editor/ExportDialog';
import AIPanel from '@/components/editor/panels/AIPanel';
import Inspector from '@/components/editor/Inspector';
import AudioPanel from '@/components/editor/panels/AudioPanel';
import { TextPanel, CaptionsPanel } from '@/components/editor/panels/LibraryPanels';
import { useToast } from '@/components/ToastProvider';
import { describeUpload, dragHasFiles, filesFromDrop, filesFromPaste, uploadMany, type UploadInfo } from '@/lib/mediaFiles';
import UploadDropzone from '@/components/media/UploadDropzone';
import { useEditor, useEditorStore } from '@/components/editor/store';
import ThemesPanel from '@/components/editor/panels/ThemesPanel';
import { listMedia } from '@/lib/api';
import { BulkMediaBar, MediaPreview, MediaTile, SortSelect, sortMedia, useMediaRemover, type SortMode } from './MediaLibrary';
import type { EditorProjectDoc, Media, RenderResult } from '@/lib/types';

/** Médiathèque : écouter / regarder, supprimer, trier ; cocher = « ces clips » pour l'IA. */
function MediaRail({ selected, onToggle, onSelect, incoming }: { selected: string[]; onToggle: (id: string) => void; onSelect: (ids: string[]) => void; incoming: Media[] }) {
  const removeMedia = useMediaRemover();
  const store = useEditorStore();
  const [media, setMedia] = useState<Media[]>([]);
  const [sort, setSort] = useState<SortMode>('recent');
  const [preview, setPreview] = useState<Media | null>(null);

  useEffect(() => {
    listMedia().then(setMedia).catch(() => {});
  }, []);

  // Fichiers déposés / collés n'importe où dans l'Éditeur IA.
  useEffect(() => {
    if (incoming.length) setMedia((list) => [...incoming.filter((m) => !list.some((x) => x.id === m.id)), ...list]);
  }, [incoming]);

  const sorted = useMemo(() => sortMedia(media, sort), [media, sort]);

  const remove = async (m: Media) => {
    if (!(await removeMedia(m))) return;
    setMedia((list) => list.filter((x) => x.id !== m.id));
    if (selected.includes(m.id)) onToggle(m.id);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-white">Vos médias</h2>
          <p className="text-[11px] text-zinc-500">Cochez ceux que l'IA doit utiliser, + pour les ajouter au montage. Glissez ou collez (Ctrl+V) vos captures n'importe où.</p>
        </div>
        <SortSelect value={sort} onChange={setSort} />
      </div>
      <div className="px-3 pb-2">
        <BulkMediaBar
          media={media}
          selected={selected}
          onSelect={onSelect}
          onDeleted={(ids) => {
            setMedia((list) => list.filter((m) => !ids.includes(m.id)));
            onSelect(selected.filter((id) => !ids.includes(id)));
          }}
        />
      </div>
      <div className="px-3 pb-2">
        <UploadDropzone compact onUploaded={(list) => setMedia((m) => [...list, ...m])} title="Importer" subtitle="vidéos, sons, images" />
      </div>
      {/* Défilement sur un conteneur séparé : dans une grille à hauteur fixe, les tuiles (overflow-hidden) seraient écrasées. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        <div className="grid grid-cols-2 gap-2">
          {sorted.map((m) => (
            <MediaTile key={m.id} media={m} selected={selected.includes(m.id)} onToggle={() => onToggle(m.id)} onPreview={() => setPreview(m)} onDelete={() => remove(m)} onAdd={() => store.addMedia(m)} />
          ))}
        </div>
      </div>
      {preview && <MediaPreview media={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

type RightTab = 'media' | 'edit' | 'themes' | 'audio' | 'text' | 'captions';

const RIGHT_TABS: { id: RightTab; label: string; icon: typeof Images }[] = [
  { id: 'media', label: 'Médias', icon: Images },
  { id: 'edit', label: 'Modifier', icon: SlidersHorizontal },
  { id: 'themes', label: 'Thèmes', icon: Palette },
  { id: 'audio', label: 'Sons', icon: Music },
  { id: 'text', label: 'Texte', icon: Type },
  { id: 'captions', label: 'Sous-titres', icon: Captions },
];

function StudioLayout({ doc, initialPrompt, initialMedia }: { doc: EditorProjectDoc; initialPrompt?: string; initialMedia: string[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [name, setName] = useState(doc.name);
  const [selected, setSelected] = useState<string[]>(initialMedia);
  const [showExport, setShowExport] = useState(false);
  const [lastExport, setLastExport] = useState<RenderResult | null>(doc.lastExport);
  const [tab, setTab] = useState<RightTab>('media');
  const [incoming, setIncoming] = useState<Media[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [uploadInfo, setUploadInfo] = useState<UploadInfo | null>(null);
  const dragDepth = useRef(0);
  const saveState = useAutosave(doc.id, name);
  const clipCount = useEditor((s) => s.project.clips.length);
  const selectedClips = useEditor((s) => s.selection.clipIds);

  // Un clip sélectionné sur la timeline ou l'aperçu : on ouvre ses réglages (texte, sous-titres, son…).
  useEffect(() => {
    if (selectedClips.length) setTab('edit');
  }, [selectedClips]);

  /** Import de fichiers déposés / collés : ajoutés à la médiathèque et sélectionnés pour l'IA. */
  const importFiles = async (files: File[]) => {
    if (files.length === 0 || uploading !== null) return;
    setUploading(0);
    setUploadInfo(null);
    setTab('media');
    try {
      const { media, errors } = await uploadMany(
        files,
        (pct, info) => {
          setUploading(pct);
          setUploadInfo(info);
        },
        // Chaque fichier apparaît (et est sélectionné) dès qu'il est prêt.
        (ready) => {
          setIncoming(ready);
          setSelected((s) => [...s, ...ready.map((m) => m.id).filter((id) => !s.includes(id))]);
        }
      );
      errors.slice(0, 5).forEach((e) => showToast({ type: 'error', message: `${e.name} : ${e.error}` }));
      if (media.length) showToast({ type: 'success', message: `${media.length} fichier(s) importé(s) et sélectionné(s) pour l'IA.` });
    } finally {
      setUploading(null);
      setUploadInfo(null);
    }
  };
  const importRef = useRef(importFiles);
  importRef.current = importFiles;

  // Ctrl+V d'une capture d'écran (ou de fichiers) n'importe où dans la page.
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

  return (
    <div
      className="relative z-10 flex flex-col h-[calc(100vh-73px)] w-full bg-zinc-950 text-zinc-100"
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
      // Phase de capture : le cadre disparaît même si une zone enfant traite le dépôt elle-même.
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
      <header className="flex items-center gap-3 px-3 py-2 border-b border-white/5 bg-black/40">
        <button onClick={() => router.push('/ai-editor')} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center" aria-label="Retour">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-fuchsia-300 bg-fuchsia-500/10 px-2 py-1 rounded-md">
          <Bot className="w-3.5 h-3.5" /> Éditeur IA
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent font-bold text-sm outline-none border-b border-transparent focus:border-fuchsia-500 w-64" />
        <SaveIndicator state={saveState} />
        {uploading !== null && (
          <span className="flex items-center gap-1.5 text-xs text-fuchsia-200">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Import {Math.round(uploading)} % <span className="text-zinc-400">{describeUpload(uploadInfo)}</span>
          </span>
        )}
        <button onClick={() => router.push(`/editor/${doc.id}`)} className="ml-auto flex items-center gap-2 text-sm font-bold bg-white/10 hover:bg-white/20 text-white px-4 py-1.5 rounded-full" title="Retouches précises à la main">
          <Clapperboard className="w-4 h-4" /> Ouvrir dans l'éditeur
        </button>
        <button onClick={() => setShowExport(true)} disabled={clipCount === 0} className="flex items-center gap-2 text-sm font-bold bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white px-4 py-1.5 rounded-full hover:brightness-110 disabled:opacity-40">
          <Share className="w-4 h-4" /> Exporter
        </button>
      </header>

      <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: '400px minmax(0,1fr) 340px' }}>
        <aside className="min-h-0 border-r border-white/5 flex flex-col">
          <AIPanel projectId={doc.id} initialPrompt={initialPrompt} selectedMediaIds={selected} onFilesAdded={(m) => setIncoming(m)} />
        </aside>
        <main className="min-h-0">
          <PreviewCanvas />
        </main>
        <aside className="min-h-0 border-l border-white/5 flex flex-col">
          <nav className="flex flex-shrink-0 border-b border-white/5">
            {RIGHT_TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 py-2 flex flex-col items-center gap-1 text-[10px] font-semibold border-b-2 transition-colors ${
                    active ? 'border-fuchsia-400 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-fuchsia-300' : ''}`} />
                  {t.label}
                </button>
              );
            })}
          </nav>
          {/* La médiathèque reste montée (sélection, fichiers importés) même quand un autre onglet est ouvert. */}
          <div className={tab === 'media' ? 'flex-1 min-h-0' : 'hidden'}>
            <MediaRail selected={selected} incoming={incoming} onSelect={setSelected} onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
          </div>
          {tab === 'edit' && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <Inspector />
            </div>
          )}
          {tab !== 'media' && tab !== 'edit' && (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {tab === 'themes' && <ThemesPanel />}
              {tab === 'audio' && <AudioPanel />}
              {tab === 'text' && <TextPanel />}
              {tab === 'captions' && <CaptionsPanel />}
            </div>
          )}
        </aside>
      </div>

      {/* Timeline avec ses outils : supprimer, couper, dupliquer, annuler… les clips placés par l'IA. */}
      <div className="h-[250px] border-t border-white/5 flex flex-col">
        <Toolbar timelineWidth={1200} />
        <div className="flex-1 min-h-0">
          <Timeline />
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-[110] bg-fuchsia-500/10 border-4 border-dashed border-fuchsia-400 rounded-xl flex flex-col items-center justify-center gap-2">
          <UploadCloud className="w-12 h-12 text-fuchsia-300" />
          <p className="text-lg font-black text-white">Déposez vos clips, captures ou dossiers</p>
          <p className="text-sm text-zinc-300">Ils seront importés et sélectionnés pour l'IA</p>
        </div>
      )}

      {showExport && <ExportDialog defaultName={name} projectId={doc.id} initial={lastExport} onClose={() => setShowExport(false)} onDone={setLastExport} />}
    </div>
  );
}

export default function AiStudio({ doc, initialPrompt, initialMedia = [] }: { doc: EditorProjectDoc; initialPrompt?: string; initialMedia?: string[] }) {
  return (
    // Pas de raccourcis à une seule lettre ici : on parle à l'IA en tapant du texte
    // (un « s » tapé hors du champ ne doit pas couper la vidéo). Ctrl+Z, Ctrl+A, Suppr… restent actifs.
    <EditorProviders doc={doc} shortcuts={false}>
      <StudioLayout doc={doc} initialPrompt={initialPrompt} initialMedia={initialMedia} />
    </EditorProviders>
  );
}
