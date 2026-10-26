'use client';

import { useEffect, useState } from 'react';
import { Globe, Zap, Gauge, Brain } from 'lucide-react';
import { getAiModels, getAiProviders, type AiMode, type AiProvider } from '@/lib/api';
import { getJSON, setJSON } from '@/lib/storage';

const PREFS_KEY = 'cliptok:ai-editor-prefs';

export const AI_MODES: { id: AiMode; label: string; icon: typeof Zap; hint: string }[] = [
  { id: 'fast', label: 'Rapide', icon: Zap, hint: 'Petit modèle, réponse en quelques secondes' },
  { id: 'balanced', label: 'Équilibré', icon: Gauge, hint: 'Bon compromis qualité / vitesse' },
  { id: 'max', label: 'Le plus poussé', icon: Brain, hint: 'Modèle le plus intelligent, montage complet et soigné, plus de recherches' },
];

export interface AiPrefs {
  provider: string;
  model: string;
  mode: AiMode;
  webSearch: boolean;
}

/**
 * Choix d'IA mémorisés (fournisseur, modèle, mode, recherche web), partagés
 * entre l'accueil de l'Éditeur IA et l'assistant : la dernière option est
 * reprise partout.
 */
export function useAiPrefs() {
  const [prefs, setPrefs] = useState<AiPrefs>({ provider: 'auto', model: '', mode: 'balanced', webSearch: true });
  const [loaded, setLoaded] = useState(false);
  const [providers, setProviders] = useState<AiProvider[] | null>(null);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    setPrefs((p) => ({ ...p, ...getJSON<Partial<AiPrefs>>(PREFS_KEY, {}) }));
    setLoaded(true);
    getAiProviders().then(setProviders).catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    if (loaded) setJSON(PREFS_KEY, prefs);
  }, [prefs, loaded]);

  // Modèles réellement disponibles chez le fournisseur choisi.
  useEffect(() => {
    if (prefs.provider === 'auto') {
      setModels([]);
      return;
    }
    let alive = true;
    getAiModels(prefs.provider)
      .then((list) => alive && setModels(list))
      .catch(() => alive && setModels([]));
    return () => {
      alive = false;
    };
  }, [prefs.provider]);

  const update = (patch: Partial<AiPrefs>) => setPrefs((p) => ({ ...p, ...patch }));
  /** Paramètres à envoyer à l'API (le modèle ne vaut que pour un fournisseur choisi). */
  const request = {
    provider: prefs.provider === 'auto' ? undefined : prefs.provider,
    model: prefs.provider !== 'auto' && prefs.model ? prefs.model : undefined,
    mode: prefs.mode,
  };
  return { prefs, update, providers, models, request };
}

/** Choix rapides : un seul menu au lieu de fournisseur + modèle + mode. */
function presetsFor(providers: AiProvider[]) {
  const list: { id: string; label: string; provider: string; mode: AiMode }[] = [
    { id: 'auto:balanced', label: '⚡ Automatique — la meilleure IA dispo', provider: 'auto', mode: 'balanced' },
    { id: 'auto:max', label: '🧠 Le plus intelligent', provider: 'auto', mode: 'max' },
    { id: 'auto:fast', label: '🚀 Ultra rapide', provider: 'auto', mode: 'fast' },
  ];
  for (const p of providers.filter((x) => x.configured)) {
    const name = p.name.replace(/\s*\(.*\)/, '');
    list.push({ id: `${p.id}:balanced`, label: `${name}${p.model ? ` · ${p.model.split('/').pop()?.replace(':free', '')}` : ''}`, provider: p.id, mode: 'balanced' });
  }
  return list;
}

export function AiModelPicker({ ai, size = 'sm' }: { ai: ReturnType<typeof useAiPrefs>; size?: 'sm' | 'md' }) {
  const { prefs, update, providers } = ai;
  const [advanced, setAdvanced] = useState(false);
  const presets = presetsFor(providers || []);
  const current = prefs.model ? '' : presets.find((p) => p.provider === prefs.provider && (p.provider !== 'auto' || p.mode === prefs.mode))?.id || '';
  const text = size === 'md' ? 'text-sm' : 'text-xs';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={current}
          onChange={(e) => {
            const p = presets.find((x) => x.id === e.target.value);
            if (p) update({ provider: p.provider, mode: p.provider === 'auto' ? p.mode : prefs.mode, model: '' });
          }}
          className={`flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 ${text} text-white outline-none focus:border-fuchsia-500`}
          title="Choix de l'IA"
        >
          {current === '' && <option value="">Réglage personnalisé ({prefs.provider} · {prefs.model || prefs.mode})</option>}
          <optgroup label="Recommandé">
            {presets.slice(0, 3).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          {presets.length > 3 && (
            <optgroup label="Une IA précise">
              {presets.slice(3).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          onClick={() => update({ webSearch: !prefs.webSearch })}
          title="Autoriser l'IA à faire des recherches Google / web"
          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-semibold flex-shrink-0 ${prefs.webSearch ? 'border-sky-400/60 bg-sky-500/15 text-sky-200' : 'border-white/10 text-zinc-500 hover:text-white'}`}
        >
          <Globe className="w-3 h-3" /> Web
        </button>
        <button type="button" onClick={() => setAdvanced((v) => !v)} className={`text-[10px] flex-shrink-0 ${advanced ? 'text-white' : 'text-zinc-500 hover:text-white'}`} title="Choisir le fournisseur, le modèle exact et le mode">
          Avancé
        </button>
      </div>
      {advanced && <AdvancedPicker ai={ai} size={size} />}
    </div>
  );
}

/** Réglage détaillé : fournisseur, modèle exact, mode. */
function AdvancedPicker({ ai, size = 'sm' }: { ai: ReturnType<typeof useAiPrefs>; size?: 'sm' | 'md' }) {
  const { prefs, update, providers, models } = ai;
  const configured = (providers || []).filter((p) => p.configured);
  const text = size === 'md' ? 'text-sm' : 'text-xs';
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={prefs.provider}
          onChange={(e) => update({ provider: e.target.value, model: '' })}
          className={`bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 ${text} text-white outline-none focus:border-fuchsia-500`}
          title="Fournisseur d'IA (gratuit)"
        >
          <option value="auto">IA automatique (relais)</option>
          {configured.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={prefs.model}
          onChange={(e) => update({ model: e.target.value })}
          disabled={prefs.provider === 'auto'}
          className={`bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 ${text} text-white outline-none focus:border-fuchsia-500 disabled:opacity-40`}
          title={prefs.provider === 'auto' ? 'Choisissez un fournisseur pour choisir le modèle' : 'Modèle'}
        >
          <option value="">{prefs.provider === 'auto' ? 'Modèle : selon le mode' : 'Modèle par défaut'}</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex bg-black/40 border border-white/10 rounded-lg p-0.5 gap-0.5">
          {AI_MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => update({ mode: m.id })}
                title={m.hint}
                className={`flex-1 flex items-center justify-center gap-1 px-1 py-1 rounded-md ${size === 'md' ? 'text-xs' : 'text-[11px]'} font-semibold whitespace-nowrap transition-colors ${
                  prefs.mode === m.id ? 'bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Icon className="w-3 h-3" /> {m.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
