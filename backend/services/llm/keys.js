/**
 * keys.js — réserve de clés d'API par fournisseur, rotation automatique et suivi d'usage.
 *
 *  - Clés : celles du .env (plusieurs séparées par des virgules, ex. GEMINI_API_KEY="k1,k2")
 *    + celles ajoutées depuis le site (data/ai-keys.json, jamais renvoyées en clair).
 *  - Rotation : pour chaque appel, la clé la moins utilisée aujourd'hui pour ce modèle passe
 *    en premier ; une clé dont le quota est atteint (429) est mise de côté pour CE modèle
 *    (jusqu'au lendemain pour un quota journalier, 1 min pour un quota par minute), une clé
 *    refusée (401/403) est mise de côté pour tous les modèles.
 *  - Usage : requêtes, réussites, erreurs, quotas atteints et jetons, par jour (fuseau des
 *    quotas Google : Pacifique), par clé et par modèle ; visible sur le site.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const KEYS_FILE = path.join(DATA_DIR, 'ai-keys.json');
const USAGE_FILE = path.join(DATA_DIR, 'ai-usage.json');
const KEEP_DAYS = 7;

const ENV_NAMES = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

let stored = readJson(KEYS_FILE, {}); // { gemini: ['k1', ...], groq: [...] }
// Fichier d'usage : { days: { [jour]: { [provider]: { [keyId]: { [model]: stats } } } }, cooling: [[clé, { until, reason }]] }
const usageFile = readJson(USAGE_FILE, {});
let usage = usageFile.days || (usageFile.cooling ? {} : usageFile);
// Clés mises de côté (quota du jour, clé refusée) : conservées après un redémarrage du serveur.
const cooling = new Map((usageFile.cooling || []).filter(([, c]) => c && c.until > Date.now())); // `${provider}|${keyId}|${model ou *}` -> { until, reason }
/*
 * Projets Google détectés : le quota gratuit est PAR PROJET, pas par clé. Une clé
 * jamais utilisée pour un modèle qui répond « quota du jour atteint » partage donc
 * son projet avec une clé déjà épuisée : on les regroupe, et une seule erreur de
 * quota met de côté tout le groupe (au lieu de gaspiller une requête par clé).
 */
const groups = new Map(usageFile.groups || []); // `${provider}|${keyId}` -> identifiant de groupe
const modelCooling = new Map(); // `${provider}|${model}` -> { until, reason } (modèle saturé pour toutes les clés)

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      // On ne garde que les derniers jours.
      const days = Object.keys(usage).sort().slice(-KEEP_DAYS);
      usage = Object.fromEntries(days.map((d) => [d, usage[d]]));
      const now = Date.now();
      fs.writeFileSync(USAGE_FILE, JSON.stringify({ days: usage, cooling: [...cooling.entries()].filter(([, c]) => c.until > now), groups: [...groups.entries()] }));
    } catch (err) {
      console.warn('[llm:keys] Sauvegarde de l’usage impossible :', err.message);
    }
  }, 1500);
}

const keyId = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 10);
const mask = (key) => (key.length > 10 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••');

/** Jour des quotas (minuit heure du Pacifique, comme Google). */
function quotaDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date);
}

/** Prochaine remise à zéro des quotas journaliers (minuit Pacifique). */
function nextReset() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date())
      .map((p) => [p.type, Number(p.value)])
  );
  const elapsed = ((parts.hour % 24) * 3600 + parts.minute * 60 + parts.second) * 1000;
  return Date.now() - elapsed + 24 * 3600 * 1000;
}

