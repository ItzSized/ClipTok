const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const { probeClip } = require('../services/composer/clipAnalyzer');
const { renderComposition } = require('../services/composer/composerRenderer');
const media = require('../services/media');

const router = express.Router();

const TEMP_DIR = path.join(media.TEMP_DIR, 'composer');
const OUTPUT_DIR = media.OUTPUT_DIR;

// Configure multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const jobId = req.params.jobId;
    const dir = path.join(TEMP_DIR, jobId, 'input');
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage });

const composerJobs = new Map();

function emitEvent(jobId, type, data) {
  const job = composerJobs.get(jobId);
  if (!job) return;
  job.history.push({ type, data });
  if (job.res) {
    job.res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  }
}

// 1. Initialiser le job
router.post('/init', (req, res) => {
  const jobId = uuidv4();
  composerJobs.set(jobId, { history: [], res: null, done: false, cancelled: false, files: {} });
  res.json({ jobId });
});

// 2. Upload des fichiers
router.post('/:jobId/upload', upload.array('clips', 30), async (req, res) => {
  const jobId = req.params.jobId;
  const job = composerJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Les chemins disque restent côté serveur : le client ne manipule que des identifiants.
  const files = req.files.map((f) => {
    const id = uuidv4();
    job.files[id] = { path: f.path, originalName: f.originalname };
    return { id, originalName: f.originalname, size: f.size };
  });

  res.json({ success: true, files });
});

// 3. Lancer le rendu
router.post('/:jobId/render', async (req, res) => {
  const jobId = req.params.jobId;
  const job = composerJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { clips: requested, settings = {} } = req.body || {};
  // clips : [{ id }] dans l'ordre voulu ; seuls les fichiers uploadés pour ce job sont acceptés.
  const clips = (Array.isArray(requested) ? requested : []).map((c) => job.files[c && c.id]).filter(Boolean);
  if (clips.length === 0) return res.status(400).json({ error: 'Aucun clip valide à assembler.' });

  const jobDir = path.join(TEMP_DIR, jobId);

  res.json({ success: true });

  (async () => {
    try {
      emitEvent(jobId, 'step', { step: 1, message: 'Analyse des clips (FFprobe)...', percent: 0 });

      const analyzedClips = [];
      let totalDuration = 0;

      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        if (job.cancelled) throw new Error("Annulé");
        emitEvent(jobId, 'step', { step: 1, message: `Analyse du clip ${i + 1}/${clips.length}...`, percent: (i / clips.length) * 100 });

        const metadata = await probeClip(c.path);
        analyzedClips.push({
          file: c.path,
          originalName: c.originalName,
          ...metadata
        });
        totalDuration += metadata.duration;
      }

      emitEvent(jobId, 'estimate', { estimatedSeconds: totalDuration });
      emitEvent(jobId, 'step', { step: 2, message: 'Rendu de la composition (FFmpeg)...', percent: 0 });

      const outputPath = await renderComposition(jobId, jobDir, analyzedClips, settings, (percent) => {
        if (job.cancelled) throw new Error("Annulé");
        emitEvent(jobId, 'progress', { message: `Rendu : ${percent.toFixed(1)}%`, percent });
      });

      // Move output to final output dir
      const finalFileName = `composer-${jobId.substring(0, 8)}.mp4`;
      const finalPath = path.join(OUTPUT_DIR, finalFileName);
      await fs.copyFile(outputPath, finalPath);

      const resultData = {
        videoUrl: `/output/${finalFileName}`,
        duration: totalDuration
      };

      emitEvent(jobId, 'done', resultData);
    } catch (err) {
      console.error(`[composer job ${jobId}] Erreur:`, err);
      emitEvent(jobId, 'error', { error: err.message });
    } finally {
      job.done = true;
      if (job.res) {
        job.res.write(`data: ${JSON.stringify({ type: 'closed' })}\n\n`);
        job.res.end();
      }
      setTimeout(() => composerJobs.delete(jobId), 1000 * 60 * 60);

      // Cleanup temp
      fs.rm(jobDir, { recursive: true, force: true }).catch(() => { });
    }
  })();
});

// 4. SSE Status
router.get('/:jobId/status', (req, res) => {
  const jobId = req.params.jobId;
  const job = composerJobs.get(jobId);

  if (!job) return res.status(404).json({ error: 'Job non trouvé' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  for (const event of job.history) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  if (job.done) {
    res.write(`data: ${JSON.stringify({ type: 'closed' })}\n\n`);
    res.end();
    return;
  }

  job.res = res;
  req.on('close', () => {
    if (job.res === res) job.res = null;
  });
});

router.post('/:jobId/cancel', (req, res) => {
  const jobId = req.params.jobId;
  const job = composerJobs.get(jobId);
  if (job) {
    job.cancelled = true;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Job non trouvé' });
  }
});

module.exports = router;
