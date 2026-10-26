'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Plus, Music, RefreshCw } from 'lucide-react';
import UploadDropzone from '@/components/media/UploadDropzone';
import { getSfx, listMedia, absoluteFileUrl } from '@/lib/api';
import type { Media, SfxItem } from '@/lib/types';
import { useEditor, useEditorStore } from '../store';
import { DND_MIME } from '../engineContext';
import { formatTime } from '@/components/ui/controls';

export default function AudioPanel() {
  const store = useEditorStore();
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const selectedAudio = selection.clipIds.length === 1 ? project.clips.find((c) => c.id === selection.clipIds[0] && c.type === 'audio') || null : null;
  const [sfx, setSfx] = useState<SfxItem[]>([]);
  const [audio, setAudio] = useState<Media[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    getSfx().then(setSfx).catch(() => { });
    listMedia()
      .then((m) => setAudio(m.filter((x) => x.kind === 'audio')))
      .catch(() => { });
    return () => player.current?.pause();
  }, []);

  const preview = (id: string, url: string) => {
    if (playing === id) {
      player.current?.pause();
      setPlaying(null);
      return;
    }
    player.current?.pause();
    const bustUrl = `${absoluteFileUrl(url)}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(id)}`;
    const a = new Audio(bustUrl);
    a.onended = () => setPlaying(null);
    a.onerror = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    player.current = a;
    setPlaying(id);
  };

  const groups = useMemo(() => {
    const map = new Map<string, SfxItem[]>();
    for (const s of sfx) map.set(s.category, [...(map.get(s.category) || []), s]);
    return [...map.entries()];
  }, [sfx]);

  const Row = ({ id, name, url, duration, onAdd, onReplace, drag }: { id: string; name: string; url: string; duration: number; onAdd: () => void; onReplace?: () => void; drag: string }) => (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, drag);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 group cursor-grab"
    >
      <button onClick={() => preview(id, url)} className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center flex-shrink-0" aria-label="Écouter">
        {playing === id ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
      </button>
      <span className="text-xs text-zinc-200 truncate flex-1">{name}</span>
      <span className="text-[10px] font-mono text-zinc-500">{formatTime(duration, true)}</span>
      {onReplace && (
        <button
          onClick={onReplace}
          className="px-2 h-6 rounded-full bg-amber-500/20 hover:bg-amber-500/40 border border-amber-400/40 text-amber-200 text-[10px] font-bold flex items-center gap-1"
          title={`Remplacer « ${selectedAudio?.name} » par ce son`}
        >
          <RefreshCw className="w-2.5 h-2.5" /> Remplacer
        </button>
      )}
      <button onClick={onAdd} className="w-6 h-6 rounded-full bg-cyan-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100" aria-label="Ajouter" title="Ajouter à la timeline">
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {selectedAudio && (
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-2.5 text-xs text-cyan-200">
          Son sélectionné : <b className="text-white">{selectedAudio.name}</b>. Cliquez sur <b>Remplacer</b> à côté d'un son pour l'échanger, ou sur <b>+</b> pour en ajouter un autre.
        </div>
      )}
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-1.5">
          <Music className="w-3.5 h-3.5" /> Musique & sons importés
        </h3>
        <UploadDropzone compact accept="audio/*,video/*" onUploaded={(list) => setAudio((a) => [...list.filter((m) => m.kind === 'audio'), ...a])} title="Importer une musique" subtitle="MP3, WAV, M4A…" />
        <div className="mt-2 flex flex-col">
          {audio.map((m) => (
            <Row
              key={m.id}
              id={m.id}
              name={m.name}
              url={m.url}
              duration={m.duration}
              onAdd={() => store.addMedia(m)}
              onReplace={selectedAudio ? () => store.replaceClipAudio(selectedAudio.id, { id: m.id, name: m.name, src: m.url, duration: m.duration }) : undefined}
              drag={JSON.stringify({ type: 'media', media: m })}
            />
          ))}
        </div>
      </div>
      {groups.map(([category, items]) => (
        <div key={category}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Effets sonores · {category}</h3>
          {items.map((s) => (
            <Row
              key={s.id}
              id={s.id}
              name={s.name}
              url={s.url}
              duration={s.duration}
              onAdd={() => store.addMedia({ ...s, kind: 'audio' } as any)}
              onReplace={selectedAudio ? () => store.replaceClipAudio(selectedAudio.id, { id: s.id, name: s.name, src: s.url, duration: s.duration }) : undefined}
              drag={JSON.stringify({ type: 'sfx', sfx: s })}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
