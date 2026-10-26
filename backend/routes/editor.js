const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const media = require('../services/media');
const jobs = require('../services/jobs');
const core = require('../../shared/editorCore');
const { renderProject } = require('../services/editor/editorRenderer');

const router = express.Router();
const TEMP_DIR = path.join(media.TEMP_DIR, 'editor');
const OUTPUT_SUBDIR = 'editor';
const MAX_PROJECT_BYTES = 20 * 1024 * 1024;

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'projet'
  );
}

/** Contrôle minimal de structure (le contenu détaillé est validé au rendu). */
function validateProject(p) {
  if (!p || typeof p !== 'object') throw new Error('Projet invalide.');
  if (!p.settings || !Array.isArray(p.tracks) || !Array.isArray(p.clips) || !Array.isArray(p.transitions)) {
    throw new Error('Projet invalide (settings, tracks, clips, transitions requis).');
  }
  const w = Number(p.settings.width);
  const h = Number(p.settings.height);
  if (!(w >= 64 && w <= 4096 && h >= 64 && h <= 4096)) throw new Error('Dimensions du projet invalides.');
  if (JSON.stringify(p).length > MAX_PROJECT_BYTES) throw new Error('Projet trop volumineux.');
  return p;
}

function summarize(doc) {
  const p = doc.project || {};
  const firstVisual = (p.clips || []).find((c) => (c.type === 'video' || c.type === 'image') && c.mediaId);
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    settings: p.settings,
    duration: core.projectDuration(p),
    clipCount: (p.clips || []).length,
    thumbnailUrl: firstVisual ? `/api/media/${firstVisual.mediaId}/thumbnail` : null,
    lastExport: doc.lastExport || null,
  };
}

router.get('/projects', async (req, res) => {
  res.json((await db.listDocs('editorProjects')).map(summarize));
});

