'use client';

import { useMemo, useState } from 'react';
import { Sparkles, Loader2, Search, Film, ArrowDownWideNarrow, DownloadCloud, Trash2 } from 'lucide-react';
import GeneratorForm from './GeneratorForm';
import ClipCard from './ClipCard';
import ClipDetailModal from './ClipDetailModal';
import { absoluteFileUrl } from '@/lib/api';
import type { ClipResult, Project } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { useDialog } from './DialogProvider';

interface DashboardProps {
  clips: ClipResult[];
  projects: Project[];
  loading: boolean;
  onDeleteClip: (id: string) => void;
  onDeleteClips: (ids: string[]) => Promise<void>;
  onGenerated: (clips: ClipResult[]) => void;
  onCreateProject: (name: string) => void;
  onDeleteProject: (id: string) => void;
  onMoveClip: (clipId: string, projectId: string | null) => void;
}

type SortMode = 'recent' | 'score' | 'duration';

export default function Dashboard({ clips, projects, loading, onDeleteClip, onDeleteClips, onGenerated, onCreateProject, onDeleteProject, onMoveClip }: DashboardProps) {
  const router = useRouter();
  const dialog = useDialog();
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [selectedClip, setSelectedClip] = useState<ClipResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);

  const topScore = useMemo(() => (clips.length ? Math.max(...clips.map((c) => c.viralityScore)) : 0), [clips]);

  const visibleClips = useMemo(() => {
    let list = clips.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));
    if (sortMode === 'score') list = [...list].sort((a, b) => b.viralityScore - a.viralityScore);
    else if (sortMode === 'duration') list = [...list].sort((a, b) => (b.clipEnd - b.clipStart) - (a.clipEnd - a.clipStart));
    return list;
  }, [clips, query, sortMode]);

  const handleDownloadAll = async () => {
    if (visibleClips.length === 0 || busy) return;
    setBusy(true);
    for (let i = 0; i < visibleClips.length; i++) {
      const a = document.createElement('a');
      a.href = absoluteFileUrl(visibleClips[i].videoUrl);
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      await new Promise((r) => setTimeout(r, 400));
    }
    setBusy(false);
  };

  return (
    <div className="w-full max-w-6xl relative z-10 py-8">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-12">
        <div className="md:col-span-3 bg-gradient-to-br from-fuchsia-500/10 to-orange-500/10 border border-fuchsia-500/20 rounded-3xl p-8 flex flex-col justify-center">
          <h2 className="text-3xl font-extrabold text-white mb-2">Bienvenue dans le Studio</h2>
          <p className="text-zinc-400">
            Générez instantanément un clip avec l'IA en remplissant le formulaire ci-dessous.
          </p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col justify-center items-center text-center hover:bg-white/10 transition-colors">
          <div className="w-12 h-12 bg-orange-500/20 text-orange-400 rounded-full flex items-center justify-center mb-4">
            <Film className="w-6 h-6" />
          </div>
          <h4 className="text-4xl font-black text-white">{clips.length}</h4>
          <p className="text-zinc-500 text-sm font-medium mt-1 uppercase tracking-wider">Clips Générés</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col justify-center items-center text-center hover:bg-white/10 transition-colors">
          <div className="w-12 h-12 bg-fuchsia-500/20 text-fuchsia-400 rounded-full flex items-center justify-center mb-4">
            <Sparkles className="w-6 h-6" />
          </div>
          <h4 className="text-4xl font-black text-white">{clips.length ? Math.round(clips.reduce((acc, c) => acc + c.viralityScore, 0) / clips.length) : '—'}</h4>
          <p className="text-zinc-500 text-sm font-medium mt-1 uppercase tracking-wider">Score moyen</p>
        </div>
      </div>

      <GeneratorForm onComplete={onGenerated} />

      <div className="mt-16 border-t border-white/5 pt-12">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white">Vos Clips</h2>
            <span className="bg-white/10 text-white text-xs font-bold px-2.5 py-1 rounded-md">{clips.length}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un clip..."
                className="bg-white/5 border border-white/10 rounded-full pl-9 pr-4 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-fuchsia-500/50 w-48"
              />
            </div>
            <div className="relative">
              <ArrowDownWideNarrow className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="bg-white/5 border border-white/10 rounded-full pl-9 pr-4 py-2 text-sm text-white outline-none focus:border-fuchsia-500/50 appearance-none cursor-pointer"
              >
                <option value="recent">Récent</option>
                <option value="score">Score</option>
                <option value="duration">Durée</option>
              </select>
            </div>
            <button
              onClick={handleDownloadAll}
              disabled={busy || visibleClips.length === 0}
              className="flex items-center gap-1.5 text-sm font-bold text-white bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 rounded-full transition-colors disabled:opacity-50"
            >
              <DownloadCloud className="w-4 h-4" /> Tout télécharger
            </button>
            <button
              onClick={async () => {
                const ok = await dialog.confirm({
                  title: `Supprimer ${visibleClips.length} clip${visibleClips.length > 1 ? 's' : ''} ?`,
                  message: 'Tous les clips actuellement affichés seront supprimés définitivement (fichiers MP4 et MP3 compris).',
                  danger: true,
                  confirmLabel: 'Tout supprimer',
                });
                if (!ok) return;
                setBusy(true);
                try {
                  await onDeleteClips(visibleClips.map((c) => c.id));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy || visibleClips.length === 0}
              className="flex items-center gap-1.5 text-sm font-bold text-red-400 bg-red-500/10 hover:bg-red-500/20 px-4 py-2 rounded-full transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" /> Tout supprimer
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-fuchsia-500" />
          </div>
        ) : clips.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-white/10 rounded-3xl bg-black/20">
            <Film className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Aucun clip</h3>
              <p className="text-zinc-500 mb-6 text-sm">Générez un clip pour le voir apparaître ici.</p>
          </div>
        ) : visibleClips.length === 0 ? (
          <p className="text-center text-zinc-500 py-16">Aucun clip ne correspond à "{query}".</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {visibleClips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                isTopPick={clips.length > 1 && clip.viralityScore === topScore}
                onOpenDetail={() => setSelectedClip(clip)}
                onDelete={() => onDeleteClip(clip.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* SECTION PROJETS */}
      <div className="mt-16 border-t border-white/5 pt-12 mb-20">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white">Vos Projets</h2>
            <span className="bg-white/10 text-white text-xs font-bold px-2.5 py-1 rounded-md">{projects.length}</span>
          </div>
          <button
            onClick={async () => {
              const name = await dialog.prompt({ title: 'Nouveau projet', label: 'Nom du projet', placeholder: 'Ex. Podcast épisode 12', confirmLabel: 'Créer' });
              if (name) onCreateProject(name);
            }}
            className="text-sm font-bold bg-fuchsia-500 hover:bg-fuchsia-600 text-white px-4 py-2 rounded-full transition-colors"
          >
            + Nouveau Projet
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-white/10 rounded-3xl bg-black/20">
            <p className="text-zinc-500 text-sm">Créez un projet pour classer vos clips.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverProjectId('trash');
              }}
              onDragLeave={() => setDragOverProjectId(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverProjectId(null);
                const clipId = e.dataTransfer.getData('text/plain');
                if (clipId) onDeleteClip(clipId);
              }}
              className={`bg-red-500/5 border border-red-500/20 border-dashed rounded-3xl p-6 transition-all flex flex-col items-center justify-center text-center ${
                dragOverProjectId === 'trash'
                  ? 'bg-red-500/20 border-red-500 scale-105'
                  : 'hover:bg-red-500/10'
              }`}
            >
              <Trash2 className="w-8 h-8 text-red-400 mb-2" />
              <h3 className="text-lg font-bold text-red-400">Poubelle</h3>
              <p className="text-xs text-red-400/70">Glissez un clip ici pour le supprimer</p>
            </div>
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => router.push(`/dashboard/${project.id}`)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverProjectId(project.id);
                }}
                onDragLeave={() => setDragOverProjectId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverProjectId(null);
                  const clipId = e.dataTransfer.getData('text/plain');
                  if (clipId) onMoveClip(clipId, project.id);
                }}
                className={`bg-white/5 border rounded-3xl p-6 cursor-pointer transition-all ${
                  dragOverProjectId === project.id
                    ? 'border-fuchsia-500 bg-fuchsia-500/10 scale-105'
                    : 'border-white/10 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 bg-fuchsia-500/20 text-fuchsia-400 rounded-full flex items-center justify-center">
                    <Film className="w-5 h-5" />
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteProject(project.id);
                    }}
                    className="text-zinc-600 hover:text-red-400 p-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <h3 className="text-xl font-bold text-white mb-1">{project.name}</h3>
                <p className="text-sm text-zinc-500">{project.clips?.length || 0} clip(s)</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedClip && (
        <ClipDetailModal
          clip={selectedClip}
          onClose={() => setSelectedClip(null)}
          onDelete={() => {
            onDeleteClip(selectedClip.id);
            setSelectedClip(null);
          }}
        />
      )}
    </div>
  );
}
