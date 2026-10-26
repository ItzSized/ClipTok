const { SchemaType } = require('@google/generative-ai');
const fs = require('fs/promises');
const path = require('path');
const llm = require('./llm');

/** Mode de vitesse choisi dans l'interface -> niveau de modèle (gratuit) à utiliser. */
const TIER_BY_SPEED = { ultra_fast: 'fast', fast: 'balanced', normal: 'smart', precise: 'max' };

function buildCompactTranscript(words) {
  let out = '';
  let lastMarker = -5;
  for (const w of words) {
    if (w.start - lastMarker >= 5) {
      out += `\n[${w.start.toFixed(1)}s] `;
      lastMarker = w.start;
    }
    out += w.word + ' ';
  }
  return out.trim();
}

/**
 * Le LLM ne renvoie que des timestamps approximatifs (basés sur les marqueurs [Xs]).
 * On les recale ici sur les vraies frontières de mots pour garantir un montage
 * propre et des sous-titres parfaitement synchronisés.
 */
function snapToWordBoundaries(words, approxStart, approxEnd, minDuration) {
  let startWord = words[0];
  let endWord = words[words.length - 1];

  for (const w of words) {
    if (w.start <= approxStart) startWord = w;
    else break;
  }
  for (let i = words.length - 1; i >= 0; i--) {
    if (words[i].end >= approxEnd) endWord = words[i];
    else break;
  }

  if (endWord.end <= startWord.start) {
    endWord =
      words.find((w) => w.start >= startWord.start + minDuration) || words[words.length - 1];
  }

  return { start: startWord.start, end: endWord.end };
}

function buildSystemPrompt(targetDuration, clipCount, minDuration, maxDuration) {
  return `Tu es un Réalisateur et Monteur Vidéo Expert en rétention TikTok, Shorts et Reels.
Ton rôle est d'analyser la transcription d'une vidéo YouTube (avec des marqueurs de temps [Xs]) et d'en extraire une série logique de ${clipCount} clips d'environ ${targetDuration}s (entre ${minDuration}s et ${maxDuration}s).
[Graine aléatoire de génération: ${Math.random()}]

Règles très strictes de sélection :
1. SÉRIE CHRONOLOGIQUE : Les ${clipCount} clips doivent impérativement se suivre dans l'ordre chronologique de la vidéo. Tu dois diviser l'histoire en "Partie 1", "Partie 2", etc. NE SUPPRIME PAS trop de passages entre les parties ! Garde le contexte et les transitions, même s'ils sont un peu lents, pour que l'histoire reste parfaitement compréhensible du début à la fin.
2. TITRES ET FORMAT : Le titre généré pour chaque clip DOIT commencer par "Partie X : " (ex: "Partie 1 : ", "Partie 2 : ") suivi d'un titre viral incluant 1 ou 2 émojis pertinents.
3. STORYTELLING CONTINU : Chaque partie DOIT faire avancer l'histoire globale tout en gardant son propre "payoff" final, donnant envie de voir la partie suivante. La transition sémantique d'un clip à l'autre doit être fluide.
4. HOOK GENERATOR : Tu dois générer un "hook" (4 à 12 mots) ultra-catchy qui sera affiché en haut de l'écran pendant les 3 premières secondes.
5. SEMANTIC ZOOMS : Tu dois identifier les moments clés (punchline, révélation, nom célèbre) et créer des événements de "zoom" (intensité entre 0.10 et 0.20) à des timestamps précis. Limite à 3-4 zooms max par clip.
6. OUTRO INTELLIGENTE : Ne coupe pas au hasard. Identifie le timestamp exact du "payoff" (la fin de la phrase finale) dans \`ending.payoffTimestamp\`. Ne rallonge pas un clip artificiellement.
7. SIGNAUX ÉMOTIONNELS : La transcription contient des tags \`[LOUD]\` à côté des mots prononcés avec une forte énergie audio. Sers-toi de ces tags pour identifier les moments de haute intensité émotionnelle. Ne garde pas les tags \`[LOUD]\` dans tes titres/légendes.
- "start" et "end" sont des nombres en secondes basés sur les marqueurs fournis. Les passages ne doivent pas se chevaucher.
- Tu dois générer un score de viralité sur 100, une justification, une légende et des hashtags pour chaque clip.

Réponds STRICTEMENT avec un objet JSON valide contenant un tableau nommé "clips".`;
}

