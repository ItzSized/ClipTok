'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import AiStudio from '@/components/ai-editor/AiStudio';
import { getEditorProject } from '@/lib/api';
import type { EditorProjectDoc } from '@/lib/types';

export default function AiEditorPage({ params, searchParams }: { params: { id: string }; searchParams: { ai?: string; media?: string } }) {
  const router = useRouter();
  const [doc, setDoc] = useState<EditorProjectDoc | null>(null);
  // Demande initiale de « Créer avec l'IA » : lue une fois puis retirée de l'URL
  // (un rechargement de la page ne la renverra pas).
  const [ai] = useState(() => ({ prompt: searchParams.ai || undefined, media: searchParams.media ? searchParams.media.split(',').filter(Boolean) : [] }));

  useEffect(() => {
    if (ai.prompt) router.replace(`/ai-editor/${params.id}`);
    getEditorProject(params.id)
      .then(setDoc)
      .catch(() => router.push('/ai-editor'));
  }, [params.id, router, ai.prompt]);

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-fuchsia-500" />
      </div>
    );
  }
  return <AiStudio doc={doc} initialPrompt={ai.prompt} initialMedia={ai.media} />;
}
