const express = require('express');
const media = require('../services/media');
const tts = require('../services/tts');

const router = express.Router();

router.get('/voices', (req, res) => res.json(tts.listVoices()));

router.get('/voices/:id/preview', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(await tts.previewFile(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Génère une voix off. Corps : { text, voice, rate, pitch }. Retourne le média créé. */
router.post('/', async (req, res) => {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  try {
    const { text, voice, rate, pitch } = req.body || {};
    const doc = await tts.generateVoice(text, { voice, rate, pitch }, controller.signal);
    res.json(media.summarize(doc));
  } catch (err) {
    if (!controller.signal.aborted) res.status(400).json({ error: err.message });
  }
});

module.exports = router;