const CURATION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    clips: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          start: { type: SchemaType.NUMBER },
          end: { type: SchemaType.NUMBER },
          title: { type: SchemaType.STRING },
          viralityScore: { type: SchemaType.NUMBER },
          reason: { type: SchemaType.STRING },
          caption: { type: SchemaType.STRING },
          hashtags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          hook: { type: SchemaType.STRING },
          ending: {
            type: SchemaType.OBJECT,
            properties: { payoffTimestamp: { type: SchemaType.NUMBER } },
            required: ['payoffTimestamp'],
          },
          events: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                type: { type: SchemaType.STRING }, // "zoom"
                timestamp: { type: SchemaType.NUMBER },
                intensity: { type: SchemaType.NUMBER },
                reason: { type: SchemaType.STRING },
              },
              required: ['type', 'timestamp', 'intensity'],
            },
          },
        },
        required: ['start', 'end', 'title', 'viralityScore', 'reason', 'caption', 'hashtags', 'hook', 'ending', 'events'],
      },
    },
  },
  required: ['clips'],
};

/**
 * Demande la sélection des moments viraux à une IA gratuite (Gemini en premier,
 * puis Groq, OpenRouter, Mistral, Cerebras ou Ollama selon les clés configurées).
 */
async function callCurator(compactTranscript, targetDuration, clipCount, minDuration, maxDuration, speedMode, retryHint, signal, preferred) {
  const { data, provider, model } = await llm.generateJson({
    system: buildSystemPrompt(targetDuration, clipCount, minDuration, maxDuration),
    prompt: `Transcription :
${compactTranscript}${retryHint ? `

${retryHint}` : ''}`,
    schema: CURATION_SCHEMA,
    tier: TIER_BY_SPEED[speedMode] || 'balanced',
    temperature: 0.8,
    preferred,
    signal,
    // Longues transcriptions + modèles « réfléchis » : on laisse plus de temps.
    timeoutMs: 180000,
  });
  console.log(`[curator] Curation réalisée par ${provider} (${model}).`);
  return data;
}

function cleanWord(w) {
  return w.replace(/[.,!?…]/g, '').toLowerCase().trim();
}

function applyCorrections(words, corrections) {
  if (!corrections || corrections.length === 0) return;
  for (const corr of corrections) {
    if (!corr.wrong || !corr.correct) continue;
    const wrongLower = cleanWord(corr.wrong);
    for (const w of words) {
      const currentWordClean = cleanWord(w.word);
      // Remplacement si ressemblance exacte (en ignorant ponctuation/casse)
      if (currentWordClean === wrongLower || 
         (currentWordClean.length > 4 && wrongLower.length > 4 && (currentWordClean.includes(wrongLower) || wrongLower.includes(currentWordClean)))) {
        const punctuation = w.word.match(/[.,!?…]+$/);
        w.word = corr.correct + (punctuation ? punctuation[0] : '');
      }
    }
  }
}

/**
 * Sélectionne les moments les plus viraux de la transcription via un LLM,
 * puis recale précisément les timestamps sur les mots réels.
 */
