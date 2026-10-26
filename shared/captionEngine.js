/**
 * captionEngine.js — moteur de sous-titres partagé backend / frontend.
 *
 * Ce fichier (CommonJS, sans dépendance) est utilisé :
 *   - par le backend pour générer le fichier .ass brûlé par ffmpeg/libass ;
 *   - par le frontend pour l'aperçu temps réel (canvas) et les exports SRT/VTT.
 * Toute la logique de découpage (pages, lignes, mot actif) vit ici, ce qui
 * garantit que l'aperçu du navigateur correspond au rendu final.
 *
 * Unités d'un style :
 *   - fontSize       : taille de l'em en fraction de min(largeur, hauteur) de la vidéo
 *   - outlineWidth, shadowDepth, letterSpacing, boxPadding : fractions de l'em
 *   - positionX/Y    : centre du bloc de texte en fraction de la largeur/hauteur
 *   - couleurs       : '#RRGGBB', opacités entre 0 et 1
 */

const DEFAULT_STYLE = {
  preset: 'classic',
  fontId: 'Anton-Regular',
  fontSize: 0.075,
  uppercase: true,
  letterSpacing: 0,
  textColor: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 0.06,
  shadowColor: '#000000',
  shadowOpacity: 0.6,
  shadowDepth: 0.05,
  glow: false,
  background: 'none', // 'none' | 'box'
  backgroundColor: '#000000',
  backgroundOpacity: 0.6,
  boxPadding: 0.12,
  highlightMode: 'color', // 'none' | 'color' | 'box' | 'underline'
  highlightColors: ['#FFFF00', '#00FF00', '#00FFFF', '#FFA555'],
  highlightTextColor: '#FFFFFF',
  highlightScale: 1.15,
  animation: 'none', // 'none' | 'pop' | 'fade' | 'slide-up' | 'word-pop' | 'bounce' | 'karaoke' | 'typewriter'
  positionX: 0.5,
  positionY: 0.72,
  wordsPerPage: 5,
  maxLines: 2,
  maxCharsPerLine: 18,
  breakOnPunctuation: true,
  punctuation: 'keep', // 'keep' | 'remove'
  emphasizeLoud: false,
  loudColor: '#FF3B3B',
};

