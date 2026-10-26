'use client';

import { useEffect, useState } from 'react';
import { X, Download, Film, Loader2, Sparkles, Copy, Check, ExternalLink, RefreshCw } from 'lucide-react';
import * as core from '@shared/editorCore';
import type { EditorProject } from '@shared/editorCore';
import { useEditorStore } from './store';
import { useJob } from '@/hooks/useJob';
import { exportEditorProject, absoluteFileUrl, downloadUrl, generateSocialCaption } from '@/lib/api';
import { ensureAllFonts } from '@/lib/fonts';
import { rasterizeClip } from '@/lib/editor/textRaster';
import { ProgressBar, Segmented } from '@/components/ui/controls';
import { useToast } from '@/components/ToastProvider';
import type { RenderResult } from '@/lib/types';

const SHORT_SIDE = { '720p': 720, '1080p': 1080, '4k': 2160 } as const;

/**
 * Prépare le projet pour l'export : rastérise textes et stickers à la
 * résolution finale (PNG) et enregistre leur taille de calque (clip.box).
 */
/** Empreinte (FNV-1a) du projet et de la qualité : change dès qu'on modifie quoi que ce soit. */
function projectFingerprint(project: EditorProject, quality: string, exportFps: number) {
  const text = JSON.stringify(project) + '|' + quality + '|' + exportFps;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

async function prepareExport(project: EditorProject, quality: keyof typeof SHORT_SIDE, exportFps: number) {
  await ensureAllFonts();
  const copy: EditorProject = JSON.parse(JSON.stringify(project));
  copy.settings.fps = exportFps;
  const { width, height } = copy.settings;
  const R = SHORT_SIDE[quality] / Math.min(width, height);
  const rasters: Record<string, string> = {};
  for (const clip of copy.clips) {
    if (clip.type !== 'text' && clip.type !== 'sticker') continue;
    const canvas = rasterizeClip(clip, width, height, R);
    rasters[clip.id] = canvas.toDataURL('image/png');
    clip.box = { w: canvas.width / R, h: canvas.height / R };
  }
  return { project: copy, rasters };
}

export default function ExportDialog({
  projectId,
  initial,
  onClose,
  onDone,
  defaultName = '',
}: {
  projectId: string;
  initial: RenderResult | null;
  onClose: () => void;
  onDone: (r: RenderResult) => void;
  defaultName?: string;
}) {
  const store = useEditorStore();
  const { showToast } = useToast();
  const [fileName, setFileName] = useState(() => defaultName.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 100) || 'ma-video');
  const [quality, setQuality] = useState<keyof typeof SHORT_SIDE>('1080p');
  const [exportFps, setExportFps] = useState<'30' | '60'>('30');
  const [result, setResult] = useState<RenderResult | null>(initial);
  const [preparing, setPreparing] = useState(false);
  const [description, setDescription] = useState('');
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [copied, setCopied] = useState(false);
  const job = useJob<RenderResult>();
  const project = store.getState().project;
  const duration = core.projectDuration(project);
  const R = SHORT_SIDE[quality] / Math.min(project.settings.width, project.settings.height);
  const outW = Math.round((project.settings.width * R) / 2) * 2;
  const outH = Math.round((project.settings.height * R) / 2) * 2;
  const fingerprint = projectFingerprint(project, quality, Number(exportFps));
  const upToDate = !!result && (result.fingerprint === fingerprint || result.fingerprint === projectFingerprint(project, quality, project.settings.fps));

  const generateCaption = async () => {
    setGeneratingDesc(true);
    try {
      const p = store.getState().project;
      const transcript = p.clips
        .filter((c) => c.type === 'caption' || c.type === 'text')
        .map((c) => (c.type === 'caption' ? (c.words || []).map((w) => w.text).join(' ') : c.text || ''))
        .join(' ')
        .trim();
      const clipNames = p.clips.filter((c) => c.type === 'video').map((c) => c.name || '').filter(Boolean);
      const res = await generateSocialCaption({
        title: fileName || defaultName,
        transcript,
        clipNames,
        duration,
      });
      setDescription(res.description || '');
    } catch {
      setDescription(`${fileName || 'Nouvelle vidéo'} 🔥👀\n\n#fyp #pourtoi #viral #shorts #reels #tiktok`);
    } finally {
      setGeneratingDesc(false);
    }
  };

  useEffect(() => {
    generateCaption();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyDescription = async (silent = false) => {
    if (!description.trim()) return;
    try {
      await navigator.clipboard.writeText(description);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      if (!silent) showToast({ type: 'success', message: 'Description et hashtags copiés !' });
    } catch { }
  };

  const openSocial = async (platform: 'tiktok' | 'youtube' | 'instagram', url: string) => {
    await copyDescription(true);
    const label = platform === 'tiktok' ? 'TikTok Studio' : platform === 'youtube' ? 'YouTube Studio' : 'Instagram';
    showToast({ type: 'success', message: `Description copiée ! Faites Ctrl+V sur ${label}.` });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const start = async () => {
    setPreparing(true);
    let payload: Awaited<ReturnType<typeof prepareExport>>;
    try {
      payload = await prepareExport(store.getState().project, quality, Number(exportFps));
    } catch (err: any) {
      setPreparing(false);
      job.clearError();
      alert(`Préparation de l'export impossible : ${err.message}`);
      return;
    }
    setPreparing(false);
    const r = await job.run(() => exportEditorProject(projectId, { project: payload.project, quality, rasters: payload.rasters, fingerprint }));
    if (r) {
      setResult(r);
      onDone(r);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-zinc-950 border border-white/10 rounded-3xl p-6 flex flex-col gap-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Film className="w-5 h-5 text-cyan-400" /> Exporter & Publier
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-zinc-400">Résolution</span>
            <Segmented
              value={quality}
              onChange={setQuality}
              options={[
                { value: '720p', label: '720p' },
                { value: '1080p', label: '1080p' },
                { value: '4k', label: '4K' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-zinc-400">Cadence (Vitesse de rendu)</span>
            <Segmented
              value={exportFps}
              onChange={setExportFps}
              options={[
                { value: '30', label: '30 i/s (⚡ 2x plus rapide)' },
                { value: '60', label: '60 i/s' },
              ]}
            />
          </div>
        </div>
        <p className="text-[11px] text-zinc-500 -mt-2">
          {outW}×{outH} · {exportFps} i/s · {duration.toFixed(1)} s · MP4 H.264 + AAC
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-zinc-400">Nom du fichier</span>
          <div className="flex items-center bg-black/40 border border-white/10 rounded-xl focus-within:border-cyan-500">
            <input
              value={fileName}
              onChange={(e) => setFileName(e.target.value.replace(/[\\/:*?"<>|]/g, ''))}
              placeholder="ma-video"
              className="flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none"
            />
            <span className="pr-3 text-xs text-zinc-500">.mp4</span>
          </div>
        </div>

        {preparing && (
          <p className="text-xs text-zinc-400 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Préparation des textes et stickers…
          </p>
        )}
        {job.running && (
          <div className="flex flex-col gap-2">
            <ProgressBar percent={job.percent} message={job.message} />
            <button onClick={job.cancel} className="text-xs font-bold text-red-400 self-end">
              Annuler
            </button>
          </div>
        )}
        {job.error && <p className="text-xs text-red-400 whitespace-pre-wrap max-h-40 overflow-auto bg-red-500/5 rounded-lg p-2">{job.error}</p>}

        {!job.running && !preparing && (
          <button onClick={start} disabled={duration <= 0} className="py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-400 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40">
            <Film className="w-4 h-4" /> {!result ? 'Lancer l’export' : upToDate ? 'Exporter à nouveau' : 'Exporter la nouvelle version'}
          </button>
        )}

        {result && !job.running && !upToDate && (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
            Le projet a été modifié depuis le dernier export : lancez l’export pour obtenir la nouvelle version. L’ancien fichier reste téléchargeable ci-dessous.
          </p>
        )}

        {result && !job.running && (
          <div className={`flex flex-col gap-2 border-t border-white/5 pt-3 ${upToDate ? '' : 'opacity-60'}`}>
            <video src={absoluteFileUrl(result.videoUrl)} controls className="w-full max-h-60 rounded-xl bg-black" />
            <a href={downloadUrl(result.videoUrl, fileName.trim() || 'ma-video')} className="py-2.5 rounded-xl bg-white text-black text-sm font-bold text-center hover:bg-zinc-200 flex items-center justify-center gap-2">
              <Download className="w-4 h-4" /> {upToDate ? 'Télécharger' : 'Télécharger l’ancienne version'} « {(fileName.trim() || 'ma-video') + '.mp4'} »
            </a>
            <p className="text-[11px] text-zinc-600 text-center">
              Export du {new Date(result.createdAt).toLocaleString('fr-FR')} {result.quality ? `· ${result.quality}` : ''}
            </p>
          </div>
        )}

        {/* Description générée automatiquement + Liens directs de publication */}
        <div className="border-t border-white/10 pt-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" /> Description & Hashtags (auto)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={generateCaption}
                disabled={generatingDesc}
                className="text-[11px] font-semibold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1 flex items-center gap-1"
                title="Régénérer la description avec l'IA"
              >
                <RefreshCw className={`w-3 h-3 ${generatingDesc ? 'animate-spin' : ''}`} /> Régénérer
              </button>
              <button
                type="button"
                onClick={() => copyDescription(false)}
                className="text-[11px] font-bold text-cyan-300 hover:text-white bg-cyan-500/15 hover:bg-cyan-500/30 border border-cyan-500/30 rounded-lg px-2.5 py-1 flex items-center gap-1"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copié !' : 'Copier'}
              </button>
            </div>
          </div>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={generatingDesc ? 'Génération de la description et des hashtags en cours…' : 'Description pour TikTok, YouTube Shorts et Instagram Reels…'}
            className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-200 outline-none focus:border-fuchsia-500 resize-y"
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-zinc-400">Poster directement (copie la description automatiquement) :</span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => openSocial('tiktok', 'https://www.tiktok.com/tiktokstudio/upload')}
                className="py-2 px-2.5 rounded-xl bg-gradient-to-r from-zinc-900 to-zinc-800 hover:from-pink-600/30 hover:to-cyan-500/30 border border-white/15 hover:border-pink-400/50 text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-all"
              >
                <span>🎵</span> TikTok <ExternalLink className="w-3 h-3 opacity-70" />
              </button>
              <button
                type="button"
                onClick={() => openSocial('youtube', 'https://studio.youtube.com/')}
                className="py-2 px-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/30 border border-red-500/30 hover:border-red-400 text-xs font-bold text-red-200 hover:text-white flex items-center justify-center gap-1.5 transition-all"
              >
                <span>▶️</span> YouTube Shorts <ExternalLink className="w-3 h-3 opacity-70" />
              </button>
              <button
                type="button"
                onClick={() => openSocial('instagram', 'https://www.instagram.com/')}
                className="py-2 px-2.5 rounded-xl bg-gradient-to-r from-fuchsia-500/15 to-amber-500/15 hover:from-fuchsia-500/30 hover:to-amber-500/30 border border-fuchsia-500/30 hover:border-fuchsia-400 text-xs font-bold text-fuchsia-200 hover:text-white flex items-center justify-center gap-1.5 transition-all"
              >
                <span>📸</span> Instagram Reels <ExternalLink className="w-3 h-3 opacity-70" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
