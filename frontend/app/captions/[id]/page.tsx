'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  Loader2,
  Wand2,
  Download,
  Film,
  Undo2,
  Redo2,
  Check,
  Palette,
  Crop,
  Share,
  RefreshCw,
  FileText,
} from 'lucide-react';
import type { CaptionStyle } from '@shared/captionEngine';
import * as editorCore from '@shared/editorCore';
import CaptionPreview, { type CaptionPreviewHandle } from '@/components/captions/CaptionPreview';
import CaptionStylePanel from '@/components/captions/CaptionStylePanel';
import TranscriptEditor from '@/components/captions/TranscriptEditor';
import { Select, Segmented, Slider, ProgressBar, Field } from '@/components/ui/controls';
import { useToast } from '@/components/ToastProvider';
import { useJob } from '@/hooks/useJob';
import {
  getCaptionProject,
  updateCaptionProject,
  transcribeMedia,
  renderCaptionProject,
  captionExportUrl,
  absoluteFileUrl,
  downloadUrl,
  createEditorProject,
  saveEditorProject,
} from '@/lib/api';
import type { CaptionFraming, CaptionProject, RenderResult, TranscriptWord, Media } from '@/lib/types';

const LANGUAGES = [
  { value: 'auto', label: 'Détection automatique' },
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'Anglais' },
  { value: 'es', label: 'Espagnol' },
  { value: 'de', label: 'Allemand' },
  { value: 'it', label: 'Italien' },
  { value: 'pt', label: 'Portugais' },
  { value: 'nl', label: 'Néerlandais' },
  { value: 'ar', label: 'Arabe' },
  { value: 'tr', label: 'Turc' },
  { value: 'ru', label: 'Russe' },
  { value: 'ja', label: 'Japonais' },
  { value: 'zh', label: 'Chinois' },
];

const MODELS = [
  { value: 'base', label: 'Rapide (base)' },
  { value: 'small', label: 'Équilibré (small) — recommandé' },
  { value: 'medium', label: 'Précis (medium)' },
  { value: 'large-v3', label: 'Maximum (large-v3, lent)' },
];

interface Snapshot {
  words: TranscriptWord[];
  style: CaptionStyle;
  framing: CaptionFraming;
}

type Tab = 'style' | 'format' | 'export';