/** Modèles prêts à l'emploi (façon CapCut). Chaque preset surcharge DEFAULT_STYLE. */
const PRESETS = [
  {
    id: 'classic',
    name: 'ClipTok Classic',
    description: 'Le style historique : majuscules, couleurs tournantes, mot actif agrandi.',
    style: {},
  },
  {
    id: 'hormozi',
    name: 'Hormozi',
    description: 'Montserrat Black, gros contour, mot actif vert/jaune qui « pop ».',
    style: {
      fontId: 'Montserrat-Black',
      fontSize: 0.068,
      outlineWidth: 0.09,
      shadowOpacity: 0.8,
      highlightColors: ['#3DFF6E', '#FFE600'],
      highlightScale: 1.12,
      animation: 'word-pop',
      wordsPerPage: 3,
      maxLines: 2,
      maxCharsPerLine: 14,
    },
  },
  {
    id: 'beast',
    name: 'Beast',
    description: 'Police cartoon, contour épais, apparition « pop » par groupe de 2 mots.',
    style: {
      fontId: 'LuckiestGuy-Regular',
      fontSize: 0.085,
      outlineWidth: 0.11,
      shadowDepth: 0.08,
      shadowOpacity: 1,
      highlightColors: ['#FFE600'],
      highlightScale: 1.2,
      animation: 'pop',
      wordsPerPage: 2,
      maxLines: 1,
      maxCharsPerLine: 16,
    },
  },
  {
    id: 'karaoke',
    name: 'Karaoké',
    description: 'Remplissage progressif des mots, style lyrics.',
    style: {
      fontId: 'Poppins-ExtraBold',
      fontSize: 0.058,
      uppercase: false,
      outlineWidth: 0.07,
      highlightColors: ['#22D3EE'],
      highlightScale: 1,
      animation: 'karaoke',
      wordsPerPage: 6,
      maxLines: 2,
      maxCharsPerLine: 22,
    },
  },
  {
    id: 'boxed',
    name: 'Viral Box',
    description: 'Mot actif dans une boîte colorée, texte sans contour.',
    style: {
      fontId: 'Poppins-Black',
      fontSize: 0.062,
      outlineWidth: 0,
      shadowDepth: 0.06,
      shadowOpacity: 0.5,
      highlightMode: 'box',
      highlightColors: ['#7C3AED', '#E11D48', '#2563EB'],
      highlightTextColor: '#FFFFFF',
      highlightScale: 1.05,
      boxPadding: 0.14,
      animation: 'word-pop',
      wordsPerPage: 4,
      maxLines: 2,
      maxCharsPerLine: 16,
    },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Texte propre en casse normale, sans surlignage, fondu doux.',
    style: {
      fontId: 'Poppins-Bold',
      fontSize: 0.05,
      uppercase: false,
      outlineWidth: 0,
      shadowDepth: 0.04,
      shadowOpacity: 0.7,
      highlightMode: 'none',
      highlightScale: 1,
      animation: 'fade',
      wordsPerPage: 8,
      maxLines: 2,
      maxCharsPerLine: 28,
    },
  },
  {
    id: 'subtitle-bar',
    name: 'Sous-titre TV',
    description: 'Bandeau noir semi-transparent, lisible partout.',
    style: {
      fontId: 'Poppins-Bold',
      fontSize: 0.045,
      uppercase: false,
      outlineWidth: 0,
      shadowDepth: 0,
      background: 'box',
      backgroundColor: '#000000',
      backgroundOpacity: 0.65,
      boxPadding: 0.18,
      highlightMode: 'none',
      highlightScale: 1,
      animation: 'none',
      positionY: 0.85,
      wordsPerPage: 12,
      maxLines: 2,
      maxCharsPerLine: 34,
    },
  },
  {
    id: 'neon',
    name: 'Néon',
    description: 'Halo lumineux magenta, mot actif cyan.',
    style: {
      fontId: 'LilitaOne-Regular',
      fontSize: 0.07,
      outlineColor: '#FF2BD6',
      outlineWidth: 0.05,
      glow: true,
      shadowOpacity: 0,
      highlightColors: ['#5CF6FF'],
      highlightScale: 1.1,
      animation: 'word-pop',
      wordsPerPage: 3,
      maxCharsPerLine: 16,
    },
  },
  {
    id: 'typewriter',
    name: 'Machine à écrire',
    description: 'Les mots apparaissent un par un.',
    style: {
      fontId: 'RussoOne-Regular',
      fontSize: 0.06,
      outlineWidth: 0.07,
      highlightMode: 'none',
      highlightScale: 1,
      animation: 'typewriter',
      wordsPerPage: 6,
      maxLines: 2,
      maxCharsPerLine: 20,
    },
  },
  {
    id: 'bold-pop',
    name: 'Bold Pop',
    description: 'Texte jaune, contour noir, rebond du mot actif.',
    style: {
      fontId: 'TitanOne-Regular',
      fontSize: 0.066,
      textColor: '#FFE600',
      outlineWidth: 0.1,
      shadowDepth: 0.07,
      shadowOpacity: 1,
      highlightColors: ['#FFFFFF'],
      highlightScale: 1.18,
      animation: 'bounce',
      wordsPerPage: 3,
      maxCharsPerLine: 14,
    },
  },
  {
    id: 'marker',
    name: 'Marqueur',
    description: 'Écriture feutre, surlignage orange.',
    style: {
      fontId: 'PermanentMarker-Regular',
      fontSize: 0.062,
      uppercase: false,
      outlineWidth: 0.08,
      highlightColors: ['#FF8A00'],
      highlightScale: 1.1,
      animation: 'pop',
      wordsPerPage: 4,
      maxCharsPerLine: 18,
    },
  },
  {
    id: 'bebas',
    name: 'Cinéma',
    description: 'Bebas Neue élancée, mot actif rouge.',
    style: {
      fontId: 'BebasNeue-Regular',
      fontSize: 0.085,
      letterSpacing: 0.03,
      outlineWidth: 0.05,
      highlightColors: ['#FF3B3B'],
      highlightScale: 1.08,
      animation: 'slide-up',
      wordsPerPage: 4,
      maxCharsPerLine: 18,
    },
  },
  {
    id: 'impact',
    name: 'Impact',
    description: 'Anton blanc très épais, mot actif rouge qui pop.',
    style: { fontId: 'Anton-Regular', fontSize: 0.085, outlineWidth: 0.1, shadowDepth: 0.06, shadowOpacity: 1, highlightColors: ['#FF2D2D'], highlightScale: 1.18, animation: 'word-pop', wordsPerPage: 3, maxCharsPerLine: 14 },
  },
  {
    id: 'gaming',
    name: 'Gaming',
    description: 'Russo One cyan, contour magenta, halo.',
    style: { fontId: 'RussoOne-Regular', fontSize: 0.064, textColor: '#5CF6FF', outlineColor: '#7E22CE', outlineWidth: 0.08, glow: true, highlightColors: ['#F0ABFC', '#FFE600'], highlightScale: 1.12, animation: 'word-pop', wordsPerPage: 3, maxCharsPerLine: 14 },
  },
  {
    id: 'gold',
    name: 'Luxe or',
    description: 'Montserrat dorée, élégante, fondu.',
    style: { fontId: 'Montserrat-ExtraBold', fontSize: 0.056, uppercase: false, textColor: '#FFD54A', outlineColor: '#3B2600', outlineWidth: 0.05, shadowOpacity: 0.7, highlightColors: ['#FFFFFF'], highlightScale: 1.05, animation: 'fade', wordsPerPage: 5, maxCharsPerLine: 22 },
  },
  {
    id: 'horror',
    name: 'Horreur',
    description: 'Feutre rouge sang, halo sombre.',
    style: { fontId: 'PermanentMarker-Regular', fontSize: 0.066, textColor: '#F43F5E', outlineColor: '#000000', outlineWidth: 0.09, glow: true, shadowOpacity: 0, highlightColors: ['#FFFFFF'], highlightScale: 1.12, animation: 'pop', wordsPerPage: 3, maxCharsPerLine: 14 },
  },
  {
    id: 'kawaii',
    name: 'Kawaii',
    description: 'Titan One blanc, contour rose bonbon, rebond.',
    style: { fontId: 'TitanOne-Regular', fontSize: 0.064, textColor: '#FFFFFF', outlineColor: '#EC4899', outlineWidth: 0.12, shadowOpacity: 0, highlightColors: ['#FDE047', '#A5F3FC'], highlightScale: 1.15, animation: 'bounce', wordsPerPage: 3, maxCharsPerLine: 14 },
  },
  {
    id: 'fire',
    name: 'Feu',
    description: 'Texte orange, mot actif jaune, très punchy.',
    style: { fontId: 'LuckiestGuy-Regular', fontSize: 0.078, textColor: '#FF7A00', outlineColor: '#3B0A00', outlineWidth: 0.1, shadowDepth: 0.07, shadowOpacity: 1, highlightColors: ['#FFE600'], highlightScale: 1.2, animation: 'pop', wordsPerPage: 2, maxLines: 1, maxCharsPerLine: 16 },
  },
  {
    id: 'clean-box',
    name: 'Boîte blanche',
    description: 'Mot actif dans une boîte blanche, texte noir dedans.',
    style: { fontId: 'Poppins-Black', fontSize: 0.06, outlineWidth: 0.05, highlightMode: 'box', highlightColors: ['#FFFFFF'], highlightTextColor: '#000000', highlightScale: 1.04, boxPadding: 0.14, animation: 'word-pop', wordsPerPage: 4, maxCharsPerLine: 16 },
  },
  {
    id: 'underline',
    name: 'Souligné',
    description: 'Montserrat, mot actif souligné en jaune.',
    style: { fontId: 'Montserrat-ExtraBold', fontSize: 0.06, outlineWidth: 0.06, highlightMode: 'underline', highlightColors: ['#FFE600'], highlightScale: 1, animation: 'fade', wordsPerPage: 4, maxCharsPerLine: 18 },
  },
  {
    id: 'glow-green',
    name: 'Néon vert',
    description: 'Halo vert fluo, mot actif blanc.',
    style: { fontId: 'Kanit-Black', fontSize: 0.068, textColor: '#86EFAC', outlineColor: '#15803D', outlineWidth: 0.05, glow: true, shadowOpacity: 0, highlightColors: ['#FFFFFF'], highlightScale: 1.1, animation: 'word-pop', wordsPerPage: 3, maxCharsPerLine: 14 },
  },
  {
    id: 'archivo',
    name: 'Bloc orange',
    description: 'Archivo Black, ombre portée, mot actif orange.',
    style: { fontId: 'ArchivoBlack-Regular', fontSize: 0.066, outlineWidth: 0.05, shadowDepth: 0.1, shadowOpacity: 1, highlightColors: ['#FF5C00'], highlightScale: 1.14, animation: 'bounce', wordsPerPage: 3, maxCharsPerLine: 14 },
  },
  {
    id: 'blue-box',
    name: 'Boîtes bleues',
    description: 'Chaque mot actif dans une boîte bleue arrondie.',
    style: { fontId: 'Poppins-ExtraBold', fontSize: 0.058, uppercase: false, outlineWidth: 0, shadowDepth: 0.04, shadowOpacity: 0.5, highlightMode: 'box', highlightColors: ['#2563EB'], highlightTextColor: '#FFFFFF', highlightScale: 1.05, boxPadding: 0.14, animation: 'word-pop', wordsPerPage: 4, maxCharsPerLine: 18 },
  },
  {
    id: 'lyrics',
    name: 'Paroles',
    description: 'Karaoké rose, casse normale, 2 lignes.',
    style: { fontId: 'Poppins-Bold', fontSize: 0.052, uppercase: false, outlineWidth: 0.06, highlightColors: ['#F472B6'], highlightScale: 1, animation: 'karaoke', wordsPerPage: 7, maxLines: 2, maxCharsPerLine: 24 },
  },
];

