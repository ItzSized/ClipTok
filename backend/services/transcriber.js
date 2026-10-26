const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { toolEnv } = require('./ffmpegUtils');

const PYTHON_PATH = process.env.PYTHON_PATH || 'python';
const TRANSCRIBE_SCRIPT = path.join(__dirname, '..', 'scripts', 'transcribe.py');
const AUDIO_ANALYZER_SCRIPT = path.join(__dirname, '..', 'scripts', 'audio_analyzer.py');
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base';

const MODEL_BY_SPEED = {
  ultra_fast: 'tiny',
  fast: 'base',
  normal: 'small',
  precise: 'medium',
};

const ALLOWED_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3', 'large-v3-turbo', 'turbo'];

async function analyzeAudioEnergy(audioPath, signal) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_PATH, [AUDIO_ANALYZER_SCRIPT, audioPath], { windowsHide: true, env: toolEnv(), signal });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      console.warn(`[audio_analyzer] spawn error: ${err.message}`);
      resolve(null);
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`[audio_analyzer] failed (code ${code}): ${stderr.slice(-500)}`);
        return resolve(null);
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Transcrit l'audio via faster-whisper en local avec timestamps mot-par-mot.
 *
 * options :
 *   language     : code langue ('fr', 'en'...) ou 'auto'
 *   model        : force un modèle Whisper (sinon déduit de speedMode)
 *   initialPrompt, vadFilter, task
 *   analyzeEnergy: tague les mots prononcés fort avec [LOUD] (utile à la curation IA)
 *   signal       : AbortSignal pour annuler (tue le process Python)
 */
async function transcribeAudio(audioPath, jobDir, speedMode = 'precise', options = {}, onProgress) {
  // Ancienne signature : transcribeAudio(audioPath, jobDir, speedMode, onProgress)
  if (typeof options === 'function') {
    onProgress = options;
    options = {};
  }
  const { signal, analyzeEnergy = true } = options;

  try {
    const outputJson = path.join(jobDir, 'transcript.json');
    const model = ALLOWED_MODELS.includes(options.model) ? options.model : MODEL_BY_SPEED[speedMode] || WHISPER_MODEL;

    const args = [TRANSCRIBE_SCRIPT, audioPath, outputJson, '--model', model];
    if (options.language) args.push('--language', options.language);
    if (options.initialPrompt) args.push('--initial_prompt', options.initialPrompt);
    if (options.vadFilter) args.push('--vad_filter');
    if (options.task) args.push('--task', options.task);

    console.log(`[transcriber] Lancement de faster-whisper (modèle: ${model})... Cela peut prendre du temps.`);

    await new Promise((resolve, reject) => {
      const child = spawn(PYTHON_PATH, args, { windowsHide: true, env: toolEnv(), signal });
      let stderr = '';

      child.stdout.on('data', (d) => {
        if (!onProgress) return;
        const matches = [...d.toString().matchAll(/PROGRESS:(\d+\.\d+)/g)];
        if (matches.length > 0) {
          try {
            onProgress(parseFloat(matches[matches.length - 1][1]));
          } catch (e) {
            child.kill();
            reject(e);
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
            `Impossible de lancer le script Python de transcription (as-tu bien lancé 'npm run install:python' ?) : ${err.message}`
          )
        );
      });
      child.on('exit', (code) => {
        if (signal && signal.aborted) return reject(new Error("Tâche annulée par l'utilisateur."));
        if (code !== 0) return reject(new Error(`transcribe.py a échoué (code ${code}). Logs:\n${stderr.slice(-2000)}`));
        if (onProgress) onProgress(100);
        resolve();
      });
    });

    const transcript = JSON.parse(await fs.readFile(outputJson, 'utf-8'));
    if (!transcript.words || transcript.words.length === 0) {
      throw new Error('Aucun mot détecté dans la transcription (audio silencieux ou vide ?).');
    }

    // Signaux émotionnels (volume RMS) : les mots prononcés fort sont tagués [LOUD].
    if (analyzeEnergy) {
      try {
        console.log(`[transcriber] Analyse de l'énergie audio...`);
        const energyData = await analyzeAudioEnergy(audioPath, signal);
        if (energyData && energyData.energies && energyData.energies.length > 0) {
          const { energies, window_ms, loud_threshold } = energyData;
          for (const w of transcript.words) {
            const startIdx = Math.floor((w.start * 1000) / window_ms);
            const endIdx = Math.ceil((w.end * 1000) / window_ms);
            for (let i = startIdx; i <= endIdx && i < energies.length; i++) {
              if (energies[i] > loud_threshold) {
                w.word = `${w.word} [LOUD]`;
                break;
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[transcriber] Impossible d'analyser l'audio pour les émotions:`, e);
      }
    }

    return transcript;
  } catch (err) {
    throw new Error(`[transcriber] ${err.message}`);
  }
}

module.exports = { transcribeAudio, ALLOWED_MODELS };
