require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs/promises');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');

const { downloadVideo } = require('./services/downloader');
const { transcribeAudio } = require('./services/transcriber');
const { findViralMoment } = require('./services/curator');
const { renderClip, cleanupJobDir } = require('./services/renderer');
const { detectEncoder } = require('./services/ffmpegUtils');
const { listFonts, FONTS_DIR } = require('./services/fonts');
const { ensureSfx, listSfx } = require('./services/sfx');
const media = require('./services/media');
const jobs = require('./services/jobs');
const db = require('./services/db');
const captionEngine = require('../shared/captionEngine');
const composerRoutes = require('./routes/composer');
const mediaRoutes = require('./routes/media');
const captionsRoutes = require('./routes/captions');
const editorRoutes = require('./routes/editor');
const aiRoutes = require('./routes/ai');
const llm = require('./services/llm');

function slugify(text) {
  return text.toString().toLowerCase()
    .normalize('NFD') // Remove accents
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '') || 'clip';
}

const app = express();
const PORT = process.env.PORT || 4000;
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET non défini : clé de développement utilisée. Définissez JWT_SECRET en production.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-pour-cliptok-v1';

const TEMP_DIR = media.TEMP_DIR;
const OUTPUT_DIR = media.OUTPUT_DIR;

app.use(cors(process.env.FRONTEND_URL ? { origin: process.env.FRONTEND_URL } : {}));

// L'export de l'éditeur envoie des calques PNG volumineux : il a son propre parseur (routes/editor.js).
const jsonParser = express.json({ limit: '25mb' });
app.use((req, res, next) => (/^\/api\/editor\/projects\/[^/]+\/export$/.test(req.path) ? next() : jsonParser(req, res, next)));

app.use('/output', express.static(OUTPUT_DIR));
app.use('/output', express.static(path.join(__dirname, '..', 'clips')));
app.use('/media', express.static(media.MEDIA_DIR));
app.use('/media', express.static(path.join(__dirname, 'media')));
app.use('/sfx', express.static(media.SFX_DIR, { maxAge: '7d' }));
app.use('/fonts', express.static(FONTS_DIR, { maxAge: '30d' }));

