/**
 * providers.js — fournisseurs de modèles de langage GRATUITS.
 *
 *   gemini      : Google AI Studio (offre gratuite)          GEMINI_API_KEY (plusieurs clés séparées par des virgules)
 *   groq        : Groq (offre gratuite, très rapide)          GROQ_API_KEY
 *   openrouter  : OpenRouter, modèles « :free »               OPENROUTER_API_KEY
 *   mistral     : Mistral La Plateforme (offre Experiment)    MISTRAL_API_KEY
 *   cerebras    : Cerebras Inference (offre gratuite)         CEREBRAS_API_KEY
 *   ollama      : modèle local via Ollama (100 % gratuit)     OLLAMA_MODEL (+ OLLAMA_BASE_URL)
 *
 * Chaque modèle est surchargeable par variable d'environnement (<FOURNISSEUR>_MODEL
 * et <FOURNISSEUR>_MODEL_FAST) : les catalogues gratuits évoluent souvent.
 * Les fournisseurs « compatibles OpenAI » sont appelés via fetch (même format
 * /chat/completions pour tous), sans dépendance supplémentaire.
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyPool = require('./keys');

class ProviderError extends Error {
  /** retryable : on peut passer au fournisseur suivant (quota, panne, clé invalide...). */
  constructor(message, { status, retryable = true } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** Extrait un objet JSON d'une réponse texte (tolère les blocs ```json et le texte autour). */
function extractJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch {}
  }
  throw new ProviderError('Réponse JSON invalide du modèle.', { retryable: true });
}

