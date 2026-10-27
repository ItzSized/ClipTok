/**
 * tts.js
 *
 * Voix off : synthèse gratuite avec les voix neuronales de Microsoft Edge
 * (scripts/tts.py, module edge-tts, sans clé), ou ElevenLabs si une clé
 * ELEVENLABS_API_KEY est dans le .env (offre gratuite : ~10 000 caractères/mois,
 * la vraie voix d'Adam). Le MP3 est rangé dans la bibliothèque Voix (sur D:) et
 * enregistré comme média avec le minutage de chaque mot : les sous-titres de la
 * voix off se font sans transcription.
 */
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const media = require('./media');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'tts.py');
const VENV_PYTHON = path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
const PYTHON_PATH = process.env.PYTHON_PATH || (fsSync.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python');
const PREVIEW_DIR = path.join(media.CACHE_DIR, 'tts-preview');
const MAX_CHARS = 5000;

/** Voix proposées. rate/pitch : réglages de base du preset (le style « Adam » = voix grave et posée). */
const EDGE_VOICES = [
  { id: 'adam-like', name: 'Narrateur grave', desc: 'Grave et posé, style Adam', lang: 'en', gender: 'male', voice: 'en-US-ChristopherNeural', rate: -4, pitch: -8 },
  { id: 'andrew-deep', name: 'Andrew', desc: 'Chaleureux, grave, storytelling', lang: 'en', gender: 'male', voice: 'en-US-AndrewMultilingualNeural', rate: -2, pitch: -6 },
  { id: 'brian', name: 'Brian', desc: 'Naturel, décontracté', lang: 'en', gender: 'male', voice: 'en-US-BrianMultilingualNeural', rate: 0, pitch: -3 },
  { id: 'guy', name: 'Guy', desc: 'Énergique, hype', lang: 'en', gender: 'male', voice: 'en-US-GuyNeural', rate: 6, pitch: -2 },
  { id: 'roger', name: 'Roger', desc: 'Mature, documentaire', lang: 'en', gender: 'male', voice: 'en-US-RogerNeural', rate: -3, pitch: -5 },
  { id: 'eric', name: 'Eric', desc: 'Calme, sérieux', lang: 'en', gender: 'male', voice: 'en-US-EricNeural', rate: 0, pitch: -4 },
  { id: 'steffan', name: 'Steffan', desc: 'Clair, présentateur', lang: 'en', gender: 'male', voice: 'en-US-SteffanNeural', rate: 0, pitch: 0 },
  { id: 'ryan', name: 'Ryan', desc: 'Britannique', lang: 'en', gender: 'male', voice: 'en-GB-RyanNeural', rate: 0, pitch: -3 },
  { id: 'thomas', name: 'Thomas', desc: 'Britannique, posé', lang: 'en', gender: 'male', voice: 'en-GB-ThomasNeural', rate: -2, pitch: -4 },
  { id: 'william', name: 'William', desc: 'Australien', lang: 'en', gender: 'male', voice: 'en-AU-WilliamMultilingualNeural', rate: 0, pitch: -2 },
  { id: 'ava', name: 'Ava', desc: 'Chaleureuse, expressive', lang: 'en', gender: 'female', voice: 'en-US-AvaMultilingualNeural', rate: 0, pitch: 0 },
  { id: 'emma', name: 'Emma', desc: 'Joyeuse, claire', lang: 'en', gender: 'female', voice: 'en-US-EmmaMultilingualNeural', rate: 0, pitch: 0 },
  { id: 'aria', name: 'Aria', desc: 'Dynamique', lang: 'en', gender: 'female', voice: 'en-US-AriaNeural', rate: 0, pitch: 0 },
  { id: 'jenny', name: 'Jenny', desc: 'Douce, amicale', lang: 'en', gender: 'female', voice: 'en-US-JennyNeural', rate: 0, pitch: 0 },
  { id: 'michelle', name: 'Michelle', desc: 'Posée', lang: 'en', gender: 'female', voice: 'en-US-MichelleNeural', rate: 0, pitch: 0 },
  { id: 'sonia', name: 'Sonia', desc: 'Britannique', lang: 'en', gender: 'female', voice: 'en-GB-SoniaNeural', rate: 0, pitch: 0 },
  { id: 'henri', name: 'Henri', desc: 'Français, grave', lang: 'fr', gender: 'male', voice: 'fr-FR-HenriNeural', rate: 0, pitch: -5 },
  { id: 'remy', name: 'Rémy', desc: 'Français, naturel', lang: 'fr', gender: 'male', voice: 'fr-FR-RemyMultilingualNeural', rate: 0, pitch: -2 },
  { id: 'denise', name: 'Denise', desc: 'Française', lang: 'fr', gender: 'female', voice: 'fr-FR-DeniseNeural', rate: 0, pitch: 0 },
  { id: 'vivienne', name: 'Vivienne', desc: 'Française, chaleureuse', lang: 'fr', gender: 'female', voice: 'fr-FR-VivienneMultilingualNeural', rate: 0, pitch: 0 },
].map((v) => ({ ...v, provider: 'edge' }));

/** Voix ElevenLabs par défaut (disponibles avec une clé gratuite). */
const ELEVEN_VOICES = [
  { id: 'eleven-adam', name: 'Adam (ElevenLabs)', desc: 'La vraie voix d’Adam', lang: 'en', gender: 'male', voice: 'pNInz6obpgDQGcFmaJgB' },
  { id: 'eleven-brian', name: 'Brian (ElevenLabs)', desc: 'Grave, narrateur', lang: 'en', gender: 'male', voice: 'nPczCjzI2devNBz1zQrb' },
  { id: 'eleven-daniel', name: 'Daniel (ElevenLabs)', desc: 'Britannique, autoritaire', lang: 'en', gender: 'male', voice: 'onwK4e9ZLuTAKqWW03F9' },
  { id: 'eleven-bill', name: 'Bill (ElevenLabs)', desc: 'Mature, documentaire', lang: 'en', gender: 'male', voice: 'pqHfZKP75CvOlQylNhV4' },
  { id: 'eleven-rachel', name: 'Rachel (ElevenLabs)', desc: 'Calme, claire', lang: 'en', gender: 'female', voice: '21m00Tcm4TlvDq8ikWAM' },
].map((v) => ({ ...v, provider: 'elevenlabs', rate: 0, pitch: 0 }));

const elevenKey = () => (process.env.ELEVENLABS_API_KEY || '').split(',')[0].trim();

function listVoices() {
  return [...(elevenKey() ? ELEVEN_VOICES : []), ...EDGE_VOICES].map(({ voice, ...v }) => v);
}

function findVoice(id) {
  return [...ELEVEN_VOICES, ...EDGE_VOICES].find((v) => v.id === id) || EDGE_VOICES[0];
}

const signed = (n, unit) => `${n >= 0 ? '+' : ''}${Math.round(n)}${unit}`;

function runEdge(voice, text, { rate = 0, pitch = 0 }, outAudio, signal) {
  const dir = path.dirname(outAudio);
  const textFile = path.join(dir, `${path.basename(outAudio)}.txt`);
  const wordsFile = path.join(dir, `${path.basename(outAudio)}.json`);
  return (async () => {
    await fs.writeFile(textFile, text, 'utf-8');
    try {
      await new Promise((resolve, reject) => {
        const args = [SCRIPT, voice.voice, signed(voice.rate + rate, '%'), signed(voice.pitch + pitch, 'Hz'), textFile, outAudio, wordsFile];
        const child = spawn(PYTHON_PATH, args, { windowsHide: true, signal });
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += d));
        child.on('error', (err) => reject(new Error(`Impossible de lancer Python pour la voix off : ${err.message}`)));
        child.on('close', (code) => {
          if (code === 0) return resolve();
          if (/No module named ['"]?edge_tts/.test(stderr)) return reject(new Error('Module edge-tts manquant : lancez « npm run install:python » (ou pip install edge-tts dans backend/venv).'));
          reject(new Error(`Synthèse vocale échouée : ${stderr.trim().split('\n').pop() || `code ${code}`}`));
        });
      });
      return JSON.parse(await fs.readFile(wordsFile, 'utf-8'));
    } finally {
      await fs.unlink(textFile).catch(() => { });
      await fs.unlink(wordsFile).catch(() => { });
    }
  })();
}

/** ElevenLabs avec minutage par caractère, regroupé en mots. */
async function runEleven(voice, text, { rate = 0 }, outAudio, signal) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.voice}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': elevenKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, 1 + rate / 100)) },
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      const j = JSON.parse(body);
      detail = j.detail?.message || j.detail?.status || JSON.stringify(j.detail || j);
    } catch { }
    throw new Error(`ElevenLabs ${res.status} : ${String(detail).slice(0, 200)}`);
  }
  const data = await res.json();
  await fs.writeFile(outAudio, Buffer.from(data.audio_base64, 'base64'));
  const a = data.alignment || {};
  const words = [];
  let cur = null;
  (a.characters || []).forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = { text: '', start: a.character_start_times_seconds[i], end: 0 };
    cur.text += ch;
    cur.end = a.character_end_times_seconds[i];
  });
  if (cur) words.push(cur);
  return words;
}

