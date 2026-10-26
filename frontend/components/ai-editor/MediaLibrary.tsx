'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, Film, Music, Image as ImageIcon, Play, Plus, Square, Trash2, Volume2, X } from 'lucide-react';
import { DND_MIME } from '@/components/editor/engineContext';
import { deleteMedia, deleteManyMedia, mediaThumbnailUrl, absoluteFileUrl } from '@/lib/api';
import { useDialog } from '@/components/DialogProvider';
import { useToast } from '@/components/ToastProvider';
import type { Media } from '@/lib/types';
import { formatTime } from '@/components/ui/controls';

function formatFileSize(bytes: number) {
  if (!bytes || bytes <= 0) return '0 Ko';
  if (bytes < 100 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

// Lecteur audio partagé pour écouter un son directement depuis sa tuile en un clic.
let sharedAudio: HTMLAudioElement | null = null;
let sharedAudioId: string | null = null;
const sharedListeners = new Set<(id: string | null) => void>();

function notifySharedAudio(id: string | null) {
  sharedAudioId = id;
  sharedListeners.forEach((fn) => fn(id));
}

export function toggleInlineAudio(media: Media) {
  if (sharedAudio && sharedAudioId === media.id) {
    sharedAudio.pause();
    sharedAudio = null;
    notifySharedAudio(null);
    return;
  }
  if (sharedAudio) {
    sharedAudio.pause();
    sharedAudio = null;
  }
  const url = `${absoluteFileUrl(media.url)}${media.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(media.updatedAt || media.id)}`;
  const a = new Audio(url);
  sharedAudio = a;
  notifySharedAudio(media.id);
  a.onended = () => {
    if (sharedAudio === a) {
      sharedAudio = null;
      notifySharedAudio(null);
    }
  };
  a.onerror = () => {
    if (sharedAudio === a) {
      sharedAudio = null;
      notifySharedAudio(null);
    }
  };
  a.play().catch(() => {
    if (sharedAudio === a) {
      sharedAudio = null;
      notifySharedAudio(null);
    }
  });
}

export type SortMode = 'recent' | 'name' | 'duration' | 'kind';

export function sortMedia(media: Media[], sort: SortMode): Media[] {
  const list = media.slice();
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  else if (sort === 'duration') list.sort((a, b) => b.duration - a.duration);
  else if (sort === 'kind') list.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'fr'));
  else list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return list;
}

export function SortSelect({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortMode)}
      className="bg-black/40 border border-white/10 rounded-md px-1.5 py-1 text-[11px] text-zinc-300 outline-none"
      title="Trier"
    >
      <option value="recent">Récents</option>
      <option value="name">Nom</option>
      <option value="duration">Durée</option>
      <option value="kind">Type</option>
    </select>
  );
}

