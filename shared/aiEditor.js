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

/** Voix off disponibles (backend/services/tts.js) : "adam-like" = voix grave style Adam d'ElevenLabs. */
const VOICE_IDS = 'adam-like, andrew-deep, brian, guy, roger, eric, steffan, ryan, thomas, william, ava, emma, aria, jenny, michelle, sonia, henri (fr), remy (fr), denise (fr), vivienne (fr)';

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
  'voiceover',
  'web_media',
  'undo',
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
  return `Tu es l'assistant de montage vidéo intégré à ClipTok, un éditeur façon CapCut. L'utilisateur te demande en français (ou autre langue) de modifier son projet. Tu réponds UNIQUEMENT par un objet JSON, dans cet ordre :
{"checklist": ["<chaque consigne précise de la DEMANDE, une par ligne : quoi, où, combien, quelle couleur, quelle durée…>"], "reply": "<message court et sympathique pour l'utilisateur, dans sa langue, qui explique ce que tu as fait>", "actions": [ ... ], "remember": [ ... ]}

RÈGLES PRIORITAIRES (plus importantes que tous les conseils ci-dessous) :
1. OBÉIS À LA LETTRE. Chaque consigne de la DEMANDE (texte exact, couleur, durée, moment, nombre, position, style, langue, fichier nommé) doit être respectée telle quelle. Écris-les d'abord dans "checklist", puis vérifie que CHAQUE ligne a son action. Un texte demandé entre guillemets s'écrit mot pour mot (pas traduit, pas reformulé).
2. NE FAIS QUE CE QUI EST DEMANDÉ. N'ajoute pas de titre, sticker, musique, filtre, thème, transition ou sous-titres non demandés (sauf demande vague du type « fais un montage », « rends-le viral »). Une demande de modification ne touche à rien d'autre.
3. MODIFIE L'EXISTANT au lieu de recréer : « change le texte », « mets-le en rouge », « plus gros », « déplace-le » → update_clip sur le clip concerné (voir "clips" du contexte, "selection", ou le dernier clip créé dans les ÉCHANGES PRÉCÉDENTS). « enlève / supprime » → delete_clip. Ne duplique jamais un clip existant.
4. SUIS LA CONVERSATION : « ça », « le », « celui-là », « encore », « refais » renvoient aux ÉCHANGES PRÉCÉDENTS (les actions déjà appliquées y sont listées). Si l'utilisateur dit que ton dernier essai est faux, corrige précisément ce point.
5. IDENTIFIANTS : n'utilise que les clips "cX" et médias "mX" présents dans le CONTEXTE (ou des "$ref" créés dans ce plan) et uniquement les identifiants des CATALOGUES. N'invente jamais d'identifiant.
6. Si une consigne est impossible avec les actions disponibles, fais le reste et dis clairement dans "reply" ce qui n'a pas pu être fait (ne prétends jamais avoir fait quelque chose que tes actions ne font pas).
7. REVENIR EN ARRIÈRE : « reviens en arrière », « annule », « remets comme avant », « remets l'ancien / l'ancienne … », « enlève ce que tu viens de faire » → {"type":"undo","steps":N} (N = nombre de tes réponses précédentes à défaire, d'après les ÉCHANGES PRÉCÉDENTS : 1 = la dernière). Le projet reprend alors exactement l'état d'avant. Ne réponds JAMAIS « rien à modifier » ou « j'ai conservé… » à une demande de changement : une demande de changement sans action est une erreur.
8. LA VOIX : « la voix », « le son des clips », « remets la voix » = le son D'ORIGINE des vidéos (update_clip "muted":false / "volume"). « Le texte de la voix » / « ce qu'il dit à l'écran » = les SOUS-TITRES (captions). L'action "voiceover" (voix de synthèse) UNIQUEMENT si l'utilisateur demande explicitement une voix off générée, une narration ou une « voix IA ». Les clips "generated_voice": true sont des voix de synthèse que TU as ajoutées.
9. TU ES UNE ÉQUIPE : d'autres IA ont pu répondre avant toi dans cette discussion. Leurs réponses et leurs [Actions appliquées] font foi : continue leur travail comme si c'était le tien, sans le contredire ni le refaire.
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
- {"type":"undo","steps":1}  (RETOUR EN ARRIÈRE : rétablit le projet tel qu'il était avant tes N dernières réponses ; à mettre EN PREMIER, éventuellement suivi d'autres actions)
- {"type":"web_media","query":"<ce qu'il faut trouver sur internet>","kind":"screenshot|image|video","url":"<optionnel : page précise, ex. une URL des recherches précédentes>","track":"overlay|main","at":<s>,"duration":<s à l'écran>,"clip_start":<s, début de l'extrait vidéo>,"clip_length":<s, 3..90>,"ref":"..."}  (INTERNET : tu PEUX récupérer toi-même des visuels sur le web et les mettre dans la vidéo — "screenshot" = capture d'écran du site (page officielle d'un logiciel, d'un jeu, d'un outil…), "image" = image trouvée sur Google/Bing Images, "video" = extrait d'une vidéo YouTube. Ne dis JAMAIS que tu ne peux pas aller sur internet ou chercher des images : utilise cette action. Par défaut posé en incrustation ("overlay") à la tête de lecture)
- {"type":"voiceover","text":"<texte exact à dire>","at":<s>,"voice":"<voix>","volume":<0..2>,"ref":"..."}  (VOIX OFF générée, posée sur la piste audio ; omets "voice" pour la voix choisie par l'utilisateur (contexte "voice") ; voix : ${VOICE_IDS} ; si on te demande d'écrire le texte, écris un script parlé naturel, EN ANGLAIS par défaut ; enchaîne {"type":"captions","generate":true} après si des sous-titres sont voulus)
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
- styles de sous-titres : ${slim ? ids(captions.PRESETS) : captions.PRESETS.map((p) => `${p.id} (${p.name})`).join(', ')}
- thèmes : ${slim ? ids(core.THEMES) : core.THEMES.map((t) => `${t.id} (${t.name} : ${t.description})`).join(' ; ')}
${slim
      ? `
