'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Captions, Film, Trash2, Loader2, Clock, Type } from 'lucide-react';
import UploadDropzone from '@/components/media/UploadDropzone';
import { useToast } from '@/components/ToastProvider';
import { useDialog } from '@/components/DialogProvider';
import {
  listCaptionProjects,
  createCaptionProject,
  deleteCaptionProject,
  getClips,
  importClipAsMedia,
  mediaThumbnailUrl,
  absoluteFileUrl,
} from '@/lib/api';
import type { CaptionProject, ClipResult, Media } from '@/lib/types';
import { formatTime } from '@/components/ui/controls';

export default function CaptionsHome() {
  const router = useRouter();
  const { showToast } = useToast();
  const { confirm } = useDialog();
  const [projects, setProjects] = useState<CaptionProject[] | null>(null);
  const [clips, setClips] = useState<ClipResult[]>([]);
  const [busyClip, setBusyClip] = useState<string | null>(null);

  useEffect(() => {
    listCaptionProjects().then(setProjects).catch(() => setProjects([]));
    getClips().then(setClips).catch(() => {});
  }, []);

  const start = async (media: Media) => {
    if (media.kind !== 'video') {
      showToast({ type: 'error', message: 'Choisissez un fichier vidéo.' });
      return;
    }
    try {
      const project = await createCaptionProject(media.id);
      router.push(`/captions/${project.id}`);
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
    }
  };

  const fromClip = async (clip: ClipResult) => {
    setBusyClip(clip.id);
    try {
      await start(await importClipAsMedia(clip.id));
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setBusyClip(null);
    }
  };

  const remove = async (p: CaptionProject) => {
    if (!(await confirm({ title: 'Supprimer ce projet de sous-titres ?', message: 'La vidéo importée reste disponible dans vos médias.', danger: true, confirmLabel: 'Supprimer' }))) return;
    await deleteCaptionProject(p.id);
    setProjects((list) => (list || []).filter((x) => x.id !== p.id));
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-10 relative z-10">
      <div className="flex items-start gap-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center shadow-lg shadow-fuchsia-500/20">
          <Captions className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-black text-white">Sous-titres automatiques</h1>
          <p className="text-zinc-400 mt-1">Envoyez une vidéo : l'IA la transcrit mot à mot, choisissez un style, corrigez et exportez.</p>
        </div>
      </div>

      <UploadDropzone accept="video/*" multiple={false} onUploaded={(m) => start(m[0])} title="Déposez une vidéo" subtitle="MP4, MOV, WEBM, MKV… — transcription locale (Whisper), aucune limite de durée" />

      {clips.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-2">
            <Film className="w-4 h-4" /> Ou partir d'un clip généré
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {clips.slice(0, 20).map((c) => (
              <button
                key={c.id}
                onClick={() => fromClip(c)}
                disabled={busyClip !== null}
                className="relative flex-shrink-0 w-28 aspect-[9/16] rounded-xl overflow-hidden border border-white/10 hover:border-fuchsia-500 transition-colors group disabled:opacity-50"
              >
                <video src={absoluteFileUrl(c.videoUrl)} muted preload="metadata" className="w-full h-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black to-transparent text-[10px] font-semibold text-white text-left line-clamp-2">{c.title}</div>
                {busyClip === c.id && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-12">
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
              <div
                key={p.id}
                onClick={() => router.push(`/captions/${p.id}`)}
                className="group bg-white/5 border border-white/10 rounded-2xl overflow-hidden cursor-pointer hover:border-white/30 transition-colors"
              >
                <div className="aspect-video bg-black relative">
                  {p.media && <img src={mediaThumbnailUrl(p.media.id)} alt="" className="w-full h-full object-cover" />}
                  <span className="absolute bottom-2 right-2 text-[10px] font-mono bg-black/70 text-white px-1.5 py-0.5 rounded">{formatTime(p.media?.duration || 0)}</span>
                </div>
                <div className="p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{p.name}</p>
                    <p className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Type className="w-3 h-3" /> {p.wordCount || 0} mots
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {new Date(p.updatedAt).toLocaleDateString('fr-FR')}
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(p);
                    }}
                    className="text-zinc-600 hover:text-red-400 p-1"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
