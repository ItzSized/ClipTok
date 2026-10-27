/**
 * editorRenderer.js
 *
 * Transforme un projet de l'éditeur (voir shared/editorCore.js) en un unique
 * graphe de filtres ffmpeg :
 *
 *   piste principale : chaque clip est composé sur un canevas plein (fond
 *                      couleur ou flou), puis les segments sont enchaînés par
 *                      concat ou xfade (transitions) ;
 *   autres pistes    : chaque clip devient un calque RGBA (recadrage, couleurs,
 *                      effets, échelle/rotation/opacité animées) superposé à
 *                      sa position avec overlay, décalé dans le temps ;
 *   sous-titres      : un fichier .ass par clip de sous-titres (captionEngine) ;
 *   audio            : chaque source est découpée, accélérée, réglée en volume
 *                      et fondus, décalée (adelay) puis mixée (amix).
 *
 * Les textes et stickers sont rasterisés en PNG par le navigateur (rendu
 * identique à l'aperçu, emojis en couleur) et fournis dans `rasters`.
 */
const path = require('path');
const fs = require('fs/promises');
const core = require('../../../shared/editorCore');
const captionEngine = require('../../../shared/captionEngine');
const { runFfmpeg, videoEncoderArgs, filterPath, atempoChain } = require('../ffmpegUtils');
const { resolvePublicPath } = require('../media');
const { FONTS_DIR, getFont, fontsRelFor } = require('../fonts');

const QUALITY_SHORT_SIDE = { '720p': 720, '1080p': 1080, '4k': 2160 };

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const num = (n) => {
  const v = Math.round(n * 10000) / 10000;
  return Object.is(v, -0) ? '0' : String(v);
};
const hexColor = (hex) => `0x${String(hex || '#000000').replace('#', '').slice(0, 6).padEnd(6, '0')}`;

function hasAlphaSource(clip) {
  if (clip.type === 'text' || clip.type === 'sticker') return true;
  return clip.type === 'image' && /\.(png|webp|gif)$/i.test(String(clip.src || '').split('?')[0]);
}

/**
 * Facteur de résolution d'export : la taille du projet définit le cadre,
 * la qualité choisit la résolution réelle (côté le plus court).
 */
function exportScale(project, quality) {
  const shortSide = Math.min(project.settings.width, project.settings.height);
  const target = QUALITY_SHORT_SIDE[quality] || shortSide;
  return target / shortSide;
}

class GraphBuilder {
  constructor() {
    this.inputs = []; // tableaux d'arguments ffmpeg
    this.chains = [];
    this.counter = 0;
    this.files = []; // fichiers annexes à écrire dans jobDir { name, content }
  }

  addInput(args) {
    this.inputs.push(args);
    return this.inputs.length - 1;
  }

  label(prefix) {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }

  push(chain) {
    this.chains.push(chain);
  }

  addFile(name, content) {
    this.files.push({ name, content });
    return name;
  }
}