function cleanModel(name) {
  return String(name || '').replace(/["']/g, '').trim();
}

// ---------------------------------------------------------------------------
// Gemini (SDK officiel déjà utilisé par le projet)
// ---------------------------------------------------------------------------

// Alias « -latest » : ils suivent toujours la version courante (les numéros figés
// disparaissent régulièrement, ex. gemini-2.5-flash n'est plus ouvert aux nouvelles clés).
const GEMINI_TIERS = {
  fast: 'gemini-flash-lite-latest',
  balanced: 'gemini-flash-latest',
  smart: 'gemini-flash-latest',
  max: 'gemini-pro-latest',
};
// Modèles essayés ensuite si le premier est introuvable (404) ou saturé (503/500).
const GEMINI_FALLBACKS = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-3.8-flash'];
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 60000;

// Attente maximale quand un fournisseur demande de patienter (limite de requêtes / jetons par minute).
const MAX_RATE_WAIT_S = Number(process.env.AI_MAX_RATE_WAIT_S) || 25;

/** Pause annulable. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Tâche annulée.'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('Tâche annulée.'));
    }, { once: true });
  });
}

/** Signal combinant l'annulation demandée et un délai maximal par appel (un modèle saturé ne bloque pas tout). */
function withTimeout(signal, ms = DEFAULT_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function geminiKeys() {
  return keyPool.getKeys('gemini');
}

// Modèles Flash disponibles (liste de l'API, mise en cache 6 h).
let flashCache = { at: 0, list: [] };
async function flashModels() {
  if (Date.now() - flashCache.at < 6 * 3600 * 1000) return flashCache.list;
  flashCache = { at: Date.now(), list: flashCache.list };
  try {
    const list = await gemini.listModels();
    flashCache.list = list.filter((m) => /flash/i.test(m) && !/image|tts|live|audio|thinking|exp|preview/i.test(m)).slice(0, 12);
  } catch {}
  return flashCache.list;
}

const gemini = {
  id: 'gemini',
  name: 'Google Gemini (gratuit)',
  vision: true,
  isConfigured: () => geminiKeys().length > 0,
  model(tier) {
    return cleanModel(process.env[`GEMINI_MODEL_${String(tier).toUpperCase()}`] || GEMINI_TIERS[tier] || GEMINI_TIERS.balanced);
  },
  /**
   * Essaie chaque modèle, et pour chaque modèle chaque clé (la moins utilisée
   * aujourd'hui d'abord) : un quota atteint fait passer à la CLÉ suivante,
   * un modèle saturé ou absent au MODÈLE suivant.
   */
  async generate({ system, prompt, schema, tier, signal, temperature = 0.7, timeoutMs, model: forced, images, maxModels = Infinity }) {
    const configuredFallback = process.env.CURATOR_MODEL ? [cleanModel(process.env.CURATOR_MODEL)] : [];
    // Chaque modèle a son propre quota gratuit (20 requêtes / jour / projet) : on profite de tous les Flash disponibles.
    const all = [...new Set([...(forced ? [cleanModel(forced)] : []), this.model(tier), ...configuredFallback, ...GEMINI_FALLBACKS, ...(await flashModels())])];
    // Modèles disponibles d'abord ; ceux mis de côté (saturés) restent en dernier recours.
    const models = [...all.filter((m) => !keyPool.isModelCooling('gemini', m)), ...all.filter((m) => keyPool.isModelCooling('gemini', m))];
    const limit = Math.min(models.length, maxModels);
    let lastError;
    let triedAnyKey = false;
    let attempted = 0;
    for (let m = 0; m < models.length && attempted < limit; m++) {
      const modelName = models[m];
      const keys = keyPool.orderedKeys('gemini', modelName);
      if (keys.length === 0) {
        // Toutes les clés à court de quota pour ce modèle : ne compte pas comme un essai.
        lastError = lastError || new Error(`toutes les clés ont atteint leur quota pour ${modelName}`);
        continue;
      }
      attempted += 1;
      // Délai complet seulement en mode « Le plus poussé » ou pour le tout dernier recours (aucun relais).
      const lastResort = attempted === limit && maxModels === Infinity;
      const wait = tier === 'max' || lastResort ? timeoutMs : Math.min(timeoutMs || DEFAULT_TIMEOUT_MS, maxModels === Infinity ? 25000 : 20000);
      let nextModel = false;
      for (const key of keys) {
        triedAnyKey = true;
        try {
          const model = new GoogleGenerativeAI(key).getGenerativeModel({
            model: modelName.startsWith('models/') ? modelName : `models/${modelName}`,
            systemInstruction: system,
            generationConfig: { temperature, responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) },
          });
          // images : [{ mimeType, data (base64) }] — analyse visuelle (miniatures, captures).
          const content = images?.length ? [prompt, ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data } }))] : prompt;
          const result = await model.generateContent(content, { signal: withTimeout(signal, wait) });
          const data = extractJson(result.response.text());
          const u = result.response.usageMetadata || {};
          keyPool.record('gemini', key, modelName, { ok: true, tokensIn: u.promptTokenCount || 0, tokensOut: u.candidatesTokenCount || 0 });
          return { data, model: modelName };
        } catch (err) {
          if (signal?.aborted) throw err;
          lastError = err;
          const msg = String(err.message || err.name || '');
          const reason = err instanceof ProviderError ? 'bad-json' : keyPool.classify(msg);
          keyPool.record('gemini', key, modelName, { ok: false, reason });
          if (reason === 'quota-day' || reason === 'quota-minute' || reason === 'invalid') {
            const label = reason === 'invalid' ? 'clé refusée' : reason === 'quota-day' ? 'quota du jour atteint' : 'trop de requêtes par minute';
            console.warn(`[llm:gemini] ${modelName} : ${label} sur la clé ${key.slice(0, 4)}…${key.slice(-4)}, clé suivante.`);
            continue; // même modèle, clé suivante
          }
          const why = reason === 'missing' ? 'modèle introuvable' : reason === 'slow' ? 'trop lent' : reason === 'bad-json' ? 'réponse illisible' : 'saturé chez Google';
          console.warn(`[llm:gemini] ${modelName} ${why}, modèle suivant.`);
          nextModel = true;
          break;
        }
      }
      if (!nextModel && keys.length) {
        // Toutes les clés de ce modèle sont à court de quota : modèle suivant.
        continue;
      }
    }
    if (!triedAnyKey) throw new ProviderError('Gemini : toutes les clés ont atteint leur quota gratuit pour aujourd’hui (ajoutez des clés sur la page Usage IA).');
    throw new ProviderError(`Gemini : ${String(lastError?.message || lastError).slice(0, 300)}`);
  },

  /** Modèles texte disponibles pour la clé (alias « -latest » en tête). */
  async listModels() {
    const key = keyPool.orderedKeys('gemini', '__list__')[0] || geminiKeys()[0];
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, signal: withTimeout(null, 15000) });
    const json = await res.json();
    const skip = /tts|image|banana|robotics|lyria|computer-use|transcribe|research|antigravity|embedding|aqa|omni|customtools|learnlm/i;
    const names = (json.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
      .filter((n) => !skip.test(n));
    const aliases = names.filter((n) => n.endsWith('-latest'));
    return [...aliases, ...names.filter((n) => !n.endsWith('-latest')).sort().reverse()];
  },

  /**
   * Recherche Google (« grounding » de Gemini, inclus dans l'offre gratuite) :
   * retourne un résumé factuel et les sources consultées.
   */
  async search(query, signal) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: `Recherche sur le web et résume en français, de façon factuelle et concise (8 lignes max), les informations utiles pour : ${query}` }] }],
      tools: [{ google_search: {} }],
    };
    let lastError;
    for (const model of ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-flash-lite-latest']) {
      // Recherche Google : quota à part, suivi sous le nom « <modèle> (recherche) ».
      const usageName = `${model} (recherche)`;
      const key = keyPool.orderedKeys('gemini', usageName)[0];
      if (!key) continue;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: withTimeout(signal, 40000),
        });
        const json = await res.json();
        if (!res.ok) {
          keyPool.record('gemini', key, usageName, { ok: false, reason: keyPool.classify(json.error?.message, res.status) });
          throw new Error(json.error?.message || `HTTP ${res.status}`);
        }
        const um = json.usageMetadata || {};
        keyPool.record('gemini', key, usageName, { ok: true, tokensIn: um.promptTokenCount || 0, tokensOut: um.candidatesTokenCount || 0 });
        const cand = json.candidates?.[0];
        const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
        const sources = (cand?.groundingMetadata?.groundingChunks || [])
          .map((c) => c.web)
          .filter(Boolean)
          .map((w) => ({ title: w.title || w.uri, url: w.uri }));
        if (text) return { summary: text, sources, engine: `Google (${model})` };
      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = err;
      }
    }
    throw new ProviderError(`Recherche Google indisponible : ${lastError?.message || 'réponse vide'}`);
  },
};

