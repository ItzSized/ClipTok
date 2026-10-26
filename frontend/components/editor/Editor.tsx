'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Share, CloudOff, Bot, FolderOpen, Plus } from 'lucide-react';
import { EditorStore, EditorContext, useEditor } from './store';
import { EngineContext } from './engineContext';
import { PreviewEngine } from '@/lib/editor/engine';
import { ensureAllFonts } from '@/lib/fonts';
import { saveEditorProject, createEditorProject } from '@/lib/api';
import type { EditorProjectDoc, RenderResult } from '@/lib/types';
import LeftPanel, { type LeftTab } from './LeftPanel';
import PreviewCanvas from './PreviewCanvas';
import Inspector from './Inspector';
import Timeline from './Timeline';
import Toolbar from './Toolbar';
import ExportDialog from './ExportDialog';

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Raccourcis clavier façon CapCut / Premiere.
 * mode 'all' : tous ; 'combos' (Éditeur IA, où l'on tape du texte à l'IA) : pas de
 * raccourci à une seule lettre (« s » pour couper…), mais Ctrl+Z / Ctrl+A / Suppr… actifs.
 */
function useShortcuts(store: EditorStore, engine: PreviewEngine, mode: 'all' | 'combos' = 'all') {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (mode === 'combos' && !ctrl && e.key.length === 1 && e.code !== 'Space') return;
      const fps = store.getState().project.settings.fps || 30;
      const key = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        engine.toggle();
      } else if (ctrl && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (ctrl && key === 'y') {
        e.preventDefault();
        store.redo();
      } else if (ctrl && key === 'a') {
        e.preventDefault();
        store.select(store.getState().project.clips.map((c) => c.id));
      } else if (ctrl && key === 'd') {
        e.preventDefault();
        store.duplicateSelection();
      } else if (ctrl && key === 'c') {
        store.copySelection();
      } else if (ctrl && key === 'v') {
        store.paste();
      } else if (ctrl && key === 'b') {
        e.preventDefault();
        store.splitAt();
      } else if (!ctrl && key === 's') {
        store.splitAt();
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        store.deleteSelection();
      } else if (key === 'arrowleft') {
        e.preventDefault();
        engine.seek(engine.time - (e.shiftKey ? 1 : 1 / fps));
      } else if (key === 'arrowright') {
        e.preventDefault();
        engine.seek(engine.time + (e.shiftKey ? 1 : 1 / fps));
      } else if (key === 'home') {
        engine.seek(0);
      } else if (key === 'end') {
        engine.seek(engine.duration);
      } else if (key === '+' || key === '=') {
        store.setZoom(store.getState().zoom * 1.25);
      } else if (key === '-') {
        store.setZoom(store.getState().zoom / 1.25);
      } else if (key === 'escape') {
        store.clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, engine, mode]);
}

export function SaveIndicator({ state }: { state: 'saved' | 'saving' | 'dirty' | 'error' }) {
  return (
    <span className="text-[11px] text-zinc-500 flex items-center gap-1">
      {state === 'saving' && <Loader2 className="w-3 h-3 animate-spin" />}
      {state === 'saved' && <Check className="w-3 h-3 text-emerald-400" />}
      {state === 'error' && <CloudOff className="w-3 h-3 text-red-400" />}
      {state === 'saving' ? 'Sauvegarde…' : state === 'saved' ? 'Enregistré' : state === 'error' ? 'Échec de la sauvegarde' : 'Modifié'}
    </span>
  );
}

