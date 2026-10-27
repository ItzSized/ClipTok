const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const { FFMPEG_PATH, runFfmpeg, toolEnv } = require('./ffmpegUtils');

const PYTHON_PATH = process.env.PYTHON_PATH || 'python';

/**
 * Args d'authentification/anti-bot optionnels, lus depuis l'environnement.
 * YouTube exige de plus en plus souvent une preuve "non-bot" (cookies ou client
 * mobile) ; ces variables permettent de la fournir sans toucher au code.
 */
function buildAuthArgs() {
  const args = [];
  const fsSync = require('fs');
  const cookiesPath = path.join(__dirname, '..', 'cookies.txt');
  
  if (process.env.YTDLP_COOKIES) {
    args.push('--cookies', process.env.YTDLP_COOKIES);
  } else if (fsSync.existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath);
  }
  
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
    args.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
  }
  if (process.env.YTDLP_EXTRA_ARGS) {
    args.push(...process.env.YTDLP_EXTRA_ARGS.split(' ').filter(Boolean));
  }
  
  args.push('--js-runtimes', 'node');
  args.push('--remote-components', 'ejs:github');
  
  return args;
}

const BOT_CHECK_PATTERN = /sign in to confirm|not a bot|429|403/i;

/**
 * Exécute yt-dlp et capture stdout/stderr sans jamais faire déborder la mémoire
 * (la progression du téléchargement est ignorée, seule l'erreur finale est gardée).
 */
function runYtDlp(args, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_PATH, ['-u', '-m', 'yt_dlp', ...args], { windowsHide: true, env: toolEnv(), signal });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      if (onProgress) {
        const match = text.match(/\[download\]\s+(\d+\.\d)%/);
        if (match) {
          try {
            onProgress(parseFloat(match[1]));
          } catch (e) {
            child.kill();
            reject(e);
          }
        }
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });

    child.on('error', (err) => {
      if (err.name === 'AbortError') return reject(new Error("Tâche annulée par l'utilisateur."));
      reject(
        new Error(
          `Impossible de lancer yt-dlp. Vérifie que Python et le module yt-dlp sont installés (pip install yt-dlp, ou configure PYTHON_PATH) : ${err.message}`
        )
      );
    });

    child.on('close', (code) => {
      if (signal && signal.aborted) return reject(new Error("Tâche annulée par l'utilisateur."));
      if (code === 0) resolve({ stdout, stderr });
      else {
        const err = new Error(`yt-dlp a échoué (code ${code}) : ${stderr.slice(-2000)}`);
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

/** Lance yt-dlp avec les arguments d'authentification / anti-bot configurés. */
async function runYtDlpWithAuth(args, onProgress, signal) {
  return await runYtDlp([...args, ...buildAuthArgs()], onProgress, signal);
}

async function getVideoMetadata(youtubeUrl, signal) {
  const { stdout } = await runYtDlpWithAuth(['--dump-json', '--no-playlist', youtubeUrl], null, signal);
  const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
  if (!lastLine) throw new Error("yt-dlp n'a renvoyé aucune métadonnée pour cette URL.");

  const meta = JSON.parse(lastLine);
  return {
    id: meta.id,
    title: meta.title || 'video',
    duration: meta.duration || 0,
  };
}

/**
 * Extrait une piste audio mono 16kHz/64kbps : suffisant pour Whisper,
 * et permet de rester sous la limite de taille de l'API le plus longtemps possible.
 */
async function extractAudio(videoPath, jobDir, signal) {
  const audioPath = path.join(jobDir, 'audio.mp3');
  try {
    await runFfmpeg(['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-c:a', 'libmp3lame', audioPath], { signal });
  } catch (err) {
    throw new Error(`Extraction audio échouée : ${err.message}`);
  }
  return audioPath;
}

/**
 * Télécharge la vidéo YouTube (mp4) puis en extrait l'audio.
 * Retourne les chemins locaux des fichiers générés.
 */
async function downloadVideo(youtubeUrl, jobDir, quality = '1080p', onProgress, signal) {
  try {
    if (!youtubeUrl || typeof youtubeUrl !== 'string') {
      throw new Error('URL YouTube manquante ou invalide.');
    }

    await fs.mkdir(jobDir, { recursive: true });

    const meta = await getVideoMetadata(youtubeUrl, signal);
    const videoPath = path.join(jobDir, 'source.mkv');

    const maxHeight = quality === '4k' ? 2160 : 1080;

    await runYtDlpWithAuth([
      '-f',
      `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/best`,
      '--merge-output-format',
      'mkv',
      '--ffmpeg-location',
      FFMPEG_PATH,
      '--no-playlist',
      '--retries',
      '3',
      '-o',
      videoPath,
      youtubeUrl,
    ], onProgress, signal);

    const stat = await fs.stat(videoPath).catch(() => null);
    if (!stat || stat.size === 0) {
      throw new Error('Le téléchargement de la vidéo a échoué (fichier vide ou introuvable).');
    }

    const audioPath = await extractAudio(videoPath, jobDir, signal);

    return {
      videoPath,
      audioPath,
      title: meta.title,
      sourceDuration: meta.duration,
    };
  } catch (err) {
    if (signal && signal.aborted) throw err;
    if (err.message.includes('Sign in to confirm') || err.message.includes('403') || err.message.includes('429')) {
      throw new Error(`YouTube a bloqué l'accès (Anti-Bot).`);
    }
    if (
      err.message.includes('Video unavailable') ||
      err.message.includes('Incomplete YT ID') ||
      err.message.includes('Private video')
    ) {
      throw new Error(`Le lien YouTube est invalide, la vidéo est privée ou elle n'existe pas.`);
    }
    throw new Error(`[downloader] ${err.message}`);
  }
}

module.exports = { downloadVideo, extractAudio, getVideoMetadata, runYtDlpWithAuth };