/** Filtres de traitement d'image (effets "pixel") du clip, au format ffmpeg. */
function pixelEffectFilters(clip, R, alpha) {
  const filters = [];
  for (const fx of clip.effects || []) {
    const i = fx.intensity === undefined ? 0.6 : fx.intensity;
    switch (fx.id) {
      case 'blur':
        filters.push(`gblur=sigma=${num(2 + 30 * i * R)}`);
        break;
      case 'rgb-split': {
        const px = Math.max(1, Math.round(14 * i * R));
        filters.push(`rgbashift=rh=-${px}:bh=${px}:edge=smear`);
        break;
      }
      case 'pixelate': {
        const f = Math.max(2, Math.round(4 + 36 * i));
        filters.push(`scale=iw/${f}:-2:flags=neighbor`, `scale=iw*${f}:-2:flags=neighbor`);
        break;
      }
      case 'mirror':
        // Marqueur traité par buildLayer : nécessite de scinder la chaîne (split + hstack).
        filters.push({ mirror: true });
        break;
      case 'grain':
        if (!alpha) filters.push(`noise=alls=${Math.round(8 + 30 * i)}:allf=t`);
        break;
      case 'vhs':
        if (!alpha) filters.push(`noise=alls=${Math.round(10 + 20 * i)}:allf=t`, `rgbashift=rh=-${Math.max(1, Math.round(6 * i * R))}:bh=${Math.max(1, Math.round(6 * i * R))}`, 'eq=saturation=0.75:contrast=1.05');
        break;
      case 'vignette':
        if (!alpha) filters.push(`vignette=angle=${num(0.3 + 0.6 * i)}`);
        break;
      case 'flash':
        if (!alpha) filters.push(`eq=brightness='${num(0.6 * i)}*pow(max(0,sin(2*PI*t*2)),12)':eval=frame`);
        break;
      case 'strobe':
        if (!alpha) filters.push(`eq=brightness='${num(0.7 * i)}*lt(mod(t,0.25),0.06)':eval=frame`);
        break;
      case 'rainbow':
        filters.push(`hue=h='t*${num(120 * (0.3 + i))}'`);
        break;
      case 'pulse-light':
        if (!alpha) filters.push(`eq=brightness='${num(0.35 * i)}*(0.5+0.5*sin(2*PI*t*2))':eval=frame`);
        break;
      case 'blackout':
        if (!alpha) filters.push(`eq=brightness='-${num(0.8 * i)}*pow(max(0,sin(2*PI*t*1.5)),14)':eval=frame`);
        break;
      case 'dreamy':
        if (!alpha) filters.push(`eq=brightness=${num(0.05 * i)}:contrast=${num(1 - 0.12 * i)}:saturation=${num(1 + 0.2 * i)}`, `gblur=sigma=${num(1 + 2 * i * R)}`);
        break;
      case 'punch':
        if (!alpha) filters.push(`eq=contrast=${num(1 + 0.4 * i)}:saturation=${num(1 + 0.5 * i)}`);
        break;
      case 'old-film':
        if (!alpha) filters.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131', `noise=alls=${Math.round(10 + 25 * i)}:allf=t`, `vignette=angle=${num(0.4 + 0.4 * i)}`);
        break;
      default:
        break;
    }
  }
  const adjust = core.effectiveAdjust(clip).adjust;
  if (adjust.blur > 0) filters.push(`gblur=sigma=${num(adjust.blur * 0.02 * 1080 * R)}`);
  if (adjust.sharpen > 0) filters.push(`unsharp=5:5:${num(adjust.sharpen * 1.5)}:5:5:0`);
  if (adjust.vignette > 0 && !alpha) filters.push(`vignette=angle=${num(0.2 + 0.7 * adjust.vignette)}`);
  return filters;
}

/** Matrice couleur -> colorchannelmixer (+ lutrgb pour les décalages). */
function colorFilters(clip) {
  const m = core.colorMatrix(clip);
  if (core.isIdentityMatrix(m)) return [];
  const names = ['rr', 'rg', 'rb', 'ra', 'gr', 'gg', 'gb', 'ga', 'br', 'bg', 'bb', 'ba', 'ar', 'ag', 'ab', 'aa'];
  const vals = [m[0], m[1], m[2], m[3], m[5], m[6], m[7], m[8], m[10], m[11], m[12], m[13], m[15], m[16], m[17], m[18]];
  const filters = [`colorchannelmixer=${names.map((n, i) => `${n}=${num(vals[i])}`).join(':')}`];
  const off = [m[4], m[9], m[14]];
  if (off.some((v) => Math.abs(v) > 1e-4)) {
    filters.push(`lutrgb=r='clip(val+${num(off[0] * 255)},0,255)':g='clip(val+${num(off[1] * 255)},0,255)':b='clip(val+${num(off[2] * 255)},0,255)'`);
  }
  return filters;
}

/**
 * Construit le calque d'un clip visuel. Retourne { label, boxed } où label est
 * un flux RGBA dont le temps commence à 0 (temps local du clip).
 */