/** Palettes de couleurs rapides pour les sous-titres : texte, contour, surlignage. */
const COLOR_PALETTES = [
  { id: 'white-yellow', name: 'Blanc / jaune', textColor: '#FFFFFF', outlineColor: '#000000', highlightColors: ['#FFE600'] },
  { id: 'white-green', name: 'Blanc / vert', textColor: '#FFFFFF', outlineColor: '#000000', highlightColors: ['#3DFF6E'] },
  { id: 'white-red', name: 'Blanc / rouge', textColor: '#FFFFFF', outlineColor: '#000000', highlightColors: ['#FF2D2D'] },
  { id: 'white-cyan', name: 'Blanc / cyan', textColor: '#FFFFFF', outlineColor: '#000000', highlightColors: ['#22D3EE'] },
  { id: 'white-pink', name: 'Blanc / rose', textColor: '#FFFFFF', outlineColor: '#000000', highlightColors: ['#F472B6'] },
  { id: 'white-purple', name: 'Blanc / violet', textColor: '#FFFFFF', outlineColor: '#000000', highlightColors: ['#A855F7'] },
  { id: 'yellow-white', name: 'Jaune / blanc', textColor: '#FFE600', outlineColor: '#000000', highlightColors: ['#FFFFFF'] },
  { id: 'black-white', name: 'Noir sur blanc', textColor: '#111111', outlineColor: '#FFFFFF', highlightColors: ['#E11D48'] },
  { id: 'gold', name: 'Or', textColor: '#FFD54A', outlineColor: '#3B2600', highlightColors: ['#FFFFFF'] },
  { id: 'fire', name: 'Feu', textColor: '#FF7A00', outlineColor: '#3B0A00', highlightColors: ['#FFE600'] },
  { id: 'ice', name: 'Glace', textColor: '#D9F6FF', outlineColor: '#0369A1', highlightColors: ['#FFFFFF'] },
  { id: 'neon', name: 'Néon', textColor: '#5CF6FF', outlineColor: '#7E22CE', highlightColors: ['#F0ABFC'] },
  { id: 'rainbow', name: 'Arc-en-ciel', textColor: '#FFFFFF', outlineColor: '#000000', highlightColors: ['#FF2D2D', '#FFE600', '#3DFF6E', '#22D3EE', '#A855F7'] },
  { id: 'mint', name: 'Menthe', textColor: '#ECFDF5', outlineColor: '#065F46', highlightColors: ['#34D399'] },
];

