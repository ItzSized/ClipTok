'use client';

import { useEffect, useState } from 'react';
import { Play, Sparkles, Zap, Settings2, CheckCircle2, Loader2, Clock, FolderOpen, History, FileUp } from 'lucide-react';
import { useGenerateClip } from '@/hooks/useGenerateClip';
import { getJSON, setJSON, pushRecentUrl, RECENT_URLS_KEY, GENERATOR_SETTINGS_KEY } from '@/lib/storage';
import { uploadCookies, getAiProviders, type AiProvider } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';
import type { ClipResult, SpeedMode, VideoFormat, VideoQuality } from '@/lib/types';
import { PRESETS as CAPTION_PRESETS } from '@shared/captionEngine';

interface GeneratorSettings {
  quality: VideoQuality;
  targetDuration: string;
  speedMode: SpeedMode;
  withSubtitles: boolean;
  captionStyle: string;
  aiProvider: string;
  videoFormat: VideoFormat;
  clipCount: number;
  videoSpeed: number;
}

const DEFAULT_SETTINGS: GeneratorSettings = {
  quality: '1080p',
  targetDuration: '60',
  speedMode: 'fast',
  withSubtitles: true,
  captionStyle: 'classic',
  aiProvider: 'auto',
  videoFormat: 'portrait',
  clipCount: 0,
  videoSpeed: 1.0,
};

interface GeneratorFormProps {
  projectId?: string;
  onComplete: (clips: ClipResult[], projectId: string) => void;
}