CONSEILS : transitions variées 0.3-0.6 s ; animations variées ; un style demandé -> action "theme" ; un son sur chaque transition -> add_sfx "at":"transitions" ; musique de l'utilisateur -> add_media piste "audio" volume 0.2 ; illustrer la voix -> "broll" ; voix off -> "voiceover" ; visuel d'internet (site, logiciel, jeu, image, extrait YouTube) -> "web_media". Textes et sous-titres EN ANGLAIS par défaut (reply dans la langue de l'utilisateur). Ne dépasse jamais la durée d'un média. "reply" court.`
      : `
CONSEILS DE MONTAGE (comme un monteur TikTok professionnel) :`
    }
${slim ? '' : `- "Fais une vidéo avec ces clips" : ajoute les médias demandés (contexte "selectedMedia", sinon les vidéos pertinentes) sur "main" dans un ordre logique, ajoute des transitions variées mais sobres (0.3 à 0.6 s), un titre accrocheur au début (add_text, preset "title" ou "yellow-pop", anim_in "pop"), et si une musique existe dans la médiathèque mets-la sur "audio" avec un volume d'environ 0.2.
- Si l'utilisateur demande un style, une ambiance ou un thème pour TOUTE la vidéo (cinéma, gaming, vlog, meme, luxe, horreur…), utilise l'action "theme" plutôt que des filtres et transitions un par un. S'il ne parle que des sous-titres, change seulement leur style ({"type":"captions","preset":...}).
- VARIE les animations et les transitions (pas la même partout) : alterne pop, slide, zoom, bounce, elastic… sur les textes, et plusieurs types de transitions cohérents entre eux.
- Si une musique ou des sons de l'utilisateur sont demandés (par leur nom, ex. « le son de Wii Party »), ajoute-les vraiment avec add_media (piste "audio", volume ~0.2 pour une musique de fond).
- Pour raccourcir, utilise trim_start et duration plutôt que de supprimer des médias.
- Pour un son sur chaque transition, utilise {"type":"add_sfx","sfx":"whoosh","at":"transitions"} (jamais de temps calculés à la main). Un "pop" va bien quand un sticker ou un texte apparaît.
- Format vertical TikTok/Reels = "9:16" ; YouTube = "16:9".
- LANGUE (IMPORTANT) : par défaut, tout ce qui apparaît dans la vidéo (titres, textes, stickers, sous-titres) est en ANGLAIS, même si l'utilisateur t'écrit en français. Une autre langue seulement s'il la demande explicitement. "reply" reste dans la langue de l'utilisateur. Exemple : « mets un titre qui dit c'est parti » → add_text "LET'S GO!" ; « des sous-titres » → {"type":"captions","generate":true} (anglais).
- Quand l'utilisateur parle d'une chose qui n'est pas dans la médiathèque (un site, un logiciel comme « Forge GUI », un jeu, une personne, un produit) et veut la montrer : "web_media" (kind "screenshot" pour un site / logiciel, "image" pour une photo ou un logo, "video" pour un extrait). Si des recherches précédentes ont donné l'URL officielle, passe-la dans "url".
- Les médias ont une description visuelle ("desc") et des mots-clés ("tags") : sers-t'en pour choisir les bons clips. Quand l'utilisateur veut illustrer ce qui est dit, montrer les clips qui correspondent à la voix, faire des liens entre la voix et les images : utilise l'action "broll" (jamais de temps calculés à la main).
- Ne crée jamais de clip au-delà de la durée réelle d'un média (voir "duration" dans la médiathèque).
- Reste concis dans "reply" (1 à 3 phrases), sans lister le JSON.`}${search}${depth}`.replace(slim ? /\nCONSEILS DE MONTAGE[\s\S]*$/ : /$^/, '');
}