// ---------------------------------------------------------------------------
// Fournisseurs compatibles OpenAI (fetch)
// ---------------------------------------------------------------------------

function openAICompatible({ id, name, baseUrl, keyEnv, models, fallbacks = [], visionModels = null, extraHeaders = {}, keyless = false, configuredWhen }) {
  return {
    id,
    name,
    // Analyse d'images (captures, miniatures) avec les modèles « vision » du fournisseur.
    vision: Boolean(visionModels),
    isConfigured: configuredWhen || (() => keyPool.getKeys(id).length > 0),
    model(tier) {
      const prefix = id.toUpperCase();
      const fast = tier === 'fast';
      return cleanModel((fast && process.env[`${prefix}_MODEL_FAST`]) || process.env[`${prefix}_MODEL`] || (fast ? models.fast : models.smart));
    },
    async generate({ system, prompt, schema, tier, signal, temperature = 0.7, timeoutMs, model: forced, slim, images }) {
      const primary = forced ? cleanModel(forced) : this.model(tier);
      // Chaîne de modèles (les gratuits d'OpenRouter sont souvent saturés à tour de rôle) ;
      // ceux mis de côté récemment passent en dernier.
      // Jamais de repli vers le petit modèle pour une demande « smart » / « max » : il suit mal les consignes.
      const withImages = Boolean(images?.length && visionModels);
      const chain = withImages
        ? forced && visionModels.includes(cleanModel(forced)) ? [cleanModel(forced)] : visionModels
        : forced ? [primary] : [...new Set([primary, ...fallbacks, ...(tier === 'fast' ? [this.model('smart')] : [])])];
      const ordered = [...chain.filter((m) => !keyPool.isModelCooling(id, m)), ...chain.filter((m) => keyPool.isModelCooling(id, m))];
      const url = `${(typeof baseUrl === 'function' ? baseUrl() : baseUrl).replace(/\/$/, '')}/chat/completions`;
      // Les fournisseurs compatibles n'acceptent pas tous un schéma JSON strict :
      // le schéma est décrit dans le prompt et la sortie forcée en objet JSON.
      const text = schema ? `${prompt}\n\nRéponds UNIQUEMENT avec un objet JSON respectant ce schéma :\n${JSON.stringify(schema)}` : prompt;
      const userContent = withImages ? [{ type: 'text', text }, ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mimeType};base64,${im.data}` } }))] : text;
      const call = async (payload, key) => {
        const headers = { 'Content-Type': 'application/json', ...extraHeaders };
        if (!keyless) headers.Authorization = `Bearer ${key}`;
        let res;
        try {
          res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: withTimeout(signal, timeoutMs) });
        } catch (err) {
          if (signal?.aborted) throw err;
          throw new ProviderError(`${name} injoignable : ${err.message}`);
        }
        const text = await res.text();
        if (!res.ok) {
          const err = new ProviderError(`${name} (${res.status}) : ${text.slice(0, 300)}`, { status: res.status });
          // Limite par minute : délai d'attente indiqué (en-tête retry-after ou « try again in 7.5s »).
          const header = Number(res.headers.get('retry-after'));
          const inText = text.match(/try again in\s+(?:(\d+)m)?([\d.]+)(ms|s)\b/i);
          if (inText) err.retryAfter = (Number(inText[1]) || 0) * 60 + Number(inText[2]) / (inText[3] === 'ms' ? 1000 : 1);
          else if (Number.isFinite(header) && header > 0) err.retryAfter = header;
          const tpm = text.match(/Limit\s+(\d+),\s*Used\s+(\d+),\s*Requested\s+(\d+)/i);
          // Demande plus grosse que la limite elle-même : attendre ne sert à rien.
          if (tpm && Number(tpm[3]) > Number(tpm[1])) err.tooBig = true;
          throw err;
        }
        return JSON.parse(text);
      };
      const isTooBig = (err) => err instanceof ProviderError && (err.tooBig || err.status === 413 || /too large|context length|maximum context/i.test(err.message));
      const isRateLimited = (err) => err instanceof ProviderError && err.status === 429 && !err.tooBig && err.retryAfter > 0 && err.retryAfter <= MAX_RATE_WAIT_S && !/upstream|Provider returned error/i.test(err.message);
      const slimBody = (body) => ({ ...body, messages: [{ role: 'system', content: slim.system }, { role: 'user', content: slim.prompt }] });

      let lastErr;
      for (const model of ordered) {
        const body = {
          model,
          temperature,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
          response_format: { type: 'json_object' },
        };
        // Rotation : la clé la moins utilisée d'abord ; quota atteint ou clé refusée -> clé suivante.
        const keys = keyless ? [null] : keyPool.orderedKeys(id, model);
        if (keys.length === 0) {
          lastErr = lastErr || new ProviderError(`${name} : toutes les clés ont atteint leur quota pour ${model}.`);
          continue;
        }
        let nextModel = false;
        for (const key of keys) {
          try {
            let json;
            try {
              json = await call(body, key);
            } catch (err) {
              // Certains modèles refusent response_format : on réessaie sans.
              if (err instanceof ProviderError && err.status === 400 && /response_format|json_object|json mode/i.test(err.message)) {
                const { response_format, ...rest } = body;
                json = await call(rest, key);
              } else if (isRateLimited(err) && key === keys[keys.length - 1]) {
                // (avec plusieurs clés, on passe d'abord simplement à la clé suivante)
                // Quota par minute momentanément atteint : attendre quelques secondes vaut mieux
                // que de basculer sur des IA gratuites saturées qui finissent par expirer.
                console.warn(`[llm:${id}] ${model} : limite par minute, nouvel essai dans ${err.retryAfter.toFixed(1)} s.`);
                await sleep(err.retryAfter * 1000 + 300, signal);
                try {
                  json = await call(body, key);
                } catch (again) {
                  if (!slim || !(isTooBig(again) || isRateLimited(again))) throw again;
                  console.warn(`[llm:${id}] ${model} : toujours limité, nouvel essai en version allégée.`);
                  json = await call(slimBody(body), key);
                }
              } else if (slim && (isTooBig(err) || /tokens per minute|\bTPM\b/i.test(err.message))) {
                // Demande trop grosse pour l'offre gratuite : version allégée du même message.
                console.warn(`[llm:${id}] demande trop grosse pour ${model}, nouvel essai en version allégée.`);
                json = await call(slimBody(body), key);
              } else throw err;
            }
            const content = json?.choices?.[0]?.message?.content;
            if (!content) throw new ProviderError(`${name} : réponse vide.`);
            const data = extractJson(content);
            if (key) keyPool.record(id, key, model, { ok: true, tokensIn: json.usage?.prompt_tokens || 0, tokensOut: json.usage?.completion_tokens || 0 });
            return { data, model };
          } catch (err) {
            if (signal?.aborted) throw err;
            lastErr = err;
            const msg = String(err.message || '');
            // OpenRouter : « rate-limited upstream » = le MODÈLE gratuit est saturé (pas la clé).
            const upstream = /upstream|Provider returned error/i.test(msg);
            const reason = upstream ? 'overloaded' : keyPool.classify(msg, err.status);
            if (key) keyPool.record(id, key, model, { ok: false, reason });
            if (!upstream && (reason === 'quota-day' || reason === 'quota-minute' || reason === 'invalid')) continue; // clé suivante
            if (reason === 'overloaded' || reason === 'missing' || reason === 'slow' || err.status === 403 || err.status === 404 || err instanceof ProviderError) {
              console.warn(`[llm:${id}] ${model} indisponible (${msg.slice(0, 60)}), modèle suivant.`);
              nextModel = true;
              break;
            }
            throw err;
          }
        }
        if (!nextModel) continue;
      }
      throw lastErr;
    },
    /** Modèles proposés par le fournisseur (OpenRouter : seulement les gratuits). */
    async listModels() {
      const url = `${(typeof baseUrl === 'function' ? baseUrl() : baseUrl).replace(/\/$/, '')}/models`;
      const headers = keyless ? {} : { Authorization: `Bearer ${keyPool.getKeys(id)[0]}` };
      const res = await fetch(url, { headers, signal: withTimeout(null, 15000) });
      const json = await res.json();
      let ids = (json.data || json.models || []).map((m) => m.id || m.name).filter(Boolean);
      if (id === 'openrouter') ids = ids.filter((m) => m.endsWith(':free'));
      // Pas les modèles de voix, de transcription ni de modération.
      ids = ids.filter((m) => !/whisper|orpheus|guard|tts|embed/i.test(m));
      return ids.sort();
    },
  };
}

const groq = openAICompatible({
  id: 'groq',
  name: 'Groq (gratuit)',
  baseUrl: 'https://api.groq.com/openai/v1',
  keyEnv: 'GROQ_API_KEY',
  // Catalogue gratuit actuel de Groq (les anciens Llama 3.x ont été retirés).
  models: { fast: 'openai/gpt-oss-20b', smart: 'openai/gpt-oss-120b' },
});

const openrouter = openAICompatible({
  id: 'openrouter',
  name: 'OpenRouter (modèles gratuits)',
  baseUrl: 'https://openrouter.ai/api/v1',
  keyEnv: 'OPENROUTER_API_KEY',
  // Modèles « :free » qui répondent bien en JSON ; les gratuits sont souvent saturés à tour de rôle,
  // d'où la chaîne de relais (Gemma 4 = modèle ouvert de Google, cousin de Gemini).
  models: { fast: 'poolside/laguna-s-2.1:free', smart: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
  fallbacks: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'google/gemma-4-31b-it:free', 'dots-studio/dots-3-note-preview:free', 'nvidia/nemotron-3.5-super-vl:free'],
  visionModels: ['nvidia/nemotron-3.5-super-vl:free', 'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free'],
  extraHeaders: { 'X-Title': 'ClipTok' },
});

const mistral = openAICompatible({
  id: 'mistral',
  name: 'Mistral (offre gratuite)',
  baseUrl: 'https://api.mistral.ai/v1',
  keyEnv: 'MISTRAL_API_KEY',
  models: { fast: 'mistral-small-latest', smart: 'mistral-large-latest' },
  fallbacks: ['mistral-medium-latest'],
  visionModels: ['mistral-medium-latest', 'mistral-small-latest'],
});

const cerebras = openAICompatible({
  id: 'cerebras',
  name: 'Cerebras (gratuit)',
  baseUrl: 'https://api.cerebras.ai/v1',
  keyEnv: 'CEREBRAS_API_KEY',
  // gpt-oss-120b (OpenAI, modèle ouvert) et Qwen 3 235B : gros modèles gratuits, très rapides chez Cerebras.
  models: { fast: 'gpt-oss-120b', smart: 'gpt-oss-120b' },
  fallbacks: ['qwen-3-235b-a22b-instruct-2507', 'llama-3.3-70b'],
});

const ollama = openAICompatible({
  id: 'ollama',
  name: 'Ollama (local, 100 % gratuit)',
  baseUrl: () => process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  keyEnv: 'OLLAMA_API_KEY',
  keyless: true,
  configuredWhen: () => Boolean(process.env.OLLAMA_MODEL),
  models: { fast: 'qwen2.5:7b', smart: 'qwen2.5:7b' },
});

const PROVIDERS = { gemini, groq, openrouter, mistral, cerebras, ollama };

module.exports = { PROVIDERS, ProviderError, extractJson };
