/**
 * ffmpegUtils.js
 *
 * Outils ffmpeg communs à tous les rendus :
 *   - chemins des binaires embarqués (ffmpeg-static / ffprobe-installer) ;
 *   - détection de l'encodeur (NVENC si une carte NVIDIA est dispo, sinon libx264) ;
 *   - exécution d'ffmpeg avec progression fiable (-progress) et annulation (AbortSignal) ;
 *   - environnement pour les scripts Python (ffmpeg/ffprobe ajoutés au PATH).
 */
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { path: ffprobePath } = require('@ffprobe-installer/ffprobe');

const FFMPEG_PATH = process.env.FFMPEG_PATH || ffmpegPath;
const FFPROBE_PATH = process.env.FFPROBE_PATH || ffprobePath;

/** Environnement à passer aux scripts Python : ils appellent "ffmpeg"/"ffprobe" via le PATH. */
function toolEnv() {
  const dirs = [path.dirname(FFMPEG_PATH), path.dirname(FFPROBE_PATH)];
  return {
    ...process.env,
    PATH: [...dirs, process.env.PATH || ''].join(path.delimiter),
    FFMPEG_BINARY: FFMPEG_PATH,
    FFPROBE_BINARY: FFPROBE_PATH,
    PYTHONIOENCODING: 'utf-8',
  };
}

function runCapture(bin, args, { signal, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, signal });
    let stdout = '';
    let stderr = '';
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 50000) stderr = stderr.slice(-50000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`${path.basename(bin)} a échoué (code ${code}) : ${stderr.slice(-1500)}`), { stderr }));
    });
  });
}

function parseRate(rate) {
  if (!rate) return 0;
  const [a, b] = String(rate).split('/').map(Number);
  if (b) return a / b;
  return Number(a) || 0;
}

/** Métadonnées d'un fichier média. */
async function probeMedia(filePath) {
  const { stdout } = await runCapture(FFPROBE_PATH, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ]);
  const data = JSON.parse(stdout);
  const v = (data.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = (data.streams || []).find((s) => s.codec_type === 'audio');
  let width = v ? v.width : 0;
  let height = v ? v.height : 0;
  // Vidéos de téléphone : la rotation est stockée en métadonnée, ffmpeg l'applique automatiquement.
  const rotate = v ? Number((v.tags && v.tags.rotate) || (v.side_data_list || []).find((s) => s.rotation !== undefined)?.rotation || 0) : 0;
  if (Math.abs(rotate) % 180 === 90) [width, height] = [height, width];
  return {
    duration: parseFloat(data.format && data.format.duration) || parseFloat(v && v.duration) || parseFloat(a && a.duration) || 0,
    width,
    height,
    fps: v ? parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || 30 : 0,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    videoCodec: v ? v.codec_name : null,
    audioCodec: a ? a.codec_name : null,
    isImage: Boolean(v) && (['png', 'mjpeg', 'webp', 'bmp', 'gif', 'tiff'].includes(v.codec_name) && !(parseFloat(data.format.duration) > 0.5)),
  };
}

let encoderPromise = null;

/** Détecte (une seule fois) si h264_nvenc est utilisable sur cette machine. */
function detectEncoder() {
  if (process.env.VIDEO_ENCODER) return Promise.resolve(process.env.VIDEO_ENCODER);
  if (!encoderPromise) {
    encoderPromise = runCapture(
      FFMPEG_PATH,
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-'],
      { timeoutMs: 15000 }
    )
      .then(() => 'h264_nvenc')
      .catch(() => {
        console.log('[ffmpeg] NVENC indisponible, utilisation de libx264 (CPU).');
        return 'libx264';
      });
  }
  return encoderPromise;
}

/** Arguments d'encodage vidéo H.264 adaptés à la résolution de sortie. */
async function videoEncoderArgs(outputHeight = 1920) {
  const encoder = await detectEncoder();
  const big = outputHeight > 2000;
  if (encoder === 'h264_nvenc') {
    return [
      '-c:v', 'h264_nvenc',
      '-preset', process.env.NVENC_PRESET || 'p1',
      '-rc', 'vbr',
      '-cq', big ? '30' : '28',
      '-b:v', big ? '8M' : '3.5M',
      '-maxrate', big ? '12M' : '5M',
      '-bufsize', big ? '12M' : '5M',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
    ];
  }
  return ['-c:v', 'libx264', '-preset', process.env.X264_PRESET || 'superfast', '-crf', big ? '23' : '22', '-threads', '0', '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
}

/**
 * Lance ffmpeg avec `args` (sans le binaire). `duration` (s) permet de calculer
 * un pourcentage ; `onProgress(percent)` est appelé au fil du rendu.
 */
function runFfmpeg(args, { signal, duration, onProgress, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const fullArgs = ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args];
    let child;
    try {
      child = spawn(FFMPEG_PATH, fullArgs, { windowsHide: true, cwd, signal });
    } catch (err) {
      return reject(err);
    }
    let stderr = '';
    let buffer = '';
    child.stdout.on('data', (d) => {
      buffer += d.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const match = line.match(/^out_time_us=(\d+)/) || line.match(/^out_time_ms=(\d+)/);
        if (match && duration > 0 && onProgress) {
          const seconds = Number(match[1]) / 1e6;
          try {
            onProgress(Math.min(100, Math.max(0, (seconds / duration) * 100)));
          } catch (e) {
            child.kill('SIGKILL');
            reject(e);
          }
        }
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 60000) stderr = stderr.slice(-60000);
    });
    child.on('error', (err) => {
      if (err.name === 'AbortError') return reject(new Error("Tâche annulée par l'utilisateur."));
      reject(new Error(`Impossible de lancer ffmpeg : ${err.message}`));
    });
    child.on('close', (code) => {
      if (signal && signal.aborted) return reject(new Error("Tâche annulée par l'utilisateur."));
      if (code === 0) {
        if (onProgress) onProgress(100);
        return resolve({ stderr });
      }
      reject(new Error(`Rendu ffmpeg échoué (code ${code}) :\n${stderr.slice(-3000)}`));
    });
  });
}

/**
 * Chemin utilisable dans un graphe de filtres ffmpeg (ass=..., fontsdir=...).
 * Gère les deux niveaux d'échappement (graphe puis options) : ':' et apostrophes.
 */
function filterPath(p) {
  const normalized = p.replace(/\\/g, '/').replace(/:/g, '\\:');
  return `'${normalized.split("'").join("'\\''")}'`;
}

/** Chaîne de filtres atempo couvrant n'importe quelle vitesse (atempo est limité à [0.5, 2]). */
function atempoChain(speed) {
  const filters = [];
  let remaining = speed;
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  if (Math.abs(remaining - 1.0) > 0.001) filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters;
}

module.exports = {
  FFMPEG_PATH,
  FFPROBE_PATH,
  toolEnv,
  runCapture,
  probeMedia,
  detectEncoder,
  videoEncoderArgs,
  runFfmpeg,
  filterPath,
  atempoChain,
};