export default function CaptionStudio({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { showToast } = useToast();
  const previewRef = useRef<CaptionPreviewHandle>(null);

  const [project, setProject] = useState<CaptionProject | null>(null);
  const [name, setName] = useState('');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [time, setTime] = useState(0);
  const [tab, setTab] = useState<Tab>('style');
  const [language, setLanguage] = useState('auto');
  // Anglais par défaut : Whisper traduit directement la voix.
  const [translate, setTranslate] = useState(true);
  const [model, setModel] = useState('small');
  const [vocab, setVocab] = useState('');
  const [lastRender, setLastRender] = useState<RenderResult | null>(null);
  const [openingEditor, setOpeningEditor] = useState(false);

  const transcribeJob = useJob<{ transcript: { words: TranscriptWord[]; language: string } }>();
  const renderJob = useJob<RenderResult>();

  useEffect(() => {
    getCaptionProject(params.id)
      .then((p) => {
        setProject(p);
        setName(p.name);
        setSnap({ words: p.words, style: p.style, framing: p.framing });
        setLastRender(p.lastRender);
        if (p.language) setLanguage(p.language);
      })
      .catch(() => router.push('/captions'));
  }, [params.id, router]);

  // Modification avec historique (annuler / rétablir). Les changements rapprochés
  // (glisser un curseur) sont regroupés en une seule étape.
  const lastCommit = useRef(0);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snap;

  const commit = useCallback((patch: Partial<Snapshot>) => {
    const current = snapRef.current;
    if (!current) return;
    const now = Date.now();
    if (now - lastCommit.current > 600) {
      setPast((p) => [...p.slice(-80), current]);
      setFuture([]);
    }
    lastCommit.current = now;
    const next = { ...current, ...patch };
    snapRef.current = next;
    setSnap(next);
    setSaveState('dirty');
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0 || !snap) return;
    setFuture((f) => [snap, ...f]);
    setSnap(past[past.length - 1]);
    setPast(past.slice(0, -1));
    setSaveState('dirty');
  }, [past, snap]);

  const redo = useCallback(() => {
    if (future.length === 0 || !snap) return;
    setPast((p) => [...p, snap]);
    setSnap(future[0]);
    setFuture(future.slice(1));
    setSaveState('dirty');
  }, [future, snap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.code === 'Space') {
        e.preventDefault();
        previewRef.current?.togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // Sauvegarde automatique.
  const save = useCallback(async () => {
    if (!project || !snap) return;
    setSaveState('saving');
    try {
      await updateCaptionProject(project.id, { name, words: snap.words, style: snap.style, framing: snap.framing });
      setSaveState('saved');
    } catch (err: any) {
      setSaveState('dirty');
      showToast({ type: 'error', message: `Sauvegarde impossible : ${err.message}` });
    }
  }, [project, snap, name, showToast]);

  useEffect(() => {
    if (saveState !== 'dirty') return;
    const t = setTimeout(save, 900);
    return () => clearTimeout(t);
  }, [saveState, save]);

  const startTranscription = async () => {
    if (!project) return;
    const result = await transcribeJob.run(() => transcribeMedia(project.mediaId, { language, model, prompt: vocab, translate }));
    if (result) {
      commit({ words: result.transcript.words });
      setProject((p) => (p ? { ...p, language: result.transcript.language } : p));
      showToast({ type: 'success', message: `${result.transcript.words.length} mots transcrits.` });
    }
  };

  const startRender = async () => {
    if (!project) return;
    await save();
    const result = await renderJob.run(() => renderCaptionProject(project.id));
    if (result) {
      setLastRender(result);
      showToast({ type: 'success', title: 'Vidéo prête', message: 'Les sous-titres ont été incrustés.' });
    }
  };

  const openInEditor = async () => {
    if (!project || !snap || !project.media) return;
    setOpeningEditor(true);
    try {
      await save();
      const doc = await createEditorProject({ name: project.name, mediaIds: [project.mediaId] });
      const p = doc.project;
      const capTrack = p.tracks.find((t) => t.kind === 'caption');
      if (capTrack) {
        p.clips.push(editorCore.createCaptionClip(capTrack.id, 0, project.media.duration, snap.words, snap.style));
        await saveEditorProject(doc.id, { project: p });
      }
      router.push(`/editor/${doc.id}`);
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
      setOpeningEditor(false);
    }
  };

  if (!project || !snap) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-fuchsia-500" />
      </div>
    );
  }

  const media = project.media as Media | null;
  const hasWords = snap.words.length > 0;

  return (
    <div className="relative z-10 flex flex-col h-[calc(100vh-73px)] w-full">
      {/* En-tête */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 bg-black/30">
        <button onClick={() => router.push('/captions')} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white" aria-label="Retour">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaveState('dirty');
          }}
          className="bg-transparent text-white font-bold text-base outline-none border-b border-transparent focus:border-fuchsia-500 min-w-0 w-64"
        />
        <span className="text-[11px] text-zinc-500 flex items-center gap-1">
          {saveState === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> : saveState === 'saved' ? <Check className="w-3 h-3 text-emerald-400" /> : null}
          {saveState === 'saving' ? 'Sauvegarde...' : saveState === 'saved' ? 'Enregistré' : 'Modifications non enregistrées'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={undo} disabled={past.length === 0} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30" title="Annuler (Ctrl+Z)">
            <Undo2 className="w-4 h-4" />
          </button>
          <button onClick={redo} disabled={future.length === 0} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30" title="Rétablir (Ctrl+Y)">
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            onClick={openInEditor}
            disabled={!hasWords || openingEditor}
            className="flex items-center gap-2 text-sm font-bold bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full disabled:opacity-40"
          >
            {openingEditor ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />} Ouvrir dans l'éditeur
          </button>
          <button
            onClick={() => setTab('export')}
            disabled={!hasWords}
            className="flex items-center gap-2 text-sm font-bold bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white px-4 py-2 rounded-full disabled:opacity-40"
          >
            <Share className="w-4 h-4" /> Exporter
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_360px]">
        {/* Transcription */}
        <aside className="hidden lg:flex flex-col min-h-0 border-r border-white/5 p-4 bg-black/20">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" /> Transcription
          </h2>
          <div className="flex-1 min-h-0">
            <TranscriptEditor words={snap.words} onChange={(words) => commit({ words })} currentTime={time} onSeek={(t) => previewRef.current?.seek(t)} />
          </div>
        </aside>

        {/* Aperçu */}
        <main className="relative min-h-0 p-4 flex flex-col">
          {media ? (
            <CaptionPreview
              ref={previewRef}
              src={media.url}
              words={snap.words}
              style={snap.style}
              framing={snap.framing}
              sourceWidth={media.width}
              sourceHeight={media.height}
              onTimeChange={setTime}
              onStyleChange={(style) => commit({ style })}
            />
          ) : (
            <p className="text-zinc-500 m-auto">La vidéo source est introuvable.</p>
          )}

          {!hasWords && (
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
              <div className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-3xl p-6 flex flex-col gap-4 shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-fuchsia-500/20 text-fuchsia-300 flex items-center justify-center">
                    <Wand2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Générer les sous-titres</h3>
                    <p className="text-xs text-zinc-500">Transcription mot à mot avec Whisper, en local.</p>
                  </div>
                </div>
                <Field label="Langue parlée">
                  <Select value={language} onChange={setLanguage} options={LANGUAGES} />
                </Field>
                <Field label="Langue des sous-titres">
                  <Select
                    value={translate ? 'en' : 'source'}
                    onChange={(v) => setTranslate(v === 'en')}
                    options={[
                      { value: 'en', label: 'Sous-titres en anglais (traduction)' },
                      { value: 'source', label: 'Sous-titres dans la langue parlée' },
                    ]}
                  />
                </Field>
                <Field label="Précision">
                  <Select value={model} onChange={setModel} options={MODELS} />
                </Field>
                <Field label="Vocabulaire spécifique" hint="optionnel">
                  <input
                    value={vocab}
                    onChange={(e) => setVocab(e.target.value)}
                    placeholder="Noms propres, marques, jargon…"
                    className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-500"
                  />
                </Field>
                {transcribeJob.running ? (
                  <div className="flex flex-col gap-3">
                    <ProgressBar percent={transcribeJob.percent} message={transcribeJob.message} />
                    <button onClick={transcribeJob.cancel} className="text-xs font-bold text-red-400 hover:text-red-300 self-end">
                      Annuler
                    </button>
                  </div>
                ) : (
                  <button onClick={startTranscription} className="w-full py-3 rounded-xl bg-white text-black font-bold flex items-center justify-center gap-2 hover:bg-fuchsia-100">
                    <Wand2 className="w-4 h-4" /> Lancer la transcription
                  </button>
                )}
                {transcribeJob.error && <p className="text-xs text-red-400 whitespace-pre-wrap max-h-32 overflow-auto">{transcribeJob.error}</p>}
              </div>
            </div>
          )}
        </main>

        {/* Panneau latéral */}
        <aside className="flex flex-col min-h-0 border-l border-white/5 bg-black/20">
          <div className="p-3 border-b border-white/5">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'style', label: <><Palette className="w-3.5 h-3.5" /> Style</> },
                { value: 'format', label: <><Crop className="w-3.5 h-3.5" /> Format</> },
                { value: 'export', label: <><Download className="w-3.5 h-3.5" /> Export</> },
              ]}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4">
            {tab === 'style' && <CaptionStylePanel style={snap.style} onChange={(style) => commit({ style })} />}

            {tab === 'format' && (
              <div className="flex flex-col gap-4 py-4">
                <Field label="Format de sortie">
                  <div className="grid grid-cols-5 gap-1.5">
                    {(['original', '9:16', '1:1', '4:5', '16:9'] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => commit({ framing: { ...snap.framing, aspect: a } })}
                        className={`py-2 rounded-lg text-xs font-bold border ${snap.framing.aspect === a ? 'border-fuchsia-500 bg-fuchsia-500/10 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}
                      >
                        {a === 'original' ? 'Original' : a}
                      </button>
                    ))}
                  </div>
                </Field>
                {snap.framing.aspect !== 'original' && (
                  <>
                    <Field label="Remplissage">
                      <Segmented
                        value={snap.framing.fit}
                        onChange={(fit) => commit({ framing: { ...snap.framing, fit } })}
                        options={[
                          { value: 'crop', label: 'Recadrer' },
                          { value: 'blur', label: 'Fond flou' },
                          { value: 'black', label: 'Bandes noires' },
                        ]}
                      />
                    </Field>
                    {snap.framing.fit === 'crop' && (
                      <Slider label="Position du cadrage" value={snap.framing.cropX} min={0} max={1} onChange={(cropX) => commit({ framing: { ...snap.framing, cropX } })} format={(v) => (v < 0.4 ? 'Gauche' : v > 0.6 ? 'Droite' : 'Centre')} />
                    )}
                  </>
                )}
                <div className="border-t border-white/5 pt-4 flex flex-col gap-3">
                  <p className="text-xs font-semibold text-zinc-400">Refaire la transcription</p>
                  <Select value={language} onChange={setLanguage} options={LANGUAGES} />
                  <Select
                    value={translate ? 'en' : 'source'}
                    onChange={(v) => setTranslate(v === 'en')}
                    options={[
                      { value: 'en', label: 'Sous-titres en anglais (traduction)' },
                      { value: 'source', label: 'Sous-titres dans la langue parlée' },
                    ]}
                  />
                  <Select value={model} onChange={setModel} options={MODELS} />
                  {transcribeJob.running ? (
                    <ProgressBar percent={transcribeJob.percent} message={transcribeJob.message} />
                  ) : (
                    <button onClick={startTranscription} className="py-2 rounded-lg border border-white/10 text-xs font-bold text-zinc-300 hover:text-white hover:bg-white/5 flex items-center justify-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5" /> Retranscrire (remplace le texte)
                    </button>
                  )}
                </div>
              </div>
            )}

            {tab === 'export' && (
              <div className="flex flex-col gap-4 py-4">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
                  <p className="font-bold text-white text-sm">Vidéo avec sous-titres incrustés</p>
                  <p className="text-xs text-zinc-500">
                    Format : {snap.framing.aspect === 'original' ? `original (${media?.width}×${media?.height})` : snap.framing.aspect} — encodage GPU si disponible.
                  </p>
                  {renderJob.running ? (
                    <div className="flex flex-col gap-2">
                      <ProgressBar percent={renderJob.percent} message={renderJob.message} />
                      <button onClick={renderJob.cancel} className="text-xs font-bold text-red-400 self-end">
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button onClick={startRender} className="py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white font-bold flex items-center justify-center gap-2">
                      <Film className="w-4 h-4" /> Générer la vidéo MP4
                    </button>
                  )}
                  {renderJob.error && <p className="text-xs text-red-400 whitespace-pre-wrap max-h-40 overflow-auto">{renderJob.error}</p>}
                  {lastRender && !renderJob.running && (
                    <div className="flex flex-col gap-2">
                      <video src={absoluteFileUrl(lastRender.videoUrl)} controls className="w-full rounded-xl bg-black max-h-80" />
                      <a href={downloadUrl(lastRender.videoUrl)} className="py-2.5 rounded-xl bg-white text-black text-sm font-bold text-center hover:bg-zinc-200 flex items-center justify-center gap-2">
                        <Download className="w-4 h-4" /> Télécharger le MP4
                      </a>
                      <p className="text-[11px] text-zinc-600 text-center">Rendu du {new Date(lastRender.createdAt).toLocaleString('fr-FR')}</p>
                    </div>
                  )}
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
                  <p className="font-bold text-white text-sm">Fichiers de sous-titres</p>
                  <p className="text-xs text-zinc-500">Pour YouTube, Premiere, DaVinci, CapCut…</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['srt', 'vtt', 'ass', 'txt'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={async () => {
                          await save();
                          window.location.href = captionExportUrl(project.id, f);
                        }}
                        className="py-2 rounded-lg border border-white/10 text-xs font-bold text-zinc-300 hover:text-white hover:bg-white/5 uppercase"
                      >
                        .{f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Transcription sur mobile / petits écrans */}
      <div className="lg:hidden border-t border-white/5 p-4 h-72">
        <TranscriptEditor words={snap.words} onChange={(words) => commit({ words })} currentTime={time} onSeek={(t) => previewRef.current?.seek(t)} />
      </div>
    </div>
  );
}
