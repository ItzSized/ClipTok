'use client';

import { useEffect, useRef, useState } from 'react';
import { Undo2, Redo2, Scissors, Trash2, Copy, Snowflake, Unlink, Magnet, ZoomIn, ZoomOut, Maximize2, Loader2, Volume2, VolumeX, RefreshCw, Play, Square, Plus, Upload } from 'lucide-react';
import * as core from '@shared/editorCore';
import { useEditor, useEditorStore, isSfxTrack } from './store';
import { useEngine } from './engineContext';
import { uploadMedia, listMedia, getSfx, absoluteFileUrl } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';
import { formatTime } from '@/components/ui/controls';
import type { Media, SfxItem } from '@/lib/types';

function ToolButton({ onClick, disabled, title, children, active }: { onClick: () => void; disabled?: boolean; title: string; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-2 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${active ? 'text-cyan-300 bg-cyan-500/10' : 'text-zinc-300 hover:text-white hover:bg-white/10'}`}
    >
      {children}
    </button>
  );
}

export default function Toolbar({ timelineWidth }: { timelineWidth: number }) {
  const store = useEditorStore();
  const engine = useEngine();
  const { showToast } = useToast();
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const zoom = useEditor((s) => s.zoom);
  const snapping = useEditor((s) => s.snapping);
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const [freezing, setFreezing] = useState(false);
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const [audioSearch, setAudioSearch] = useState('');
  const [audioMedia, setAudioMedia] = useState<Media[]>([]);
  const [sfxList, setSfxList] = useState<SfxItem[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const selected = selection.clipIds.length === 1 ? project.clips.find((c) => c.id === selection.clipIds[0]) : null;
  const selectedTrack = selected ? project.tracks.find((t) => t.id === selected.trackId) : null;
  const videoAtPlayhead = selected?.type === 'video' && engine.time >= selected.start && engine.time < core.clipEnd(selected) ? selected : null;
  const hasSelection = selection.clipIds.length > 0 || Boolean(selection.transitionId);

  useEffect(() => {
    setShowAudioPicker(false);
    previewRef.current?.pause();
    setPlayingId(null);
  }, [selected?.id]);

  useEffect(() => {
    if (!showAudioPicker) return;
    listMedia().then((m) => setAudioMedia(m.filter((x) => x.kind === 'audio'))).catch(() => {});
    getSfx().then(setSfxList).catch(() => {});
  }, [showAudioPicker]);

  const togglePreview = (id: string, url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingId === id) {
      previewRef.current?.pause();
      setPlayingId(null);
      return;
    }
    previewRef.current?.pause();
    const a = new Audio(absoluteFileUrl(url));
    a.onended = () => setPlayingId(null);
    a.onerror = () => setPlayingId(null);
    a.play().catch(() => setPlayingId(null));
    previewRef.current = a;
    setPlayingId(id);
  };

  const onUploadAudio = async (files: FileList | null) => {
    if (!files || !files.length || !selected) return;
    try {
      const { media } = await uploadMedia(Array.from(files));
      const first = media.find((m) => m.kind === 'audio') || media[0];
      if (first) {
        store.replaceClipAudio(selected.id, { id: first.id, name: first.name, src: first.url, duration: first.duration });
        setShowAudioPicker(false);
        showToast({ type: 'success', message: `Son remplacé par « ${first.name} »` });
      }
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
    }
  };

  /** Fige l'image courante : capture, envoi au serveur puis insertion d'une image de 2 s. */
  const freeze = async () => {
    if (!videoAtPlayhead) return;
    const canvas = engine.captureFrame(videoAtPlayhead.id);
    if (!canvas) return showToast({ type: 'error', message: "Image non disponible, réessayez après la lecture." });
    setFreezing(true);
    try {
      const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture impossible'))), 'image/png'));
      const file = new File([blob], `${videoAtPlayhead.name || 'image'} (figée).png`, { type: 'image/png' });
      const { media } = await uploadMedia([file]);
      const t = engine.time;
      store.splitAt(t);
      const id = store.addMedia(media[0], t, videoAtPlayhead.trackId);
      store.patchClip(id, (c) => {
        c.duration = 2;
        c.transform = { ...core.DEFAULT_TRANSFORM, ...(videoAtPlayhead.transform || {}) };
        c.fit = videoAtPlayhead.fit;
        c.crop = videoAtPlayhead.crop;
      });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setFreezing(false);
    }
  };

  const fit = () => {
    const d = core.projectDuration(project);
    if (d > 0) store.setZoom((timelineWidth - 220) / d);
  };

  const q = audioSearch.trim().toLowerCase();
  const filteredMedia = audioMedia.filter((m) => !q || m.name.toLowerCase().includes(q));
  const filteredSfx = sfxList.filter((s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q));
  const isSelectedSfxTrack = selectedTrack ? isSfxTrack(selectedTrack) : false;

  return (
    <div className="relative flex items-center gap-1 px-2 py-1 border-y border-white/5 bg-zinc-900/80">
      <ToolButton onClick={store.undo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
        <Undo2 className="w-4 h-4" />
      </ToolButton>
      <ToolButton onClick={store.redo} disabled={!canRedo} title="Rétablir (Ctrl+Y)">
        <Redo2 className="w-4 h-4" />
      </ToolButton>
      <div className="w-px h-5 bg-white/10 mx-1" />
      <ToolButton onClick={() => store.splitAt()} title="Couper à la tête de lecture (S)">
        <Scissors className="w-4 h-4" />
      </ToolButton>
      <ToolButton onClick={() => store.deleteSelection()} disabled={!hasSelection} title="Supprimer (Suppr)">
        <Trash2 className="w-4 h-4" />
      </ToolButton>
      <ToolButton onClick={() => store.duplicateSelection()} disabled={selection.clipIds.length === 0} title="Dupliquer (Ctrl+D)">
        <Copy className="w-4 h-4" />
      </ToolButton>
      <ToolButton onClick={freeze} disabled={!videoAtPlayhead || freezing} title="Figer l'image (arrêt sur image de 2 s)">
        {freezing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Snowflake className="w-4 h-4" />}
      </ToolButton>
      <ToolButton onClick={() => selected && store.detachAudio(selected.id)} disabled={selected?.type !== 'video' || selected.hasAudio === false || selected.muted} title="Extraire l'audio">
        <Unlink className="w-4 h-4" />
      </ToolButton>

      {/* Contrôles rapides de son / musique / SFX quand un clip audio ou vidéo est sélectionné */}
      {selected && (selected.type === 'audio' || (selected.type === 'video' && selected.hasAudio !== false)) && (
        <>
          <div className="w-px h-5 bg-white/10 mx-1" />
          <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2 py-0.5">
            <button
              type="button"
              onClick={() => store.patchClip(selected.id, { muted: !selected.muted })}
              className="text-zinc-300 hover:text-white p-0.5"
              title={selected.muted ? 'Activer le son' : 'Couper le son'}
            >
              {selected.muted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-cyan-300" />}
            </button>
            <input
              type="range"
              min={0}
              max={2}
              step={0.02}
              value={selected.muted ? 0 : (selected.volume ?? 1)}
              onChange={(e) => {
                const v = Number(e.target.value);
                store.patchClip(selected.id, { volume: v, muted: v === 0 }, `vol:${selected.id}`);
              }}
              className="w-20 accent-cyan-400 h-1.5"
              title="Volume du son sélectionné (0% à 200%)"
            />
            <span className="text-[10px] font-mono text-zinc-200 w-9 text-right">
              {Math.round((selected.muted ? 0 : (selected.volume ?? 1)) * 100)}%
            </span>
          </div>

          {selected.type === 'audio' && (
            <>
              <button
                type="button"
                onClick={() => setShowAudioPicker((v) => !v)}
                className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${
                  showAudioPicker ? 'bg-cyan-500/20 border-cyan-400 text-white' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200 hover:bg-cyan-500/20'
                }`}
                title="Remplacer cette musique / voix / effet sonore par un autre"
              >
                <RefreshCw className="w-3 h-3" /> Changer le son / SFX
              </button>

              <button
                type="button"
                onClick={() => store.moveClipToRole(selected.id, isSelectedSfxTrack ? 'audio' : 'sfx')}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-200"
                title={isSelectedSfxTrack ? 'Déplacer vers une piste Audio / Musique' : 'Déplacer vers une piste Effets sonores (SFX)'}
              >
                {isSelectedSfxTrack ? '→ Piste Audio' : '→ Piste SFX'}
              </button>

              <button
                type="button"
                onClick={() => store.moveClipToRole(selected.id, isSelectedSfxTrack ? 'new_sfx' : 'new_audio')}
                className="flex items-center gap-0.5 text-[11px] font-semibold px-2 py-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200"
                title="Isoler ce son sur une nouvelle ligne en dessous"
              >
                <Plus className="w-3 h-3" /> Nouvelle ligne
              </button>
            </>
          )}
        </>
      )}

      {/* Menu déroulant pour changer le son / la musique / le SFX en 1 clic */}
      {showAudioPicker && selected?.type === 'audio' && (
        <div className="absolute left-36 bottom-full mb-1.5 z-50 w-80 bg-zinc-950 border border-white/15 rounded-xl shadow-2xl p-2.5 flex flex-col gap-2 max-h-80">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-white truncate">Remplacer « {selected.name} »</span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-[11px] font-semibold px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white flex items-center gap-1 flex-shrink-0"
            >
              <Upload className="w-3 h-3" /> Importer
            </button>
            <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => onUploadAudio(e.target.files)} />
          </div>
          <input
            value={audioSearch}
            onChange={(e) => setAudioSearch(e.target.value)}
            placeholder="Chercher un son, une musique ou un SFX..."
            className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
            autoFocus
          />
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1">
            {filteredMedia.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Vos sons & musiques</p>
                <div className="flex flex-col gap-1">
                  {filteredMedia.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => {
                        store.replaceClipAudio(selected.id, { id: m.id, name: m.name, src: m.url, duration: m.duration });
                        setShowAudioPicker(false);
                      }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-cyan-500/20 cursor-pointer text-xs"
                    >
                      <button
                        type="button"
                        onClick={(e) => togglePreview(m.id, m.url, e)}
                        className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center flex-shrink-0"
                      >
                        {playingId === m.id ? <Square className="w-2.5 h-2.5 text-cyan-300" /> : <Play className="w-2.5 h-2.5 ml-0.5 text-white" />}
                      </button>
                      <span className="truncate flex-1 text-zinc-200 font-medium">{m.name}</span>
                      <span className="text-[10px] font-mono text-zinc-500">{formatTime(m.duration || 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {filteredSfx.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Effets sonores (SFX)</p>
                <div className="flex flex-col gap-1">
                  {filteredSfx.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => {
                        store.replaceClipAudio(selected.id, { id: s.id, name: s.name, src: s.url, duration: s.duration });
                        setShowAudioPicker(false);
                      }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-emerald-500/20 cursor-pointer text-xs"
                    >
                      <button
                        type="button"
                        onClick={(e) => togglePreview(s.id, s.url, e)}
                        className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center flex-shrink-0"
                      >
                        {playingId === s.id ? <Square className="w-2.5 h-2.5 text-emerald-300" /> : <Play className="w-2.5 h-2.5 ml-0.5 text-white" />}
                      </button>
                      <span className="truncate flex-1 text-zinc-200 font-medium">{s.name}</span>
                      <span className="text-[10px] text-zinc-500">{s.category}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        <ToolButton onClick={() => store.setSnapping(!snapping)} active={snapping} title="Magnétisme">
          <Magnet className="w-4 h-4" />
        </ToolButton>
        <ToolButton onClick={() => store.setZoom(zoom / 1.3)} title="Dézoomer (-)">
          <ZoomOut className="w-4 h-4" />
        </ToolButton>
        <input type="range" min={4} max={400} value={zoom} onChange={(e) => store.setZoom(Number(e.target.value))} className="w-28 accent-cyan-500" title="Zoom de la timeline (Ctrl + molette)" />
        <ToolButton onClick={() => store.setZoom(zoom * 1.3)} title="Zoomer (+)">
          <ZoomIn className="w-4 h-4" />
        </ToolButton>
        <ToolButton onClick={fit} title="Ajuster à la fenêtre">
          <Maximize2 className="w-4 h-4" />
        </ToolButton>
      </div>
    </div>
  );
}
