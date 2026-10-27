/**
 * Point d'entrée unique pour appeler un modèle de langage gratuit.
 *
 * Les fournisseurs configurés sont essayés dans l'ordre de AI_PROVIDERS
 * (par défaut : gemini, groq, openrouter, mistral, cerebras, ollama). Si l'un
 * échoue (quota atteint, panne, clé invalide, JSON illisible), on passe
 * automatiquement au suivant.
 */
const { PROVIDERS, ProviderError } = require('./providers');

const DEFAULT_ORDER = ['gemini', 'groq', 'openrouter', 'mistral', 'cerebras', 'ollama'];

/**
 * Ordre d'essai. Par défaut, Groq (réponse en 1-2 s) passe avant Gemini, souvent
 * saturé sur l'offre gratuite ; en mode « Le plus poussé » (tier max), Gemini Pro
 * reste prioritaire. AI_PROVIDERS impose un ordre fixe.
 */
function order(tier) {
  const fromEnv = (process.env.AI_PROVIDERS || '').split(',').map((s) => s.trim().toLowerCase()).filter((id) => PROVIDERS[id]);
  const fast = ['groq', 'gemini', ...DEFAULT_ORDER.filter((id) => id !== 'groq' && id !== 'gemini')];
  const list = fromEnv.length ? fromEnv : tier === 'max' ? DEFAULT_ORDER : fast;
  return [...list, ...DEFAULT_ORDER.filter((id) => !list.includes(id))];
}

/** Liste des fournisseurs pour l'interface (aucune clé n'est exposée). */
function listProviders() {
  return order().map((id) => {
    const p = PROVIDERS[id];
    return { id, name: p.name, configured: p.isConfigured(), model: p.isConfigured() ? p.model('smart') : null };
  });
}

function hasProvider() {
  return Object.values(PROVIDERS).some((p) => p.isConfigured());
}

/**
 * Génère un objet JSON.
 * @param {object} opts
 * @param {string} opts.system    instructions système
 * @param {string} opts.prompt    message utilisateur
 * @param {object} [opts.schema]  schéma JSON attendu (strict pour Gemini, décrit dans le prompt sinon)
 * @param {'fast'|'balanced'|'smart'|'max'} [opts.tier]
 * @param {string} [opts.preferred] fournisseur à essayer en premier
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.timeoutMs] délai maximal par appel de modèle
 * @returns {Promise<{ data: object, provider: string, model: string }>}
 */
async function generateJson(opts) {
  // Avec des images, seuls les fournisseurs capables de les lire.
  const ids = order(opts.tier).filter((id) => PROVIDERS[id].isConfigured() && (!opts.images?.length || PROVIDERS[id].vision));
  if (opts.preferred && ids.includes(opts.preferred)) {
    ids.splice(ids.indexOf(opts.preferred), 1);
    ids.unshift(opts.preferred);
  }
  if (ids.length === 0) {
    throw new ProviderError(
      "Aucune IA configurée. Ajoutez au moins une clé gratuite dans backend/.env (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY, CEREBRAS_API_KEY) ou un modèle local OLLAMA_MODEL.",
      { retryable: false }
    );
  }
  const errors = [];
  for (const id of ids) {
    if (opts.signal?.aborted) throw new Error("Tâche annulée par l'utilisateur.");
    try {
      // Le modèle choisi dans l'interface ne vaut que pour son fournisseur.
      const hasRelay = ids.indexOf(id) < ids.length - 1;
      const { data, model } = await PROVIDERS[id].generate({ ...opts, tier: opts.tier || 'balanced', model: id === opts.preferred ? opts.model : undefined, maxModels: hasRelay ? 2 : Infinity });
      if (errors.length) console.log(`[llm] Réponse obtenue via ${id} (${model}) après échec de : ${errors.map((e) => e.id).join(', ')}`);
      return { data, provider: id, model };
    } catch (err) {
      if (opts.signal?.aborted) throw new Error("Tâche annulée par l'utilisateur.");
      console.warn(`[llm] ${id} a échoué : ${String(err.message).slice(0, 200)}`);
      errors.push({ id, message: err.message });
      if (err instanceof ProviderError && !err.retryable) break;
    }
  }
  throw new ProviderError(`Toutes les IA ont échoué :\n${errors.map((e) => `- ${e.id} : ${String(e.message).slice(0, 200)}`).join('\n')}`);
}

/** Modèles disponibles chez un fournisseur (pour le choix dans l'interface). */
async function listModels(providerId) {
  const p = PROVIDERS[providerId];
  if (!p || !p.isConfigured()) return [];
  try {
    return await p.listModels();
  } catch (err) {
    console.warn(`[llm] Liste des modèles ${providerId} indisponible : ${err.message}`);
    return [p.model('fast'), p.model('smart')].filter((m, i, a) => a.indexOf(m) === i);
  }
}

/** Ce modèle est-il le « petit » modèle rapide du fournisseur (à ne pas garder pour toute une discussion) ? */
function isFastModel(providerId, model) {
  const p = PROVIDERS[providerId];
  return Boolean(p && model && p.model('fast') === model && p.model('smart') !== model);
}

module.exports = { generateJson, listProviders, hasProvider, listModels, isFastModel };