/** Sauvegarde automatique du projet (et de son nom) avec anti-rebond. */
export function useAutosave(docId: string, name: string) {
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const revision = useEditor((s) => s.revision);
  const project = useEditor((s) => s.project);
  const firstRevision = useRef(revision);
  const nameRef = useRef(name);
  useEffect(() => {
    if (revision === firstRevision.current && name === nameRef.current) return;
    setSaveState('dirty');
    const t = setTimeout(async () => {
      setSaveState('saving');
      try {
        await saveEditorProject(docId, { project, name });
        nameRef.current = name;
        firstRevision.current = revision;
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [revision, project, name, docId]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === 'dirty' || saveState === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  return saveState;
}

function EditorLayout({ doc }: { doc: EditorProjectDoc }) {
  const router = useRouter();
  const [name, setName] = useState(doc.name);
  const [tab, setTab] = useState<LeftTab>('media');
  const [showExport, setShowExport] = useState(false);
  const [lastExport, setLastExport] = useState<RenderResult | null>(doc.lastExport);
  const [timelineH, setTimelineH] = useState(300);
  const project = useEditor((s) => s.project);
  const saveState = useAutosave(doc.id, name);
  const timelineWrap = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(1200);

  useEffect(() => {
    const el = timelineWrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTimelineWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Poignée de redimensionnement entre l'aperçu et la timeline.
  const resizing = useRef<{ y: number; h: number } | null>(null);

  return (
    <div className="relative z-10 flex flex-col h-[calc(100vh-73px)] w-full bg-[#141417] text-zinc-100">
      <header className="flex items-center gap-3 px-3 py-2 border-b border-white/5 bg-black/40">
        <button onClick={() => router.push('/editor/projects')} className="flex items-center gap-1.5 text-xs font-bold text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg" title="Tous les projets">
          <FolderOpen className="w-3.5 h-3.5" /> Projets
        </button>
        <button
          onClick={async () => {
            const created = await createEditorProject({ name: 'Nouveau projet', aspect: project.settings.aspect });
            router.push(`/editor/${created.id}`);
          }}
          className="flex items-center gap-1.5 text-xs font-bold text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg"
          title="Nouveau projet"
        >
          <Plus className="w-3.5 h-3.5" /> Nouveau
        </button>
        <input value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent font-bold text-sm outline-none border-b border-transparent focus:border-cyan-500 w-64" />
        <SaveIndicator state={saveState} />
        <span className="text-[11px] text-zinc-600 hidden md:inline">
          {project.settings.width}×{project.settings.height} · {project.settings.fps} i/s
        </span>
        <button
          onClick={() => router.push(`/ai-editor/${doc.id}`)}
          className="ml-auto flex items-center gap-2 text-sm font-bold bg-white/10 hover:bg-white/20 text-white px-4 py-1.5 rounded-full"
          title="Continuer ce projet en le décrivant à l'IA"
        >
          <Bot className="w-4 h-4" /> Éditeur IA
        </button>
        <button onClick={() => setShowExport(true)} className="flex items-center gap-2 text-sm font-bold bg-gradient-to-r from-cyan-500 to-teal-400 text-white px-4 py-1.5 rounded-full hover:brightness-110">
          <Share className="w-4 h-4" /> Exporter
        </button>
      </header>

      <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: '360px minmax(0,1fr) 340px' }}>
        <aside className="min-h-0 border-r border-white/5">
          <LeftPanel tab={tab} onTab={setTab} />
        </aside>
        <main className="min-h-0">
          <PreviewCanvas />
        </main>
        <aside className="min-h-0 border-l border-white/5 overflow-hidden">
          <Inspector />
        </aside>
      </div>

      <div
        className="h-1.5 cursor-row-resize bg-white/5 hover:bg-cyan-500/50 transition-colors"
        onPointerDown={(e) => {
          resizing.current = { y: e.clientY, h: timelineH };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!resizing.current) return;
          setTimelineH(Math.min(window.innerHeight * 0.7, Math.max(160, resizing.current.h - (e.clientY - resizing.current.y))));
        }}
        onPointerUp={() => (resizing.current = null)}
      />
      <div ref={timelineWrap} className="flex flex-col" style={{ height: timelineH }}>
        <Toolbar timelineWidth={timelineWidth} />
        <div className="flex-1 min-h-0">
          <Timeline />
        </div>
      </div>

      {showExport && <ExportDialog defaultName={name} projectId={doc.id} initial={lastExport} onClose={() => setShowExport(false)} onDone={setLastExport} />}
    </div>
  );
}

/** Store + moteur d'aperçu + raccourcis : partagés par l'éditeur classique et l'Éditeur IA. */
export function EditorProviders({ doc, children, shortcuts = true }: { doc: EditorProjectDoc; children: React.ReactNode; shortcuts?: boolean }) {
  const store = useMemo(() => new EditorStore(doc.project), [doc]);
  const engine = useMemo(() => new PreviewEngine(store.getState().project), [store]);

  useEffect(() => {
    store.getTime = () => engine.time;
    engine.setProject(store.getState().project);
    // Accès console pour le débogage en développement.
    if (process.env.NODE_ENV !== 'production') Object.assign(window, { __cliptokEditor: { store, engine } });
    let last = store.getState().project;
    const unsub = store.subscribe(() => {
      const p = store.getState().project;
      if (p !== last) {
        last = p;
        engine.setProject(p);
      }
    });
    ensureAllFonts()
      .then((fonts) => engine.setFonts(fonts))
      .catch(() => {});
    return () => {
      unsub();
      engine.destroy();
    };
  }, [store, engine]);

  useShortcuts(store, engine, shortcuts ? 'all' : 'combos');

  return (
    <EditorContext.Provider value={store}>
      <EngineContext.Provider value={engine}>
        {children}
      </EngineContext.Provider>
    </EditorContext.Provider>
  );
}

export default function Editor({ doc }: { doc: EditorProjectDoc }) {
  return (
    <EditorProviders doc={doc}>
      <EditorLayout doc={doc} />
    </EditorProviders>
  );
}
