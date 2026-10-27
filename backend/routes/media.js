const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const media = require('../services/media');
const jobs = require('../services/jobs');
const { transcribeAudio, ALLOWED_MODELS } = require('../services/transcriber');
const { describeMedia, queueDescribe } = require('../services/mediaVision');
const llm = require('../services/llm');

const router = express.Router();
const TEMP_DIR = path.join(media.TEMP_DIR, 'transcribe');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdir(media.UPLOADS_DIR, { recursive: true }).then(() => cb(null, media.UPLOADS_DIR), cb);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024, files: 30 },
});

/** Multer encode les noms en latin1 : on les recode en UTF-8 (accents). */
function originalName(file) {
  try {
    return Buffer.from(file.originalname, 'latin1').toString('utf8');
  } catch {
    return file.originalname;
  }
}

router.get('/', async (req, res) => {
  // Sons déposés à la main dans la bibliothèque (D:\…\Bibliotheque) : ajoutés automatiquement.
  await media.scanLibrary().catch((err) => console.warn('[bibliothèque]', err.message));
  const list = await db.listDocs('media');
  res.json(list.map(media.summarize));
});

router.post('/upload', upload.array('files', 30), async (req, res) => {
  const created = [];
  const errors = [];
  for (const file of req.files || []) {
    try {
      created.push(media.summarize(await media.registerFile(file.path, { name: originalName(file), mimetype: file.mimetype, size: file.size, toLibrary: true })));
    } catch (err) {
      errors.push({ name: originalName(file), error: err.message.split('\n')[0] });
      await fs.unlink(file.path).catch(() => { });
    }
  }
  if (created.length === 0 && errors.length > 0) return res.status(400).json({ error: errors[0].error, errors });
  // L'IA « regarde » les nouveaux visuels en arrière-plan (B-roll automatique de l'Éditeur IA).
  if (llm.hasProvider()) queueDescribe(created.filter((m) => m.kind !== 'audio').map((m) => m.id));
  res.json({ media: created, errors });
});

/**
 * Analyse visuelle (description + mots-clés) des médias demandés qui ne l'ont
 * pas encore. Corps : { ids: string[] }. Retourne les médias à jour.
 */
router.post('/describe', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => typeof x === 'string').slice(0, 60);
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const out = [];
  const errors = [];
  for (const id of ids) {
    try {
      const doc = await describeMedia(id, { signal: controller.signal });
      if (doc) out.push(media.summarize(doc));
    } catch (err) {
      if (controller.signal.aborted) return;
      errors.push({ id, error: String(err.message).split('\n')[0].slice(0, 200) });
    }
  }
  res.json({ media: out, errors });
});

/** Importe un clip généré (dossier clips/) comme média, sans copier le fichier. */
router.post('/import-clip', async (req, res) => {
  try {
    const clip = await db.findClip(req.body && req.body.clipId);
    if (!clip) return res.status(404).json({ error: 'Clip introuvable.' });
    const existing = (await db.listDocs('media')).find((m) => m.url === clip.videoUrl);
    if (existing) return res.json(media.summarize(existing));
    const filePath = media.resolvePublicPath(clip.videoUrl);
    if (!filePath) return res.status(404).json({ error: 'Fichier du clip introuvable.' });
    const doc = await media.registerFile(filePath, { name: clip.title, source: 'clip' });
    res.json(media.summarize(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Supprime plusieurs médias. Corps : { ids: string[] }. */
router.post('/delete-many', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => typeof x === 'string').slice(0, 2000);
  let deleted = 0;
  for (const id of ids) {
    if (await media.deleteMedia(id)) deleted += 1;
  }
  res.json({ deleted });
});

router.get('/:id', async (req, res) => {
  const doc = await db.getDoc('media', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Média introuvable.' });
  res.json(doc);
});

router.patch('/:id', async (req, res) => {
  const { name } = req.body || {};
  const doc = await db.updateDoc('media', req.params.id, name ? { name: String(name).slice(0, 200) } : {});
  if (!doc) return res.status(404).json({ error: 'Média introuvable.' });
  res.json(media.summarize(doc));
});

router.delete('/:id', async (req, res) => {
  const doc = await media.deleteMedia(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Média introuvable.' });
  res.json({ success: true });
});

router.get('/:id/thumbnail', async (req, res) => {
  try {
    const doc = await db.getDoc('media', req.params.id);
    if (!doc || doc.kind === 'audio') return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(await media.getThumbnail(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/waveform', async (req, res) => {
  try {
    const doc = await db.getDoc('media', req.params.id);
    if (!doc || (!doc.hasAudio && doc.kind !== 'audio')) return res.status(404).json({ error: 'Pas de piste audio.' });
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(await media.getWaveform(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Lance la transcription Whisper d'un média (tâche SSE). Le résultat est
 * stocké sur le média (réutilisable par les sous-titres et l'éditeur).
 */
router.post('/:id/transcribe', async (req, res) => {
  const doc = await db.getDoc('media', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Média introuvable.' });
  if (!doc.hasAudio && doc.kind !== 'audio') return res.status(400).json({ error: "Ce média n'a pas de piste audio." });
  const filePath = media.resolvePublicPath(doc.url);
  if (!filePath) return res.status(404).json({ error: 'Fichier introuvable.' });

  const language = /^[a-z]{2,3}$|^auto$/.test(req.body?.language || '') ? req.body.language : 'auto';
  const model0 = ALLOWED_MODELS.includes(req.body?.model) ? req.body.model : 'small';
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.slice(0, 500) : '';
  // translate : Whisper traduit directement la voix en anglais (stocké à part : la
  // transcription d'origine reste utilisée pour couper les silences).
  const translate = req.body?.translate === true;
  // Les modèles « turbo » ne savent pas traduire.
  const model = translate && /turbo/.test(model0) ? 'medium' : model0;

  const jobDir = path.join(TEMP_DIR, uuidv4());
  const jobId = jobs.startJob({
    kind: 'transcribe',
    onFinally: () => fs.rm(jobDir, { recursive: true, force: true }),
    run: async (ctx) => {
      await fs.mkdir(jobDir, { recursive: true });
      ctx.step(1, translate ? `Traduction en anglais (Whisper ${model})...` : `Transcription (Whisper ${model})...`, 0);
      let transcript;
      try {
        transcript = await transcribeAudio(
          filePath,
          jobDir,
          'precise',
          { language, model, initialPrompt: prompt, signal: ctx.signal, vadFilter: true, ...(translate ? { task: 'translate' } : {}) },
          (percent) => ctx.step(1, `Transcription : ${percent.toFixed(0)}%`, percent)
        );
      } catch (err) {
        // Musique ou silence : ce n'est pas une erreur, simplement aucune parole.
        if (!/Aucun mot détecté/.test(err.message)) throw err;
        transcript = { language: language === 'auto' ? null : language, words: [] };
      }
      const words = transcript.words.map((w) => ({
        text: w.word.replace(/\[LOUD\]/g, '').trim(),
        start: w.start,
        end: w.end,
        loud: /\[LOUD\]/.test(w.word),
        probability: w.probability,
      }));
      const saved = { language: translate ? 'en' : transcript.language, model, words, createdAt: new Date().toISOString() };
      await db.updateDoc('media', doc.id, translate ? { transcriptEn: saved } : { transcript: saved });
      return { mediaId: doc.id, transcript: saved };
    },
  });
  res.json({ jobId });
});

module.exports = router;
