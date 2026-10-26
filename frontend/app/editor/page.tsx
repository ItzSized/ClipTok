'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { listEditorProjects, createEditorProject } from '@/lib/api';

/**
 * Comme CapCut : « Éditeur » ouvre directement l'espace de montage
 * (le dernier projet, ou un nouveau projet 9:16 s'il n'y en a aucun).
 * La liste des projets est sur /editor/projects.
 */
export default function OpenEditor() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const projects = await listEditorProjects();
        const target = projects[0] ? projects[0].id : (await createEditorProject({ name: 'Nouveau projet', aspect: '9:16' })).id;
        router.replace(`/editor/${target}`);
      } catch {
        router.replace('/editor/projects');
      }
    })();
  }, [router]);

  return (
    <div className="flex-1 flex items-center justify-center gap-3 text-zinc-400 text-sm">
      <Loader2 className="w-5 h-5 animate-spin text-cyan-400" /> Ouverture de l'éditeur…
    </div>
  );
}