async function findViralMoment(transcript, jobDir, targetDuration = 60, clipCount = 1, speedMode = 'fast', signal, preferredProvider) {
  try {
    const words = transcript.words;
    if (!transcript.words || transcript.words.length === 0) {
      throw new Error("La transcription ne contient aucun mot.");
    }
    
    // Utiliser la durée totale de la vidéo pour ne pas forcer des clips courts
    // si le créateur parle peu.
    const actualDuration = transcript.duration || Math.max(5, words[words.length - 1].end - words[0].start);
    
    // TikTok Creativity Program Beta requires videos > 60s for monetization.
    // Jump Cuts (EDL) remove silences (often ~10-15s), so we MUST ask the AI 
    // for a longer source clip to ensure the final render is >= 60s.
    let adjustedTarget = Number(targetDuration);
    let minDuration = Math.max(5, adjustedTarget - 15);
    
    if (adjustedTarget >= 60) {
       adjustedTarget += 15; // Demander à l'IA de viser ~75s
       minDuration = Math.max(minDuration, 70); // Minimum strict à 70s
    }
    minDuration = Math.min(actualDuration, minDuration);
    
    const maxDuration = Math.max(minDuration, adjustedTarget + 20);
    const compact = buildCompactTranscript(words);

    let parsed;
    try {
      parsed = await callCurator(compact, adjustedTarget, clipCount, minDuration, maxDuration, speedMode, undefined, signal, preferredProvider);
    } catch (e) {
      if (signal?.aborted) throw e;
      parsed = await callCurator(
        compact,
        adjustedTarget,
        clipCount,
        minDuration,
        maxDuration,
        speedMode,
        "ERREUR PRECEDENTE: Ton JSON était mal formaté ou tronqué. Assure-toi de produire un JSON parfait, ferme toutes les accolades et crochets.",
        signal
      );
    }

    if (!parsed.clips || !Array.isArray(parsed.clips)) {
      throw new Error('Réponse du LLM incomplète ou mal formée (tableau clips manquant).');
    }

    // Variables already defined above


    const results = [];
    for (const c of parsed.clips) {
      const startNum = Number(c.start);
      const endNum = Number(c.end);
      if (isNaN(startNum) || isNaN(endNum) || !c.title) continue;

      let { start, end } = snapToWordBoundaries(words, startNum, endNum, minDuration);

      // Smart Outro: On utilise le payoffTimestamp si fourni, sinon on garde end
      let payoff = Number(c.ending?.payoffTimestamp);
      let calculatedEnd = end;
      if (!isNaN(payoff) && payoff > start && payoff < end + 5) {
        calculatedEnd = payoff;
      }
      
      const finalSnapped = snapToWordBoundaries(words, start, calculatedEnd, 2);
      
      // Ajout d'un padding (respiration) pour éviter les cuts audio trop brutaux
      let finalStart = Math.max(0, finalSnapped.start - 0.25);
      let finalEnd = Math.min(actualDuration, finalSnapped.end + 0.4);

      if (finalEnd - finalStart < minDuration) {
        finalEnd = Math.min(actualDuration, finalStart + minDuration);
      }
      if (finalEnd - finalStart > maxDuration) {
        finalEnd = finalStart + maxDuration;
      }
      // Re-snap to word boundaries just in case we cut a word in half
      const finalSnappedEnd = snapToWordBoundaries(words, finalStart, finalEnd, 2);
      finalEnd = finalSnappedEnd.end;

      let rawHashtags = [];
      if (Array.isArray(c.hashtags)) {
         rawHashtags = c.hashtags;
      } else if (typeof c.hashtags === 'string') {
         rawHashtags = [c.hashtags];
      }
      
      const hashtags = rawHashtags
        .join(',')
        .replace(/['"\[\]#]/g, '')
        .split(/[, ]+/)
        .map(h => h.trim())
        .filter(Boolean)
        .slice(0, 5);

      applyCorrections(words, c.corrections);

      results.push({
        start: +finalStart.toFixed(2),
        end: +finalEnd.toFixed(2),
        title: String(c.title).slice(0, 80),
        viralityScore: Math.max(0, Math.min(100, Number(c.viralityScore) || 0)),
        reason: c.reason || '',
        caption: c.caption ? String(c.caption).slice(0, 300) : String(c.title).slice(0, 80),
        hashtags,
        hook: c.hook || '',
        events: Array.isArray(c.events) ? c.events : [],
        corrections: c.corrections || []
      });
    }

    if (results.length === 0) {
      throw new Error("Aucun clip valide n'a pu être généré par l'IA.");
    }

    await fs.writeFile(path.join(jobDir, 'curation.json'), JSON.stringify({ clips: results }, null, 2), 'utf-8');

    return results;
  } catch (err) {
    throw new Error(`[curator] ${err.message}`);
  }
}

module.exports = { findViralMoment };
