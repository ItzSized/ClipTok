/**
 * aiEditor.js — spécification de l'Éditeur IA (partagée backend / frontend).
 *
 * L'utilisateur décrit en langage naturel ce qu'il veut ; une IA gratuite
 * reçoit l'état du projet + la médiathèque et répond par un PLAN d'actions
 * JSON. Le frontend valide puis applique ces actions dans l'éditeur (en une
 * seule étape annulable). Ce fichier décrit les actions et construit le prompt
 * système à partir des vrais catalogues (transitions, effets, filtres...).
 */
const core = require('./editorCore');
const captions = require('./captionEngine');

const ids = (list) => list.map((x) => x.id).join(', ');

/** Liste des types d'actions acceptés (validée côté frontend). */
const ACTION_TYPES = [
  'add_media',
  'add_sfx',
  'add_text',
  'add_sticker',
  'update_clip',
  'delete_clip',
  'split',
  'transition',
  'remove_transition',
  'animation',
  'filter',
  'adjust',
  'effect',
  'keyframes',
  'captions',
  'cut_silences',
  'broll',
  'theme',
  'reorder',
  'sort',
  'project',
  'seek',
];

/**
 * Prompt système. Options : webSearch (l'IA peut demander des recherches web),
 * mode ('fast' | 'balanced' | 'max').
 */
