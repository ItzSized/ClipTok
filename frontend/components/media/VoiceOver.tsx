'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Square, Loader2, Mic } from 'lucide-react';
import { generateVoice, getVoices, voicePreviewUrl } from '@/lib/api';
import type { Media, Voice } from '@/lib/types';
import { getJSON, setJSON } from '@/lib/storage';
import { Slider } from '@/components/ui/controls';
import { useToast } from '@/components/ToastProvider';

const VOICE_PREFS_KEY = 'cliptok:voice-prefs';
export const DEFAULT_VOICE = 'adam-like';

export interface VoicePrefs {
  voice: string;
  rate: number;
  pitch: number;
}

/** Voix choisie par l'utilisateur (aussi utilisée par l'IA pour ses voix off). */
export function getVoicePrefs(): VoicePrefs {
  return { voice: DEFAULT_VOICE, rate: 0, pitch: 0, ...getJSON<Partial<VoicePrefs>>(VOICE_PREFS_KEY, {}) };
}

export function useVoicePrefs() {
  const [prefs, setPrefs] = useState<VoicePrefs>({ voice: DEFAULT_VOICE, rate: 0, pitch: 0 });
  useEffect(() => setPrefs(getVoicePrefs()), []);
  const update = (patch: Partial<VoicePrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      setJSON(VOICE_PREFS_KEY, next);
      return next;
    });
  return [prefs, update] as const;
}

let voicesCache: Promise<Voice[]> | null = null;
export function useVoices() {
  const [voices, setVoices] = useState<Voice[]>([]);
  useEffect(() => {
    voicesCache = voicesCache || getVoices().catch((e) => {
      voicesCache = null;
      throw e;
    });
    voicesCache.then(setVoices).catch(() => { });
  }, []);
  return voices;
}

/** Liste des voix avec écoute d'un extrait. */
export function VoicePicker({ value, onChange, compact }: { value: string; onChange: (id: string) => void; compact?: boolean }) {
  const voices = useVoices();
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const [lang, setLang] = useState<'en' | 'fr'>('en');

  useEffect(() => () => player.current?.pause(), []);
  useEffect(() => {
    const v = voices.find((x) => x.id === value);
    if (v && (v.lang === 'en' || v.lang === 'fr')) setLang(v.lang);
  }, [voices, value]);

  const listen = (id: string) => {
    player.current?.pause();
    if (playing === id) return setPlaying(null);
    const a = new Audio(voicePreviewUrl(id));
    setLoading(id);
    a.oncanplay = () => setLoading(null);
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setLoading(null);
      setPlaying(null);
    };
    a.play().catch(() => setPlaying(null));
    player.current = a;
    setPlaying(id);
  };

  const shown = voices.filter((v) => v.lang === lang);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        {(['en', 'fr'] as const).map((l) => (
          <button key={l} onClick={() => setLang(l)} className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${lang === l ? 'border-fuchsia-500 bg-fuchsia-500/15 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}>
            {l === 'en' ? 'Anglais' : 'Français'}
          </button>
        ))}
      </div>
      {voices.length === 0 && <p className="text-[11px] text-zinc-500">Chargement des voix…</p>}
      <div className={`grid gap-1.5 ${compact ? 'grid-cols-1' : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]'}`}>
        {shown.map((v) => (
          <div
            key={v.id}
            onClick={() => onChange(v.id)}
            className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 cursor-pointer ${value === v.id ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'border-white/10 hover:border-white/30'}`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                listen(v.id);
              }}
              className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center flex-shrink-0"
              title="Écouter un extrait"
            >
              {loading === v.id ? <Loader2 className="w-3 h-3 animate-spin" /> : playing === v.id ? <Square className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5 ml-0.5" />}
            </button>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-white truncate">
                {v.name} <span className="text-zinc-500 font-normal">{v.gender === 'male' ? '♂' : '♀'}</span>
              </p>
              <p className="text-[10px] text-zinc-500 truncate">{v.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Texte → voix off : génère le MP3 (rangé dans la bibliothèque Voix) puis appelle onCreated. */
export function VoiceOverForm({ onCreated }: { onCreated: (media: Media) => void }) {
  const [prefs, setPrefs] = useVoicePrefs();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const create = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const media = await generateVoice({ text: text.trim(), ...prefs });
      onCreated(media);
      setText('');
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Texte de la voix off (ex. : Nobody expected what happened next…)"
        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-fuchsia-500 resize-none"
      />
      <VoicePicker compact value={prefs.voice} onChange={(voice) => setPrefs({ voice })} />
      <Slider label="Vitesse" value={prefs.rate} min={-40} max={40} step={1} onChange={(rate) => setPrefs({ rate })} format={(v) => `${v > 0 ? '+' : ''}${v} %`} />
      <Slider label="Hauteur (grave ↔ aigu)" value={prefs.pitch} min={-15} max={15} step={1} onChange={(pitch) => setPrefs({ pitch })} format={(v) => `${v > 0 ? '+' : ''}${v} Hz`} />
      <button
        onClick={create}
        disabled={!text.trim() || busy}
        className="h-8 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />} {busy ? 'Génération…' : 'Générer la voix off'}
      </button>
      <p className="text-[10px] text-zinc-600">Gratuit et illimité. Enregistrée dans la bibliothèque Voix (disque D:), avec le minutage des mots pour des sous-titres instantanés.</p>
    </div>
  );
}