function buildLayer(g, clip, ctx, rasters) {
  const { W, H, fps, R } = ctx;
  const dur = clip.duration;
  let srcLabel;

  if (clip.type === 'video') {
    const speed = clip.speed || 1;
    const srcPath = resolvePublicPath(clip.src);
    if (!srcPath) throw new Error(`Média introuvable pour le clip "${clip.name}".`);
    const srcDur = dur * speed;
    const idx = g.addInput(['-threads', '2', '-ss', num(clip.trimStart || 0), '-t', num(srcDur + 0.5), '-i', srcPath]);
    clip._inputIndex = idx;
    srcLabel = g.label('src');
    g.push(`[${idx}:v]setpts=(PTS-STARTPTS)/${num(speed)},fps=${fps},trim=duration=${num(dur)},setpts=PTS-STARTPTS[${srcLabel}]`);
  } else {
    let srcPath;
    if (clip.type === 'image') srcPath = resolvePublicPath(clip.src);
    else srcPath = rasters[clip.id];
    if (!srcPath) throw new Error(`Image introuvable pour le clip "${clip.name || clip.type}".`);
    const idx = g.addInput(['-loop', '1', '-framerate', String(fps), '-t', num(dur + 0.2), '-i', srcPath]);
    srcLabel = g.label('src');
    g.push(`[${idx}:v]fps=${fps},trim=duration=${num(dur)},setpts=PTS-STARTPTS[${srcLabel}]`);
  }

  const alpha = hasAlphaSource(clip);
  const filters = [];
  const crop = Object.assign({}, core.DEFAULT_CROP, clip.crop);
  if (clip.type === 'video' || clip.type === 'image') {
    if (crop.left || crop.top || crop.right || crop.bottom) {
      filters.push(`crop=w=iw*${num(1 - crop.left - crop.right)}:h=ih*${num(1 - crop.top - crop.bottom)}:x=iw*${num(crop.left)}:y=ih*${num(crop.top)}`);
    }
  }

  // Taille de base (échelle 1) dans le canevas d'export.
  const base = core.baseLayerSize(clip, W / R, H / R);
  const baseW = base.w * R;
  const baseH = base.h * R;
  const { exprs, animated } = core.visualStateExprs(clip, 't');
  const states = core.sampleStates(clip, fps);
  const maxScale = Math.max(...states.map((s) => s.scale));
  const scaleAnimated = animated.scale;
  const rotationAnimated = animated.rotation;
  const staticState = states[0];
  const hasRotation = rotationAnimated || Math.abs(staticState.rotation) > 0.01;
  const hasChroma = Boolean(clip.chromaKey && clip.chromaKey.enabled);
  const needsRgba = alpha || hasChroma || hasRotation || scaleAnimated || animated.opacity || staticState.opacity < 0.999;

  // Les très gros zooms sont plafonnés (évite des images gigantesques en mémoire).
  const preScale = scaleAnimated ? Math.min(maxScale, 3) : Math.max(0.01, staticState.scale);
  const preW = even(baseW * preScale);
  const preH = even(baseH * preScale);
  filters.push(`scale=${preW}:${preH}:flags=bicubic`);

  if (clip.transform && clip.transform.flipH) filters.push('hflip');
  if (clip.transform && clip.transform.flipV) filters.push('vflip');

  if (hasChroma) {
    filters.push('format=rgba', `colorkey=color=${hexColor(clip.chromaKey.color)}:similarity=${num(Math.max(0.01, clip.chromaKey.similarity))}:blend=${num(clip.chromaKey.blend || 0)}`);
  }
  if (clip.type === 'video' || clip.type === 'image') filters.push(...pixelEffectFilters(clip, R, alpha || hasChroma));
  filters.push(...colorFilters(clip));
  if (needsRgba) filters.push('format=rgba');

  if (animated.opacity) {
    const opId = g.label('op');
    const lines = [];
    let last = null;
    states.forEach((s, i) => {
      const v = Math.round(s.opacity * 1000) / 1000;
      if (v !== last) lines.push(`${num(i / fps)} colorchannelmixer@${opId} aa ${v};`);
      last = v;
    });
    const name = g.addFile(`opacity_${clip.id}.cmd`, lines.join('\n'));
    filters.push(`sendcmd=f=${filterPath(name)}`, `colorchannelmixer@${opId}=aa=${states[0].opacity}`);
  } else if (staticState.opacity < 0.999) {
    filters.push(`colorchannelmixer=aa=${num(staticState.opacity)}`);
  }

  let boxed = false;
  if (rotationAnimated) {
    const box = even(Math.hypot(preW, preH) + 4);
    if (scaleAnimated) {
      const ratio = `min(1,(${exprs.scale})/${num(preScale)})`; // jamais plus grand que la boîte (zooms > x3 plafonnés)
      filters.push(`scale=w='max(2,trunc(iw*${ratio}/2)*2)':h='max(2,trunc(ih*${ratio}/2)*2)':flags=fast_bilinear:eval=frame`);
    }
    filters.push(`pad=w=${box}:h=${box}:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0${scaleAnimated ? ':eval=frame' : ''}`);
    filters.push(`rotate=a='(${exprs.rotation})*PI/180':c=none:ow=${box}:oh=${box}`);
    boxed = true;
  } else if (scaleAnimated) {
    const ratio = `min(1,(${exprs.scale})/${num(preScale)})`; // jamais plus grand que la boîte (zooms > x3 plafonnés)
    filters.push(`scale=w='max(2,trunc(iw*${ratio}/2)*2)':h='max(2,trunc(ih*${ratio}/2)*2)':flags=fast_bilinear:eval=frame`);
    if (Math.abs(staticState.rotation) > 0.01) {
      const box = even(Math.hypot(preW, preH) + 4);
      const a = `${num(staticState.rotation)}*PI/180`;
      filters.push(`pad=w=${box}:h=${box}:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0:eval=frame`);
      filters.push(`rotate=a=${a}:c=none:ow=${box}:oh=${box}`);
    } else {
      filters.push(`pad=w=${preW}:h=${preH}:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0:eval=frame`);
    }
    boxed = true;
  } else if (Math.abs(staticState.rotation) > 0.01) {
    const a = `${num(staticState.rotation)}*PI/180`;
    filters.push(`rotate=a=${a}:c=none:ow='rotw(${a})':oh='roth(${a})'`);
  }

  // Assemblage : les marqueurs { mirror } coupent la chaîne en sous-graphes.
  let current = srcLabel;
  let pending = [];
  const flush = () => {
    if (pending.length === 0) return;
    const next = g.label('f');
    g.push(`[${current}]${pending.join(',')}[${next}]`);
    current = next;
    pending = [];
  };
  for (const f of filters) {
    if (typeof f === 'string') {
      pending.push(f);
      continue;
    }
    pending.push('crop=trunc(iw/4)*2:ih:0:0');
    flush();
    const [a, b, flipped, out] = [g.label('mra'), g.label('mrb'), g.label('mrf'), g.label('mro')];
    g.push(`[${current}]split[${a}][${b}];[${b}]hflip[${flipped}];[${a}][${flipped}]hstack[${out}]`);
    current = out;
  }
  if (pending.length === 0) pending.push('null');
  const out = g.label('lay');
  g.push(`[${current}]${pending.join(',')}[${out}]`);
  const isSimpleStatic = !needsRgba && !animated.x && !animated.y && Math.abs(staticState.x - 0.5) < 0.001 && Math.abs(staticState.y - 0.5) < 0.001;
  return { label: out, exprs, animated, preW, preH, isSimpleStatic, boxed };
}

