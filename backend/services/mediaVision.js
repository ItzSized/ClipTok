/**
 * mediaVision.js — l'IA « regarde » les médias importés.
 *
 * Pour chaque vidéo (3 images prises à 15 %, 50 % et 85 %) ou image, un modèle
 * de vision gratuit (Gemini) produit une courte description et des mots-clés.
 * Ils sont stockés sur le média (`vision`) et servent à l'Éditeur IA pour
 * illustrer automatiquement ce qui est dit (B-roll : « l'appareil photo » →
 * le clip où l'on voit un appareil photo).
 */
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const llm = require('./llm');
const { runFfmpeg } = require('./ffmpegUtils');
const { resolvePublicPath, CACHE_DIR } = require('./media');

const SYSTEM = `You describe media files for a video editor so that clips can later be matched to what a narrator says.
Answer ONLY with JSON: {"description":"<one or two English sentences: what is visible, place, objects, people, action, on-screen UI>","tags":["<10 to 20 short lowercase keywords, English AND French synonyms (ex: camera, appareil photo, lobby, menu, car, voiture)>"],"text":"<important visible text, or empty>"}`;

/** Images JPEG (base64) représentatives du média, réduites pour limiter le coût. */
async function sampleFrames(doc) {
  const source = resolvePublicPath(doc.url);
  if (!source) throw new Error('Fichier source introuvable.');
  const dir = path.join(CACHE_DIR, `vision-${uuidv4()}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    const points = doc.kind === 'video' ? [0.15, 0.5, 0.85].map((r) => Math.max(0, (doc.duration || 0) * r)) : [0];
    const frames = [];
    for (let i = 0; i < points.length; i++) {
      const out = path.join(dir, `${i}.jpg`);
      const seek = doc.kind === 'video' ? ['-ss', points[i].toFixed(2)] : [];
      await runFfmpeg(['-y', ...seek, '-i', source, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', out]);
      frames.push({ mimeType: 'image/jpeg', data: (await fs.readFile(out)).toString('base64') });
    }
    return frames;
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Décrit un média (si ce n'est pas déjà fait) et enregistre le résultat. */
async function describeMedia(id, { signal, force = false } = {}) {
  const doc = await db.getDoc('media', id);
  if (!doc || (doc.kind !== 'video' && doc.kind !== 'image')) return doc;
  if (doc.vision && !force) return doc;
  const images = await sampleFrames(doc);
  const { data, model } = await llm.generateJson({
    system: SYSTEM,
    prompt: `File name: ${doc.name}\n${doc.kind === 'video' ? `Video, ${Math.round(doc.duration)} s. The ${images.length} images are taken at 15 %, 50 % and 85 % of the video.` : 'Image / screenshot.'}`,
    images,
    tier: 'fast',
    temperature: 0.2,
    signal,
    timeoutMs: 45000,
  });
  const vision = {
    description: String(data.description || '').slice(0, 600),
    tags: (Array.isArray(data.tags) ? data.tags : []).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 25),
    text: String(data.text || '').slice(0, 200),
    model,
    createdAt: new Date().toISOString(),
  };
  return db.updateDoc('media', id, { vision });
}

// File d'attente : les analyses se font une par une, en arrière-plan (quotas gratuits).
let chain = Promise.resolve();
const queued = new Set();

/** Analyse en arrière-plan (après un import), sans bloquer la réponse. */
function queueDescribe(ids) {
  for (const id of ids) {
    if (queued.has(id)) continue;
    queued.add(id);
    chain = chain
      .then(() => describeMedia(id))
      .catch((err) => console.warn(`[vision] ${id} : ${String(err.message).slice(0, 160)}`))
      .finally(() => queued.delete(id));
  }
  return chain;
}

module.exports = { describeMedia, queueDescribe };
