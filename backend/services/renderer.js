const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const { probeMedia, runFfmpeg, videoEncoderArgs, toolEnv, filterPath, atempoChain } = require('./ffmpegUtils');
const { FONTS_DIR, getFont, fontsRelFor } = require('./fonts');
const captionEngine = require('../../shared/captionEngine');

const PYTHON_PATH = process.env.PYTHON_PATH || 'python';
const FACE_TRACKER_SCRIPT = path.join(__dirname, '..', 'scripts', 'face_tracker.py');

async function probeVideo(videoPath) {
  const meta = await probeMedia(videoPath);
  if (!meta.hasVideo) throw new Error('Aucun flux vidéo détecté dans le fichier source.');
  return meta;
}

/**
 * Appelle le script Python (OpenCV + MediaPipe) qui traque le visage sur la
 * fenêtre [start, end] de la vidéo source et renvoie des échantillons
 * {t, cx, cy} (t relatif au début du clip) dans un fichier JSON.
 */
function runFaceTracker(sourceVideoPath, start, end, jobDir, signal) {
  return new Promise((resolve, reject) => {
    const outputJson = path.join(jobDir, 'face_track.json');
    const args = [
      FACE_TRACKER_SCRIPT,
      sourceVideoPath,
      outputJson,
      '--start',
      String(start),
      '--end',
      String(end),
      '--sample-fps',
      '2',
    ];

    const child = spawn(PYTHON_PATH, args, { windowsHide: true, env: toolEnv(), signal });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      reject(
        new Error(
          `Impossible de lancer le script Python de face tracking (vérifie PYTHON_PATH et les dépendances requirements.txt) : ${err.message}`
        )
      );
    });
    child.on('close', async (code) => {
      if (code !== 0) {
        return reject(new Error(`face_tracker.py a échoué (code ${code}) : ${stderr.slice(-2000)}`));
      }
      try {
        const raw = await fs.readFile(outputJson, 'utf-8');
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error(`Impossible de lire le résultat du face tracking : ${e.message}`));
      }
    });
  });
}

function evenFloor(n) {
  const v = Math.floor(n);
  return v % 2 === 0 ? v : v - 1;
}

/** Calcule les dimensions du crop 9:16 les plus grandes possibles dans la vidéo source. */
function computeCropSize(srcW, srcH) {
  let cropH = evenFloor(srcH);
  let cropW = evenFloor((cropH * 9) / 16);
  if (cropW > srcW) {
    cropW = evenFloor(srcW);
    cropH = evenFloor((cropW * 16) / 9);
    if (cropH > srcH) cropH = evenFloor(srcH);
  }
  return { cropW, cropH };
}

/**
 * Construit une expression ffmpeg par morceaux (piecewise linear) qui interpole
 * la position du crop entre chaque échantillon de face tracking, en fonction du
 * temps `t` du filtre. Permet un déplacement fluide de la "caméra virtuelle".
 */
function buildPiecewiseExpr(keyframes, field) {
  if (keyframes.length === 0) return '0';
  if (keyframes.length === 1) return keyframes[0][field].toFixed(2);

  let expr = keyframes[keyframes.length - 1][field].toFixed(2);
  for (let i = keyframes.length - 2; i >= 0; i--) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    const dt = Math.max(b.t - a.t, 1e-3);
    const slope = ((b[field] - a[field]) / dt).toFixed(4);
    const lerp = `(${a[field].toFixed(2)}+${slope}*(t-${a.t.toFixed(2)}))`;
    expr = `if(lt(t,${b.t.toFixed(2)}),${lerp},${expr})`;
  }
  expr = `if(lt(t,${keyframes[0].t.toFixed(2)}),${keyframes[0][field].toFixed(2)},${expr})`;
  return expr;
}