const ANIMATIONS = [
  { id: 'none', name: 'Aucune' },
  { id: 'pop', name: 'Pop (groupe)' },
  { id: 'fade', name: 'Fondu' },
  { id: 'slide-up', name: 'Glisse vers le haut' },
  { id: 'word-pop', name: 'Pop du mot actif' },
  { id: 'bounce', name: 'Rebond du mot actif' },
  { id: 'karaoke', name: 'Karaoké (remplissage)' },
  { id: 'typewriter', name: 'Machine à écrire' },
];

const HIGHLIGHT_MODES = [
  { id: 'none', name: 'Aucun' },
  { id: 'color', name: 'Couleur' },
  { id: 'box', name: 'Boîte' },
  { id: 'underline', name: 'Souligné' },
];

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}

/** Style complet = défauts + preset + surcharges. */
function resolveStyle(style) {
  const s = style || {};
  const preset = getPreset(s.preset || DEFAULT_STYLE.preset);
  const merged = Object.assign({}, DEFAULT_STYLE, preset.style, s);
  if (!Array.isArray(merged.highlightColors) || merged.highlightColors.length === 0) {
    merged.highlightColors = DEFAULT_STYLE.highlightColors.slice();
  }
  return merged;
}

/** Applique un preset en repartant de zéro (les réglages position peuvent être conservés). */
function applyPreset(presetId, keep) {
  const preset = getPreset(presetId);
  const style = Object.assign({}, DEFAULT_STYLE, preset.style, { preset: preset.id });
  if (keep) {
    for (const key of ['positionX', 'positionY']) if (keep[key] !== undefined) style[key] = keep[key];
  }
  return style;
}

function normalizeHex(hex) {
  let h = String(hex || '#FFFFFF').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) h = 'FFFFFF';
  return h.toUpperCase();
}

function hex2(n) {
  return Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0').toUpperCase();
}

/** '#RRGGBB' + opacité -> couleur de style ASS '&HAABBGGRR'. */
function assColor(hex, opacity) {
  const h = normalizeHex(hex);
  const a = opacity === undefined ? 0 : (1 - clamp(opacity, 0, 1)) * 255;
  return `&H${hex2(a)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
}

/** '#RRGGBB' -> couleur de balise inline ASS '&HBBGGRR&'. */
function assInlineColor(hex) {
  const h = normalizeHex(hex);
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`;
}