/** Superpose un calque sur `baseLabel`. T est l'expression du temps local du clip. */
function overlayLayer(g, baseLabel, layer, clip, ctx, T, enable) {
  const { W, H } = ctx;
  const sub = (e) => e.replace(/\bt\b/g, T);
  const x = `(${sub(layer.exprs.x)})*${W}-w/2`;
  const y = `(${sub(layer.exprs.y)})*${H}-h/2`;
  const out = g.label('ov');
  const en = enable ? `:enable='${enable}'` : '';
  const evalMode = layer.animated && (layer.animated.x || layer.animated.y) ? ':eval=frame' : ':eval=init';
  g.push(`[${baseLabel}][${layer.label}]overlay=x='${x}':y='${y}'${en}:eof_action=pass${evalMode}[${out}]`);
  return out;
}

/** Segment plein canevas d'un clip de la piste principale (durée = durée du clip). */
function buildMainSegment(g, clip, ctx, rasters, project) {
  const { W, H, fps } = ctx;
  const bg = project.settings.background || { type: 'color', color: '#000000' };
  const layer = buildLayer(g, clip, ctx, rasters);

  if (bg.type !== 'blur' && layer.isSimpleStatic) {
    const seg = g.label('seg');
    const geom = [];
    if (layer.preW > W || layer.preH > H) {
      const cw = Math.min(W, layer.preW);
      const ch = Math.min(H, layer.preH);
      geom.push(`crop=${cw}:${ch}:(iw-${cw})/2:(ih-${ch})/2`);
    }
    if (layer.preW < W || layer.preH < H) {
      geom.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${hexColor(bg.color)}`);
    }
    geom.push(`trim=duration=${num(clip.duration)}`, 'format=yuv420p', 'setsar=1', 'settb=AVTB', 'setpts=PTS-STARTPTS');
    g.push(`[${layer.label}]${geom.join(',')}[${seg}]`);
    return seg;
  }

  let bgLabel = g.label('bg');
  if (bg.type === 'blur' && clip.type === 'video' && clip._inputIndex !== undefined) {
    const speed = clip.speed || 1;
    g.push(
      `[${clip._inputIndex}:v]setpts=(PTS-STARTPTS)/${num(speed)},fps=${fps},trim=duration=${num(clip.duration)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${W}:${H},gblur=sigma=${num(Math.max(W, H) / 40)},eq=brightness=-0.08,format=yuv420p[${bgLabel}]`
    );
  } else {
    g.push(`color=c=${hexColor(bg.color)}:s=${W}x${H}:r=${fps}:d=${num(clip.duration)},format=yuv420p[${bgLabel}]`);
  }
  const composed = overlayLayer(g, bgLabel, layer, clip, ctx, 't', null);
  const seg = g.label('seg');
  g.push(`[${composed}]trim=duration=${num(clip.duration)},format=yuv420p,setsar=1,settb=AVTB,setpts=PTS-STARTPTS[${seg}]`);
  return seg;
}

function audioChain(g, clip, inputIndex, ctx, extraFades) {
  const speed = clip.speed || 1;
  const dur = clip.duration;
  const filters = [
    `atrim=duration=${num(dur * speed)}`,
    'asetpts=PTS-STARTPTS',
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    ...atempoChain(speed),
  ];
  const volume = clip.volume === undefined ? 1 : clip.volume;
  if (Math.abs(volume - 1) > 0.001) filters.push(`volume=${num(volume)}`);
  const fadeIn = Math.max(clip.fadeIn || 0, extraFades.in || 0);
  const fadeOut = Math.max(clip.fadeOut || 0, extraFades.out || 0);
  if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${num(Math.min(fadeIn, dur))}`);
  if (fadeOut > 0) filters.push(`afade=t=out:st=${num(Math.max(0, dur - fadeOut))}:d=${num(Math.min(fadeOut, dur))}`);
  const delayMs = Math.round(clip.start * 1000);
  if (delayMs > 0) filters.push(`adelay=${delayMs}|${delayMs}`);
  const out = g.label('aud');
  g.push(`[${inputIndex}:a]${filters.join(',')}[${out}]`);
  return out;
}

/**
 * Rend un projet en MP4.
 * @param {object} opts
 * @param {object} opts.project   projet éditeur
 * @param {object} opts.rasters   { [clipId]: cheminPNG } pour les textes/stickers
 * @param {string} opts.jobDir    dossier temporaire
 * @param {string} opts.outputPath
 * @param {string} opts.quality   '720p' | '1080p' | '4k'
 */
async function renderProject({ project: input, rasters = {}, jobDir, outputPath, quality = '1080p', signal, onProgress }) {
  const project = JSON.parse(JSON.stringify(input));
  core.packMainTrack(project);
  const total = core.projectDuration(project);
  if (total <= 0) throw new Error('Le projet est vide : ajoutez au moins un clip.');

  const R = exportScale(project, quality);
  const W = even(project.settings.width * R);
  const H = even(project.settings.height * R);
  const fps = Math.round(project.settings.fps || 30);
  const ctx = { W, H, fps, R };
  const g = new GraphBuilder();
  const bgColor = hexColor((project.settings.background || {}).color || '#000000');

  const main = core.mainTrack(project);
  const visualTracks = project.tracks.filter((t) => t.kind === 'visual' && !t.hidden);
  const trackById = Object.fromEntries(project.tracks.map((t) => [t.id, t]));

  // ---- Piste principale ----
  let baseLabel;
  let mainLength = 0;
  const mainClips = main && !main.hidden ? core.clipsOnTrack(project, main.id).filter((c) => c.type === 'video' || c.type === 'image') : [];
  if (mainClips.length > 0) {
    let acc = buildMainSegment(g, mainClips[0], ctx, rasters, project);
    mainLength = mainClips[0].duration;
    for (let i = 1; i < mainClips.length; i++) {
      const seg = buildMainSegment(g, mainClips[i], ctx, rasters, project);
      const tr = core.transitionBetween(project, mainClips[i - 1].id, mainClips[i].id);
      const out = g.label('seq');
      if (tr) {
        g.push(`[${acc}][${seg}]xfade=transition=${tr.type}:duration=${num(tr.duration)}:offset=${num(mainLength - tr.duration)}[${out}]`);
        mainLength += mainClips[i].duration - tr.duration;
      } else {
        g.push(`[${acc}][${seg}]concat=n=2:v=1:a=0[${out}]`);
        mainLength += mainClips[i].duration;
      }
      acc = out;
    }
    baseLabel = acc;
    if (total > mainLength + 0.01) {
      const padded = g.label('pad');
      g.push(`[${baseLabel}]tpad=stop_mode=add:stop_duration=${num(total - mainLength)}:color=${bgColor}[${padded}]`);
      baseLabel = padded;
    }
  } else {
    baseLabel = g.label('base');
    g.push(`color=c=${bgColor}:s=${W}x${H}:r=${fps}:d=${num(total)},format=yuv420p[${baseLabel}]`);
  }

  // ---- Autres pistes visuelles (de la plus basse à la plus haute) ----
  for (const track of visualTracks.slice().reverse()) {
    if (main && track.id === main.id) continue;
    for (const clip of core.clipsOnTrack(project, track.id)) {
      if (!core.isVisual(clip)) continue;
      if ((clip.type === 'text' || clip.type === 'sticker') && !rasters[clip.id]) continue;
      const layer = buildLayer(g, clip, ctx, rasters);
      const shifted = g.label('sh');
      g.push(`[${layer.label}]setpts=PTS+${num(clip.start)}/TB[${shifted}]`);
      layer.label = shifted;
      baseLabel = overlayLayer(g, baseLabel, layer, clip, ctx, `(t-${num(clip.start)})`, `between(t,${num(clip.start)},${num(core.clipEnd(clip))})`);
    }
  }

  // ---- Sous-titres ----
  const fontsRel = fontsRelFor(jobDir);
  let capIndex = 0;
  for (const track of project.tracks.filter((t) => t.kind === 'caption' && !t.hidden)) {
    for (const clip of core.clipsOnTrack(project, track.id)) {
      if (clip.type !== 'caption' || !clip.words || clip.words.length === 0) continue;
      const style = captionEngine.resolveStyle(clip.captionStyle || {});
      const font = getFont(style.fontId) || getFont(captionEngine.DEFAULT_STYLE.fontId);
      const words = clip.words
        .filter((w) => w.end > 0 && w.start < clip.duration)
        .map((w) => ({ ...w, start: clip.start + Math.max(0, w.start), end: clip.start + Math.min(clip.duration, w.end) }));
      const ass = captionEngine.buildAss({ words, style, width: W, height: H, font });
      const name = g.addFile(`captions_${capIndex++}.ass`, ass);
      const out = g.label('cap');
      g.push(`[${baseLabel}]ass=${filterPath(name)}:fontsdir=${filterPath(fontsRel)}[${out}]`);
      baseLabel = out;
    }
  }

  const vout = 'vout';
  g.push(`[${baseLabel}]trim=duration=${num(total)},format=yuv420p,setsar=1[${vout}]`);

  // ---- Audio ----
  const audioLabels = [];
  const mainIds = mainClips.map((c) => c.id);
  for (const clip of project.clips) {
    const track = trackById[clip.trackId];
    if (!track || track.muted) continue;
    if (!core.hasSourceAudio(clip) || clip.muted || (clip.volume !== undefined && clip.volume <= 0)) continue;
    if (clip.type === 'video' && track.hidden) continue;
    let inputIndex = clip._inputIndex;
    if (clip.type === 'video' && main && clip.trackId === main.id && !mainIds.includes(clip.id)) continue;
    if (inputIndex === undefined) {
      const srcPath = resolvePublicPath(clip.src);
      if (!srcPath) throw new Error(`Son introuvable pour le clip "${clip.name}".`);
      inputIndex = g.addInput(['-ss', num(clip.trimStart || 0), '-t', num(clip.duration * (clip.speed || 1) + 0.5), '-i', srcPath]);
    }
    // Fondu croisé automatique sous les transitions de la piste principale.
    const fades = {};
    if (mainIds.includes(clip.id)) {
      const before = project.transitions.find((t) => t.toId === clip.id);
      const after = project.transitions.find((t) => t.fromId === clip.id);
      if (before) fades.in = before.duration;
      if (after) fades.out = after.duration;
    }
    audioLabels.push(audioChain(g, clip, inputIndex, ctx, fades));
  }

  const aout = 'aout';
  if (audioLabels.length > 0) {
    const post = [`apad=whole_dur=${num(total)}`, `atrim=duration=${num(total)}`];
    if (project.settings.normalizeAudio) post.push('loudnorm=I=-14:TP=-1.5:LRA=11');
    post.push('alimiter=limit=0.97');
    const mix = audioLabels.length > 1
      ? `${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,`
      : `[${audioLabels[0]}]`;
    g.push(`${mix}${post.join(',')}[${aout}]`);
  } else {
    g.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(total)}[${aout}]`);
  }

  // ---- Exécution ----
  await fs.mkdir(jobDir, { recursive: true });
  for (const f of g.files) await fs.writeFile(path.join(jobDir, f.name), f.content, 'utf-8');
  await fs.writeFile(path.join(jobDir, 'graph.txt'), g.chains.join(';\n'), 'utf-8');

  const args = [
    ...g.inputs.flat(),
    '-filter_complex_script', 'graph.txt',
    '-map', `[${vout}]`,
    '-map', `[${aout}]`,
    ...(await videoEncoderArgs(H)),
    '-r', String(fps),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', num(total),
    '-movflags', '+faststart',
    '-y', outputPath,
  ];
  await runFfmpeg(args, { cwd: jobDir, signal, duration: total, onProgress });
  return { outputPath, duration: total, width: W, height: H };
}

module.exports = { renderProject, exportScale };