/** Convertit les centres de visage (cx, cy) en coin haut-gauche du crop (x, y), avec un lissage additionnel. */
function buildCropKeyframes(faceTrack, cropW, cropH, events = [], srcW = 1920, srcH = 1080) {
  const samples =
    faceTrack.samples && faceTrack.samples.length > 0
      ? faceTrack.samples
      : [{ t: 0, cx: faceTrack.width / 2, cy: faceTrack.height / 2 }];

  const smoothed = [];
  let prevX = samples[0].cx;
  let prevY = samples[0].cy;

  // Paramètres du Smart Framing
  const alpha = 0.08; // Vitesse de rattrapage
  const deadZoneX = cropW * 0.15; // Marge morte en X (15% de la largeur du crop)
  const deadZoneY = cropH * 0.15; // Marge morte en Y

  for (const s of samples) {
    if (s.scene_cut) {
      // Cut caméra : on saute instantanément (pas de lissage)
      prevX = s.cx;
      prevY = s.cy;
    } else {
      // Smart Framing (Dead Zone)
      const dx = s.cx - prevX;
      const dy = s.cy - prevY;

      let targetX = prevX;
      let targetY = prevY;

      // Si on sort de la zone, on cible le bord de la zone pour rattraper
      if (Math.abs(dx) > deadZoneX) {
        targetX = s.cx - (Math.sign(dx) * deadZoneX);
      }
      if (Math.abs(dy) > deadZoneY) {
        targetY = s.cy - (Math.sign(dy) * deadZoneY);
      }

      // Smooth Lerp
      prevX = prevX + alpha * (targetX - prevX);
      prevY = prevY + alpha * (targetY - prevY);
    }

    let currentW = cropW;
    let currentH = cropH;

    // Semantic Auto Zooms
    for (const ev of events) {
      if (ev.type === 'zoom' && s.t >= ev.timestamp - 0.5 && s.t <= ev.timestamp + 3.0) {
        const factor = 1 - Math.min(0.5, ev.intensity || 0.15); // Max 50% zoom
        const targetW = cropW * factor;
        const targetH = cropH * factor;

        // Interpolation douce
        if (s.t < ev.timestamp) {
          const progress = (s.t - (ev.timestamp - 0.5)) / 0.5;
          currentW = cropW - (cropW - targetW) * progress;
          currentH = cropH - (cropH - targetH) * progress;
        } else if (s.t > ev.timestamp + 2.5) {
          const progress = (s.t - (ev.timestamp + 2.5)) / 0.5;
          currentW = targetW + (cropW - targetW) * progress;
          currentH = targetH + (cropH - targetH) * progress;
        } else {
          currentW = targetW;
          currentH = targetH;
        }
      }
    }

    let targetCropX = prevX - currentW / 2;
    // Le visage doit être dans le tiers supérieur (33%) pour les formats verticaux
    let targetCropY = prevY - currentH * 0.33;

    // Clamper pour ne pas sortir de la vidéo source
    let finalX = Math.max(0, Math.min(targetCropX, srcW - currentW));
    let finalY = Math.max(0, Math.min(targetCropY, srcH - currentH));

    smoothed.push({ t: s.t, x: finalX, y: finalY, w: currentW, h: currentH });
  }

  // Réduire le nombre de points pour accélérer considérablement le rendu FFmpeg
  // et éviter de faire planter son parseur d'expressions.
  const maxPoints = 15;
  if (smoothed.length <= maxPoints) return smoothed;

  const step = Math.ceil(smoothed.length / maxPoints);
  const decimated = [];
  for (let i = 0; i < smoothed.length; i += step) {
    decimated.push(smoothed[i]);
  }
  if (decimated[decimated.length - 1] !== smoothed[smoothed.length - 1]) {
    decimated.push(smoothed[smoothed.length - 1]);
  }
  return decimated;
}

/**
 * Génère le fichier .ass des sous-titres via le moteur partagé (shared/captionEngine).
 * `captionStyle` : id de preset ('classic', 'hormozi'...) ou objet style complet.
 */
async function generateAssSubtitles(words, jobDir, outputW, outputH, videoSpeed = 1.0, hook = '', captionStyle = 'classic', isPortrait = true) {
  let style = typeof captionStyle === 'string' ? captionEngine.applyPreset(captionStyle) : captionEngine.resolveStyle(captionStyle);
  // En paysage, le bloc par défaut (72% de la hauteur) est remonté vers le bas de l'image.
  if (!isPortrait && style.positionY === captionEngine.DEFAULT_STYLE.positionY) style = { ...style, positionY: 0.86 };
  const font = getFont(style.fontId) || getFont(captionEngine.DEFAULT_STYLE.fontId);
  const outputWords = words.map((w) => ({ ...w, start: w.start / videoSpeed, end: w.end / videoSpeed }));
  const ass = captionEngine.buildAss({
    words: outputWords,
    style,
    width: outputW,
    height: outputH,
    font,
    hook: hook ? { text: hook, duration: 3 } : null,
  });
  const assPath = path.join(jobDir, 'subtitles.ass');
  await fs.writeFile(assPath, ass, 'utf-8');
  return assPath;
}