/**
 * Vérifie un plan d'actions par rapport au contexte envoyé (clips, médias, catalogues).
 * Retourne la liste des problèmes (vide si tout est cohérent) : ils sont renvoyés
 * à l'IA pour qu'elle corrige son plan avant qu'il soit appliqué.
 */
function validatePlan(data, context, request) {
  const problems = [];
  const actions = Array.isArray(data && data.actions) ? data.actions : null;
  if (!actions) return ['"actions" doit être un tableau.'];
  const ctx = context || {};
  const clipIds = new Set((ctx.clips || []).map((c) => c.id));
  const media = ctx.media || [];
  const mediaIds = new Set(media.map((m) => m.id));
  const mediaNames = media.map((m) => String(m.name || '').toLowerCase());
  const sfxIds = new Set((ctx.sfx || []).map((s) => String(s).split(' ')[0]));
  const refs = new Set();
  const has = (list, id) => id === undefined || id === null || id === 'none' || list.some((x) => x.id === id);
  const groups = new Set(['all', 'all_main', 'all_text', 'selection']);
  const checkClip = (v, i, field) => {
    if (v === undefined) return;
    for (const one of Array.isArray(v) ? v : [v]) {
      if (typeof one !== 'string') problems.push(`action ${i + 1} : "${field}" invalide (${JSON.stringify(one)}).`);
      else if (one.startsWith('$')) {
        if (!refs.has(one.slice(1))) problems.push(`action ${i + 1} : "${one}" ne correspond à aucun "ref" créé AVANT dans le plan.`);
      } else if (!groups.has(one) && !clipIds.has(one)) problems.push(`action ${i + 1} : le clip "${one}" n'existe pas (clips existants : ${[...clipIds].join(', ') || 'aucun'}).`);
    }
  };
  const knownMedia = (v) => {
    const s = String(v || '').trim();
    if (mediaIds.has(s)) return true;
    const low = s.toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '');
    return low.length >= 2 && mediaNames.some((n) => n === s.toLowerCase() || n.replace(/\.[a-z0-9]{2,5}$/, '') === low || n.includes(low));
  };
  actions.forEach((a, i) => {
    if (!a || typeof a !== 'object') return problems.push(`action ${i + 1} : ce n'est pas un objet.`);
    if (!ACTION_TYPES.includes(a.type)) return problems.push(`action ${i + 1} : type inconnu "${a.type}" (types possibles : ${ACTION_TYPES.join(', ')}).`);
    switch (a.type) {
      case 'add_media':
        if (!knownMedia(a.media)) problems.push(`action ${i + 1} : média "${a.media}" introuvable dans la médiathèque.`);
        break;
      case 'add_sfx':
        if (!a.sfx) problems.push(`action ${i + 1} : "sfx" manquant.`);
        else if (!sfxIds.has(String(a.sfx)) && !knownMedia(a.sfx) && ![...sfxIds].some((s) => s.includes(String(a.sfx).toLowerCase()))) problems.push(`action ${i + 1} : son "${a.sfx}" inconnu (ni sfx intégré, ni média).`);
        break;
      case 'add_text':
        if (typeof a.text !== 'string' || !a.text.trim()) problems.push(`action ${i + 1} : "text" manquant.`);
        if (a.preset && !has(core.TEXT_PRESETS, a.preset)) problems.push(`action ${i + 1} : style de texte "${a.preset}" inconnu.`);
        break;
      case 'transition':
        if (!has(core.TRANSITIONS, a.transition)) problems.push(`action ${i + 1} : transition "${a.transition}" inconnue.`);
        if (!a.all) {
          checkClip(a.from, i, 'from');
          checkClip(a.to, i, 'to');
        }
        break;
      case 'animation':
        checkClip(a.clip, i, 'clip');
        if (!has(core.ANIMATIONS_IN, a.in)) problems.push(`action ${i + 1} : animation d'entrée "${a.in}" inconnue.`);
        if (!has(core.ANIMATIONS_OUT, a.out)) problems.push(`action ${i + 1} : animation de sortie "${a.out}" inconnue.`);
        if (!has(core.ANIMATIONS_LOOP, a.loop)) problems.push(`action ${i + 1} : boucle "${a.loop}" inconnue.`);
        break;
      case 'filter':
        checkClip(a.clip, i, 'clip');
        if (!has(core.FILTER_PRESETS, a.filter)) problems.push(`action ${i + 1} : filtre "${a.filter}" inconnu.`);
        break;
      case 'effect':
        checkClip(a.clip, i, 'clip');
        if (!has(core.EFFECTS, a.effect)) problems.push(`action ${i + 1} : effet "${a.effect}" inconnu.`);
        break;
      case 'captions':
        if (a.preset && !has(captions.PRESETS, a.preset)) problems.push(`action ${i + 1} : style de sous-titres "${a.preset}" inconnu.`);
        break;
      case 'theme':
        if (!has(core.THEMES, a.theme)) problems.push(`action ${i + 1} : thème "${a.theme}" inconnu.`);
        break;
      case 'reorder':
        checkClip(a.order, i, 'order');
        break;
      case 'voiceover':
        if (typeof a.text !== 'string' || !a.text.trim()) problems.push(`action ${i + 1} : "text" de la voix off manquant.`);
        break;
      case 'web_media':
        if (!String(a.query || '').trim() && !String(a.url || '').trim()) problems.push(`action ${i + 1} : "query" (ou "url") manquant pour web_media.`);
        break;
      case 'broll':
        for (const m of Array.isArray(a.media) ? a.media : []) if (!knownMedia(m)) problems.push(`action ${i + 1} : média "${m}" introuvable.`);
        break;
      case 'undo':
        break;
      default:
        checkClip(a.clip, i, 'clip');
    }
    if (typeof a.ref === 'string' && a.ref) refs.add(a.ref.replace(/^\$/, ''));
  });
  // Demande de changement à laquelle l'IA répond sans rien faire (« j'ai conservé… ») : à corriger.
  const wantsChange = CHANGE_VERBS.test(String(request || ''));
  const asksBack = /\?\s*$/.test(String(data.reply || '').trim());
  const searching = Array.isArray(data.search) && data.search.length > 0;
  if (actions.length === 0 && wantsChange && !asksBack && !searching) {
    problems.push('la DEMANDE réclame une modification mais ton plan ne contient AUCUNE action. Fais-la vraiment (pour « reviens en arrière / annule / remets comme avant » : {"type":"undo","steps":N}).');
  }
  return problems;
}

