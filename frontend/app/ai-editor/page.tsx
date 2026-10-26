'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Film, Clock } from 'lucide-react';
import AiCreateCard from '@/components/ai-editor/AiCreateCard';
import { listEditorProjects, absoluteFileUrl } from '@/lib/api';
import type { EditorProjectSummary } from '@/lib/types';
import { formatTime } from '@/components/ui/controls';

export default function AiEditorHome() {
  const router = useRouter();
  const [projects, setProjects] = useState<EditorProjectSummary[]>([]);

  useEffect(() => {
    listEditorProjects().then(setProjects).catch(() => {});
  }, []);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-10 relative z-10">
      <div className="flex items-start gap-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center shadow-lg shadow-fuchsia-500/20">
          <Bot className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-black text-white">Éditeur IA</h1>
          <p className="text-zinc-400 mt-1">Dites ce que vous voulez, l'IA monte la vidéo : clips, transitions, sons, textes, sous-titres, silences coupés… avec des modèles gratuits.</p>
        </div>
      </div>

      <AiCreateCard />

      {projects.length > 0 && (
        <>
          <h2 className="text-xl font-bold text-white mb-4">Continuer un projet avec l'IA</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {projects.map((p) => (
              <button key={p.id} onClick={() => router.push(`/ai-editor/${p.id}`)} className="text-left bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-fuchsia-400/60 transition-colors">
                <div className="aspect-video bg-black relative flex items-center justify-center">
                  {p.thumbnailUrl ? <img src={absoluteFileUrl(p.thumbnailUrl)} alt="" className="w-full h-full object-cover" /> : <Film className="w-8 h-8 text-zinc-700" />}
                  <span className="absolute bottom-2 right-2 text-[10px] font-mono bg-black/70 text-white px-1.5 py-0.5 rounded">{formatTime(p.duration)}</span>
                </div>
                <div className="p-3">
                  <p className="text-sm font-bold text-white truncate">{p.name}</p>
                  <p className="text-[11px] text-zinc-500 flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" /> {new Date(p.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