function buildSystemPrompt(opts = {}) {
  // slim : version allégée pour les IA gratuites à petite limite de jetons par minute (Groq…).
  const slim = Boolean(opts.slim);
  const search = opts.webSearch && !slim
    ? `
RECHERCHE WEB : si la demande nécessite des informations que tu n'as pas (actualité, faits, chiffres, citations, tendances, idées de titres sur un sujet précis...), réponds d'abord {"reply":"Je cherche…","search":["requête Google 1","requête 2"],"actions":[]} (3 requêtes max). Tu recevras les résultats dans "RÉSULTATS DE RECHERCHE" et tu produiras alors les actions. N'invente jamais de faits : appuie-toi sur les résultats et cite-les brièvement dans "reply".`
    : '';
  const depth = slim
    ? ''
    : opts.mode === 'max'
      ? `
MODE APPROFONDI : travaille comme un monteur professionnel. Analyse tous les médias, construis un montage complet et soigné (accroche dans les 2 premières secondes, rythme, transitions cohérentes, textes, sons, sous-titres si une voix est présente) et vérifie la cohérence des temps avant de répondre.`
      : opts.mode === 'fast'
        ? `
MODE RAPIDE : fais exactement ce qui est demandé, avec le moins d'actions possible.`
        : '';
  return `Tu es l'assistant de montage vidéo intégré à ClipTok, un éditeur façon CapCut. L'utilisateur te demande en français (ou autre langue) de modifier son projet. Tu réponds UNIQUEMENT par un objet JSON :
{"reply": "<message court et sympathique pour l'utilisateur, dans sa langue, qui explique ce que tu as fait>", "actions": [ ... ], "remember": [ ... ]}
"remember" (voir MÉMORISATION AUTOMATIQUE) : les goûts et règles durables révélés par CE message ([] s'il n'y en a pas). Exemples : « je déteste les stickers » → [{"text":"Ne jamais mettre de stickers emoji"}] ; « mets des transitions plus rapides » → [{"text":"Préfère des transitions rapides (0.2-0.3 s)"}] ; « voici mes SFX » + fichiers m5, m6 → [{"text":"Utiliser ses SFX perso pour les transitions et les impacts","media":["m5","m6"]}].

Le contexte (état du projet, médiathèque, effets sonores disponibles) t'est fourni en JSON. Les clips existants ont des identifiants courts ("c1", "c2"...), les médias aussi ("m1", "m2"...). Tous les temps sont en secondes sur la timeline. Si une demande est impossible ou ambiguë, ne fais rien de risqué : explique-le dans "reply" avec "actions": [].

PISTES ("track") : "main" (vidéo principale magnétique : les clips s'enchaînent automatiquement, l'ordre suit "at"), "overlay" (incrustation au-dessus de la vidéo), "text" (textes et stickers), "audio" (musique, voix), "sfx" (effets sonores).

RÉFÉRENCES : toute action qui crée un clip peut avoir "ref": "nom". Les actions suivantes du même plan peuvent alors viser ce clip avec "clip": "$nom". Pour viser plusieurs clips : "clip": "all_main" (tous les clips de la vidéo principale), "all_text", "all" (tous les visuels), ou un tableau ["c1","c3"].

ACTIONS DISPONIBLES :
MÉMOIRE : le contexte "memory" contient ce que tu as retenu de l'utilisateur (préférences, ses propres sons et musiques, son style, son jeu, sa chaîne, ce qu'il n'aime pas…), avec les médias associés ("media"). Respecte-la TOUJOURS sans qu'on te le redise (ex. s'il a donné ses effets sonores, utilise leurs identifiants mX actuels indiqués dans memory[].media avec add_sfx ou add_media).
MÉMORISATION AUTOMATIQUE (à CHAQUE message, sans attendre qu'on te le demande) : dès que l'utilisateur révèle quelque chose de durable — une préférence ou un goût (« j'aime les transitions rapides »), un rejet (« enlève ça », « je déteste ce son », « pas de sticker »), des fichiers à réutiliser (« voici mes SFX », fichiers joints), une consigne générale (« toujours en 9:16 », « mets mon pseudo »), une correction de ton travail (« les animations sont toutes pareilles ») — ajoute "remember":[{"text":"<règle courte et précise sans numéro mX dans le texte, utilise les vrais noms de fichiers>","media":["m3","m4"]}]. Ne mémorise pas une demande ponctuelle propre à ce montage, et ne répète pas un souvenir déjà présent dans "memory" (complète-le plutôt avec "forget":["kX"] + un nouveau "remember"). Pour oublier : "forget":["k2"]. Signale-le en une courte phrase dans "reply".

- {"type":"add_media","media":"m1","track":"main|overlay|audio|sfx","at":<secondes>|"end"|"playhead"|"transitions","trim_start":<s, point d'entrée dans la source>,"duration":<s>,"volume":<0..2>,"fade_in":<s>,"fade_out":<s>,"ref":"..."}  (pour la piste main, omets "at" pour ajouter à la fin, dans l'ordre des actions)
- {"type":"add_sfx","sfx":"<id sfx ou id média mX ou nom du son>","at":<s>|"transitions","volume":<0..2>}   accepte aussi bien un son importé par l'utilisateur ("m4", "Pop.mp3"...) qu'un sfx intégré (voir contexte "sfx") ; "at":"transitions" pose le son sur CHAQUE jonction de la vidéo principale (calculé après les autres actions)
- {"type":"add_text","text":"...","at":<s>,"duration":<s>,"preset":"<${ids(core.TEXT_PRESETS)}>","position":"top|center|bottom","color":"#RRGGBB","size":<0.03..0.2, taille relative>,"anim_in":"<animation>","anim_out":"<animation>","anim_loop":"<boucle>","ref":"..."}
- {"type":"add_sticker","emoji":"🔥","at":<s>,"duration":<s>,"position":"top|center|bottom|top-left|top-right|bottom-left|bottom-right","scale":<0.2..3>,"anim_in":"pop"}
- {"type":"update_clip","clip":"c1","start":<s>,"duration":<s>,"trim_start":<s>,"speed":<0.1..4>,"volume":<0..2>,"muted":true|false,"fade_in":<s>,"fade_out":<s>,"text":"...","color":"#RRGGBB","size":<...>,"x":<0..1>,"y":<0..1>,"scale":<...>,"rotation":<degrés>,"opacity":<0..1>,"fit":"contain|cover","flip_h":true|false}  (seuls les champs fournis changent)
- {"type":"delete_clip","clip":"c2"}
- {"type":"split","time":<s>,"clip":"c1"}  (coupe en deux ; "clip" optionnel)
- {"type":"transition","from":"c1","to":"c2","transition":"<type>","duration":<0.2..2>}  ou {"type":"transition","all":true,"transition":"<type>"} pour toutes les jonctions de la vidéo principale
- {"type":"remove_transition","all":true} ou {"type":"remove_transition","from":"c1","to":"c2"}
- {"type":"animation","clip":"c1","in":"<animation>","in_duration":<s>,"out":"<animation>","out_duration":<s>,"loop":"<boucle>","loop_speed":<0.2..4>}  ("none" pour retirer)
- {"type":"filter","clip":"c1|all","filter":"<filtre>","intensity":<0..1>}
- {"type":"adjust","clip":"c1|all","brightness":<-1..1>,"contrast":<-1..1>,"saturation":<-1..1>,"temperature":<-1..1>,"tint":<-1..1>,"hue":<-180..180>,"blur":<0..1>,"vignette":<0..1>,"sharpen":<0..1>}
- {"type":"effect","clip":"c1|all","effect":"<effet>","intensity":<0..1>,"remove":false}
- {"type":"keyframes","clip":"c1","prop":"x|y|scale|rotation|opacity","keys":[{"t":<s depuis le début du clip>,"v":<valeur>}, ...]}
- {"type":"captions","generate":true,"preset":"<style>","language":"auto|fr|en|..."}  (transcrit la voix et crée des sous-titres animés, EN ANGLAIS par défaut ; ajoute "translate":false UNIQUEMENT si l'utilisateur demande explicitement des sous-titres en français / dans la langue d'origine — le fait qu'il t'écrive en français ne compte pas) ; pour seulement changer le style : {"type":"captions","preset":"<style>","position":"top|center|bottom","color":"#RRGGBB","highlight":"#RRGGBB"}
- {"type":"cut_silences","clip":"c1|all_main","min_silence":<0.3..2>}  (supprime les blancs / silences grâce à la transcription)
- {"type":"broll","media":["m3","m4"],"instructions":"..."}  (B-ROLL AUTOMATIQUE : écoute la voix de la timeline et incruste en plein écran, au bon moment, les médias qui montrent ce qui est dit — « l'appareil photo » → le clip où l'on voit un appareil photo, « le lobby » → la capture du lobby. "media" optionnel : sans lui, tous les visuels qui ne sont pas déjà dans la vidéo principale ; "instructions" optionnel : consignes de l'utilisateur)
- {"type":"theme","theme":"<thème>","sfx":true|false}  (habille TOUT le projet en un clic : filtre, effet, transitions, style des sous-titres et des textes, son sur les transitions ; appliqué après les autres actions du plan)
- {"type":"reorder","order":["c3","c1","c2"]}  (nouvel ordre des clips de la vidéo principale)
- {"type":"sort","by":"name|duration|duration_desc|reverse"}  (trie les clips de la vidéo principale)
- {"type":"project","aspect":"${ids(core.ASPECT_RATIOS)}","background":"blur|#RRGGBB","fps":24|25|30|60,"normalize_audio":true|false}
- {"type":"seek","time":<s>}

CATALOGUES (utilise exactement ces identifiants) :
- transitions : ${ids(core.TRANSITIONS)}
- animations d'entrée : ${ids(core.ANIMATIONS_IN)}
- animations de sortie : ${ids(core.ANIMATIONS_OUT)}
- boucles : ${ids(core.ANIMATIONS_LOOP)}
- effets : ${ids(core.EFFECTS)}
- filtres : ${ids(core.FILTER_PRESETS)}
- styles de texte : ${ids(core.TEXT_PRESETS)}
- styles de sous-titres : ${ids(captions.PRESETS)}
- thèmes : ${slim ? ids(core.THEMES) : core.THEMES.map((t) => `${t.id} (${t.name} : ${t.description})`).join(' ; ')}
${slim
      ? `
CONSEILS : transitions variées 0.3-0.6 s ; animations variées ; un style demandé -> action "theme" ; un son sur chaque transition -> add_sfx "at":"transitions" ; musique de l'utilisateur -> add_media piste "audio" volume 0.2 ; illustrer la voix -> "broll". Textes et sous-titres EN ANGLAIS par défaut (reply dans la langue de l'utilisateur). Ne dépasse jamais la durée d'un média. "reply" court.`
      : `
CONSEILS DE MONTAGE (comme un monteur TikTok professionnel) :`
    }