/** Verbes d'une demande de modification (français / anglais). */
const CHANGE_VERBS = /\b(remets?|rajoute|ajoute|enl[eè]ve|supprime|retire|mets?|change|modifie|reviens|revenir|annule|coupe|fais|remplace|baisse|monte|augmente|diminue|d[ée]place|agrandis|r[ée]duis|add|remove|delete|put|undo|revert|replace|change|make)\b/i;

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
/**
 * Mémoire de la discussion, IDENTIQUE pour toutes les IA (même en version allégée) :
 * la consigne de départ est toujours gardée, puis les derniers échanges, où les
 * lignes [Actions appliquées] / [Échecs] / [ANNULÉ] / [Recherches] passent avant le
 * texte libre (c'est ce qui permet à une IA de reprendre le travail d'une autre).
 */
function formatHistory(history, slim) {
  const list = (history || []).filter((m) => m && typeof m.content === 'string');
  if (list.length === 0) return '';
  const keep = slim ? 8 : 14;
  const textMax = slim ? 160 : 700;
  const tagsMax = slim ? 400 : 1000;
  const line = (m) => {
    const parts = String(m.content).split('\n');
    const tags = parts.filter((p) => /^\[.*\]$/.test(p.trim())).join(' ');
    const text = parts.filter((p) => !/^\[.*\]$/.test(p.trim())).join(' ').replace(/\s+/g, ' ').trim();
    const short = text.length > textMax ? `${text.slice(0, textMax)}…` : text;
    return `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${short}${tags ? ` ${tags.slice(0, tagsMax)}` : ''}`;
  };
  const first = list[0].role === 'user' ? list[0] : null;
  const recent = list.slice(-keep);
  const out = [];
  if (first && !recent.includes(first)) {
    out.push(`Utilisateur (consigne de départ) : ${String(first.content).replace(/\s+/g, ' ').slice(0, slim ? 600 : 1500)}`);
    const skipped = list.length - recent.length - 1;
    if (skipped > 0) out.push(`(… ${skipped} message(s) plus ancien(s) omis …)`);
  }
  return [...out, ...recent.map(line)].join('\n');
}