/** Temps ASS "H:MM:SS.cc" (arrondi au centième sans jamais produire "60.00"). */
function formatAssTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function formatClock(seconds, sep) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(r).padStart(3, '0')}`;
}

/** Neutralise les caractères qui ont un sens en ASS ({ } \). */
function escapeAssText(text) {
  return String(text).replace(/\\/g, '/').replace(/\{/g, '(').replace(/\}/g, ')').replace(/[\r\n]+/g, ' ');
}

// ---------------------------------------------------------------------------
// Mots, pages et lignes
// ---------------------------------------------------------------------------

const SENTENCE_END = /[.!?…]["'»”)\]]*$/;
const PUNCTUATION = /[.,!?;:…"«»“”()\[\]]/g;

/**
 * Normalise une liste de mots (format Whisper {word,start,end} ou éditeur {text,start,end}).
 * Retourne [{ text, display, start, end, loud }] trié et sans chevauchement.
 */
function prepareWords(rawWords, style) {
  const s = resolveStyle(style);
  const cleaned = (rawWords || [])
    .map((w) => {
      const source = String(w.text !== undefined ? w.text : w.word || '');
      return {
        text: source.replace(/\[LOUD\]/g, '').trim(),
        start: Number(w.start),
        end: Number(w.end),
        loud: Boolean(w.loud) || /\[LOUD\]/.test(source),
      };
    })
    .filter((w) => w.text.length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end))
    .sort((a, b) => a.start - b.start);

  // Fusionne les mots coupés autour d'une apostrophe ("l'" + "homme") et rattache
  // la ponctuation isolée (Whisper produit parfois "!" comme un mot à part).
  const merged = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (merged.length > 0 && /^[.,!?;:…»”")\]]+$/.test(cleaned[i].text)) {
      merged[merged.length - 1].text += cleaned[i].text;
      continue;
    }
    const current = Object.assign({}, cleaned[i]);
    while (
      i + 1 < cleaned.length &&
      (/['’-]$/.test(current.text) || /^['’-]/.test(cleaned[i + 1].text))
    ) {
      current.text += cleaned[i + 1].text;
      current.end = cleaned[i + 1].end;
      current.loud = current.loud || cleaned[i + 1].loud;
      i++;
    }
    merged.push(current);
  }

  for (let i = 0; i < merged.length; i++) {
    const w = merged[i];
    const next = merged[i + 1];
    if (next && w.end > next.start && next.start > w.start) w.end = next.start;
    if (w.end <= w.start) w.end = w.start + 0.05;
    let display = s.punctuation === 'remove' ? w.text.replace(PUNCTUATION, '') : w.text;
    if (!display) display = w.text;
    w.display = s.uppercase ? display.toLocaleUpperCase('fr-FR') : display;
  }
  return merged;
}

function lineLength(words, indices) {
  return indices.reduce((acc, idx, k) => acc + words[idx].display.length + (k > 0 ? 1 : 0), 0);
}

/**
 * Répartit les mots d'une page sur le moins de lignes possible (<= maxLines),
 * en équilibrant la longueur des lignes. Retourne des tableaux d'indices locaux.
 */
function layoutLines(words, maxChars, maxLines) {
  const n = words.length;
  if (n === 0) return [];
  const total = lineLength(words, words.map((_, i) => i));
  if (total <= maxChars || maxLines <= 1) return [words.map((_, i) => i)];

  let best = null;
  const search = (startIdx, linesLeft, acc) => {
    if (startIdx >= n) {
      const worst = Math.max(...acc.map((l) => lineLength(words, l)));
      if (!best || acc.length < best.lines.length || (acc.length === best.lines.length && worst < best.worst)) {
        best = { lines: acc.map((l) => l.slice()), worst };
      }
      return;
    }
    if (linesLeft === 0) return;
    for (let end = startIdx + 1; end <= n; end++) {
      const line = [];
      for (let k = startIdx; k < end; k++) line.push(k);
      if (line.length > 1 && lineLength(words, line) > maxChars) break;
      acc.push(line);
      search(end, linesLeft - 1, acc);
      acc.pop();
    }
  };
  search(0, maxLines, []);
  if (best) return best.lines;

  // Repli : remplissage glouton (une ligne trop longue reste possible pour un mot géant).
  const lines = [[]];
  for (let i = 0; i < n; i++) {
    const cur = lines[lines.length - 1];
    if (cur.length > 0 && lineLength(words, cur.concat(i)) > maxChars) lines.push([i]);
    else cur.push(i);
  }
  return lines;
}

/**
 * Découpe les mots en "pages" (groupes affichés ensemble).
 * Page : { start, end, words: [...], lines: [[idx...]], index }
 */
function paginate(words, style) {
  const s = resolveStyle(style);
  const maxWords = Math.round(clamp(s.wordsPerPage, 1, 15));
  const maxLines = Math.round(clamp(s.maxLines, 1, 4));
  const maxChars = Math.round(clamp(s.maxCharsPerLine, 4, 80));
  const pages = [];
  let cur = [];

  const flush = () => {
    if (cur.length) pages.push({ words: cur });
    cur = [];
  };

  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = w.start - prev.end;
      const tooMany = cur.length >= maxWords;
      const sentence = s.breakOnPunctuation && SENTENCE_END.test(prev.text);
      const overflow = layoutLines(cur.concat(w), maxChars, maxLines).length > maxLines ||
        lineLength(cur.concat(w), cur.concat(w).map((_, i) => i)) > maxChars * maxLines;
      if (tooMany || sentence || gap > 1.2 || overflow) flush();
    }
    cur.push(w);
  }
  flush();

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const next = pages[i + 1];
    p.index = i;
    p.lines = layoutLines(p.words, maxChars, maxLines);
    p.start = p.words[0].start;
    const linger = p.words[p.words.length - 1].end + 0.35;
    p.end = next ? Math.min(linger, next.words[0].start) : linger;
    if (p.end <= p.start) p.end = p.start + 0.1;
  }
  return pages;
}

/** Créneaux d'activation de chaque mot d'une page : [{ start, end }]. */
function wordSlots(page) {
  return page.words.map((w, i) => {
    const start = i === 0 ? page.start : w.start;
    let end = i === page.words.length - 1 ? page.end : page.words[i + 1].start;
    if (end <= start) end = start + 0.01;
    return { start, end };
  });
}

/** Page visible et mot actif au temps t (ou null). */
function getStateAt(pages, t) {
  let lo = 0;
  let hi = pages.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = pages[mid];
    if (t < p.start) hi = mid - 1;
    else if (t >= p.end) lo = mid + 1;
    else {
      const slots = wordSlots(p);
      let active = 0;
      for (let i = 0; i < slots.length; i++) if (slots[i].start <= t) active = i;
      return { page: p, activeIndex: active, pageTime: t - p.start, wordTime: t - slots[active].start, slots };
    }
  }
  return null;
}

function highlightColorFor(style, pageIndex) {
  const colors = style.highlightColors;
  return colors[pageIndex % colors.length];
}

/** Dimensions dérivées d'un style pour une vidéo W×H et une police { emRatio }. */
function computeMetrics(style, width, height, font) {
  const s = resolveStyle(style);
  const ref = Math.min(width, height);
  const emPx = s.fontSize * ref;
  const emRatio = font && font.emRatio ? font.emRatio : 0.7;
  return {
    emPx,
    assSize: emPx / emRatio,
    outline: s.outlineWidth * emPx,
    shadow: s.shadowDepth * emPx,
    spacing: s.letterSpacing * emPx,
    padding: s.boxPadding * emPx,
    x: s.positionX * width,
    y: s.positionY * height,
  };
}

// ---------------------------------------------------------------------------
// Génération ASS
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Construit un fichier .ass complet.
 * @param {object} opts
 * @param {Array}  opts.words   mots {word|text, start, end} en secondes (temps de sortie)
 * @param {object} opts.style   style (voir DEFAULT_STYLE)
 * @param {number} opts.width   largeur vidéo
 * @param {number} opts.height  hauteur vidéo
 * @param {object} opts.font    { assName, emRatio } (voir backend/services/fonts.js)
 * @param {object} [opts.hook]  { text, duration } texte d'accroche affiché en haut au début
 */
function buildAss(opts) {
  const style = resolveStyle(opts.style);
  const width = Math.round(opts.width);
  const height = Math.round(opts.height);
  const font = opts.font || { assName: 'Arial', emRatio: 0.895 };
  const m = computeMetrics(style, width, height, font);
  const words = prepareWords(opts.words, style);
  const pages = paginate(words, style);

  const fontName = font.assName;
  const size = round2(m.assSize);
  const textStyle = [
    'Text', fontName, size,
    assColor(style.textColor), assColor(style.textColor), assColor(style.outlineColor),
    assColor(style.shadowColor, style.shadowOpacity),
    0, 0, 0, 0, 100, 100, round2(m.spacing), 0, 1, round2(m.outline), round2(m.shadow), 5, 0, 0, 0, 1,
  ].join(',');
  const boxStyle = [
    'Box', fontName, size,
    '&HFF000000', '&HFF000000', assColor(style.backgroundColor, style.backgroundOpacity), '&HFF000000',
    0, 0, 0, 0, 100, 100, round2(m.spacing), 0, 3, round2(m.padding), 0, 5, 0, 0, 0, 1,
  ].join(',');
  const hookSize = round2(m.assSize * 1.05);
  const hookStyle = [
    'Hook', fontName, hookSize,
    assColor('#FFE600'), assColor('#FFFFFF'), assColor('#000000'), assColor('#000000', 0.6),
    0, 0, 0, 0, 100, 100, 0, 0, 1, round2(Math.max(m.outline, m.emPx * 0.06)), round2(m.emPx * 0.05), 5, 0, 0, 0, 1,
  ].join(',');

  const header = `[Script Info]