function synthesizeTo(voice, text, opts, outAudio, signal) {
  return voice.provider === 'elevenlabs' ? runEleven(voice, text, opts, outAudio, signal) : runEdge(voice, text, opts, outAudio, signal);
}

/** Nom de fichier tiré des premiers mots du texte. */
function fileTitle(text) {
  const words = text.replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  return words.length > 50 ? words.slice(0, 50) : words || 'Voix off';
}

/**
 * Génère une voix off et l'enregistre comme média (bibliothèque Voix).
 * opts : { voice: id, rate: % (-50..50), pitch: Hz (-20..20) }.
 */
async function generateVoice(text, opts = {}, signal) {
  const clean = String(text || '').trim().slice(0, MAX_CHARS);
  if (!clean) throw new Error('Texte de la voix off vide.');
  const voice = findVoice(opts.voice);
  const tune = { rate: Math.max(-50, Math.min(50, Number(opts.rate) || 0)), pitch: Math.max(-20, Math.min(20, Number(opts.pitch) || 0)) };
  await fs.mkdir(media.LIBRARY.voice, { recursive: true });
  const target = await media.freeName(media.LIBRARY.voice, `${fileTitle(clean)} - ${voice.name.replace(/\s*\(.*\)/, '')}`, '.mp3');
  // Écrit d'abord sous un nom temporaire : un fichier à moitié écrit ne serait pas repris par le scan.
  const tmp = path.join(media.TEMP_DIR, `tts-${uuidv4()}.mp3`);
  await fs.mkdir(media.TEMP_DIR, { recursive: true });
  try {
    const words = (await synthesizeTo(voice, clean, tune, tmp, signal)).filter((w) => w.text && w.end > w.start);
    await fs.copyFile(tmp, target);
    const transcript = { language: voice.lang, model: `tts:${voice.id}`, words, createdAt: new Date().toISOString() };
    return media.registerFile(target, {
      name: path.basename(target),
      source: 'tts',
      extra: { transcript, ...(voice.lang === 'en' ? { transcriptEn: transcript } : {}), tts: { voice: voice.id, text: clean, ...tune } },
    });
  } finally {
    await fs.unlink(tmp).catch(() => { });
  }
}

const SAMPLES = {
  en: 'This is how I sound. Perfect for your next viral video.',
  fr: 'Voici ma voix. Parfaite pour ta prochaine vidéo virale.',
};

/** Extrait d'écoute d'une voix (mis en cache). */
async function previewFile(id) {
  const voice = findVoice(id);
  const file = path.join(PREVIEW_DIR, `${voice.id}.mp3`);
  try {
    await fs.access(file);
    return file;
  } catch { }
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
  const tmp = `${file}.${uuidv4()}.tmp.mp3`;
  try {
    await synthesizeTo(voice, SAMPLES[voice.lang] || SAMPLES.en, {}, tmp);
    await fs.rename(tmp, file);
  } finally {
    await fs.unlink(tmp).catch(() => { });
  }
  return file;
}

module.exports = { listVoices, generateVoice, previewFile };
