/**
 * media.js
 *
 * Gestion des fichiers médias (vidéos, sons, images) utilisés par les
 * sous-titres et l'éditeur : emplacement disque, résolution sécurisée des URL
 * publiques, enregistrement en base, miniatures et formes d'onde.
 */
const path = require('path');
const fs = require('fs/promises');
const db = require('./db');
const { probeMedia, runFfmpeg, FFMPEG_PATH } = require('./ffmpegUtils');

const fsSync = require('fs');
const BACKEND_DIR = path.join(__dirname, '..');

/**
 * Dossier de stockage des fichiers volumineux (médias importés, cache, rendus,
 * fichiers temporaires). Par défaut : STORAGE_DIR (dans .env), sinon D:\Whop\ClipTok
 * si D:\Whop existe sur la machine, sinon les dossiers locaux du projet.
 */
function resolveStorageRoot() {
  if (process.env.STORAGE_DIR) return path.resolve(process.env.STORAGE_DIR);
  if (fsSync.existsSync('D:\\Whop')) return 'D:\\Whop\\ClipTok';
  if (fsSync.existsSync('D:\\')) return 'D:\\ClipTok';
  return null;
}

const STORAGE_ROOT = resolveStorageRoot();
const MEDIA_DIR = STORAGE_ROOT ? path.join(STORAGE_ROOT, 'media') : path.join(BACKEND_DIR, 'media');
const UPLOADS_DIR = path.join(MEDIA_DIR, 'uploads');
const CACHE_DIR = path.join(MEDIA_DIR, 'cache');
const OUTPUT_DIR = STORAGE_ROOT ? path.join(STORAGE_ROOT, 'clips') : path.join(BACKEND_DIR, '..', 'clips');
const TEMP_DIR = STORAGE_ROOT ? path.join(STORAGE_ROOT, 'temp') : path.join(BACKEND_DIR, 'temp');

/**
 * Bibliothèque audio (sur D: avec STORAGE_DIR) : les musiques et sons importés y
 * sont rangés automatiquement sous leur vrai nom, les voix off générées aussi.
 * Tout fichier audio déposé à la main dans ces dossiers apparaît dans l'éditeur.
 */
const LIBRARY_DIR = path.join(MEDIA_DIR, 'Bibliotheque');
const LIBRARY = {
  music: path.join(LIBRARY_DIR, 'Musiques'),
  sfx: path.join(LIBRARY_DIR, 'SFX'),
  voice: path.join(LIBRARY_DIR, 'Voix'),
};
/** Sons intégrés (générés par sfx.js), dans un sous-dossier de la bibliothèque SFX. */
const LEGACY_SFX_DIR = path.join(BACKEND_DIR, 'assets', 'sfx');
const SFX_DIR = STORAGE_ROOT ? path.join(LIBRARY.sfx, 'ClipTok') : LEGACY_SFX_DIR;
/** Au-delà de cette durée, un son importé est rangé dans Musiques plutôt que SFX. */
const SFX_MAX_DURATION = 20;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|wma)$/i;

/** Préfixes d'URL publiques -> dossiers disque (voir les express.static de server.js). */
const PUBLIC_ROOTS = {
  '/media/': MEDIA_DIR,
  '/output/': OUTPUT_DIR,
  '/sfx/': SFX_DIR,
};

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Résout une URL publique ("/output/x/y.mp4", "/media/uploads/z.mov"...) vers son
 * chemin disque, en refusant toute sortie du dossier racine (path traversal).
 */
function resolvePublicPath(publicUrl) {
  if (!publicUrl || typeof publicUrl !== 'string') return null;
  const clean = decodeURIComponent(publicUrl.split('?')[0]);
  for (const [prefix, root] of Object.entries(PUBLIC_ROOTS)) {
    if (!clean.startsWith(prefix)) continue;
    const resolved = path.join(root, clean.slice(prefix.length));
    return isInside(root, resolved) ? resolved : null;
  }
  return null;
}

function publicUrlFor(filePath) {
  for (const [prefix, root] of Object.entries(PUBLIC_ROOTS)) {
    if (isInside(root, filePath)) {
      return prefix + path.relative(root, filePath).split(path.sep).map(encodeURIComponent).join('/');
    }
  }
  return null;
}