const STEPS = [
  { id: 1, name: 'Téléchargement' },
  { id: 2, name: 'Analyse IA' },
  { id: 3, name: 'Curation' },
  { id: 4, name: 'Rendu HD' },
];

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function GeneratorForm({ projectId, onComplete }: GeneratorFormProps) {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [recentUrls, setRecentUrls] = useState<string[]>([]);
  const [settings, setSettings] = useState<GeneratorSettings>(DEFAULT_SETTINGS);
  const [uploadingCookies, setUploadingCookies] = useState(false);
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const { showToast } = useToast();

  useEffect(() => {
    // Fusion avec les défauts : les anciens réglages enregistrés n'ont pas les nouvelles options.
    setSettings({ ...DEFAULT_SETTINGS, ...getJSON<Partial<GeneratorSettings>>(GENERATOR_SETTINGS_KEY, {}) });
    setRecentUrls(getJSON<string[]>(RECENT_URLS_KEY, []));
    getAiProviders()
      .then((list) => setAiProviders(list.filter((p) => p.configured)))
      .catch(() => {});
  }, []);

  const updateSetting = <K extends keyof GeneratorSettings>(key: K, value: GeneratorSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      setJSON(GENERATOR_SETTINGS_KEY, next);
      return next;
    });
  };

  const {
    loading,
    error,
    currentStep,
    stepMessage,
    stepPercent,
    estimatedTime,
    elapsedTime,
    renderProgress,
    generate,
    cancel,
    reset,
  } = useGenerateClip((clips, newProjectId) => {
    setYoutubeUrl('');
    onComplete(clips, newProjectId);
  });

  const handleGenerate = () => {
    if (!youtubeUrl.trim()) return;
    setRecentUrls(pushRecentUrl(youtubeUrl.trim()));
    generate({
      youtubeUrl: youtubeUrl.trim(),
      quality: settings.quality,
      targetDuration: Number(settings.targetDuration),
      speedMode: settings.speedMode,
      withSubtitles: settings.withSubtitles,
      captionStyle: settings.captionStyle,
      aiProvider: settings.aiProvider === 'auto' ? undefined : settings.aiProvider,
      format: settings.videoFormat,
      clipCount: settings.clipCount === 0 ? 'auto' : settings.clipCount,
      videoSpeed: settings.videoSpeed,
      projectId,
    });
  };

  const handleCookieUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadingCookies(true);
    try {
      const text = await file.text();
      await uploadCookies(text);
      showToast({ type: 'success', message: 'Cookies uploadés ! Vous pouvez relancer la génération.' });
      reset(); // Clear error state so they can try again
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur lors de l\'upload' });
    } finally {
      setUploadingCookies(false);
    }
  };

  return (
    <div className="w-full">
      <div className="w-full bg-white/5 border border-white/10 backdrop-blur-xl p-6 sm:p-8 rounded-3xl shadow-2xl mb-12">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-fuchsia-400" />
            Créer un clip viral
          </h2>
          <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 px-3 py-1.5 rounded-full w-fit">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
            <span className="text-xs font-bold text-green-400 uppercase tracking-wide">NVIDIA RTX Active</span>
          </div>
        </div>

        <div className="relative mb-3">
          <input
            type="text"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) {
                e.preventDefault();
                handleGenerate();
              }
            }}
            placeholder="Collez une URL YouTube pour extraire des clips..."
            disabled={loading}
            className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-5 text-lg outline-none focus:border-fuchsia-500/50 focus:ring-4 focus:ring-fuchsia-500/10 transition-all disabled:opacity-50 text-white placeholder-zinc-600"
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
            <Play className="w-6 h-6 text-zinc-600" />
          </div>
        </div>

        {recentUrls.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-6">
            <History className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
            {recentUrls.map((url) => (
              <button
                key={url}
                onClick={() => setYoutubeUrl(url)}
                disabled={loading}
                title={url}
                className="text-xs text-zinc-400 bg-white/5 hover:bg-white/10 hover:text-white border border-white/10 px-3 py-1.5 rounded-full transition-colors max-w-[220px] truncate disabled:opacity-50"
              >
                {url.replace(/^https?:\/\/(www\.)?/, '')}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              <Clock className="w-4 h-4" /> Durée cible
            </label>
            <select
              value={settings.targetDuration}
              onChange={(e) => updateSetting('targetDuration', e.target.value)}
              disabled={loading}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-fuchsia-500 transition-colors disabled:opacity-50 text-white appearance-none cursor-pointer hover:bg-black/60"
            >
              <option value="30">30 Secondes (Rapide)</option>
              <option value="45">45 Secondes</option>
              <option value="60">60 Secondes (Standard)</option>
              <option value="90">90 Secondes (Long)</option>
            </select>

            <div className="flex items-center justify-between mt-4">
              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                <FolderOpen className="w-4 h-4" /> Nombre de clips
              </label>
              <span className="text-sm font-bold text-fuchsia-400">
                {settings.clipCount === 0 ? 'Automatique (IA)' : `${settings.clipCount} Clip${settings.clipCount > 1 ? 's' : ''}`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              step="1"
              value={settings.clipCount}
              onChange={(e) => updateSetting('clipCount', Number(e.target.value))}
              disabled={loading}
              className="w-full mt-2 accent-fuchsia-500 cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              <Zap className="w-4 h-4" /> Vitesse Vidéo
            </label>
            <select
              value={settings.videoSpeed}
              onChange={(e) => updateSetting('videoSpeed', Number(e.target.value))}
              disabled={loading}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-fuchsia-500 transition-colors disabled:opacity-50 text-white appearance-none cursor-pointer hover:bg-black/60"
            >
              <option value="0.25">0.25x (Très lent)</option>
              <option value="0.5">0.5x (Lent)</option>
              <option value="0.75">0.75x</option>
              <option value="1">1x (Normal)</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x (Rapide)</option>
              <option value="1.75">1.75x</option>
              <option value="2">2x (Très rapide)</option>
            </select>
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-4">
              <Settings2 className="w-4 h-4" /> Qualité Vidéo
            </label>
            <select
              value={settings.quality}
              onChange={(e) => updateSetting('quality', e.target.value as VideoQuality)}
              disabled={loading}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-fuchsia-500 transition-colors disabled:opacity-50 text-white appearance-none cursor-pointer hover:bg-black/60"
            >
              <option value="720p">720p (Rapide)</option>
              <option value="1080p">1080p (HD)</option>
              <option value="4k">4K (Ultra HD)</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              <Zap className="w-4 h-4" /> Vitesse de traitement
            </label>
            <select
              value={settings.speedMode}
              onChange={(e) => updateSetting('speedMode', e.target.value as SpeedMode)}
              disabled={loading}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-fuchsia-500 transition-colors disabled:opacity-50 text-white appearance-none cursor-pointer hover:bg-black/60"
            >
              <option value="ultra_fast">Ultra rapide - ~30s</option>
              <option value="fast">Rapide - ~1m</option>
              <option value="normal">Normal - ~2m</option>
              <option value="precise">Précis - ~5m</option>
            </select>
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-4">
              <Sparkles className="w-4 h-4" /> IA (gratuite)
            </label>
            <select
              value={settings.aiProvider}
              onChange={(e) => updateSetting('aiProvider', e.target.value)}
              disabled={loading}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-fuchsia-500 transition-colors disabled:opacity-50 text-white appearance-none cursor-pointer hover:bg-black/60"
            >
              <option value="auto">Automatique (avec relais)</option>
              {aiProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-4">
              <Settings2 className="w-4 h-4" /> Sous-titres
            </label>
            <select
              value={settings.withSubtitles ? settings.captionStyle : 'none'}
              onChange={(e) => {
                const v = e.target.value;
                setSettings((prev) => {
                  const next = v === 'none' ? { ...prev, withSubtitles: false } : { ...prev, withSubtitles: true, captionStyle: v };
                  setJSON(GENERATOR_SETTINGS_KEY, next);
                  return next;
                });
              }}
              disabled={loading}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-fuchsia-500 transition-colors disabled:opacity-50 text-white appearance-none cursor-pointer hover:bg-black/60"
            >
              {CAPTION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  Style : {p.name}
                </option>
              ))}
              <option value="none">Sans sous-titres</option>
            </select>
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-4">
              <Settings2 className="w-4 h-4" /> Format
            </label>
            <select
              value={settings.videoFormat}
              onChange={(e) => updateSetting('videoFormat', e.target.value as VideoFormat)}
              disabled={loading}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-fuchsia-500 transition-colors disabled:opacity-50 text-white appearance-none cursor-pointer hover:bg-black/60"
            >
              <option value="portrait">Format Téléphone / TikTok (Vertical 9:16)</option>
              <option value="landscape">Format Ordinateur / YouTube (Paysage 16:9)</option>
            </select>
          </div>
        </div>

        <div className="flex gap-4">
          <button
            onClick={handleGenerate}
            disabled={loading || !youtubeUrl.trim()}
            className="group relative flex-1 overflow-hidden rounded-2xl px-6 py-5 font-bold text-lg bg-white text-black hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-[0_0_40px_rgba(255,255,255,0.1)]"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-300 via-pink-300 to-orange-300 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="relative flex items-center gap-2 mix-blend-difference text-white">
              {loading ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" /> Génération en cours...
                </>
              ) : (
                <>
                  <Sparkles className="w-6 h-6" /> Obtenir des clips viraux
                </>
              )}
            </span>
          </button>
          
          {loading && (
            <button
              onClick={cancel}
              className="flex-shrink-0 px-8 py-5 rounded-2xl font-bold text-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 transition-all active:scale-[0.99] flex items-center justify-center"
            >
              Stopper
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="mb-12 w-full bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row justify-between gap-4">
              {STEPS.map((step) => (
                <div key={step.id} className="flex flex-col items-center gap-2 flex-1 relative">
                  {step.id < 4 && (
                    <div className="hidden sm:block absolute top-4 left-[50%] w-full h-[2px] bg-white/10">
                      <div
                        className="h-full bg-fuchsia-500 transition-all duration-300"
                        style={{ width: currentStep > step.id ? '100%' : '0%' }}
                      />
                    </div>
                  )}

                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-500 relative z-10
                    ${
                      currentStep > step.id
                        ? 'bg-fuchsia-500 text-white shadow-[0_0_15px_rgba(217,70,239,0.5)]'
                        : currentStep === step.id
                        ? 'bg-white text-black scale-110'
                        : 'bg-white/10 text-zinc-500'
                    }`}
                  >
                    {currentStep > step.id ? <CheckCircle2 className="w-6 h-6" /> : step.id}
                  </div>

                  <div className="text-center">
                    <span className={`block text-sm font-bold ${currentStep >= step.id ? 'text-white' : 'text-zinc-500'}`}>
                      {step.name}
                    </span>
                    {currentStep === step.id && (
                      <span className="block text-xs text-fuchsia-400 font-mono mt-1">
                        {stepPercent === -1 ? 'En cours...' : `${stepPercent.toFixed(1)}%`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-black/50 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 border border-white/5">
              <div className="flex items-center gap-3 text-fuchsia-400 font-medium">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{stepMessage}</span>
                {renderProgress && (
                  <span className="px-2 py-1 bg-fuchsia-500/20 text-xs rounded-md border border-fuchsia-500/30">
                    Clip {renderProgress.current} / {renderProgress.total}
                  </span>
                )}
              </div>

              <div className="flex gap-4 font-mono text-sm">
                <div className="flex flex-col items-end">
                  <span className="text-zinc-500 text-xs uppercase tracking-wider">Écoulé</span>
                  <span className="text-white">{formatTime(elapsedTime)}</span>
                </div>
                {estimatedTime && (
                  <>
                    <div className="w-px bg-white/10" />
                    <div className="flex flex-col items-end">
                      <span className="text-zinc-500 text-xs uppercase tracking-wider">Estimé</span>
                      <span className="text-white">{formatTime(estimatedTime)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="h-2 w-full bg-black/60 rounded-full overflow-hidden shadow-inner relative border border-white/5">
              <div
                className={`h-full transition-all duration-300 ease-out bg-gradient-to-r from-fuchsia-500 to-orange-400 ${
                  stepPercent === -1 ? 'w-full animate-pulse opacity-50' : ''
                }`}
                style={{ width: stepPercent !== -1 ? `${stepPercent}%` : '100%' }}
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-12 w-full rounded-2xl border border-red-500/30 bg-red-500/10 p-6 flex items-start gap-4 text-left flex-col sm:flex-row">
          <div className="flex items-start gap-4 flex-1">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-red-400 font-bold">!</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-red-200 mb-1">Erreur de traitement</h3>
              <p className="text-red-300/80 mb-4">{error}</p>
              
              {error.includes('Anti-Bot') && (
                <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                  <h4 className="font-bold text-white mb-2 text-sm flex items-center gap-2">
                    <FileUp className="w-4 h-4 text-fuchsia-400" />
                    Solution : Upload de cookies.txt
                  </h4>
                  <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                    1. Installez l'extension Chrome "Get cookies.txt LOCALLY"<br/>
                    2. Allez sur YouTube et exportez vos cookies<br/>
                    3. Envoyez le fichier ci-dessous
                  </p>
                  
                  <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm cursor-pointer transition-colors ${uploadingCookies ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-300 border border-fuchsia-500/30'}`}>
                    {uploadingCookies ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                    {uploadingCookies ? 'Upload...' : 'Uploader cookies.txt'}
                    <input type="file" accept=".txt" className="hidden" onChange={handleCookieUpload} disabled={uploadingCookies} />
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
