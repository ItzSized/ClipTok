/**
 * captionRenderer.js
 *
 * Incruste des sous-titres (moteur partagé shared/captionEngine) dans une
 * vidéo, avec recadrage optionnel vers un autre format :
 *   aspect : 'original' | '9:16' | '1:1' | '4:5' | '16:9'
 *   fit    : 'crop' (remplit, recadré) | 'blur' (vidéo entière sur fond flou) | 'black' (bandes noires)
 *   cropX  : position horizontale du recadrage (0 = gauche, 0.5 = centre, 1 = droite)
 */
const path = require('path');
const fs = require('fs/promises');
const captionEngine = require('../../../shared/captionEngine');
const { runFfmpeg, videoEncoderArgs, filterPath } = require('../ffmpegUtils');
const { FONTS_DIR, getFont, fontsRelFor } = require('../fonts');

const ASPECTS = {
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '16:9': [1920, 1080],
};

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

/** Dimensions de sortie pour une source et un format donnés (logique reprise par l'aperçu). */
function outputSize(srcW, srcH, aspect) {
  if (ASPECTS[aspect]) return { width: ASPECTS[aspect][0], height: ASPECTS[aspect][1] };
  // Format d'origine : plafonné à 4K sur le grand côté.
  const scale = Math.min(1, 3840 / Math.max(srcW, srcH));
  return { width: even(srcW * scale), height: even(srcH * scale) };
}

function framingFilters(W, H, aspect, fit, cropX) {
  if (!ASPECTS[aspect]) return { pre: [`scale=${W}:${H}`], complex: null };
  if (fit === 'blur') {
    return {
      pre: null,
      complex: (input, out) =>
        `[${input}]split[bgs][fgs];` +
        `[bgs]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=${Math.round(Math.max(W, H) / 40)},eq=brightness=-0.08[bgb];` +
        `[fgs]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgb];` +
        `[bgb][fgb]overlay=(W-w)/2:(H-h)/2,setsar=1[${out}]`,
    };
  }
  if (fit === 'black') {
    return { pre: [`scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1'], complex: null };
  }
  const x = Math.min(1, Math.max(0, Number(cropX) || 0.5));
  return { pre: [`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}:(iw-${W})*${x}:(ih-${H})/2`, 'setsar=1'], complex: null };
}

async function renderCaptionedVideo({ sourcePath, sourceMeta, words, style, framing = {}, jobDir, outputPath, signal, onProgress }) {
  const aspect = framing.aspect || 'original';
  const fit = framing.fit || 'crop';
  const { width: W, height: H } = outputSize(sourceMeta.width, sourceMeta.height, aspect);
  const resolved = captionEngine.resolveStyle(style);
  const font = getFont(resolved.fontId) || getFont(captionEngine.DEFAULT_STYLE.fontId);

  await fs.mkdir(jobDir, { recursive: true });
  const ass = captionEngine.buildAss({ words, style: resolved, width: W, height: H, font });
  await fs.writeFile(path.join(jobDir, 'captions.ass'), ass, 'utf-8');

  const subs = `ass=${filterPath('captions.ass')}:fontsdir=${filterPath(fontsRelFor(jobDir))}`;
  const framingDef = framingFilters(W, H, aspect, fit, framing.cropX);
  const graph = framingDef.complex
    ? `${framingDef.complex('0:v', 'framed')};[framed]${subs},format=yuv420p[vout]`
    : `[0:v]${framingDef.pre.join(',')},${subs},format=yuv420p[vout]`;
  await fs.writeFile(path.join(jobDir, 'graph.txt'), graph, 'utf-8');

  const args = ['-i', sourcePath, '-filter_complex_script', 'graph.txt', '-map', '[vout]'];
  if (sourceMeta.hasAudio) args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k');
  args.push(...(await videoEncoderArgs(H)), '-movflags', '+faststart', '-y', outputPath);
  await runFfmpeg(args, { cwd: jobDir, signal, duration: sourceMeta.duration, onProgress });
  return { width: W, height: H };
}

module.exports = { renderCaptionedVideo, outputSize, ASPECTS };
