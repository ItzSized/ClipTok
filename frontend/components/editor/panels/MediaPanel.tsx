'use client';

import { useEffect, useState } from 'react';
import { Plus, Film, Image as ImageIcon, Music, Trash2, Loader2 } from 'lucide-react';
import UploadDropzone from '@/components/media/UploadDropzone';
import { listMedia, deleteMedia, getClips, importClipAsMedia, mediaThumbnailUrl, absoluteFileUrl } from '@/lib/api';
import type { ClipResult, Media } from '@/lib/types';
import { useEditorStore } from '../store';
import { DND_MIME } from '../engineContext';
import { useToast } from '@/components/ToastProvider';
import { useDialog } from '@/components/DialogProvider';
import { formatTime, Segmented } from '@/components/ui/controls';

export function MediaTile({ media, onAdd, onDelete }: { media: Media; onAdd: () => void; onDelete?: () => void }) {
  const Icon = media.kind === 'video' ? Film : media.kind === 'image' ? ImageIcon : Music;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, JSON.stringify({ type: 'media', media }));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={onAdd}
      className="group relative rounded-lg overflow-hidden bg-zinc-800 border border-white/10 hover:border-cyan-400/60 cursor-grab"
      title={`${media.name} — glissez dans la timeline ou double-cliquez`}
    >
      <div className="aspect-video bg-black flex items-center justify-center">
        {media.kind === 'audio' ? (
          <Music className="w-6 h-6 text-emerald-400" />
        ) : (
          <img src={media.kind === 'image' ? absoluteFileUrl(media.url) : mediaThumbnailUrl(media.id)} alt="" className="w-full h-full object-cover" draggable={false} />
        )}
      </div>
      <div className="px-1.5 py-1 flex items-center gap-1">
        <Icon className="w-3 h-3 text-zinc-500 flex-shrink-0" />
        <span className="text-[10px] text-zinc-300 truncate flex-1">{media.name}</span>
        {media.kind !== 'image' && <span className="text-[9px] font-mono text-zinc-500">{formatTime(media.duration)}</span>}
      </div>
      <button onClick={onAdd} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-cyan-500 text-white items-center justify-center hidden group-hover:flex shadow" aria-label="Ajouter à la timeline">
        <Plus className="w-3.5 h-3.5" />
      </button>
      {onDelete && (
        <button onClick={onDelete} className="absolute top-1 left-1 w-6 h-6 rounded-full bg-black/70 text-zinc-300 hover:text-red-400 items-center justify-center hidden group-hover:flex" aria-label="Supprimer le média">
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export default function MediaPanel() {
  const store = useEditorStore();
  const { showToast } = useToast();
  const dialog = useDialog();
  const [tab, setTab] = useState<'imported' | 'clips'>('imported');
  const [media, setMedia] = useState<Media[] | null>(null);
  const [clips, setClips] = useState<ClipResult[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    listMedia().then(setMedia).catch(() => setMedia([]));
    getClips().then(setClips).catch(() => {});
  }, []);

  const visual = (media || []).filter((m) => m.kind !== 'audio');

  return (
    <div className="flex flex-col gap-3">
      <UploadDropzone compact onUploaded={(list) => setMedia((m) => [...list, ...(m || [])])} title="Importer des fichiers" subtitle="Vidéos, images, sons" />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'imported', label: 'Importés' },
          { value: 'clips', label: 'Mes clips IA' },
        ]}
      />
      {tab === 'imported' ? (
        media === null ? (
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500 mx-auto mt-6" />
        ) : visual.length === 0 ? (
          <p className="text-xs text-zinc-500 text-center py-6">Aucun média importé.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {visual.map((m) => (
              <MediaTile
                key={m.id}
                media={m}
                onAdd={() => store.addMedia(m)}
                onDelete={async () => {
                  if (!(await dialog.confirm({ title: `Supprimer « ${m.name} » ?`, message: 'Le fichier sera retiré de vos médias. Les projets qui l’utilisent ne pourront plus l’afficher.', danger: true, confirmLabel: 'Supprimer' }))) return;
                  await deleteMedia(m.id);
                  setMedia((list) => (list || []).filter((x) => x.id !== m.id));
                }}
              />
            ))}
          </div>
        )
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {clips.map((c) => (
            <button
              key={c.id}
              disabled={busy !== null}
              onClick={async () => {
                setBusy(c.id);
                try {
                  const m = await importClipAsMedia(c.id);
                  store.addMedia(m);
                  setMedia((list) => (list && !list.some((x) => x.id === m.id) ? [m, ...list] : list));
                } catch (err: any) {
                  showToast({ type: 'error', message: err.message });
                } finally {
                  setBusy(null);
                }
              }}
              className="relative aspect-[9/16] rounded-lg overflow-hidden border border-white/10 hover:border-cyan-400 bg-black"
              title={c.title}
            >
              <video src={absoluteFileUrl(c.videoUrl)} muted preload="metadata" className="w-full h-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 p-1 text-[9px] text-white bg-gradient-to-t from-black to-transparent line-clamp-2 text-left">{c.title}</span>
              {busy === c.id && (
                <span className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                </span>
              )}
            </button>
          ))}
          {clips.length === 0 && <p className="col-span-3 text-xs text-zinc-500 text-center py-6">Aucun clip généré pour l'instant.</p>}
        </div>
      )}
    </div>
  );
}