app.use('/api/composer', composerRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/captions', captionsRoutes);
app.use('/api/editor', editorRoutes);
app.use('/api/ai', aiRoutes);

// Middleware d'authentification
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé. Token manquant.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

const YOUTUBE_URL_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i;
const VALID_PRESETS = new Set(captionEngine.PRESETS.map((p) => p.id));

/**
 * Orchestration séquentielle complète :
 * download -> transcribe -> curate -> face-track + render -> cleanup.
 * Chaque étape peut échouer indépendamment ; le job est toujours nettoyé en sortie.
 * L'annulation tue réellement les processus en cours (yt-dlp, Whisper, ffmpeg).
 */
app.post('/api/generate-clip', (req, res) => {
  const {
    youtubeUrl,
    quality = '1080p',
    targetDuration = 60,
    speedMode = 'precise',
    withSubtitles = true,
    captionStyle = 'classic',
    format = 'portrait',
    clipCount = 'auto',
    videoSpeed = 1.0,
    projectId = null,
    aiProvider = null,
  } = req.body || {};

  if (!youtubeUrl || !YOUTUBE_URL_REGEX.test(youtubeUrl)) {
    return res.status(400).json({ success: false, error: 'URL YouTube invalide.' });
  }

  if (!llm.hasProvider()) {
    return res.status(500).json({
      success: false,
      error: "Aucune IA configurée côté serveur : ajoutez une clé gratuite (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY, CEREBRAS_API_KEY) ou OLLAMA_MODEL dans backend/.env.",
    });
  }

  const speed = Math.min(4, Math.max(0.25, Number(videoSpeed) || 1));
  const style = typeof captionStyle === 'string' ? (VALID_PRESETS.has(captionStyle) ? captionStyle : 'classic') : captionEngine.resolveStyle(captionStyle);
  let jobDir = null;

  const jobId = jobs.startJob({
    kind: 'generate',
    onFinally: () => jobDir && cleanupJobDir(jobDir),
    run: async (ctx) => {
      jobDir = path.join(TEMP_DIR, ctx.id);
      const log = (msg) => console.log(`[job ${ctx.id}] ${msg}`);
      log(`Démarrage : ${youtubeUrl} (Qualité: ${quality}, Durée Cible: ${targetDuration}s, Speed: ${speedMode})`);
      await fs.mkdir(jobDir, { recursive: true });

      ctx.step(1, 'Téléchargement de la vidéo (yt-dlp)...', 0);
      const { videoPath, audioPath, title, sourceDuration } = await downloadVideo(
        youtubeUrl,
        jobDir,
        quality,
        (percent) => ctx.step(1, `Téléchargement : ${percent.toFixed(1)}%`, percent),
        ctx.signal
      );

      const estimatedSeconds = speedMode === 'fast' ? Math.max(10, Math.round(sourceDuration * 0.2)) : Math.max(10, Math.round(sourceDuration * 0.4));
      ctx.emit('estimate', { estimatedSeconds, sourceDuration });

      ctx.step(2, 'Transcription et analyse (Whisper)...', 0);
      const transcript = await transcribeAudio(audioPath, jobDir, speedMode, { signal: ctx.signal }, (percent) =>
        ctx.step(2, `Transcription audio : ${percent.toFixed(1)}%`, percent)
      );
      ctx.throwIfCancelled();

      // Plafonné à 5 : au-delà, la réponse JSON du LLM risque d'être tronquée.
      const calculatedClipCount = Math.min(
        5,
        clipCount === 'auto' || !clipCount ? Math.max(1, Math.round(sourceDuration / targetDuration)) : parseInt(clipCount, 10) || 1
      );

      ctx.step(3, 'Curation IA en cours (Veuillez patienter)...', -1);
      log(`Curation IA en cours pour ${calculatedClipCount} clip(s) avec le mode ${speedMode}...`);
      const clips = await findViralMoment(transcript, jobDir, targetDuration, calculatedClipCount, speedMode, ctx.signal, aiProvider);
      ctx.throwIfCancelled();
      log(`Résultats de l'IA :\n${JSON.stringify(clips, null, 2)}`);

      ctx.step(4, `L'IA a trouvé ${clips.length} moment(s) viral(aux) ! Préparation du rendu HD...`, 0);

      const generationFolderName = `${slugify(title || 'video')}-${ctx.id.substring(0, 8)}`;
      const projectOutputDir = path.join(OUTPUT_DIR, generationFolderName);
      await fs.mkdir(projectOutputDir, { recursive: true });

      const renderedClips = [];
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const clipFileName = `${slugify(clip.title)}-${i + 1}.mp4`;
        const label = `Clip ${i + 1}/${clips.length} : "${clip.title}"`;
        ctx.progress({ current: i + 1, total: clips.length, message: `${label} (Score: ${clip.viralityScore}%)`, percent: 0 });

        await renderClip({
          sourceVideoPath: videoPath,
          clip,
          transcript,
          jobDir,
          outputDir: projectOutputDir,
          jobId: clipFileName.replace('.mp4', ''),
          quality,
          withSubtitles,
          captionStyle: style,
          format,
          videoSpeed: speed,
          signal: ctx.signal,
          onProgress: (percent) =>
            ctx.progress({ current: i + 1, total: clips.length, message: `${label} - ${percent.toFixed(1)}%`, percent }),
        });
        ctx.throwIfCancelled();

        renderedClips.push({
          videoUrl: `/output/${generationFolderName}/${clipFileName}`,
          audioUrl: `/output/${generationFolderName}/${clipFileName.replace('.mp4', '.mp3')}`,
          title: clip.title,
          viralityScore: clip.viralityScore,
          reason: clip.reason,
          caption: clip.caption,
          hashtags: clip.hashtags || [],
          clipStart: clip.start,
          clipEnd: clip.end,
          sourceTitle: title,
        });
      }

      const saved = await db.addClips(renderedClips, projectId);
      log('Terminé.');
      return { clips: saved, projectId };
    },
  });

  res.json({ success: true, jobId });
});

