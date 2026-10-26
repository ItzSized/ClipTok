'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Star, Download, Copy, Share2, Trash2, Clapperboard, Captions, Loader2 } from 'lucide-react';
import { absoluteFileUrl, downloadUrl, createEditorProject, importClipAsMedia, createCaptionProject } from '@/lib/api';
import { useToast } from './ToastProvider';
import type { ClipResult } from '@/lib/types';

interface ClipDetailModalProps {
  clip: ClipResult;
  onClose: () => void;
  onDelete: () => void;
}

export default function ClipDetailModal({ clip, onClose, onDelete }: ClipDetailModalProps) {
  const { showToast } = useToast();
  const router = useRouter();
  const [opening, setOpening] = useState<'editor' | 'captions' | null>(null);

  const openEditor = async () => {
    setOpening('editor');
    try {
      const doc = await createEditorProject({ clipId: clip.id, name: clip.title });
      router.push(`/editor/${doc.id}`);
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
      setOpening(null);
    }
  };

  const openCaptions = async () => {
    setOpening('captions');
    try {
      const media = await importClipAsMedia(clip.id);
      const project = await createCaptionProject(media.id);
      router.push(`/captions/${project.id}`);
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
      setOpening(null);
    }
  };

  const captionText = [clip.caption || clip.title, clip.hashtags && clip.hashtags.length ? clip.hashtags.map((h) => `#${h}`).join(' ') : '']
    .filter(Boolean)
    .join('\n\n');

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(captionText);
      showToast({ type: 'success', message: 'Légende et hashtags copiés dans le presse-papiers.' });
    } catch {
      showToast({ type: 'error', message: 'Impossible de copier automatiquement.' });
    }
  };

  const share = async () => {
    const url = absoluteFileUrl(clip.videoUrl);
    if (navigator.share) {
      try {
        await navigator.share({ title: clip.title, text: clip.caption || clip.title, url });
        return;
      } catch {
        // annulé par l'utilisateur, on ignore
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast({ type: 'info', message: 'Lien du clip copié dans le presse-papiers.' });
    } catch {
      showToast({ type: 'error', message: 'Impossible de copier le lien.' });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-zinc-950 border border-white/10 rounded-3xl shadow-2xl grid md:grid-cols-[minmax(0,340px)_1fr]"
      >
        <div className="bg-black relative flex-shrink-0">
          <video
            src={absoluteFileUrl(clip.videoUrl)}
            controls
            autoPlay
            playsInline
            className="w-full h-full max-h-[90vh] md:max-h-[85vh] object-contain md:sticky md:top-0"
          />
        </div>

        <div className="p-6 sm:p-8 flex flex-col">
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-xl font-bold text-white leading-tight">{clip.title}</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors flex-shrink-0" aria-label="Fermer">
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="text-xs text-zinc-500 mb-4">
            Généré le {clip.createdAt ? new Date(clip.createdAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : 'Date inconnue'}
          </div>

          <div className="flex items-center gap-3 mb-6">
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-full text-sm font-bold text-orange-300">
              <Star className="w-4 h-4 fill-orange-400 text-orange-400" />
              {clip.viralityScore} / 100
            </span>
            <span className="text-xs font-medium text-zinc-500 bg-black/30 px-3 py-1.5 rounded-full">
              {Math.round(clip.clipEnd - clip.clipStart)}s
            </span>
          </div>

          {clip.reason && (
            <div className="mb-6">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Pourquoi ce clip</p>
              <p className="text-sm text-zinc-300 leading-relaxed">{clip.reason}</p>
            </div>
          )}

          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Légende prête à poster</p>
              <button
                onClick={copyCaption}
                className="flex items-center gap-1.5 text-xs font-bold text-fuchsia-300 hover:text-fuchsia-200 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" /> Copier
              </button>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-zinc-300 whitespace-pre-line leading-relaxed">
              {captionText || 'Aucune légende générée pour ce clip.'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              onClick={openEditor}
              disabled={opening !== null}
              className="flex items-center justify-center gap-2 text-sm font-bold bg-gradient-to-r from-sky-500 to-fuchsia-500 text-white px-4 py-3 rounded-xl hover:brightness-110 disabled:opacity-60"
            >
              {opening === 'editor' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />} Éditer le clip
            </button>
            <button
              onClick={openCaptions}
              disabled={opening !== null}
              className="flex items-center justify-center gap-2 text-sm font-bold bg-white/10 text-white px-4 py-3 rounded-xl hover:bg-white/20 disabled:opacity-60"
            >
              {opening === 'captions' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Captions className="w-4 h-4" />} Sous-titrer
            </button>
          </div>

          <div className="mt-auto flex flex-wrap gap-3 pt-4 border-t border-white/5">
            <a
              href={downloadUrl(clip.videoUrl)}
              download
              className="flex items-center gap-2 text-sm font-bold bg-white text-black px-5 py-3 rounded-xl hover:bg-fuchsia-100 transition-colors"
            >
              <Download className="w-4 h-4" /> MP4
            </a>
            {clip.audioUrl && (
              <a
                href={downloadUrl(clip.audioUrl)}
                download
                className="flex items-center gap-2 text-sm font-bold bg-zinc-800 text-zinc-200 px-5 py-3 rounded-xl hover:bg-zinc-700 transition-colors"
              >
                <Download className="w-4 h-4" /> MP3
              </a>
            )}
            <button
              onClick={share}
              className="flex items-center gap-2 text-sm font-bold bg-white/10 text-white px-5 py-3 rounded-xl hover:bg-white/20 transition-colors"
            >
              <Share2 className="w-4 h-4" /> Partager
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-2 text-sm font-bold text-red-400 px-5 py-3 rounded-xl hover:bg-red-500/10 transition-colors ml-auto"
            >
              <Trash2 className="w-4 h-4" /> Supprimer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