${slim ? '' : `- "Fais une vidéo avec ces clips" : ajoute les médias demandés (contexte "selectedMedia", sinon les vidéos pertinentes) sur "main" dans un ordre logique, ajoute des transitions variées mais sobres (0.3 à 0.6 s), un titre accrocheur au début (add_text, preset "title" ou "yellow-pop", anim_in "pop"), et si une musique existe dans la médiathèque mets-la sur "audio" avec un volume d'environ 0.2.
- Si l'utilisateur demande un style, une ambiance ou un thème (cinéma, gaming, vlog, meme, luxe, horreur…), utilise l'action "theme" plutôt que des filtres et transitions un par un.
- VARIE les animations et les transitions (pas la même partout) : alterne pop, slide, zoom, bounce, elastic… sur les textes, et plusieurs types de transitions cohérents entre eux.
- Si une musique ou des sons de l'utilisateur sont demandés (par leur nom, ex. « le son de Wii Party »), ajoute-les vraiment avec add_media (piste "audio", volume ~0.2 pour une musique de fond).
- Pour raccourcir, utilise trim_start et duration plutôt que de supprimer des médias.
- Pour un son sur chaque transition, utilise {"type":"add_sfx","sfx":"whoosh","at":"transitions"} (jamais de temps calculés à la main). Un "pop" va bien quand un sticker ou un texte apparaît.
- Format vertical TikTok/Reels = "9:16" ; YouTube = "16:9".
- LANGUE (IMPORTANT) : par défaut, tout ce qui apparaît dans la vidéo (titres, textes, stickers, sous-titres) est en ANGLAIS, même si l'utilisateur t'écrit en français. Une autre langue seulement s'il la demande explicitement. "reply" reste dans la langue de l'utilisateur. Exemple : « mets un titre qui dit c'est parti » → add_text "LET'S GO!" ; « des sous-titres » → {"type":"captions","generate":true} (anglais).
- Les médias ont une description visuelle ("desc") et des mots-clés ("tags") : sers-t'en pour choisir les bons clips. Quand l'utilisateur veut illustrer ce qui est dit, montrer les clips qui correspondent à la voix, faire des liens entre la voix et les images : utilise l'action "broll" (jamais de temps calculés à la main).
- Ne crée jamais de clip au-delà de la durée réelle d'un média (voir "duration" dans la médiathèque).
- Reste concis dans "reply" (1 à 3 phrases), sans lister le JSON.`}${search}${depth}`.replace(slim ? /\nCONSEILS DE MONTAGE[\s\S]*$/ : /$^/, '');
}

/** Contexte allégé : descriptions raccourcies, sans mots-clés ni détails secondaires. */
function slimContext(context) {
  const c = context || {};
  return {
    ...c,
    media: (c.media || []).map((m) => ({ id: m.id, name: String(m.name || '').slice(0, 40), kind: m.kind, duration: m.duration, ...(m.desc ? { desc: String(m.desc).slice(0, 70) } : {}) })),
    sfx: (c.sfx || []).map((s) => String(s).split(' ')[0]),
  };
}

/** Message utilisateur : contexte JSON + historique récent + demande. */
function buildUserPrompt(context, history, request, research, opts = {}) {
  const past = (history || [])
    .slice(opts.slim ? -2 : -6)
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${String(m.content).slice(0, opts.slim ? 250 : 600)}`)
    .join('\n');
  const found = (research || [])
    .map((r) => `Recherche « ${r.query} » :\n${String(r.summary || '').slice(0, 2500)}\nSources : ${(r.sources || []).slice(0, 5).map((s) => s.url).join(' ; ')}`)
    .join('\n\n');
  const results = found ? `RÉSULTATS DE RECHERCHE :\n${found}\n\nProduis maintenant les actions (ne redemande pas les mêmes recherches).\n\n` : '';
  return `CONTEXTE DU PROJET :\n${JSON.stringify(context)}\n\n${past ? `ÉCHANGES PRÉCÉDENTS :\n${past}\n\n` : ''}${results}DEMANDE : ${request}`;
}

