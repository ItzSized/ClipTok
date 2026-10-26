const path = require('path');
const fs = require('fs/promises');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { videoEncoderArgs } = require('../ffmpegUtils');

ffmpeg.setFfmpegPath(ffmpegPath);

async function renderComposition(jobId, jobDir, clips, settings, onProgress) {
  // settings = { outputFormat: '9:16', resolution: '1080p', fps: 30, audioNormalize: true }

  let outputW = 1080;
  let outputH = 1920;

  if (settings.outputFormat === '16:9') {
    outputW = 1920;
    outputH = 1080;
  } else if (settings.outputFormat === '1:1') {
    outputW = 1080;
    outputH = 1080;
  }

  if (settings.resolution === '4k') {
    outputW *= 2;
    outputH *= 2;
  } else if (settings.resolution === '720p') {
    outputW = Math.round(outputW * (720 / 1080));
    outputH = Math.round(outputH * (720 / 1080));
  }

  const fps = settings.fps || 30;
  const outputPath = path.join(jobDir, 'output.mp4');

  const filterComplexArr = [];
  const vLabels = [];
  const aLabels = [];

  let command = ffmpeg();

  let totalDuration = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const sourcePath = clip.file;
    command = command.input(sourcePath);

    // Video scaling & padding
    // We scale to fit within the target dimensions, then pad the rest with black.
    // Setsar=1 ensures square pixels.
    // FPS normalization: fps=${fps}
    let vFilter = `[${i}:v]scale=${outputW}:${outputH}:force_original_aspect_ratio=decrease,pad=${outputW}:${outputH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[v_norm_${i}]`;
    filterComplexArr.push(vFilter);
    vLabels.push(`[v_norm_${i}]`);

    // Audio handling
    if (clip.hasAudio) {
      let aFilter = `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a_norm_${i}]`;
      filterComplexArr.push(aFilter);
      aLabels.push(`[a_norm_${i}]`);
    } else {
      // Generate silent audio of the exact clip duration
      const duration = clip.duration || 1;
      // anullsrc generates continuous silence. We need to trim it.
      // We will use anullsrc as a separate input?
      // No, we can generate it inside the filter graph for this specific input duration using apad on a dummy 1-sample silence, or just use anullsrc with a specific duration.
      // A cleaner way in filter_complex without adding an input is to use `anullsrc=r=48000:cl=stereo:d=${duration}`
      // But anullsrc is a source filter, it doesn't take an input pad.
      filterComplexArr.push(`anullsrc=r=48000:cl=stereo:d=${duration}[a_norm_${i}]`);
      aLabels.push(`[a_norm_${i}]`);
    }

    totalDuration += (clip.duration || 1);
  }

  // Concat
  const concatInputs = vLabels.map((v, i) => `${v}${aLabels[i]}`).join('');
  filterComplexArr.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[v_concat][a_concat]`);

  let finalAudioLabel = '[a_concat]';

  // Audio Normalization
  if (settings.audioNormalize !== false) {
    filterComplexArr.push(`${finalAudioLabel}loudnorm=I=-16:TP=-1.5:LRA=11[a_norm_final]`);
    finalAudioLabel = '[a_norm_final]';
  }

  const filterComplex = filterComplexArr.join(';');
  const filterScriptPath = path.join(jobDir, 'filter.txt');
  await fs.writeFile(filterScriptPath, filterComplex, 'utf-8');

  // NVENC si une carte NVIDIA est disponible, sinon libx264.
  const encoderArgs = await videoEncoderArgs(outputH);
  const outputOptions = [
    '-filter_complex_script', filterScriptPath,
    '-map', '[v_concat]',
    '-map', finalAudioLabel,
    ...encoderArgs,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y'
  ];

  return new Promise((resolve, reject) => {
    command
      .outputOptions(outputOptions)
      .on('progress', (progress) => {
        let percent = progress.percent;
        if (percent === undefined && progress.timemark) {
          const parts = progress.timemark.split(':');
          if (parts.length === 3) {
            const h = parseFloat(parts[0]);
            const m = parseFloat(parts[1]);
            const s = parseFloat(parts[2]);
            const currentSec = h * 3600 + m * 60 + s;
            if (totalDuration > 0) {
              percent = (currentSec / totalDuration) * 100;
            }
          }
        }
        if (onProgress && percent !== undefined && !isNaN(percent)) {
          onProgress(Math.min(100, Math.max(0, percent)));
        }
      })
      .on('error', (err, stdout, stderr) => reject(new Error(`Rendu ffmpeg échoué : ${err.message}\nDétails: ${stderr}`)))
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

module.exports = { renderComposition };