// Suivi et annulation des tâches (génération, sous-titres, export éditeur...).
app.get('/api/jobs/:jobId/events', jobs.sseHandler);
app.post('/api/jobs/:jobId/cancel', jobs.cancelHandler);
// Anciennes routes conservées pour compatibilité.
app.get('/api/status/:jobId', jobs.sseHandler);
app.post('/api/cancel-job/:jobId', jobs.cancelHandler);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/fonts', (req, res) => res.json(listFonts()));
app.get('/api/sfx', (req, res) => res.json(listSfx()));

app.get('/api/download', (req, res) => {
  const filePath = media.resolvePublicPath(req.query.url);
  if (!filePath) return res.status(404).json({ error: 'Fichier introuvable' });
  // Nom choisi par l'utilisateur (sans caractères interdits par Windows), extension d'origine conservée.
  const ext = path.extname(filePath);
  const wanted = String(req.query.name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\.+$/, '').trim().slice(0, 150);
  const fileName = wanted ? (wanted.toLowerCase().endsWith(ext.toLowerCase()) ? wanted : wanted + ext) : path.basename(filePath);
  res.download(filePath, fileName, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Fichier introuvable' });
  });
});

app.get('/api/gpu-stats', (req, res) => {
  exec('nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name --format=csv,noheader,nounits', (error, stdout) => {
    if (error) {
      return res.status(500).json({ error: 'Impossible de lire les infos GPU' });
    }
    const parts = stdout.trim().split(', ');
    if (parts.length >= 5) {
      res.json({
        utilization: parseInt(parts[0], 10),
        vramUsed: parseInt(parts[1], 10),
        vramTotal: parseInt(parts[2], 10),
        temperature: parseInt(parts[3], 10),
        name: parts[4]
      });
    } else {
      res.status(500).json({ error: 'Format inattendu' });
    }
  });
});

