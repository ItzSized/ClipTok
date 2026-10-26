/**
 * timelineBuilder.js
 * 
 * Analyse la transcription d'un clip pour détecter les silences (Smart Cuts).
 * Produit une EDL (Edit Decision List) et génère des versions "time-shiftées"
 * de la transcription, du tracking facial et des événements (zooms, hooks).
 */

/**
 * Filtre les mots d'un clip
 */
function getClipWords(allWords, clipStart, clipEnd) {
  return allWords.filter(w => w.end > clipStart && w.start < clipEnd);
}

/**
 * Détecte les silences dans les mots d'un clip et retourne les coupures à effectuer.
 * @param {Array} words - Mots du clip (doivent avoir .start et .end absolus)
 * @param {Number} clipStart - Début du clip
 * @param {Number} clipEnd - Fin du clip
 * @param {Number} minSilence - Durée minimale (en sec) pour être considéré comme un silence
 * @param {Number} maxCuts - Nombre maximum de cuts autorisés (on garde les plus gros silences)
 * @param {Number} padding - Garder X sec d'audio avant/après la coupure pour un jump cut naturel
 * @returns {Array} - Liste des segments vidéo à conserver (EDL) [{start, end}]
 */
function buildEDL(words, clipStart, clipEnd, minSilence = 0.4, maxCuts = 5, padding = 0.1) {
  if (!words || words.length === 0) return [{ start: clipStart, end: clipEnd }];

  const silences = [];
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap >= minSilence) {
      silences.push({
        start: words[i].end,
        end: words[i + 1].start,
        duration: gap
      });
    }
  }

  // Trier par durée décroissante pour ne garder que les silences les plus longs
  silences.sort((a, b) => b.duration - a.duration);
  const selectedSilences = silences.slice(0, maxCuts);
  
  // Retrier chronologiquement
  selectedSilences.sort((a, b) => a.start - b.start);

  const segments = [];
  let currentStart = clipStart;

  for (const silence of selectedSilences) {
    const cutStart = silence.start + padding;
    const cutEnd = silence.end - padding;
    
    // Sécurité: Si le silence devient trop petit après le padding, on l'ignore
    if (cutEnd - cutStart < 0.1) continue;

    segments.push({ start: currentStart, end: cutStart });
    currentStart = cutEnd;
  }

  segments.push({ start: currentStart, end: clipEnd });
  return segments;
}

/**
 * Fonction générique pour décaler n'importe quelle donnée avec un champ temps en fonction de l'EDL.
 * @param {Array} items - Éléments à décaler (mots, events, etc.)
 * @param {String} timeField - Le nom du champ de temps (ex: "start", "t", "timestamp")
 * @param {Array} edl - Edit Decision List
 * @returns {Array} - Les éléments avec leurs temps décalés (ceux tombant dans un cut sont ignorés)
 */
function shiftTimeline(items, timeField, edl) {
  const shifted = [];

  for (const item of items) {
    const t = item[timeField];
    let newT = -1;
    let accumulatedOffset = 0;

    for (const segment of edl) {
      if (t >= segment.start && t <= segment.end) {
        // L'élément est dans ce segment
        newT = accumulatedOffset + (t - segment.start);
        break;
      }
      if (t > segment.end) {
        accumulatedOffset += (segment.end - segment.start);
      }
    }

    if (newT >= 0) {
      shifted.push({ ...item, [timeField]: newT });
    }
  }
  return shifted;
}

/**
 * Fonction spécifique pour les mots car ils ont un "start" et un "end"
 */
function shiftWords(words, edl) {
  const shifted = [];
  for (const w of words) {
    let newStart = -1;
    let newEnd = -1;
    let accumulatedOffset = 0;

    // Calcul pour start
    for (const segment of edl) {
      if (w.start >= segment.start && w.start <= segment.end) {
        newStart = accumulatedOffset + (w.start - segment.start);
        break;
      }
      if (w.start > segment.end) accumulatedOffset += (segment.end - segment.start);
    }

    accumulatedOffset = 0;
    // Calcul pour end
    for (const segment of edl) {
      if (w.end >= segment.start && w.end <= segment.end) {
        newEnd = accumulatedOffset + (w.end - segment.start);
        break;
      }
      if (w.end > segment.end) accumulatedOffset += (segment.end - segment.start);
    }

    if (newStart >= 0 && newEnd >= 0) {
      shifted.push({ ...w, start: newStart, end: newEnd });
    }
  }
  return shifted;
}

module.exports = {
  getClipWords,
  buildEDL,
  shiftTimeline,
  shiftWords
};