const { getClipWords, buildEDL, shiftWords, shiftTimeline } = require('./editor/timelineBuilder');

async function renderClip({ sourceVideoPath, clip, transcript, jobDir, outputDir, jobId, quality = '1080p', withSubtitles = true, captionStyle = 'classic', format = 'portrait', videoSpeed = 1.0, onProgress, signal }) {
  try {
    const srcMeta = await probeVideo(sourceVideoPath);

    const is720p = quality === '720p';
    const isPortrait = format === 'portrait';

    // Le client décide de la résolution finale (force le 4K si demandé)
    const is4k = quality === '4k';

    let outputW = is4k ? (isPortrait ? 2160 : 3840) : is720p ? (isPortrait ? 720 : 1280) : (isPortrait ? 1080 : 1920);
    let outputH = is4k ? (isPortrait ? 3840 : 2160) : is720p ? (isPortrait ? 1280 : 720) : (isPortrait ? 1920 : 1080);
    const outputPath = path.join(outputDir, `${jobId}.mp4`);

    await fs.mkdir(outputDir, { recursive: true });

    const { start, end, events, hook } = clip;
    const duration = end - start;
    if (duration <= 0) throw new Error('Durée de clip invalide.');

    // Construction de la Timeline (Smart Cuts)
    const rawClipWords = getClipWords(transcript.words, start, end);
    const edl = buildEDL(rawClipWords, start, end, 0.4, 5, 0.1);
    const shiftedWords = shiftWords(transcript.words, edl);
    const shiftedEvents = shiftTimeline(events || [], 'timestamp', edl);

    const coarseSeek = Math.max(0, edl[0].start - 10);

    const filterComplexArr = [];
    const vLabels = [];
    const aLabels = [];

    // Découpe vidéo précise par segment EDL
    for (let i = 0; i < edl.length; i++) {
      const seg = edl[i];
      const exactStart = Math.max(0, seg.start - coarseSeek);
      const exactEnd = Math.max(0, seg.end - coarseSeek);
      filterComplexArr.push(`[0:v]trim=start=${exactStart}:end=${exactEnd},setpts=PTS-STARTPTS[v_seg_${i}]`);
      filterComplexArr.push(`[0:a]atrim=start=${exactStart}:end=${exactEnd},asetpts=PTS-STARTPTS[a_seg_${i}]`);
      vLabels.push(`[v_seg_${i}]`);
      aLabels.push(`[a_seg_${i}]`);
    }

    // Concaténation des segments
    const concatInputs = vLabels.map((v, i) => `${v}${aLabels[i]}`).join('');
    filterComplexArr.push(`${concatInputs}concat=n=${edl.length}:v=1:a=1[v_concat][a_concat]`);

    if (isPortrait) {
      const { cropW, cropH } = computeCropSize(srcMeta.width, srcMeta.height);

      let cropExpr = '';
      try {
        const faceTrack = await runFaceTracker(sourceVideoPath, edl[0].start, edl[edl.length - 1].end, jobDir, signal);
        // Ajustement des temps relatifs de faceTrack par rapport à l'EDL
        const absSamples = (faceTrack.samples || []).map(s => ({ ...s, absT: s.t + edl[0].start }));
        const shiftedSamples = shiftTimeline(absSamples, 'absT', edl);
        const relativeSamples = shiftedSamples.map(s => ({ ...s, t: s.absT }));
        faceTrack.samples = relativeSamples;

        const keyframes = buildCropKeyframes(faceTrack, cropW, cropH, shiftedEvents, srcMeta.width, srcMeta.height);
        const xExpr = buildPiecewiseExpr(keyframes, 'x');
        const yExpr = buildPiecewiseExpr(keyframes, 'y');
        const wExpr = buildPiecewiseExpr(keyframes, 'w');
        const hExpr = buildPiecewiseExpr(keyframes, 'h');
        cropExpr = `crop=w='${wExpr}':h='${hExpr}':x='${xExpr}':y='${yExpr}'`;
      } catch (err) {
        if (signal && signal.aborted) throw err;
        console.warn('[renderer] Face tracker failed or disabled, falling back to center crop', err.message);
        const xCrop = Math.floor((srcMeta.width - cropW) / 2);
        const yCrop = Math.floor((srcMeta.height - cropH) / 2);
        cropExpr = `crop=w=${cropW}:h=${cropH}:x=${xCrop}:y=${yCrop}`;
      }

      filterComplexArr.push(
        `[v_concat]${cropExpr},scale=${outputW}:${outputH}:flags=lanczos,setsar=1[v2]`
      );
    } else {
      filterComplexArr.push(
        `[v_concat]scale=${outputW}:${outputH}:force_original_aspect_ratio=decrease,pad=${outputW}:${outputH}:(ow-iw)/2:(oh-ih)/2,setsar=1[v2]`
      );
    }

    let finalVideoLabel = '[v2]';

    if (videoSpeed !== 1.0) {
      filterComplexArr.push(`${finalVideoLabel}setpts=${(1 / videoSpeed).toFixed(4)}*PTS[v3]`);
      finalVideoLabel = '[v3]';
    }

    if (withSubtitles) {
      // Mots recalés sur l'EDL (les silences coupés sont retirés de la timeline).
      const assPath = await generateAssSubtitles(shiftedWords, jobDir, outputW, outputH, videoSpeed, hook, captionStyle, isPortrait);
      filterComplexArr.push(
        `${finalVideoLabel}ass=${filterPath(path.basename(assPath))}:fontsdir=${filterPath(fontsRelFor(jobDir))}[vout]`
      );
      finalVideoLabel = '[vout]';
    }

    // Audio Enhancement: Normalisation
    // loudnorm sur-échantillonne en interne (96/192 kHz) : on revient à 48 kHz.
    filterComplexArr.push(`[a_concat]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a1]`);
    let finalAudioLabel = '[a1]';

    if (videoSpeed !== 1.0) {
      filterComplexArr.push(`${finalAudioLabel}${atempoChain(videoSpeed).join(',')}[aout]`);
      finalAudioLabel = '[aout]';
    }

    const filterComplex = filterComplexArr.join(';'); // Séparer les chaînes indépendantes par des ;
    const filterScriptPath = path.join(jobDir, 'filter.txt');
    await fs.writeFile(filterScriptPath, filterComplex, 'utf-8');

    const outputDuration = edl.reduce((acc, seg) => acc + (seg.end - seg.start), 0) / videoSpeed;
    // ffmpeg tourne dans jobDir : les chemins du graphe (ass, fontsdir) restent relatifs et sans ':'.
    await runFfmpeg(
      [
        '-ss', String(coarseSeek),
        '-i', sourceVideoPath,
        '-filter_complex_script', 'filter.txt',
        '-map', finalVideoLabel,
        '-map', finalAudioLabel,
        ...(await videoEncoderArgs(outputH)),
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-avoid_negative_ts', 'make_zero',
        '-y', outputPath,
      ],
      { cwd: jobDir, signal, duration: outputDuration, onProgress }
    );

    const stat = await fs.stat(outputPath).catch(() => null);
    if (!stat || stat.size === 0) {
      throw new Error('Le fichier vidéo final est vide ou introuvable après le rendu.');
    }

    // Génération de la version MP3
    const audioOutputPath = outputPath.replace('.mp4', '.mp3');
    await runFfmpeg(['-y', '-i', outputPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', audioOutputPath], { signal }).catch((err) => {
      throw new Error(`Extraction MP3 échouée : ${err.message}`);
    });

    return outputPath;
  } catch (err) {
    throw new Error(`[renderer] ${err.message}`);
  }
}

async function cleanupJobDir(jobDir) {
  try {
    await fs.rm(jobDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[renderer] Nettoyage du dossier temporaire échoué : ${err.message}`);
  }
}

module.exports = { renderClip, cleanupJobDir };