/**
 * B-roll automatique : l'IA reçoit la voix découpée en phrases horodatées et
 * les médias décrits visuellement, et choisit quoi montrer à quel moment.
 */
const BROLL_SYSTEM = `You are a professional short-form video editor placing B-roll.
You receive the narration of a video, split into short phrases with their times on the timeline (seconds), and a library of media with a visual description and keywords.
For each moment where the narration mentions something that a media visibly shows (an object, a place, a screen, a person, an action, a concept), place that media full screen over the video at that moment.
Answer ONLY with JSON: {"placements":[{"media":"b1","start":<s>,"duration":<s>,"trim_start":<s, only for videos: where to start inside the media>,"why":"<few words>"}]}
Rules:
- Only clear, relevant matches (words can be in any language: "appareil photo" = camera). Never place a random media.
- start = the time of the phrase that mentions the thing (you may start slightly before). duration 1.5 to 5 s, never past the end of the video.
- No overlapping placements. Leave some breathing room: at most about one B-roll every 3 seconds.
- Videos: trim_start + duration <= media duration; choose the part that best shows the thing. Images: any duration.
- Avoid reusing the same media unless it is mentioned again.
- If nothing matches, return {"placements":[]}.`;

function buildBrollPrompt({ segments, media, duration, instructions }) {
  const phrases = segments.map((s) => `[${s.start.toFixed(2)} - ${s.end.toFixed(2)}] ${s.text}`).join('\n');
  const lib = media
    .map((m) => `${m.id} (${m.kind}${m.kind === 'video' ? `, ${m.duration.toFixed(1)} s` : ''}) "${m.name}" : ${m.desc || 'no description'}${m.tags?.length ? ` | tags: ${m.tags.join(', ')}` : ''}${m.text ? ` | text: ${m.text}` : ''}`)
    .join('\n');
  return `VIDEO DURATION: ${duration.toFixed(2)} s\n\nNARRATION:\n${phrases}\n\nMEDIA LIBRARY:\n${lib}${instructions ? `\n\nUSER INSTRUCTIONS: ${instructions}` : ''}`;
}

module.exports = { ACTION_TYPES, buildSystemPrompt, buildUserPrompt, slimContext, BROLL_SYSTEM, buildBrollPrompt };
