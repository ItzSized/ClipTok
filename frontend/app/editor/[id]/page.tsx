'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import Editor from '@/components/editor/Editor';
import { getEditorProject } from '@/lib/api';
import type { EditorProjectDoc } from '@/lib/types';

export default function EditorPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [doc, setDoc] = useState<EditorProjectDoc | null>(null);

  useEffect(() => {
    getEditorProject(params.id)
      .then(setDoc)
      .catch(() => router.push('/editor/projects'));
  }, [params.id, router]);

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-fuchsia-500" />
      </div>
    );
  }
  return <Editor doc={doc} />;
}