/** Toutes les clés d'un fournisseur (.env puis site), sans doublon. */
function getKeys(provider) {
  const env = (process.env[ENV_NAMES[provider]] || '')
    .split(',')
    .map((k) => k.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return [...new Set([...env, ...(stored[provider] || [])])];
}

function stats(provider, key, model, day = quotaDay()) {
  const id = keyId(key);
  usage[day] = usage[day] || {};
  usage[day][provider] = usage[day][provider] || {};
  usage[day][provider][id] = usage[day][provider][id] || {};
  const s = (usage[day][provider][id][model] = usage[day][provider][id][model] || { requests: 0, ok: 0, errors: 0, rateLimited: 0, tokensIn: 0, tokensOut: 0, lastAt: null });
  return s;
}

function coolingInfo(provider, key, model) {
  const now = Date.now();
  for (const k of [`${provider}|${keyId(key)}|${model}`, `${provider}|${keyId(key)}|*`]) {
    const c = cooling.get(k);
    if (c && c.until > now) return c;
    if (c) cooling.delete(k);
  }
  return null;
}

function isModelCooling(provider, model) {
  const c = modelCooling.get(`${provider}|${model}`);
  if (c && c.until > Date.now()) return c;
  if (c) modelCooling.delete(`${provider}|${model}`);
  return null;
}

/** Clés utilisables pour ce modèle, la moins utilisée aujourd'hui d'abord. */
function orderedKeys(provider, model) {
  const keys = getKeys(provider);
  const day = quotaDay();
  const used = (k) => usage[day]?.[provider]?.[keyId(k)]?.[model]?.requests || 0;
  return keys.filter((k) => !coolingInfo(provider, k, model)).sort((a, b) => used(a) - used(b));
}

/** Enregistre le résultat d'un appel et met de côté ce qui doit l'être. */
function record(provider, key, model, outcome) {
  const s = stats(provider, key, model);
  s.requests += 1;
  s.lastAt = new Date().toISOString();
  if (outcome.ok) {
    s.ok += 1;
    s.tokensIn += outcome.tokensIn || 0;
    s.tokensOut += outcome.tokensOut || 0;
  } else {
    s.errors += 1;
    const id = keyId(key);
    if (outcome.reason === 'quota-day') {
      s.rateLimited += 1;
      const until = nextReset();
      // Jamais réussi sur ce modèle aujourd'hui mais déjà « épuisé » : même projet qu'une clé épuisée.
      if (s.ok === 0) {
        const exhausted = getKeys(provider).filter((k) => k !== key && cooling.get(`${provider}|${keyId(k)}|${model}`)?.reason === 'quota-day');
        if (exhausted.length) {
          const target = groups.get(`${provider}|${keyId(exhausted[0])}`) || keyId(exhausted[0]);
          const mine = groups.get(`${provider}|${id}`) || id;
          for (const [k, g] of groups) if (g === mine) groups.set(k, target);
          groups.set(`${provider}|${id}`, target);
          for (const k of exhausted) if (!groups.has(`${provider}|${keyId(k)}`)) groups.set(`${provider}|${keyId(k)}`, target);
        }
      }
      // Toute la famille (même projet) est épuisée pour ce modèle.
      const group = groups.get(`${provider}|${id}`);
      for (const k of getKeys(provider)) {
        if (k === key || (group && groups.get(`${provider}|${keyId(k)}`) === group)) cooling.set(`${provider}|${keyId(k)}|${model}`, { until, reason: 'quota-day' });
      }
    } else if (outcome.reason === 'quota-minute') {
      s.rateLimited += 1;
      cooling.set(`${provider}|${id}|${model}`, { until: Date.now() + 65 * 1000, reason: 'quota-minute' });
    } else if (outcome.reason === 'invalid') {
      cooling.set(`${provider}|${id}|*`, { until: Date.now() + 24 * 3600 * 1000, reason: 'invalid' });
    } else if (outcome.reason === 'overloaded' || outcome.reason === 'slow') {
      modelCooling.set(`${provider}|${model}`, { until: Date.now() + 3 * 60 * 1000, reason: outcome.reason });
    } else if (outcome.reason === 'missing') {
      modelCooling.set(`${provider}|${model}`, { until: Date.now() + 3600 * 1000, reason: 'missing' });
    }
  }
  scheduleSave();
}

/** Classe une erreur d'API : quota (jour / minute), clé refusée, modèle saturé / lent / absent. */
function classify(message, status) {
  const msg = String(message || '');
  if (status === 401 || status === 403 || /\b(401|403)\b|API key not valid|invalid api key|PERMISSION_DENIED/i.test(msg)) return 'invalid';
  if (status === 429 || /\b429\b|quota|rate limit|RESOURCE_EXHAUSTED|too many requests/i.test(msg)) {
    // Google : « GenerateRequestsPerDayPerProjectPerModel » ; Groq : « requests per day (RPD) ».
    if (/PerMinute|per minute|\bRPM\b|\bTPM\b/i.test(msg) && !/PerDay|per day|\bRPD\b/i.test(msg)) return 'quota-minute';
    return /PerDay|per day|daily|\bRPD\b|exceeded your current quota/i.test(msg) ? 'quota-day' : 'quota-minute';
  }
  if (status === 404 || /\b404\b|not found|does not exist|model_not_found/i.test(msg)) return 'missing';
  if (/timeout|aborted/i.test(msg)) return 'slow';
  if (status >= 500 || /\b(500|502|503|504)\b|overloaded|high demand|unavailable|Error fetching|fetch failed/i.test(msg)) return 'overloaded';
  return 'other';
}

// ------------------------------------------------------------ clés ajoutées depuis le site

function saveKeys() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(stored, null, 2));
}