Title: ClipTok Captions
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${textStyle}
Style: ${boxStyle}
Style: ${hookStyle}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = [];
  const X = round2(m.x);
  const Y = round2(m.y);
  const glowTag = style.glow ? `\\blur${round2(Math.max(2, m.outline * 0.8))}` : '';
  const hasBoxLayer = style.background === 'box' || style.highlightMode === 'box';

  if (opts.hook && opts.hook.text) {
    const dur = Number(opts.hook.duration) || 3;
    const hy = round2(height * 0.16);
    // Accroche découpée en lignes courtes : sans retour à la ligne automatique (WrapStyle 2),
    // une phrase longue dans une police large sortirait de l'écran.
    const hookWords = String(opts.hook.text).toLocaleUpperCase('fr-FR').split(/\s+/).filter(Boolean).map((w) => ({ display: w }));
    // ~0,8 em par caractère en majuscules grasses, 90 % de la largeur utilisable.
    const maxHookChars = Math.max(8, Math.round((width * 0.9) / (m.emPx * 1.05 * 0.8)));
    const hookText = layoutLines(hookWords, maxHookChars, 3)
      .map((line) => line.map((i) => escapeAssText(hookWords[i].display)).join(' '))
      .join('\\N');
    events.push(
      `Dialogue: 2,${formatAssTime(0)},${formatAssTime(dur)},Hook,,0,0,0,,{\\an5\\pos(${X},${hy})\\fscx80\\fscy80\\t(0,200,\\fscx100\\fscy100)}${hookText}`
    );
  }

  const posTag = (first) => {
    if (first && style.animation === 'slide-up') {
      return `\\move(${X},${round2(Y + m.emPx * 0.6)},${X},${Y},0,180)`;
    }
    return `\\pos(${X},${Y})`;
  };

  /** Balises d'échelle d'un mot (identiques sur le calque texte et le calque boîte). */
  const scaleTags = (isActive, firstSlot) => {
    const base = isActive && style.highlightMode !== 'none' ? style.highlightScale * 100 : 100;
    const b = round2(base);
    if (firstSlot && style.animation === 'pop') {
      return `\\fscx${round2(b * 0.6)}\\fscy${round2(b * 0.6)}\\t(0,90,\\fscx${round2(b * 1.08)}\\fscy${round2(b * 1.08)})\\t(90,160,\\fscx${b}\\fscy${b})`;
    }
    if (isActive && style.animation === 'word-pop') {
      return `\\fscx100\\fscy100\\t(0,90,\\fscx${round2(b * 1.06)}\\fscy${round2(b * 1.06)})\\t(90,150,\\fscx${b}\\fscy${b})`;
    }
    if (isActive && style.animation === 'bounce') {
      return `\\fscx${b}\\fscy${b}\\t(0,80,\\fscx${round2(b * 1.22)}\\fscy${round2(b * 1.22)})\\t(80,160,\\fscx${round2(b * 0.94)}\\fscy${round2(b * 0.94)})\\t(160,220,\\fscx${b}\\fscy${b})`;
    }
    return `\\fscx${b}\\fscy${b}`;
  };

  for (const page of pages) {
    const hColor = highlightColorFor(style, page.index);
    const slots = wordSlots(page);

    if (style.animation === 'karaoke') {
      // Un seul événement par page : \kf remplit chaque mot de la couleur de surlignage.
      let text = '';
      let cursor = page.start;
      page.lines.forEach((line, li) => {
        if (li > 0) text += '\\N';
        line.forEach((idx, k) => {
          const w = page.words[idx];
          const slot = slots[idx];
          const startCs = Math.round((slot.start - cursor) * 100);
          const durCs = Math.max(1, Math.round((slot.end - slot.start) * 100));
          cursor = slot.start + durCs / 100;
          const lead = startCs > 0 ? `{\\k${startCs}}` : '';
          const color = style.emphasizeLoud && w.loud ? assInlineColor(style.loudColor) : assInlineColor(style.textColor);
          text += `${k > 0 ? ' ' : ''}${lead}{\\kf${durCs}\\1c${assInlineColor(hColor)}\\2c${color}}${escapeAssText(w.display)}`;
        });
      });
      const fade = '';
      events.push(
        `Dialogue: 1,${formatAssTime(page.start)},${formatAssTime(page.end)},Text,,0,0,0,,{\\an5${posTag(true)}${glowTag}${fade}}${text}`
      );
      if (style.background === 'box') {
        const boxText = page.lines.map((line) => line.map((idx) => escapeAssText(page.words[idx].display)).join(' ')).join('\\N');
        events.push(`Dialogue: 0,${formatAssTime(page.start)},${formatAssTime(page.end)},Box,,0,0,0,,{\\an5${posTag(true)}}${boxText}`);
      }
      continue;
    }

    slots.forEach((slot, activeIdx) => {
      const first = activeIdx === 0;
      const fade = first && style.animation === 'fade' ? '\\fad(150,0)' : '';
      let text = '';
      let box = '';
      page.lines.forEach((line, li) => {
        if (li > 0) {
          text += '\\N';
          box += '\\N';
        }
        line.forEach((idx, k) => {
          const w = page.words[idx];
          const isActive = idx === activeIdx && style.animation !== 'typewriter';
          const hidden = style.animation === 'typewriter' && idx > activeIdx;
          const scale = scaleTags(isActive, first);
          let color = style.textColor;
          if (style.emphasizeLoud && w.loud) color = style.loudColor;
          if (isActive && style.highlightMode === 'color') color = hColor;
          if (isActive && style.highlightMode === 'box') color = style.highlightTextColor;
          const under = isActive && style.highlightMode === 'underline' ? '\\u1' : '\\u0';
          const alpha = hidden ? '\\alpha&HFF&' : '\\alpha&H00&\\4a' + assShadowAlpha(style);
          const sep = k > 0 ? ' ' : '';
          text += `${sep}{${scale}\\1c${assInlineColor(color)}${alpha}${under}}${escapeAssText(w.display)}`;

          if (hasBoxLayer) {
            const boxed = !hidden && ((style.highlightMode === 'box' && isActive) || style.background === 'box');
            const boxColor = style.highlightMode === 'box' && isActive
              ? `\\3c${assInlineColor(hColor)}\\3a&H00&`
              : `\\3c${assInlineColor(style.backgroundColor)}\\3a${assAlpha(style.backgroundOpacity)}`;
            box += `${sep}{${scale}${boxed ? boxColor : '\\3a&HFF&'}}${escapeAssText(w.display)}`;
          }
        });
      });
      const start = formatAssTime(slot.start);
      const end = formatAssTime(slot.end);
      if (hasBoxLayer) {
        events.push(`Dialogue: 0,${start},${end},Box,,0,0,0,,{\\an5${posTag(first)}${fade}}${box}`);
      }
      events.push(`Dialogue: 1,${start},${end},Text,,0,0,0,,{\\an5${posTag(first)}${glowTag}${fade}}${text}`);
    });
  }

  return header + events.join('\n') + '\n';
}

