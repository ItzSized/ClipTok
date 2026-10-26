const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const media = require('../services/media');
const jobs = require('../services/jobs');
const captionEngine = require('../../shared/captionEngine');
const { renderCaptionedVideo, outputSize } = require('../services/captions/captionRenderer');
const { getFont } = require('../services/fonts');
const { probeMedia } = require('../services/ffmpegUtils');

const router = express.Router();
const TEMP_DIR = path.join(media.TEMP_DIR, 'captions');
const OUTPUT_SUBDIR = 'captions';

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'video'
  );
}

function sanitizeWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .map((w) => ({
      text: String(w.text ?? w.word ?? '').slice(0, 100),
      start: Number(w.start),
      end: Number(w.end),
      loud: Boolean(w.loud),
      ...(w.probability !== undefined ? { probability: Number(w.probability) } : {}),
    }))
    .filter((w) => w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start)
    .slice(0, 50000);
}

function sanitizeFraming(f) {
  const framing = f || {};
  return {
    aspect: ['original', '9:16', '1:1', '4:5', '16:9'].includes(framing.aspect) ? framing.aspect : 'original',
    fit: ['crop', 'blur', 'black'].includes(framing.fit) ? framing.fit : 'crop',
    cropX: Math.min(1, Math.max(0, Number(framing.cropX ?? 0.5))),
  };
}

async function withMedia(project) {
  if (!project) return null;
  const m = await db.getDoc('media', project.mediaId);
  return { ...project, media: m ? media.summarize(m) : null };
}

router.get('/projects', async (req, res) => {
  const list = await db.listDocs('captionProjects');
  res.json(
    await Promise.all(
      list.map(async (p) => {
        const { words, ...rest } = p;
        return { ...(await withMedia(rest)), wordCount: (words || []).length };
      })
    )
  );
});

router.post('/projects', async (req, res) => {
  const m = await db.getDoc('media', req.body && req.body.mediaId);
  if (!m) return res.status(404).json({ error: 'Média introuvable.' });
  if (m.kind !== 'video') return res.status(400).json({ error: 'Les sous-titres incrustés nécessitent une vidéo.' });
  const project = await db.createDoc('captionProjects', {
    name: (req.body.name || m.name || 'Sous-titres').slice(0, 200),
    mediaId: m.id,
    words: m.transcript ? sanitizeWords(m.transcript.words) : [],
    language: m.transcript ? m.transcript.language : null,
    style: captionEngine.applyPreset(req.body.preset || 'hormozi'),
    framing: sanitizeFraming({ aspect: 'original' }),
    lastRender: null,
  });
  res.json(await withMedia(project));
});

router.get('/projects/:id', async (req, res) => {
  const project = await db.getDoc('captionProjects', req.params.id);
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  res.json(await withMedia(project));
});

router.put('/projects/:id', async (req, res) => {
  const body = req.body || {};
  const updates = {};
  if (body.name !== undefined) updates.name = String(body.name).slice(0, 200);
  if (body.words !== undefined) updates.words = sanitizeWords(body.words);
  if (body.style !== undefined) updates.style = captionEngine.resolveStyle(body.style);
  if (body.framing !== undefined) updates.framing = sanitizeFraming(body.framing);
  if (body.language !== undefined) updates.language = body.language;
  const project = await db.updateDoc('captionProjects', req.params.id, updates);
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  res.json(await withMedia(project));
});

router.delete('/projects/:id', async (req, res) => {
  const project = await db.deleteDoc('captionProjects', req.params.id);
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  res.json({ success: true });
});

/** Rendu MP4 avec sous-titres incrustés (tâche SSE). */
router.post('/projects/:id/render', async (req, res) => {
  const project = await db.getDoc('captionProjects', req.params.id);
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  const m = await db.getDoc('media', project.mediaId);
  const sourcePath = m && media.resolvePublicPath(m.url);
  if (!sourcePath) return res.status(404).json({ error: 'Vidéo source introuvable.' });
  if (!project.words || project.words.length === 0) return res.status(400).json({ error: 'Aucun mot à afficher : lancez la transcription.' });

  const jobDir = path.join(TEMP_DIR, uuidv4());
  const jobId = jobs.startJob({
    kind: 'captions',
    onFinally: () => fs.rm(jobDir, { recursive: true, force: true }),
    run: async (ctx) => {
      ctx.step(1, 'Incrustation des sous-titres...', 0);
      const outDir = path.join(media.OUTPUT_DIR, OUTPUT_SUBDIR);
      await fs.mkdir(outDir, { recursive: true });
      const fileName = `${slugify(project.name)}-${uuidv4().slice(0, 8)}.mp4`;
      const outputPath = path.join(outDir, fileName);
      const sourceMeta = await probeMedia(sourcePath);
      const size = await renderCaptionedVideo({
        sourcePath,
        sourceMeta,
        words: project.words,
        style: project.style,
        framing: project.framing,
        jobDir,
        outputPath,
        signal: ctx.signal,
        onProgress: (p) => ctx.step(1, `Rendu : ${p.toFixed(0)}%`, p),
      });
      // On supprime l'ancien rendu pour ne pas accumuler les fichiers.
      if (project.lastRender) {
        const old = media.resolvePublicPath(project.lastRender.videoUrl);
        if (old && old !== outputPath) await fs.unlink(old).catch(() => { });
      }
      const lastRender = { videoUrl: media.publicUrlFor(outputPath), createdAt: new Date().toISOString(), ...size };
      await db.updateDoc('captionProjects', project.id, { lastRender });
      return lastRender;
    },
  });
  res.json({ jobId });
});

/** Export texte : srt, vtt, ass ou txt. */
router.get('/projects/:id/export/:format', async (req, res) => {
  const project = await db.getDoc('captionProjects', req.params.id);
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  const format = req.params.format;
  const base = slugify(project.name);
  let content;
  let type = 'text/plain; charset=utf-8';
  if (format === 'srt') content = captionEngine.toSrt(project.words, project.style);
  else if (format === 'vtt') {
    content = captionEngine.toVtt(project.words, project.style);
    type = 'text/vtt; charset=utf-8';
  } else if (format === 'txt') content = captionEngine.toPlainText(project.words);
  else if (format === 'ass') {
    const m = await db.getDoc('media', project.mediaId);
    const { width, height } = outputSize(m?.width || 1080, m?.height || 1920, project.framing?.aspect);
    const style = captionEngine.resolveStyle(project.style);
    content = captionEngine.buildAss({ words: project.words, style, width, height, font: getFont(style.fontId) });
  } else return res.status(400).json({ error: 'Format inconnu (srt, vtt, ass, txt).' });
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${base}.${format}"`);
  res.send(content);
});

module.exports = router;