/** Supprime un média après confirmation ; renvoie true si supprimé. */
export function useMediaRemover() {
  const dialog = useDialog();
  const { showToast } = useToast();
  return async (m: Media) => {
    const ok = await dialog.confirm({
      title: `Supprimer « ${m.name} » ?`,
      message: 'Le fichier est retiré de vos médias. Les clips des projets qui l’utilisent ne pourront plus l’afficher.',
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return false;
    try {
      await deleteMedia(m.id);
      return true;
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
      return false;
    }
  };
}

/** Aperçu d'un média (vidéo, son ou image) dans une fenêtre. */
export function MediaPreview({ media, onClose }: { media: Media; onClose: () => void }) {
  const [bust, setBust] = useState(() => encodeURIComponent(media.updatedAt || media.id));
  const audioRef = useRef<HTMLAudioElement>(null);
  const src = `${absoluteFileUrl(media.url)}${media.url.includes('?') ? '&' : '?'}v=${bust}`;

  useEffect(() => {
    if (sharedAudio) {
      sharedAudio.pause();
      sharedAudio = null;
      notifySharedAudio(null);
    }
    if (media.kind === 'audio' && audioRef.current) {
      audioRef.current.load();
      audioRef.current.play().catch(() => { });
    }
  }, [media.id, media.kind, bust]);

  return (
    <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl bg-zinc-950 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-white truncate">{media.name}</p>
          <button onClick={onClose} className="text-zinc-500 hover:text-white" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>
        {media.kind === 'video' && (
          <video
            key={src}
            src={src}
            controls
            autoPlay
            preload="auto"
            onError={() => {
              if (!String(bust).startsWith('retry-')) setBust(`retry-${Date.now()}`);
            }}
            className="w-full max-h-[70vh] rounded-xl bg-black"
          />
        )}
        {media.kind === 'audio' && (
          <audio
            ref={audioRef}
            key={src}
            src={src}
            controls
            autoPlay
            preload="auto"
            onError={() => {
              if (!String(bust).startsWith('retry-')) setBust(`retry-${Date.now()}`);
            }}
            className="w-full"
          />
        )}
        {media.kind === 'image' && <img src={src} alt="" className="w-full max-h-[70vh] object-contain rounded-xl bg-black" />}
        <p className="text-[11px] text-zinc-500">
          {media.kind !== 'image' && `${formatTime(media.duration, media.duration < 10)} · `}
          {media.kind !== 'audio' && `${media.width}×${media.height} · `}
          {formatFileSize(media.size)}
        </p>
      </div>
    </div>
  );
}

/**
 * Tuile média : clic = sélection pour l'IA ; ▶ écouter / regarder ; + ajouter au
 * montage (ou glisser dans la timeline) ; 🗑 supprimer.
 */
export function MediaTile({
  media: m,
  selected,
  onToggle,
  onPreview,
  onDelete,
  onAdd,
  rounded = 'rounded-lg',
}: {
  media: Media;
  selected: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onAdd?: () => void;
  rounded?: string;
}) {
  const Icon = m.kind === 'video' ? Film : m.kind === 'image' ? ImageIcon : Music;
  const [playing, setPlaying] = useState(() => sharedAudioId === m.id);

  useEffect(() => {
    if (m.kind !== 'audio') return;
    const listener = (id: string | null) => setPlaying(id === m.id);
    sharedListeners.add(listener);
    return () => {
      sharedListeners.delete(listener);
    };
  }, [m.id, m.kind]);

  return (
    <div
      draggable={!!onAdd}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, JSON.stringify({ type: 'media', media: m }));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className={`group relative ${rounded} overflow-hidden border ${selected ? 'border-fuchsia-500 ring-2 ring-fuchsia-500/40' : 'border-white/10 hover:border-white/30'}`}
    >
      <button onClick={onToggle} className="block w-full text-left" title={selected ? 'Retirer de la sélection' : 'Sélectionner pour l’IA'}>
        <div className="aspect-video bg-black flex items-center justify-center relative">
          {m.kind === 'audio' ? (
            <div className="flex flex-col items-center gap-1.5">
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  toggleInlineAudio(m);
                }}
                role="button"
                tabIndex={0}
                title={playing ? 'Arrêter la lecture' : 'Écouter le son'}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${playing ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/30' : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500 hover:text-black'
                  }`}
              >
                {playing ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-4 h-4 ml-0.5 fill-current" />}
              </span>
              {playing && (
                <span className="text-[9px] font-semibold text-emerald-400 flex items-center gap-1">
                  <Volume2 className="w-2.5 h-2.5 animate-pulse" /> Lecture…
                </span>
              )}
            </div>
          ) : (
            <img src={m.kind === 'image' ? absoluteFileUrl(m.url) : mediaThumbnailUrl(m.id)} alt="" className="w-full h-full object-cover" />
          )}
        </div>
        <div className="px-1.5 py-1 flex items-center gap-1">
          <Icon className="w-3 h-3 text-zinc-500 flex-shrink-0" />
          <span className="text-[10px] text-zinc-300 truncate flex-1">{m.name}</span>
          {m.kind !== 'image' && <span className="text-[9px] font-mono text-zinc-500">{formatTime(m.duration)}</span>}
        </div>
      </button>
      {selected && (
        <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-fuchsia-500 flex items-center justify-center pointer-events-none">
          <Check className="w-3 h-3 text-white" />
        </span>
      )}
      <div className="absolute top-1 left-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => (m.kind === 'audio' ? toggleInlineAudio(m) : onPreview())}
          className="w-6 h-6 rounded-full bg-black/75 text-white flex items-center justify-center hover:bg-white hover:text-black"
          title={m.kind === 'audio' ? (playing ? 'Arrêter' : 'Écouter') : 'Regarder'}
        >
          {m.kind === 'audio' && playing ? <Square className="w-2.5 h-2.5 fill-current" /> : <Play className="w-3 h-3 ml-0.5" />}
        </button>
        {onAdd && (
          <button onClick={onAdd} className="w-6 h-6 rounded-full bg-cyan-500 text-white flex items-center justify-center hover:bg-cyan-400" title="Ajouter au montage (ou glissez dans la timeline)">
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={onDelete} className="w-6 h-6 rounded-full bg-black/75 text-zinc-300 flex items-center justify-center hover:bg-red-500 hover:text-white" title="Supprimer">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

/**
 * Actions groupées sur la médiathèque : tout sélectionner / désélectionner,
 * supprimer la sélection, tout supprimer (avec confirmation).
 */
export function BulkMediaBar({
  media,
  selected,
  onSelect,
  onDeleted,
}: {
  media: Media[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  onDeleted: (ids: string[]) => void;
}) {
  const dialog = useDialog();
  const { showToast } = useToast();
  const allSelected = media.length > 0 && media.every((m) => selected.includes(m.id));

  const removeIds = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    const ok = await dialog.confirm({
      title: `${label} (${ids.length}) ?`,
      message: 'Les fichiers sont retirés de vos médias. Les clips des projets qui les utilisent ne pourront plus les afficher.',
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    try {
      const { deleted } = await deleteManyMedia(ids);
      onDeleted(ids);
      showToast({ type: 'success', message: `${deleted} média(s) supprimé(s).` });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
    }
  };

  if (media.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => onSelect(allSelected ? [] : media.map((m) => m.id))}
        className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-2 py-1"
      >
        <CheckCheck className="w-3 h-3" /> {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
      </button>
      {selected.length > 0 && (
        <button
          onClick={() => removeIds(selected.filter((id) => media.some((m) => m.id === id)), 'Supprimer la sélection')}
          className="flex items-center gap-1 text-[11px] text-red-300 hover:text-white hover:bg-red-500 border border-red-500/40 rounded-md px-2 py-1"
        >
          <Trash2 className="w-3 h-3" /> Supprimer la sélection ({selected.length})
        </button>
      )}
      <button
        onClick={() => removeIds(media.map((m) => m.id), 'Supprimer tous les médias')}
        className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-red-300 rounded-md px-2 py-1"
      >
        <Trash2 className="w-3 h-3" /> Tout supprimer
      </button>
    </div>
  );
}