/** Crée un projet, éventuellement pré-rempli avec des médias ou un clip généré. */
router.post('/projects', async (req, res) => {
  try {
    const body = req.body || {};
    const project = core.createProject({ aspect: body.aspect || '9:16' });
    const ids = Array.isArray(body.mediaIds) ? body.mediaIds.slice(0, 50) : [];
    if (body.clipId) {
      const clip = await db.findClip(body.clipId);
      if (clip) {
        const existing = (await db.listDocs('media')).find((m) => m.url === clip.videoUrl);
        const filePath = media.resolvePublicPath(clip.videoUrl);
        const m = existing || (filePath ? await media.registerFile(filePath, { name: clip.title, source: 'clip' }) : null);
        if (m) ids.unshift(m.id);
      }
    }
    const main = core.mainTrack(project);
    const audioTrack = project.tracks.find((t) => t.kind === 'audio');
    let cursor = 0;
    let audioCursor = 0;
    for (const id of ids) {
      const m = await db.getDoc('media', id);
      if (!m) continue;
      if (m.kind === 'audio') {
        const c = core.createMediaClip(m, audioTrack.id, audioCursor);
        project.clips.push(c);
        audioCursor += c.duration;
      } else {
        const c = core.createMediaClip(m, main.id, cursor);
        project.clips.push(c);
        cursor += c.duration;
      }
    }
    // Un projet créé depuis une vidéo prend le format de cette vidéo, sauf choix explicite.
    const firstVideo = project.clips.find((c) => c.type === 'video');
    if (firstVideo && !body.aspect && firstVideo.width && firstVideo.height) {
      const ratio = firstVideo.width / firstVideo.height;
      const match = core.ASPECT_RATIOS.reduce((best, r) => (Math.abs(r.width / r.height - ratio) < Math.abs(best.width / best.height - ratio) ? r : best));
      Object.assign(project.settings, { aspect: match.id, width: match.width, height: match.height });
    }
    const name = (body.name || (project.clips[0] && project.clips[0].name) || 'Nouveau projet').slice(0, 200);
    const doc = await db.createDoc('editorProjects', { name, project, lastExport: null });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id', async (req, res) => {
  const doc = await db.getDoc('editorProjects', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Projet introuvable.' });
  res.json(doc);
});

router.put('/projects/:id', async (req, res) => {
  try {
    const updates = {};
    if (req.body.name !== undefined) updates.name = String(req.body.name).slice(0, 200);
    if (req.body.project !== undefined) updates.project = validateProject(req.body.project);
    const doc = await db.updateDoc('editorProjects', req.params.id, updates);
    if (!doc) return res.status(404).json({ error: 'Projet introuvable.' });
    res.json(summarize(doc));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/projects/:id/duplicate', async (req, res) => {
  const doc = await db.getDoc('editorProjects', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Projet introuvable.' });
  const copy = await db.createDoc('editorProjects', { name: `${doc.name} (copie)`, project: doc.project, lastExport: null });
  res.json(summarize(copy));
});

router.delete('/projects/:id', async (req, res) => {
  const doc = await db.deleteDoc('editorProjects', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Projet introuvable.' });
  res.json({ success: true });
});

/**
 * Export MP4 (tâche SSE). Corps : { project, quality, rasters: { [clipId]: 'data:image/png;base64,...' } }.
 * Le projet envoyé est aussi enregistré (l'export correspond toujours à la dernière version).
 */
router.post('/projects/:id/export', express.json({ limit: '200mb' }), async (req, res) => {
  const doc = await db.getDoc('editorProjects', req.params.id);
  if (!doc) return res.status(404).json({ error: 'Projet introuvable.' });
  let project;
  try {
    project = validateProject(req.body.project || doc.project);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const quality = ['720p', '1080p', '4k'].includes(req.body.quality) ? req.body.quality : '1080p';
  const rasters = req.body.rasters && typeof req.body.rasters === 'object' ? req.body.rasters : {};
  const fingerprint = typeof req.body.fingerprint === 'string' ? req.body.fingerprint.slice(0, 64) : undefined;
  await db.updateDoc('editorProjects', doc.id, { project });

  const jobDir = path.join(TEMP_DIR, uuidv4());
  const jobId = jobs.startJob({
    kind: 'editor-export',
    onFinally: () => fs.rm(jobDir, { recursive: true, force: true }),
    run: async (ctx) => {
      ctx.step(1, 'Préparation des calques...', 0);
      await fs.mkdir(jobDir, { recursive: true });
      const rasterPaths = {};
      for (const [clipId, dataUrl] of Object.entries(rasters)) {
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
        if (!match || !/^[\w-]+$/.test(clipId)) continue;
        const file = path.join(jobDir, `raster_${clipId}.png`);
        await fs.writeFile(file, Buffer.from(match[1], 'base64'));
        rasterPaths[clipId] = file;
      }
      const outDir = path.join(media.OUTPUT_DIR, OUTPUT_SUBDIR);
      await fs.mkdir(outDir, { recursive: true });
      const outputPath = path.join(outDir, `${slugify(doc.name)}-${uuidv4().slice(0, 8)}.mp4`);
      ctx.step(2, 'Rendu vidéo...', 0);
      const result = await renderProject({
        project,
        rasters: rasterPaths,
        jobDir,
        outputPath,
        quality,
        signal: ctx.signal,
        onProgress: (p) => ctx.step(2, `Rendu : ${p.toFixed(0)}%`, p),
      });
      if (doc.lastExport) {
        const old = media.resolvePublicPath(doc.lastExport.videoUrl);
        if (old && old !== outputPath) await fs.unlink(old).catch(() => { });
      }
      const lastExport = {
        videoUrl: media.publicUrlFor(outputPath),
        createdAt: new Date().toISOString(),
        quality,
        width: result.width,
        height: result.height,
        duration: result.duration,
        fingerprint,
      };
      await db.updateDoc('editorProjects', doc.id, { lastExport });
      return lastExport;
    },
  });
  res.json({ jobId });
});

module.exports = router;