function assAlpha(opacity) {
  return `&H${hex2((1 - clamp(opacity, 0, 1)) * 255)}&`;
}

function assShadowAlpha(style) {
  return assAlpha(style.shadowOpacity);
}

// ---------------------------------------------------------------------------
// Exports texte
// ---------------------------------------------------------------------------

function pageText(page) {
  return page.lines.map((line) => line.map((idx) => page.words[idx].display).join(' ')).join('\n');
}

function toSrt(rawWords, style) {
  const pages = paginate(prepareWords(rawWords, style), style);
  return pages
    .map((p, i) => `${i + 1}\n${formatClock(p.start, ',')} --> ${formatClock(p.end, ',')}\n${pageText(p)}\n`)
    .join('\n');
}

function toVtt(rawWords, style) {
  const pages = paginate(prepareWords(rawWords, style), style);
  return 'WEBVTT\n\n' + pages
    .map((p) => `${formatClock(p.start, '.')} --> ${formatClock(p.end, '.')}\n${pageText(p)}\n`)
    .join('\n');
}

function toPlainText(rawWords) {
  return (rawWords || []).map((w) => String(w.text !== undefined ? w.text : w.word || '').replace(/\[LOUD\]/g, '').trim()).filter(Boolean).join(' ');
}

module.exports = {
  COLOR_PALETTES,
  DEFAULT_STYLE,
  PRESETS,
  ANIMATIONS,
  HIGHLIGHT_MODES,
  resolveStyle,
  applyPreset,
  getPreset,
  prepareWords,
  paginate,
  layoutLines,
  wordSlots,
  getStateAt,
  highlightColorFor,
  computeMetrics,
  buildAss,
  toSrt,
  toVtt,
  toPlainText,
  formatAssTime,
  assColor,
};
