'use client';

import { useEffect, useState } from 'react';
import Dashboard from '@/components/Dashboard';
import { useToast } from '@/components/ToastProvider';
import { useDialog } from '@/components/DialogProvider';
import { getClips, deleteClip, deleteClips, getProjects, createProject, moveClip, deleteProject } from '@/lib/api';
import type { ClipResult, Project } from '@/lib/types';

export default function DashboardPage() {
  const [clips, setClips] = useState<ClipResult[]>([]);
  const [loadingClips, setLoadingClips] = useState(true);

  const { showToast } = useToast();
  const dialog = useDialog();

  const [projects, setProjects] = useState<Project[]>([]);

  const fetchClipsAndProjects = async () => {
    setLoadingClips(true);
    try {
      const [clipsData, projectsData] = await Promise.all([getClips(), getProjects()]);
      setClips(clipsData);
      setProjects(projectsData);
    } catch (err) {
      console.error('Failed to fetch data', err);
    } finally {
      setLoadingClips(false);
    }
  };

  useEffect(() => {
    fetchClipsAndProjects();
  }, []);

  const handleDeleteClip = async (clipId: string) => {
    if (!(await dialog.confirm({ title: 'Supprimer ce clip ?', message: 'Les fichiers MP4 et MP3 seront supprimés.', danger: true, confirmLabel: 'Supprimer' }))) return;
    try {
      await deleteClip(clipId);
      setClips((prev) => prev.filter((c) => c.id !== clipId));
      showToast({ type: 'success', message: 'Clip supprimé.' });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur lors de la suppression.' });
    }
  };

  const handleDeleteClips = async (ids: string[]) => {
    try {
      const { deleted } = await deleteClips(ids);
      setClips((prev) => prev.filter((c) => !ids.includes(c.id)));
      showToast({ type: 'success', message: `${deleted} clip${deleted > 1 ? 's' : ''} supprimé${deleted > 1 ? 's' : ''}.` });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur lors de la suppression.' });
    }
  };

  const handleGenerated = async (newClips: ClipResult[]) => {
    await fetchClipsAndProjects();
    showToast({ type: 'success', title: 'Génération terminée', message: `${newClips.length} clip${newClips.length > 1 ? 's' : ''} prêt${newClips.length > 1 ? 's' : ''} !` });
  };

  const handleCreateProject = async (name: string) => {
    try {
      await createProject(name);
      await fetchClipsAndProjects();
      showToast({ type: 'success', message: 'Projet créé.' });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur.' });
    }
  };

  const handleMoveClip = async (clipId: string, projectId: string | null) => {
    try {
      await moveClip(clipId, projectId);
      await fetchClipsAndProjects();
      showToast({ type: 'success', message: projectId ? 'Clip déplacé vers le projet.' : 'Clip retiré du projet.' });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur.' });
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!(await dialog.confirm({ title: 'Supprimer ce projet ?', message: 'Le projet ET tous ses clips seront supprimés définitivement.', danger: true, confirmLabel: 'Supprimer' }))) return;
    try {
      await deleteProject(id);
      await fetchClipsAndProjects();
      showToast({ type: 'success', message: 'Projet supprimé.' });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur.' });
    }
  };

  return (
    <div className="flex-1 w-full flex flex-col items-center">
      <Dashboard
        clips={clips}
        projects={projects}
        loading={loadingClips}
        onDeleteClip={handleDeleteClip}
        onDeleteClips={handleDeleteClips}
        onGenerated={handleGenerated}
        onCreateProject={handleCreateProject}
        onMoveClip={handleMoveClip}
        onDeleteProject={handleDeleteProject}
      />
    </div>
  );
}
