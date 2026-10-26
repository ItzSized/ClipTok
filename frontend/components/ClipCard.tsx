'use client';

import { useRef } from 'react';
import { Star, Download, Trash2, Crown, Maximize2, Copy } from 'lucide-react';
import { absoluteFileUrl } from '@/lib/api';
import type { ClipResult } from '@/lib/types';
import { useToast } from '@/components/ToastProvider';

interface ClipCardProps {
  clip: ClipResult;
  isTopPick?: boolean;
  onOpenDetail: () => void;
  onDelete: () => void;
}

export default function ClipCard({ clip, isTopPick, onOpenDetail, onDelete }: ClipCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { showToast } = useToast();

  const handleCopyCaption = (e: React.MouseEvent) => {
    e.stopPropagation();
    let text = clip.caption || clip.title;
    if (clip.hashtags && clip.hashtags.length > 0) {
      text += '\n\n' + clip.hashtags.map(h => `#${h}`).join(' ');
    }
    navigator.clipboard.writeText(text).then(() => {
      showToast({ type: 'success', message: 'Légende copiée pour les réseaux !' });
    });
  };
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', clip.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onOpenDetail}
      onMouseEnter={() => videoRef.current?.play().catch(() => {})}
      onMouseLeave={() => {
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
        }
      }}
      className="group flex flex-col bg-white/5 border border-white/10 rounded-3xl overflow-hidden hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer hover:shadow-[0_0_20px_rgba(255,255,255,0.05)]"
    >
      <div className="w-full aspect-[9/16] bg-black relative">
        <video ref={videoRef} src={absoluteFileUrl(clip.videoUrl)} muted playsInline loop className="w-full h-full object-cover" />

        {isTopPick && (
          <div className="absolute top-4 left-4 px-2.5 py-1 bg-gradient-to-r from-fuchsia-500 to-orange-400 rounded-full flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-white shadow-xl">
            <Crown className="w-3 h-3" /> Top pick
          </div>
        )}

        <div className="absolute top-4 right-4 px-3 py-1 bg-black/60 backdrop-blur-md rounded-full border border-white/10 flex items-center gap-1.5 text-xs font-bold shadow-xl pointer-events-none">
          <Star className="w-3.5 h-3.5 text-orange-400 fill-orange-400" />
          <span className="text-white">{clip.viralityScore}</span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail();
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
          aria-label="Agrandir"
        >
          <Maximize2 className="w-8 h-8 text-white drop-shadow-lg" />
        </button>
      </div>

      <div className="p-5 flex flex-col flex-1">
        <h3 className="text-base font-bold text-white line-clamp-2 leading-tight mb-2 group-hover:text-fuchsia-300 transition-colors">
          {clip.title}
        </h3>
        
        <div 
          onClick={handleCopyCaption}
          className="text-xs text-zinc-400 mb-4 flex-1 hover:text-fuchsia-300 transition-colors flex items-start gap-2 group/caption cursor-pointer"
          title="Copier la légende pour TikTok/Reels"
        >
          <p className="flex-1 line-clamp-2">{clip.caption || clip.reason}</p>
          <Copy className="w-3.5 h-3.5 opacity-0 group-hover/caption:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
        </div>

        {clip.hashtags && clip.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {clip.hashtags.slice(0, 4).map((h) => (
              <span key={h} className="text-[10px] font-medium text-fuchsia-300/80 bg-fuchsia-500/10 px-2 py-0.5 rounded-full">
                #{h}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 mt-auto">
          <span className="text-xs font-medium text-zinc-600 bg-black/30 px-2 py-1 rounded w-fit">
            {clip.clipStart.toFixed(0)}s - {clip.clipEnd.toFixed(0)}s (Durée: {Math.round(clip.clipEnd - clip.clipStart)}s)
          </span>
          <div className="flex gap-2 justify-between items-center mt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-red-400 px-3 py-2 rounded-full hover:bg-red-500/10 transition-colors"
              aria-label="Supprimer le clip"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <div className="flex gap-2">
              {clip.audioUrl && (
                <a
                  href={absoluteFileUrl('/api/download?url=' + encodeURIComponent(clip.audioUrl))}
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-xs font-bold bg-zinc-800 text-zinc-200 px-3 py-2 rounded-full hover:bg-zinc-700 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  MP3
                </a>
              )}
              <a
                href={absoluteFileUrl('/api/download?url=' + encodeURIComponent(clip.videoUrl))}
                download
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 text-xs font-bold bg-white text-black px-4 py-2 rounded-full hover:bg-fuchsia-100 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                MP4
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