function buildUserPrompt(context, history, request, research, opts = {}) {
  const past = formatHistory(history, opts.slim);
  const found = (research || [])
    .map((r) => `Recherche « ${r.query} » :\n${String(r.summary || '').slice(0, 2500)}\nSources : ${(r.sources || []).slice(0, 5).map((s) => s.url).join(' ; ')}`)
    .join('\n\n');
  const results = found ? `RÉSULTATS DE RECHERCHE :\n${found}\n\nProduis maintenant les actions (ne redemande pas les mêmes recherches).\n\n` : '';
  // Correction : plan précédent refusé par le validateur, avec la liste des erreurs.
  const repair = opts.repair
    ? `\n\nTON PLAN PRÉCÉDENT CONTIENT DES ERREURS :\n${opts.repair.problems.map((p) => `- ${p}`).join('\n')}\nPlan refusé : ${JSON.stringify(opts.repair.actions).slice(0, 4000)}\nRenvoie le plan COMPLET corrigé (même format JSON), en respectant toujours chaque consigne de la DEMANDE.`
    : '';
  return `CONTEXTE DU PROJET :\n${JSON.stringify(context)}\n\n${past ? `ÉCHANGES PRÉCÉDENTS :\n${past}\n\n` : ''}${results}DEMANDE (à respecter exactement) : ${request}${repair}`;
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

module.exports = { ACTION_TYPES, buildSystemPrompt, buildUserPrompt, slimContext, validatePlan, BROLL_SYSTEM, buildBrollPrompt };