function addKeys(provider, raw) {
  if (!ENV_NAMES[provider]) throw new Error('Fournisseur inconnu.');
  const list = String(raw || '')
    .split(/[\s,;]+/)
    .map((k) => k.trim().replace(/^["']|["']$/g, ''))
    .filter((k) => k.length >= 20);
  if (list.length === 0) throw new Error('Aucune clé valide (collez une ou plusieurs clés, séparées par des virgules ou des retours à la ligne).');
  const existing = new Set(getKeys(provider));
  const added = list.filter((k) => !existing.has(k));
  stored[provider] = [...(stored[provider] || []), ...added];
  saveKeys();
  return added.length;
}

function removeKey(provider, id) {
  const before = (stored[provider] || []).length;
  stored[provider] = (stored[provider] || []).filter((k) => keyId(k) !== id);
  saveKeys();
  return before !== stored[provider].length;
}

// ------------------------------------------------------------ rapport pour le site

function report(providers) {
  const day = quotaDay();
  const now = Date.now();
  const envKeys = (p) => new Set((process.env[ENV_NAMES[p]] || '').split(',').map((k) => k.trim().replace(/^["']|["']$/g, '')).filter(Boolean));
  return {
    day,
    resetAt: new Date(nextReset()).toISOString(),
    providers: providers
      .filter((p) => ENV_NAMES[p.id])
      .map((p) => {
        const env = envKeys(p.id);
        // Lettre par projet détecté (A, B…) ; une clé seule n'a pas de lettre.
        const groupIds = [...new Set(getKeys(p.id).map((k) => groups.get(`${p.id}|${keyId(k)}`)).filter(Boolean))];
        const groupSize = (g) => getKeys(p.id).filter((k) => groups.get(`${p.id}|${keyId(k)}`) === g).length;
        const keys = getKeys(p.id).map((k) => {
          const id = keyId(k);
          const g = groups.get(`${p.id}|${id}`);
          const project = g && groupSize(g) > 1 ? { letter: String.fromCharCode(65 + groupIds.indexOf(g)), size: groupSize(g) } : null;
          const perModel = usage[day]?.[p.id]?.[id] || {};
          const models = Object.entries(perModel).map(([model, s]) => {
            const c = coolingInfo(p.id, k, model) || isModelCooling(p.id, model);
            return { model, ...s, status: c ? c.reason : 'ok', until: c ? new Date(c.until).toISOString() : null };
          });
          const all = coolingInfo(p.id, k, '__all__');
          const totals = models.reduce(
            (acc, m) => ({ requests: acc.requests + m.requests, ok: acc.ok + m.ok, rateLimited: acc.rateLimited + m.rateLimited, tokens: acc.tokens + m.tokensIn + m.tokensOut }),
            { requests: 0, ok: 0, rateLimited: 0, tokens: 0 }
          );
          return {
            id,
            masked: mask(k),
            project,
            source: env.has(k) ? 'env' : 'site',
            status: all?.reason === 'invalid' ? 'invalid' : models.some((m) => m.status === 'ok') || models.length === 0 ? 'ok' : 'limited',
            ...totals,
            models: models.sort((a, b) => b.requests - a.requests),
          };
        });
        const cooledModels = [...modelCooling.entries()]
          .filter(([k, c]) => k.startsWith(`${p.id}|`) && c.until > now)
          .map(([k, c]) => ({ model: k.split('|')[1], reason: c.reason, until: new Date(c.until).toISOString() }));
        return { id: p.id, name: p.name, keys, cooledModels };
      }),
  };
}

module.exports = { getKeys, orderedKeys, record, classify, isModelCooling, addKeys, removeKey, report, keyId, ENV_NAMES };