function kindFromMeta(meta, mimetype = '') {
  if (mimetype.startsWith('image/') || meta.isImage) return 'image';
  if (meta.hasVideo) return 'video';
  if (meta.hasAudio) return 'audio';
  return null;
}

/** Dossier de bibliothèque d'un fichier ('music' | 'sfx' | 'voice'), ou null. */
function libraryOf(filePath) {
  if (isInside(SFX_DIR, filePath)) return null;
  return Object.keys(LIBRARY).find((k) => isInside(LIBRARY[k], filePath)) || null;
}

/** Nom de fichier lisible et libre dans `dir` (« Musique.mp3 », « Musique (2).mp3 »...). */
async function freeName(dir, name, ext) {
  const base = (path.basename(name).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'son').slice(0, 120);
  for (let i = 1; ; i++) {
    const candidate = path.join(dir, `${base}${i > 1 ? ` (${i})` : ''}${ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
}

/** Range un son importé dans la bibliothèque (Musiques ou SFX selon sa durée). */
async function moveToLibrary(filePath, name, duration) {
  const dir = duration > 0 && duration <= SFX_MAX_DURATION ? LIBRARY.sfx : LIBRARY.music;
  await fs.mkdir(dir, { recursive: true });
  const target = await freeName(dir, name || path.basename(filePath), path.extname(filePath).toLowerCase());
  try {
    await fs.rename(filePath, target);
  } catch {
    // Autre disque : copie puis suppression.
    await fs.copyFile(filePath, target);
    await fs.unlink(filePath).catch(() => { });
  }
  return target;
}

/** Enregistre un fichier déjà présent sur disque comme média. */
async function registerFile(filePath, { name, mimetype, source = 'upload', size, toLibrary = false, extra = {} } = {}) {
  const meta = await probeMedia(filePath);
  const kind = kindFromMeta(meta, mimetype);
  if (!kind) throw new Error(`Format non pris en charge : ${name || path.basename(filePath)}`);
  if (toLibrary && kind === 'audio') filePath = await moveToLibrary(filePath, name, meta.duration);
  const url = publicUrlFor(filePath);
  if (!url) throw new Error('Fichier hors des dossiers publics.');
  return db.createDoc('media', {
    name: name || path.basename(filePath),
    kind,
    url,
    source,
    size: size ?? (await fs.stat(filePath)).size,
    duration: kind === 'image' ? 0 : meta.duration,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    hasAudio: meta.hasAudio,
    library: libraryOf(filePath),
    transcript: null,
    ...extra,
  });
}

let lastScan = 0;
let scanning = null;

/**
 * Ajoute aux médias les fichiers audio déposés à la main dans la bibliothèque
 * (au plus une fois toutes les 15 s ; les sons intégrés de ClipTok sont ignorés).
 */
function scanLibrary(force = false) {
  if (scanning) return scanning;
  if (!force && Date.now() - lastScan < 15000) return Promise.resolve(0);
  lastScan = Date.now();
  scanning = (async () => {
    const known = new Set((await db.listDocs('media')).map((m) => m.url));
    let added = 0;
    const walk = async (dir, depth) => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < 3 && full !== SFX_DIR) await walk(full, depth + 1);
        } else if (AUDIO_EXT.test(e.name) && !known.has(publicUrlFor(full))) {
          try {
            await registerFile(full, { name: e.name, source: 'library' });
            added += 1;
          } catch (err) {
            console.warn(`[bibliothèque] ${e.name} ignoré : ${err.message.split('\n')[0]}`);
          }
        }
      }
    };
    for (const dir of Object.values(LIBRARY)) await walk(dir, 0);
    return added;
  })().finally(() => {
    scanning = null;
  });
  return scanning;
}

/** Version allégée d'un média pour les listes (sans les mots de transcription). */
function summarize(doc) {
  if (!doc) return doc;
  const { transcript, transcriptEn, ...rest } = doc;
  return {
    ...rest,
    transcript: transcript ? { language: transcript.language, model: transcript.model, wordCount: (transcript.words || []).length } : null,
    translated: Boolean(transcriptEn),
  };
}

async function deleteMedia(id) {
  const doc = await db.deleteDoc('media', id);
  if (!doc) return null;
  const filePath = resolvePublicPath(doc.url);
  // On ne supprime physiquement que les fichiers importés (pas les clips générés ni les sons intégrés).
  if (filePath && (isInside(UPLOADS_DIR, filePath) || libraryOf(filePath))) await fs.unlink(filePath).catch(() => { });
  for (const suffix of ['.thumb.jpg', '.peaks.json']) await fs.unlink(path.join(CACHE_DIR, id + suffix)).catch(() => { });
  return doc;
}

// Générations en cours : plusieurs requêtes simultanées pour le même média partagent la même promesse.
const inflight = new Map();

function once(key, fn) {
  if (!inflight.has(key)) {
    inflight.set(
      key,
      fn().finally(() => inflight.delete(key))
    );
  }
  return inflight.get(key);
}

async function getThumbnail(doc) {
  const target = path.join(CACHE_DIR, `${doc.id}.thumb.jpg`);
  try {
    await fs.access(target);
    return target;
  } catch { }
  return once(`thumb:${doc.id}`, async () => {
    const source = resolvePublicPath(doc.url);
    if (!source) throw new Error('Fichier source introuvable.');
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const seek = doc.kind === 'video' ? Math.min(1, (doc.duration || 0) / 3) : 0;
    // Écriture dans un fichier temporaire puis renommage : jamais de miniature à moitié écrite.
    const tmp = `${target}.${process.pid}.tmp.jpg`;
    await runFfmpeg(['-y', '-ss', String(seek), '-i', source, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', tmp]);
    await fs.rename(tmp, target);
    return target;
  });
}

/**
 * Forme d'onde : pics absolus normalisés (0..1) par tranche de `1/rate` seconde.
 * Calculée une fois puis mise en cache.
 */
async function getWaveform(doc, rate = 50) {
  const target = path.join(CACHE_DIR, `${doc.id}.peaks.json`);
  try {
    return JSON.parse(await fs.readFile(target, 'utf-8'));
  } catch { }
  return once(`wave:${doc.id}`, () => computeWaveform(doc, rate, target));
}

async function computeWaveform(doc, rate, target) {
  const source = resolvePublicPath(doc.url);
  if (!source) throw new Error('Fichier source introuvable.');
  const sampleRate = 8000;
  const { stdout } = await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const child = spawn(FFMPEG_PATH, ['-v', 'error', '-i', source, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-'], { windowsHide: true });
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve({ stdout: Buffer.concat(chunks) }) : reject(new Error('Décodage audio impossible.'))));
  });
  const samplesPerPeak = Math.max(1, Math.floor(sampleRate / rate));
  const total = Math.floor(stdout.length / 2);
  const peaks = [];
  let max = 1;
  for (let i = 0; i < total; i += samplesPerPeak) {
    let peak = 0;
    const end = Math.min(total, i + samplesPerPeak);
    for (let j = i; j < end; j++) {
      const v = Math.abs(stdout.readInt16LE(j * 2));
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  const result = { rate, peaks: peaks.map((p) => Math.round((p / max) * 1000) / 1000) };
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(target, JSON.stringify(result));
  return result;
}

async function ensureDirs() {
  for (const dir of [MEDIA_DIR, UPLOADS_DIR, CACHE_DIR, OUTPUT_DIR, TEMP_DIR, SFX_DIR, ...Object.values(LIBRARY)]) await fs.mkdir(dir, { recursive: true });
  // Sons intégrés déjà générés dans l'ancien dossier du projet : copiés plutôt que regénérés.
  if (SFX_DIR !== LEGACY_SFX_DIR) {
    const files = await fs.readdir(LEGACY_SFX_DIR).catch(() => []);
    for (const f of files) await fs.copyFile(path.join(LEGACY_SFX_DIR, f), path.join(SFX_DIR, f), fsSync.constants.COPYFILE_EXCL).catch(() => { });
  }
}

module.exports = {
  STORAGE_ROOT,
  MEDIA_DIR,
  UPLOADS_DIR,
  CACHE_DIR,
  OUTPUT_DIR,
  TEMP_DIR,
  SFX_DIR,
  LIBRARY,
  resolvePublicPath,
  publicUrlFor,
  registerFile,
  scanLibrary,
  freeName,
  summarize,
  deleteMedia,
  getThumbnail,
  getWaveform,
  ensureDirs,
  isInside,
};
