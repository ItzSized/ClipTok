'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clapperboard, Plus, Trash2, Copy, Loader2, Film, Clock } from 'lucide-react';
import * as core from '@shared/editorCore';
import { listEditorProjects, createEditorProject, deleteEditorProject, duplicateEditorProject, absoluteFileUrl } from '@/lib/api';
import type { EditorProjectSummary } from '@/lib/types';
import { useDialog } from '@/components/DialogProvider';
import { useToast } from '@/components/ToastProvider';
import UploadDropzone from '@/components/media/UploadDropzone';
import Link from 'next/link';
import { formatTime } from '@/components/ui/controls';

export default function EditorProjects() {
  const router = useRouter();
  const { confirm } = useDialog();
  const { showToast } = useToast();
  const [projects, setProjects] = useState<EditorProjectSummary[] | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    listEditorProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const create = async (opts: { aspect?: string; mediaIds?: string[] }, key: string) => {
    setCreating(key);
    try {
      const doc = await createEditorProject(opts);
      router.push(`/editor/${doc.id}`);
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
      setCreating(null);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-10 relative z-10">
      <div className="flex items-start gap-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
          <Clapperboard className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-black text-white">Éditeur vidéo</h1>
          <p className="text-zinc-400 mt-1">Montage multipiste : transitions, textes animés, stickers, sons, filtres, effets, images clés, sous-titres auto.</p>
        </div>
      </div>

      <Link href="/ai-editor" className="mb-8 flex items-center justify-between gap-4 rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/5 px-5 py-4 hover:bg-fuchsia-500/10 transition-colors">
        <span className="text-sm text-zinc-300">
          <b className="text-white">Envie que l'IA monte pour vous ?</b> Décrivez votre vidéo dans l'Éditeur IA, puis revenez ici pour les retouches.
        </span>
        <span className="text-sm font-bold text-fuchsia-300 whitespace-nowrap">Ouvrir l'Éditeur IA →</span>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6 mb-12">
        <div className="bg-white/5 border border-white/10 rounded-3xl p-6">
          <h2 className="font-bold text-white mb-1">Nouveau projet vide</h2>
          <p className="text-xs text-zinc-500 mb-4">Choisissez le format du cadre (modifiable ensuite).</p>
          <div className="grid grid-cols-3 gap-3">
            {core.ASPECT_RATIOS.map((r) => {
              const ratio = r.width / r.height;
              return (
                <button
                  key={r.id}
                  disabled={creating !== null}
                  onClick={() => create({ aspect: r.id }, r.id)}
                  className="group flex flex-col items-center gap-2 p-3 rounded-2xl border border-white/10 hover:border-fuchsia-500 hover:bg-fuchsia-500/5 transition-colors disabled:opacity-50"
                >
                  <div className="h-16 flex items-center justify-center">
                    <div className="border-2 border-zinc-500 group-hover:border-fuchsia-400 rounded-md flex items-center justify-center" style={{ width: ratio >= 1 ? 64 : 64 * ratio, height: ratio >= 1 ? 64 / ratio : 64 }}>
                      {creating === r.id && <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-zinc-300 text-center leading-tight">{r.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col">
          <UploadDropzone onUploaded={(m) => create({ mediaIds: m.map((x) => x.id) }, 'upload')} title="Ou déposez vos vidéos pour commencer" subtitle="Le projet prend automatiquement le format de la première vidéo" />
        </div>
      </div>

      <h2 className="text-2xl font-bold text-white mb-5">Vos projets</h2>
      {projects === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-fuchsia-500" />
        </div>
      ) : projects.length === 0 ? (
        <p className="text-zinc-500 text-sm border border-dashed border-white/10 rounded-2xl p-8 text-center">Aucun projet pour l'instant.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {projects.map((p) => (
            <div key={p.id} onClick={() => router.push(`/editor/${p.id}`)} className="group bg-white/5 border border-white/10 rounded-2xl overflow-hidden cursor-pointer hover:border-white/30 transition-colors">
              <div className="aspect-video bg-black relative flex items-center justify-center">
                {p.thumbnailUrl ? <img src={absoluteFileUrl(p.thumbnailUrl)} alt="" className="w-full h-full object-cover" /> : <Film className="w-8 h-8 text-zinc-700" />}
                <span className="absolute top-2 left-2 text-[10px] font-bold bg-black/70 text-white px-1.5 py-0.5 rounded">{p.settings?.aspect}</span>
                <span className="absolute bottom-2 right-2 text-[10px] font-mono bg-black/70 text-white px-1.5 py-0.5 rounded">{formatTime(p.duration)}</span>
                {p.lastExport && <span className="absolute top-2 right-2 text-[10px] font-bold bg-emerald-500/80 text-white px-1.5 py-0.5 rounded">Exporté</span>}
              </div>
              <div className="p-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{p.name}</p>
                  <p className="text-[11px] text-zinc-500 flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" /> {new Date(p.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · {p.clipCount} éléments
                  </p>
                </div>
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const copy = await duplicateEditorProject(p.id);
                      setProjects((list) => [copy, ...(list || [])]);
                    }}
                    className="p-1 text-zinc-500 hover:text-white"
                    title="Dupliquer"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!(await confirm({ title: 'Supprimer ce projet ?', message: 'Les médias importés restent disponibles.', danger: true, confirmLabel: 'Supprimer' }))) return;
                      await deleteEditorProject(p.id);
                      setProjects((list) => (list || []).filter((x) => x.id !== p.id));
                    }}
                    className="p-1 text-zinc-500 hover:text-red-400"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={() => create({ aspect: '9:16' }, 'quick')}
            className="rounded-2xl border border-dashed border-white/15 flex flex-col items-center justify-center gap-2 text-zinc-500 hover:text-white hover:border-white/40 min-h-[180px]"
          >
            <Plus className="w-6 h-6" />
            <span className="text-sm font-semibold">Nouveau projet 9:16</span>
          </button>
        </div>
      )}
    </div>
  );
}
