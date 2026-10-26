const express = require('express');
const db = require('../services/db');
const llm = require('../services/llm');
const keyPool = require('../services/llm/keys');
const { webSearch } = require('../services/webSearch');
const aiEditor = require('../../shared/aiEditor');

const router = express.Router();
const MAX_CONTEXT_CHARS = 120000;

/** Modes de l'Éditeur IA : niveau de modèle, délai, nombre de tours de recherche web. */
const MODES = {
  fast: { tier: 'fast', timeoutMs: 30000, searchRounds: 1 },
  balanced: { tier: 'smart', timeoutMs: 45000, searchRounds: 2 },
  max: { tier: 'max', timeoutMs: 120000, searchRounds: 3 },
};

/** Fournisseurs d'IA gratuits et leur état de configuration (aucune clé exposée). */
router.get('/providers', (req, res) => {
  res.json(llm.listProviders());
});

/** Modèles disponibles chez un fournisseur. */
router.get('/models', async (req, res) => {
  res.json(await llm.listModels(String(req.query.provider || '')));
});

/** Recherche web directe (utile pour tester). */
router.get('/search', async (req, res) => {
  try {
    res.json(await webSearch(String(req.query.q || '')));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * Éditeur IA : transforme une demande en langage naturel en plan d'actions.
 * Corps : { request, history, context, provider?, model?, mode?: 'fast'|'balanced'|'max', webSearch?: boolean }
 * Si l'IA a besoin d'informations, elle demande des recherches web ; on les
 * exécute puis on la relance avec les résultats (quelques tours au maximum).
 */
router.post('/edit', async (req, res) => {
  const { request, history = [], context = {}, provider, model, mode = 'balanced', webSearch: allowSearch = true } = req.body || {};
  if (!request || typeof request !== 'string' || !request.trim()) {
    return res.status(400).json({ error: 'Demande vide.' });
  }
  let contextJson = JSON.stringify(context);
  if (contextJson.length > MAX_CONTEXT_CHARS) {
    // Projets énormes : on retire d'abord les extraits de transcription.
    const slim = { ...context, media: (context.media || []).map(({ transcript, ...m }) => m) };
    contextJson = JSON.stringify(slim);
    if (contextJson.length > MAX_CONTEXT_CHARS) return res.status(413).json({ error: 'Projet trop volumineux pour l’assistant IA.' });
  }
  const settings = MODES[mode] || MODES.balanced;

  // Annule l'appel à l'IA si le navigateur abandonne la requête. Écouter `res`
  // (et non `req`, dont 'close' survient dès que le corps POST est lu).
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  try {
    const research = [];
    const ask = () =>
      llm.generateJson({
        system: aiEditor.buildSystemPrompt({ webSearch: Boolean(allowSearch), mode }),
        prompt: aiEditor.buildUserPrompt(JSON.parse(contextJson), history, request.trim().slice(0, 2000), research),
        // Si la demande est trop grosse pour une IA gratuite (limite de jetons par minute), version allégée.
        slim: {
          system: aiEditor.buildSystemPrompt({ webSearch: false, mode, slim: true }),
          prompt: aiEditor.buildUserPrompt(aiEditor.slimContext(JSON.parse(contextJson)), history, request.trim().slice(0, 1500), research.map((r) => ({ ...r, summary: String(r.summary || '').slice(0, 600) })), { slim: true }),
        },
        tier: settings.tier,
        temperature: mode === 'fast' ? 0.3 : 0.4,
        preferred: provider,
        model,
        signal: controller.signal,
        timeoutMs: settings.timeoutMs,
      });

    let result = await ask();
    for (let round = 0; round < settings.searchRounds && allowSearch; round++) {
      const queries = (Array.isArray(result.data.search) ? result.data.search : [])
        .filter((q) => typeof q === 'string' && q.trim())
        .slice(0, 3)
        .filter((q) => !research.some((r) => r.query === q));
      if (queries.length === 0) break;
      const found = await Promise.all(
        queries.map((q) => webSearch(q, controller.signal).catch((err) => ({ query: q, summary: `Recherche impossible : ${err.message}`, sources: [] })))
      );
      research.push(...found);
      result = await ask();
    }

    const data = result.data;
    const actions = (Array.isArray(data.actions) ? data.actions : [])
      .filter((a) => a && typeof a === 'object' && aiEditor.ACTION_TYPES.includes(a.type))
      .slice(0, 200);
    // Mémoire : ce que l'IA veut retenir / oublier (enregistré par le navigateur, qui connaît les médias).
    const remember = (Array.isArray(data.remember) ? data.remember : [])
      .map((r) => (typeof r === 'string' ? { text: r } : r))
      .filter((r) => r && typeof r.text === 'string' && r.text.trim())
      .slice(0, 10)
      .map((r) => ({ text: r.text.trim().slice(0, 500), media: Array.isArray(r.media) ? r.media.filter((m) => typeof m === 'string').slice(0, 30) : [] }));
    const forget = (Array.isArray(data.forget) ? data.forget : []).filter((k) => typeof k === 'string').slice(0, 20);
    res.json({
      remember,
      forget,
      reply: typeof data.reply === 'string' ? data.reply : '',
      actions,
      provider: result.provider,
      model: result.model,
      searches: research.map((r) => ({ query: r.query, engine: r.engine, sources: (r.sources || []).slice(0, 5) })),
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    res.status(502).json({ error: err.message });
  }
});

/**
 * B-roll automatique. Corps : { segments: [{start,end,text}], media: [{id,name,kind,duration,desc,tags,text}],
 * duration, instructions?, provider?, model? }. Retourne { placements, provider, model }.
 */
router.post('/broll', async (req, res) => {
  const { segments = [], media = [], duration = 0, instructions = '', provider, model, mode = 'balanced' } = req.body || {};
  if (!Array.isArray(segments) || segments.length === 0) return res.status(400).json({ error: 'Aucune parole à illustrer.' });
  if (!Array.isArray(media) || media.length === 0) return res.status(400).json({ error: 'Aucun média à placer.' });
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const settings = MODES[mode] || MODES.balanced;
  try {
    const clean = (s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').slice(0, 300) });
    const result = await llm.generateJson({
      system: aiEditor.BROLL_SYSTEM,
      prompt: aiEditor.buildBrollPrompt({
        segments: segments.slice(0, 600).map(clean),
        media: media.slice(0, 80).map((m) => ({ ...m, duration: Number(m.duration) || 0, tags: Array.isArray(m.tags) ? m.tags.slice(0, 25) : [] })),
        duration: Number(duration) || 0,
        instructions: String(instructions || '').slice(0, 500),
      }),
      tier: settings.tier,
      temperature: 0.3,
      preferred: provider,
      model,
      signal: controller.signal,
      timeoutMs: settings.timeoutMs,
    });
    const placements = (Array.isArray(result.data.placements) ? result.data.placements : []).filter((p) => p && typeof p.media === 'string').slice(0, 200);
    res.json({ placements, provider: result.provider, model: result.model });
  } catch (err) {
    if (controller.signal.aborted) return;
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------- clés et usage
// Plusieurs clés gratuites par fournisseur : rotation automatique selon l'usage et les quotas.

router.get('/usage', (req, res) => {
  res.json(keyPool.report(llm.listProviders()));
});

router.post('/keys', (req, res) => {
  try {
    const added = keyPool.addKeys(String(req.body?.provider || ''), req.body?.keys);
    res.json({ added });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/keys/:provider/:id', (req, res) => {
  if (!keyPool.removeKey(req.params.provider, req.params.id)) return res.status(404).json({ error: 'Clé introuvable (les clés du fichier .env se retirent dans ce fichier).' });
  res.json({ success: true });
});

// ---------------------------------------------------------------- mémoire de l'IA
// Préférences et ressources que l'utilisateur veut voir réutilisées dans tous ses projets.

const cleanMemory = (body) => ({
  text: String(body?.text || '').trim().slice(0, 500),
  media: (Array.isArray(body?.media) ? body.media : [])
    .filter((m) => m && typeof m.id === 'string')
    .slice(0, 30)
    .map((m) => ({ id: m.id, name: String(m.name || '').slice(0, 200) })),
});

router.get('/memory', async (req, res) => {
  res.json(await db.listDocs('aiMemory'));
});

router.post('/memory', async (req, res) => {
  const entry = cleanMemory(req.body);
  if (!entry.text) return res.status(400).json({ error: 'Souvenir vide.' });
  res.json(await db.createDoc('aiMemory', entry));
});

router.patch('/memory/:id', async (req, res) => {
  const entry = cleanMemory(req.body);
  if (!entry.text) return res.status(400).json({ error: 'Souvenir vide.' });
  const doc = await db.updateDoc('aiMemory', req.params.id, entry);
  if (!doc) return res.status(404).json({ error: 'Souvenir introuvable.' });
  res.json(doc);
});

router.delete('/memory/:id', async (req, res) => {
  const doc = await db.deleteDoc('aiMemory', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Souvenir introuvable.' });
  res.json({ success: true });
});

/**
 * Génère automatiquement un titre + description virale + hashtags pour TikTok, YouTube Shorts et Instagram Reels.
 */
router.post('/social-caption', async (req, res) => {
  const { title = '', transcript = '', clipNames = [], duration = 0 } = req.body || {};
  const cleanTitle = String(title || '').replace(/\.(mp4|mov|mkv)$/i, '').trim();
  const cleanTranscript = String(transcript || '').trim().slice(0, 1500);
  const clips = (Array.isArray(clipNames) ? clipNames : []).map((c) => String(c || '').replace(/\.[a-z0-9]+$/i, '')).filter(Boolean).slice(0, 15);

  const buildFallback = () => {
    const hook = cleanTranscript ? cleanTranscript.split(/[.!?]/)[0].trim().slice(0, 110) : cleanTitle || 'Regarde ça jusqu’à la fin ! 🔥';
    const isGaming = /roblox|game|gaming|farm|loot|seed|crate|boss|win|minecraft|fortnite/i.test(`${cleanTitle} ${cleanTranscript} ${clips.join(' ')}`);
    const tags = isGaming
      ? '#gaming #roblox #fyp #pourtoi #viral #shorts #reels #gameplay #tiktokgaming'
      : '#fyp #pourtoi #viral #shorts #reels #tiktok #trending';
    return {
      title: (cleanTitle || hook || 'Nouvelle vidéo 🔥').slice(0, 95),
      description: `${hook} 🔥👀\n\nDis-moi ce que t'en penses en commentaire ! 👇\n\n${tags}`,
      hashtags: tags.split(' '),
    };
  };

  try {
    const result = await llm.generateJson({
      system:
        'Tu es un expert en réseaux sociaux (TikTok, YouTube Shorts, Instagram Reels). Réponds UNIQUEMENT en JSON valide de la forme {"title":"Titre accrocheur court (<90 car.)","description":"Description virale prête à copier-coller avec hook, call-to-action et 6 à 10 hashtags pertinents","hashtags":["#tag1","#tag2"]}. Adapte la langue (français ou anglais) au texte de la vidéo ou au titre.',
      prompt: JSON.stringify({
        projectTitle: cleanTitle,
        spokenTranscript: cleanTranscript,
        sceneClips: clips,
        durationSeconds: Math.round(Number(duration) || 0),
      }),
      tier: 'fast',
      temperature: 0.5,
      timeoutMs: 12000,
    });
    const d = result?.data || {};
    if (typeof d.description === 'string' && d.description.trim()) {
      return res.json({
        title: typeof d.title === 'string' && d.title.trim() ? d.title.trim() : cleanTitle,
        description: d.description.trim(),
        hashtags: Array.isArray(d.hashtags) ? d.hashtags : [],
        provider: result.provider,
      });
    }
  } catch { }
  res.json(buildFallback());
});

module.exports = router;
