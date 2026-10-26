'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Trash2, DownloadCloud, Film } from 'lucide-react';
import { getProjects, deleteClip, absoluteFileUrl, deleteProject } from '@/lib/api';
import type { Project, ClipResult } from '@/lib/types';
import ClipCard from '@/components/ClipCard';
import ClipDetailModal from '@/components/ClipDetailModal';
import { useToast } from '@/components/ToastProvider';
import { useDialog } from '@/components/DialogProvider';

export default function ProjectPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { showToast } = useToast();
  const dialog = useDialog();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedClip, setSelectedClip] = useState<ClipResult | null>(null);

  const fetchProject = async () => {
    try {
      const projects = await getProjects();
      const p = projects.find((x) => x.id === params.id);
      if (p) setProject(p);
      else router.push('/dashboard');
    } catch (err) {
      router.push('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProject();
  }, [params.id]);

  const handleDeleteClip = async (clipId: string) => {
    if (!(await dialog.confirm({ title: 'Supprimer ce clip ?', danger: true, confirmLabel: 'Supprimer' }))) return;
    try {
      await deleteClip(clipId);
      await fetchProject();
      showToast({ type: 'success', message: 'Clip supprimé.' });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur.' });
    }
  };

  const handleDownloadAll = async () => {
    if (!project || project.clips.length === 0) return;
    for (let i = 0; i < project.clips.length; i++) {
      const a = document.createElement('a');
      a.href = absoluteFileUrl(project.clips[i].videoUrl);
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  if (loading) return <div className="p-20 text-white text-center">Chargement...</div>;
  if (!project) return null;

  return (
    <div className="w-full max-w-6xl relative z-10 py-8">
      <div className="flex items-center justify-between mb-12">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-3xl font-extrabold text-white">{project.name}</h1>
            <p className="text-zinc-500 text-sm mt-1">{project.clips.length} clip(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleDownloadAll}
            disabled={project.clips.length === 0}
            className="flex items-center gap-2 text-sm font-bold bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-full transition-colors disabled:opacity-50"
          >
            <DownloadCloud className="w-4 h-4" />
            Tout télécharger
          </button>
          <button
            onClick={async () => {
              if (await dialog.confirm({ title: 'Supprimer ce projet ?', message: 'Le projet et tous ses clips seront supprimés.', danger: true, confirmLabel: 'Supprimer' })) {
                await deleteProject(project.id);
                router.push('/dashboard');
              }
            }}
            className="flex items-center gap-2 text-sm font-bold text-red-400 bg-red-400/10 hover:bg-red-400/20 px-5 py-2.5 rounded-full transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Supprimer
          </button>
        </div>
      </div>

      {project.clips.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-white/10 rounded-3xl bg-black/20">
          <Film className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">Projet vide</h3>
          <p className="text-zinc-500 mb-6 text-sm">Glissez des clips depuis le Dashboard vers ce projet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {project.clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              onOpenDetail={() => setSelectedClip(clip)}
              onDelete={() => handleDeleteClip(clip.id)}
            />
          ))}
        </div>
      )}

      {selectedClip && (
        <ClipDetailModal
          clip={selectedClip}
          onClose={() => setSelectedClip(null)}
          onDelete={() => {
            handleDeleteClip(selectedClip.id);
            setSelectedClip(null);
          }}
        />
      )}
    </div>
  );
}