app.get('/api/clips', async (req, res) => {
  try {
    const clips = await db.getClips();
    res.json(clips);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function deleteClipFiles(clip) {
  for (const url of [clip.videoUrl, clip.audioUrl]) {
    const filePath = media.resolvePublicPath(url);
    if (!filePath) continue;
    await fs.unlink(filePath).catch(() => { });
  }
}

app.delete('/api/clips/:id', async (req, res) => {
  try {
    const clip = await db.deleteClip(req.params.id);
    if (!clip) return res.status(404).json({ error: 'Clip introuvable' });
    await deleteClipFiles(clip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Suppression groupée (une seule écriture en base au lieu de N requêtes concurrentes).
app.post('/api/clips/delete', async (req, res) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    const removed = await db.deleteClips(ids);
    for (const clip of removed) await deleteClipFiles(clip);
    res.json({ success: true, deleted: removed.length });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/clips/:id/move', async (req, res) => {
  try {
    const { projectId } = req.body;
    const clip = await db.moveClipToProject(req.params.id, projectId);
    if (!clip) return res.status(404).json({ error: 'Clip introuvable' });
    res.json({ success: true, clip });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- PROJECTS ---

app.get('/api/projects', async (req, res) => {
  try {
    const projects = await db.getProjects();
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name } = req.body;
    const project = await db.createProject(name);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.patch('/api/projects/:id', async (req, res) => {
  try {
    const project = await db.renameProject(req.params.id, req.body && req.body.name);
    if (!project) return res.status(404).json({ error: 'Projet introuvable' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    const project = await db.deleteProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Projet introuvable' });
    // On supprime aussi physiquement tous les clips contenus dans ce projet
    for (const clip of (project.clips || [])) {
      await deleteClipFiles(clip);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- AUTHENTICATION ---

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

    const existingUser = await db.getUserByEmail(email);
    if (existingUser) return res.status(400).json({ error: 'Cet email est déjà utilisé.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await db.createUser(email, hashedPassword, name);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    console.error('[AUTH REGISTER ERROR]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.getUserByIdentifier(email);
    if (!user) return res.status(401).json({ error: 'Email/Pseudo ou mot de passe incorrect.' });

    const isValid = await bcrypt.compare(password || '', user.password);
    if (!isValid) return res.status(401).json({ error: 'Email/Pseudo ou mot de passe incorrect.' });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    console.error('[AUTH LOGIN ERROR]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.post('/api/auth/guest', async (req, res) => {
  try {
    const guestEmail = `guest_${Date.now()}@guest.local`;
    const hashedPassword = await bcrypt.hash('guest', 10);
    const user = await db.createUser(guestEmail, hashedPassword, 'Invité');

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    console.error('[AUTH GUEST ERROR]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  // Factice pour l'instant
  const { email } = req.body;
  const user = await db.getUserByEmail(email);
  if (!user) return res.status(404).json({ error: 'Aucun compte trouvé avec cet email.' });

  // On reset directement le mdp à "123456" pour la démo
  const newHash = await bcrypt.hash('123456', 10);
  await db.updateUser(user.id, { password: newHash });
  console.log(`[AUTH] Mot de passe réinitialisé à '123456' pour l'utilisateur ${email}`);

  res.json({ success: true, message: 'Pour cette démo, le mot de passe a été réinitialisé à "123456".' });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.put('/api/auth/settings', authMiddleware, async (req, res) => {
  try {
    const { name, avatar, language, bio } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (avatar !== undefined) updates.avatar = avatar;
    if (language !== undefined) updates.language = language;
    if (bio !== undefined) updates.bio = bio;

    const updatedUser = await db.updateUser(req.userId, updates);
    if (!updatedUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const { password: _, ...userWithoutPassword } = updatedUser;
    res.json({ user: userWithoutPassword });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- TEAMS ---

app.post('/api/teams', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const team = await db.createTeam(name, req.userId);
    res.json(team);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.post('/api/teams/join', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    const team = await db.getTeamByToken(token);
    if (!team) return res.status(404).json({ error: 'Lien d\'invitation invalide ou expiré.' });

    await db.updateUser(req.userId, { teamId: team.id });
    res.json({ success: true, team });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.get('/api/teams/:id', authMiddleware, async (req, res) => {
  try {
    const team = await db.getTeamById(req.params.id);
    if (!team) return res.status(404).json({ error: 'Équipe introuvable.' });
    const members = await db.getTeamMembers(team.id);
    res.json({ team, members });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.post('/api/upload-cookies', express.text({ limit: '10mb' }), async (req, res) => {
  try {
    const cookiesText = req.body;
    if (!cookiesText || !cookiesText.includes('# Netscape HTTP Cookie File')) {
      return res.status(400).json({ error: 'Fichier de cookies invalide. Assurez-vous d\'exporter au format Netscape.' });
    }
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    await fs.writeFile(cookiesPath, cookiesText, 'utf-8');
    res.json({ success: true, message: 'Cookies uploadés avec succès.' });
  } catch (err) {
    console.error('[COOKIES UPLOAD ERROR]', err);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde des cookies.' });
  }
});

// Erreurs d'upload (taille max, etc.) et JSON invalide : réponse JSON lisible par le frontend.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error('[server]', err);
  res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux.' : err.message || 'Erreur serveur.' });
});

async function bootstrap() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  await media.ensureDirs();
  await db.initDB();

  const server = app.listen(PORT, () => {
    console.log(`ClipTok backend démarré sur http://localhost:${PORT}`);
    console.log(`[storage] Médias : ${media.MEDIA_DIR} | Clips : ${media.OUTPUT_DIR} | Temp : ${media.TEMP_DIR}`);
  });

  // Le pipeline complet (download + Whisper + LLM + ffmpeg) peut prendre plusieurs minutes.
  server.timeout = 20 * 60 * 1000;

  // Tâches de fond : détection de l'encodeur et génération des effets sonores manquants.
  detectEncoder().then((enc) => console.log(`[ffmpeg] Encodeur vidéo : ${enc}`));
  ensureSfx().then((list) => console.log(`[sfx] ${list.length} effets sonores disponibles.`)).catch((err) => console.warn('[sfx]', err.message));
}

bootstrap().catch((err) => {
  console.error('Échec du démarrage du serveur :', err);
  process.exit(1);
});

module.exports = app;
