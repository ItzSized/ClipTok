/**
 * editorCore.js — cœur partagé de l'éditeur vidéo (backend + frontend).
 *
 * Contient le modèle de projet, les catalogues (transitions, animations,
 * effets, filtres, textes) et toute la "math" temporelle d'un clip
 * (images clés, animations d'entrée/sortie/boucle, couleurs).
 *
 * Les formules d'animation sont écrites UNE fois, dans un sous-ensemble commun
 * aux expressions ffmpeg et au JavaScript (+ - * / , sin cos pow min max abs
 * exp sqrt clip lt gt gte lte between mod floor hypot PI). Le frontend les
 * compile en fonctions JS pour l'aperçu ; le backend les injecte telles quelles
 * dans le graphe de filtres ffmpeg. L'aperçu et l'export suivent donc la même
 * courbe.
 *
 * Unités : temps en secondes ; positions en fraction du canevas (0..1, centre
 * du calque) ; rotation en degrés (sens horaire) ; échelle relative à la
 * taille "ajustée" du média dans le canevas.
 */

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

/** Transitions entre deux clips de la piste principale (noms = transitions xfade d'ffmpeg). */
const TRANSITIONS = [
  { id: 'fade', name: 'Fondu', category: 'Basique' },
  { id: 'fadeblack', name: 'Fondu au noir', category: 'Basique' },
  { id: 'fadewhite', name: 'Fondu au blanc', category: 'Basique' },
  { id: 'dissolve', name: 'Dissolution', category: 'Basique' },
  { id: 'wipeleft', name: 'Balayage gauche', category: 'Balayage' },
  { id: 'wiperight', name: 'Balayage droite', category: 'Balayage' },
  { id: 'wipeup', name: 'Balayage haut', category: 'Balayage' },
  { id: 'wipedown', name: 'Balayage bas', category: 'Balayage' },
  { id: 'smoothleft', name: 'Balayage doux gauche', category: 'Balayage' },
  { id: 'smoothright', name: 'Balayage doux droite', category: 'Balayage' },
  { id: 'smoothup', name: 'Balayage doux haut', category: 'Balayage' },
  { id: 'smoothdown', name: 'Balayage doux bas', category: 'Balayage' },
  { id: 'slideleft', name: 'Glisser gauche', category: 'Glisser' },
  { id: 'slideright', name: 'Glisser droite', category: 'Glisser' },
  { id: 'slideup', name: 'Glisser haut', category: 'Glisser' },
  { id: 'slidedown', name: 'Glisser bas', category: 'Glisser' },
  { id: 'circleopen', name: 'Cercle ouvrant', category: 'Formes' },
  { id: 'circleclose', name: 'Cercle fermant', category: 'Formes' },
  { id: 'radial', name: 'Radial', category: 'Formes' },
  { id: 'horzopen', name: 'Ouverture horizontale', category: 'Formes' },
  { id: 'vertopen', name: 'Ouverture verticale', category: 'Formes' },
  { id: 'rectcrop', name: 'Rectangle', category: 'Formes' },
  { id: 'zoomin', name: 'Zoom avant', category: 'Dynamique' },
  { id: 'squeezeh', name: 'Écrasement horizontal', category: 'Dynamique' },
  { id: 'squeezev', name: 'Écrasement vertical', category: 'Dynamique' },
  { id: 'hblur', name: 'Flou de mouvement', category: 'Dynamique' },
  { id: 'pixelize', name: 'Pixelisation', category: 'Dynamique' },
  { id: 'fadefast', name: 'Fondu rapide', category: 'Basique' },
  { id: 'fadeslow', name: 'Fondu lent', category: 'Basique' },
  { id: 'fadegrays', name: 'Fondu en gris', category: 'Basique' },
  { id: 'distance', name: 'Distance', category: 'Basique' },
  { id: 'wipetl', name: 'Balayage coin haut gauche', category: 'Balayage' },
  { id: 'wipetr', name: 'Balayage coin haut droit', category: 'Balayage' },
  { id: 'wipebl', name: 'Balayage coin bas gauche', category: 'Balayage' },
  { id: 'wipebr', name: 'Balayage coin bas droit', category: 'Balayage' },
  { id: 'diagtl', name: 'Diagonale haut gauche', category: 'Balayage' },
  { id: 'diagtr', name: 'Diagonale haut droite', category: 'Balayage' },
  { id: 'diagbl', name: 'Diagonale bas gauche', category: 'Balayage' },
  { id: 'diagbr', name: 'Diagonale bas droite', category: 'Balayage' },
  { id: 'coverleft', name: 'Recouvrir gauche', category: 'Glisser' },
  { id: 'coverright', name: 'Recouvrir droite', category: 'Glisser' },
  { id: 'coverup', name: 'Recouvrir haut', category: 'Glisser' },
  { id: 'coverdown', name: 'Recouvrir bas', category: 'Glisser' },
  { id: 'revealleft', name: 'Dévoiler gauche', category: 'Glisser' },
  { id: 'revealright', name: 'Dévoiler droite', category: 'Glisser' },
  { id: 'revealup', name: 'Dévoiler haut', category: 'Glisser' },
  { id: 'revealdown', name: 'Dévoiler bas', category: 'Glisser' },
  { id: 'circlecrop', name: 'Cercle (iris)', category: 'Formes' },
  { id: 'horzclose', name: 'Fermeture horizontale', category: 'Formes' },
  { id: 'vertclose', name: 'Fermeture verticale', category: 'Formes' },
  { id: 'hlslice', name: 'Tranches vers la gauche', category: 'Tranches' },
  { id: 'hrslice', name: 'Tranches vers la droite', category: 'Tranches' },
  { id: 'vuslice', name: 'Tranches vers le haut', category: 'Tranches' },
  { id: 'vdslice', name: 'Tranches vers le bas', category: 'Tranches' },
  { id: 'hlwind', name: 'Vent vers la gauche', category: 'Tranches' },
  { id: 'hrwind', name: 'Vent vers la droite', category: 'Tranches' },
  { id: 'vuwind', name: 'Vent vers le haut', category: 'Tranches' },
  { id: 'vdwind', name: 'Vent vers le bas', category: 'Tranches' },
];

/*
 * Formules d'animation. Variables disponibles :
 *   e : progression adoucie (0 -> 1 = arrivée complète à l'écran)
 *   t : temps local du clip (s)    k : vitesse (boucles)    d : durée du clip
 * Composantes : dx, dy (fraction du canevas), s (multiplicateur d'échelle),
 *               r (degrés ajoutés), a (multiplicateur d'opacité).
 */
const IN_OUT_FORMULAS = {
  fade: { a: 'min(1,0.2+0.8*e)' },
  'zoom-in': { s: '0.78+0.22*e', a: 'min(1,0.45+0.55*e)' },
  'zoom-out': { s: '1.25-0.25*e', a: 'min(1,0.45+0.55*e)' },
  'slide-left': { dx: '0.6*(1-e)', a: 'min(1,e*3)' },
  'slide-right': { dx: '-0.6*(1-e)', a: 'min(1,e*3)' },
  'slide-up': { dy: '0.4*(1-e)', a: 'min(1,e*3)' },
  'slide-down': { dy: '-0.4*(1-e)', a: 'min(1,e*3)' },
  rotate: { r: '-90*(1-e)', s: '0.6+0.4*e', a: 'e' },
  spin: { r: '-360*(1-e)', s: 'max(0.02,e)' },
  pop: { s: 'max(0.02,min(e/0.7*1.15,1.15-(e-0.7)*0.5))' },
  bounce: { dy: '-0.3*pow(1-e,2)*cos(e*PI*3)', a: 'min(1,e*4)' },
  drop: { dy: '-0.5*(1-e)', s: '1.2-0.2*e' },
  blink: { a: 'gte(mod(e*5,1),0.4)*lt(e,1)+gte(e,1)' },
  rise: { dy: '0.12*(1-e)', a: 'e' },
  sink: { dy: '-0.12*(1-e)', a: 'e' },
  grow: { s: 'max(0.02,e)' },
  elastic: { s: 'max(0.02,1-pow(1-e,3)*cos(e*PI*4))' },
  'swing-in': { r: '25*(1-e)*cos(e*PI*3)', a: 'min(1,e*3)' },
  'roll-left': { dx: '0.6*(1-e)', r: '180*(1-e)', a: 'min(1,e*3)' },
  'roll-right': { dx: '-0.6*(1-e)', r: '-180*(1-e)', a: 'min(1,e*3)' },
  tilt: { r: '-15*(1-e)', dy: '0.08*(1-e)', a: 'e' },
  'zoom-spin': { r: '270*(1-e)', s: 'max(0.02,e)', a: 'e' },
  glitch: { dx: '0.04*(1-e)*sin(e*90)', a: 'gte(mod(e*7,1),0.3)*lt(e,1)+gte(e,1)' },
  wobble: { r: '14*(1-e)*sin(e*PI*6)', s: '0.85+0.15*e', a: 'min(1,e*3)' },
  'fly-up': { dy: '0.9*(1-e)' },
  'fly-down': { dy: '-0.9*(1-e)' },
  'fly-left': { dx: '1.1*(1-e)' },
  'fly-right': { dx: '-1.1*(1-e)' },
  'zoom-blast': { s: '3-2*e', a: 'e' },
};

const ANIMATIONS_IN = [
  { id: 'fade', name: 'Fondu' },
  { id: 'zoom-in', name: 'Zoom avant' },
  { id: 'zoom-out', name: 'Zoom arrière' },
  { id: 'slide-left', name: 'Entrée par la droite' },
  { id: 'slide-right', name: 'Entrée par la gauche' },
  { id: 'slide-up', name: 'Entrée par le bas' },
  { id: 'slide-down', name: 'Entrée par le haut' },
  { id: 'rotate', name: 'Rotation' },
  { id: 'spin', name: 'Tourbillon' },
  { id: 'pop', name: 'Pop' },
  { id: 'bounce', name: 'Rebond' },
  { id: 'drop', name: 'Chute' },
  { id: 'blink', name: 'Clignotement' },
  { id: 'rise', name: 'Montée douce' },
  { id: 'sink', name: 'Descente douce' },
  { id: 'grow', name: 'Agrandissement' },
  { id: 'elastic', name: 'Élastique' },
  { id: 'swing-in', name: 'Balancement' },
  { id: 'roll-left', name: 'Roulade (droite)' },
  { id: 'roll-right', name: 'Roulade (gauche)' },
  { id: 'tilt', name: 'Inclinaison' },
  { id: 'zoom-spin', name: 'Zoom tournoyant' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'wobble', name: 'Tremblote' },
  { id: 'fly-up', name: 'Envol du bas' },
  { id: 'fly-down', name: 'Envol du haut' },
  { id: 'fly-left', name: 'Envol de la droite' },
  { id: 'fly-right', name: 'Envol de la gauche' },
  { id: 'zoom-blast', name: 'Explosion de zoom' },
];

/** Les sorties réutilisent les formules d'entrée, jouées à l'envers. */
const ANIMATIONS_OUT = [
  { id: 'fade', name: 'Fondu', formula: 'fade' },
  { id: 'zoom-in', name: 'Zoom avant', formula: 'zoom-out' },
  { id: 'zoom-out', name: 'Zoom arrière', formula: 'zoom-in' },
  { id: 'slide-left', name: 'Sortie à gauche', formula: 'slide-right' },
  { id: 'slide-right', name: 'Sortie à droite', formula: 'slide-left' },
  { id: 'slide-up', name: 'Sortie en haut', formula: 'slide-down' },
  { id: 'slide-down', name: 'Sortie en bas', formula: 'slide-up' },
  { id: 'rotate', name: 'Rotation', formula: 'rotate' },
  { id: 'spin', name: 'Tourbillon', formula: 'spin' },
  { id: 'pop', name: 'Pop', formula: 'pop' },
  { id: 'blink', name: 'Clignotement', formula: 'blink' },
  { id: 'rise', name: 'Montée douce', formula: 'sink' },
  { id: 'sink', name: 'Descente douce', formula: 'rise' },
  { id: 'shrink', name: 'Rétrécissement', formula: 'grow' },
  { id: 'elastic', name: 'Élastique', formula: 'elastic' },
  { id: 'swing-out', name: 'Balancement', formula: 'swing-in' },
  { id: 'roll-left', name: 'Roulade (gauche)', formula: 'roll-right' },
  { id: 'roll-right', name: 'Roulade (droite)', formula: 'roll-left' },
  { id: 'tilt', name: 'Inclinaison', formula: 'tilt' },
  { id: 'zoom-spin', name: 'Zoom tournoyant', formula: 'zoom-spin' },
  { id: 'glitch', name: 'Glitch', formula: 'glitch' },
  { id: 'fly-up', name: 'Envol vers le haut', formula: 'fly-down' },
  { id: 'fly-down', name: 'Envol vers le bas', formula: 'fly-up' },
  { id: 'fly-left', name: 'Envol vers la gauche', formula: 'fly-right' },
  { id: 'fly-right', name: 'Envol vers la droite', formula: 'fly-left' },
  { id: 'zoom-blast', name: 'Explosion de zoom', formula: 'zoom-blast' },
];

const LOOP_FORMULAS = {
  pulse: { s: '1+0.06*sin(2*PI*t*k)' },
  heartbeat: { s: '1+0.09*pow(abs(sin(PI*t*k*1.2)),8)' },
  shake: { dx: '0.012*sin(2*PI*t*k*7)', dy: '0.009*cos(2*PI*t*k*9)' },
  wiggle: { r: '6*sin(2*PI*t*k*1.5)' },
  swing: { r: '12*sin(2*PI*t*k*0.6)' },
  float: { dy: '0.015*sin(2*PI*t*k*0.8)' },
  spin: { r: '180*t*k' },
  breathe: { s: '1+0.04*sin(2*PI*t*k*0.4)', a: '0.85+0.15*sin(2*PI*t*k*0.4)' },
  bob: { dy: '0.025*sin(2*PI*t*k*1.2)' },
  'zoom-pulse': { s: '1+0.12*pow(abs(sin(PI*t*k)),3)' },
  jitter: { dx: '0.006*sin(2*PI*t*k*23)', dy: '0.006*cos(2*PI*t*k*29)' },
  rock: { r: '4*sin(2*PI*t*k*2.5)' },
  orbit: { dx: '0.02*sin(2*PI*t*k*0.7)', dy: '0.02*cos(2*PI*t*k*0.7)' },
  flicker: { a: '0.7+0.3*gte(sin(2*PI*t*k*9),0)' },
  rubber: { s: '1+0.06*sin(2*PI*t*k*3)*exp(-mod(t*k,1)*3)' },
  'fade-pulse': { a: '0.65+0.35*sin(2*PI*t*k)' },
};

const ANIMATIONS_LOOP = [
  { id: 'pulse', name: 'Pulsation' },
  { id: 'heartbeat', name: 'Battement' },
  { id: 'shake', name: 'Tremblement' },
  { id: 'wiggle', name: 'Frétillement' },
  { id: 'swing', name: 'Balancier' },
  { id: 'float', name: 'Flottement' },
  { id: 'spin', name: 'Rotation continue' },
  { id: 'breathe', name: 'Respiration' },
  { id: 'bob', name: 'Rebondissement' },
  { id: 'zoom-pulse', name: 'Zoom pulsé' },
  { id: 'jitter', name: 'Vibration' },
  { id: 'rock', name: 'Bascule' },
  { id: 'orbit', name: 'Orbite' },
  { id: 'flicker', name: 'Scintillement' },
  { id: 'rubber', name: 'Caoutchouc' },
  { id: 'fade-pulse', name: 'Fondu pulsé' },
];

/**
 * Effets vidéo. `motion` : effet de mouvement (formules comme les boucles,
 * i = intensité 0..1). `pixel` : traitement d'image (implémenté côté aperçu et
 * côté ffmpeg, voir editorRenderer.js / preview).
 */
const EFFECTS = [
  { id: 'camera-shake', name: 'Caméra qui tremble', category: 'Mouvement', motion: { dx: '0.02*i*sin(2*PI*t*11)', dy: '0.016*i*cos(2*PI*t*13)', r: '1.2*i*sin(2*PI*t*7)' } },
  { id: 'ken-burns', name: 'Zoom lent (Ken Burns)', category: 'Mouvement', motion: { s: '1+0.18*i*t/max(d,0.01)' } },
  { id: 'zoom-punch', name: 'Zoom punch', category: 'Mouvement', motion: { s: '1+0.15*i*exp(-mod(t,1)*6)' } },
  { id: 'earthquake', name: 'Séisme', category: 'Mouvement', motion: { dx: '0.04*i*sin(2*PI*t*17)', dy: '0.04*i*cos(2*PI*t*19)' } },
  { id: 'flash', name: 'Flash', category: 'Lumière', pixel: true },
  { id: 'strobe', name: 'Stroboscope', category: 'Lumière', pixel: true },
  { id: 'vignette', name: 'Vignettage', category: 'Lumière', pixel: true },
  { id: 'blur', name: 'Flou', category: 'Style', pixel: true },
  { id: 'grain', name: 'Grain', category: 'Style', pixel: true },
  { id: 'rgb-split', name: 'Décalage RVB', category: 'Style', pixel: true },
  { id: 'pixelate', name: 'Pixelisation', category: 'Style', pixel: true },
  { id: 'vhs', name: 'VHS', category: 'Rétro', pixel: true },
  { id: 'invert', name: 'Négatif', category: 'Style', pixel: true },
  { id: 'mirror', name: 'Miroir', category: 'Style', pixel: true },
  { id: 'zoom-out-slow', name: 'Dézoom lent', category: 'Mouvement', motion: { s: '1+0.18*i*(1-t/max(d,0.01))' } },
  { id: 'zoom-in-fast', name: 'Zoom rapide', category: 'Mouvement', motion: { s: '1+0.35*i*min(1,t/0.4)' } },
  { id: 'beat-zoom', name: 'Zoom sur le rythme', category: 'Mouvement', motion: { s: '1+0.1*i*exp(-mod(t,0.5)*8)' } },
  { id: 'pan-left', name: 'Panoramique gauche', category: 'Mouvement', motion: { dx: '0.08*i*(0.5-t/max(d,0.01))', s: '1+0.18*i' } },
  { id: 'pan-right', name: 'Panoramique droite', category: 'Mouvement', motion: { dx: '-0.08*i*(0.5-t/max(d,0.01))', s: '1+0.18*i' } },
  { id: 'pan-up', name: 'Panoramique haut', category: 'Mouvement', motion: { dy: '0.08*i*(0.5-t/max(d,0.01))', s: '1+0.18*i' } },
  { id: 'pan-down', name: 'Panoramique bas', category: 'Mouvement', motion: { dy: '-0.08*i*(0.5-t/max(d,0.01))', s: '1+0.18*i' } },
  { id: 'handheld', name: "Caméra à l'épaule", category: 'Mouvement', motion: { dx: '0.006*i*sin(2*PI*t*1.3)+0.004*i*sin(2*PI*t*3.1)', dy: '0.005*i*cos(2*PI*t*1.7)', r: '0.6*i*sin(2*PI*t*0.9)', s: '1+0.04*i' } },
  { id: 'dutch-tilt', name: 'Plan incliné', category: 'Mouvement', motion: { r: '6*i', s: '1+0.1*i' } },
  { id: 'slow-spin', name: 'Rotation lente', category: 'Mouvement', motion: { r: '8*i*t/max(d,0.01)', s: '1+0.15*i' } },
  { id: 'bounce-cam', name: 'Caméra qui rebondit', category: 'Mouvement', motion: { dy: '-0.03*i*abs(sin(2*PI*t*1.5))' } },
  { id: 'rainbow', name: 'Arc-en-ciel', category: 'Lumière', pixel: true },
  { id: 'pulse-light', name: 'Lumière pulsée', category: 'Lumière', pixel: true },
  { id: 'blackout', name: 'Flash noir', category: 'Lumière', pixel: true },
  { id: 'dreamy', name: 'Rêveur', category: 'Style', pixel: true },
  { id: 'punch', name: 'Couleurs punchy', category: 'Style', pixel: true },
  { id: 'old-film', name: 'Vieux film', category: 'Rétro', pixel: true },
];

const DEFAULT_ADJUST = {
  brightness: 0, // -1..1
  contrast: 0, // -1..1
  saturation: 0, // -1..1
  hue: 0, // degrés -180..180
  temperature: 0, // -1 (froid) .. 1 (chaud)
  tint: 0, // -1 (vert) .. 1 (magenta)
  blur: 0, // 0..1
  vignette: 0, // 0..1
  sharpen: 0, // 0..1
};

/** Filtres colorimétriques prédéfinis : valeurs d'ajustement appliquées avec une intensité. */
const FILTER_PRESETS = [
  { id: 'none', name: 'Aucun', adjust: {} },
  { id: 'vivid', name: 'Éclatant', adjust: { saturation: 0.5, contrast: 0.12 } },
  { id: 'warm', name: 'Chaud', adjust: { temperature: 0.45, saturation: 0.1 } },
  { id: 'cool', name: 'Froid', adjust: { temperature: -0.45 } },
  { id: 'bw', name: 'Noir & blanc', adjust: { saturation: -1 } },
  { id: 'noir', name: 'Noir intense', adjust: { saturation: -1, contrast: 0.45, brightness: -0.05 } },
  { id: 'sepia', name: 'Sépia', sepia: 1, adjust: {} },
  { id: 'vintage', name: 'Vintage', sepia: 0.45, adjust: { contrast: -0.12, brightness: 0.05, vignette: 0.4 } },
  { id: 'fade', name: 'Délavé', adjust: { contrast: -0.3, brightness: 0.08, saturation: -0.25 } },
  { id: 'cinema', name: 'Cinéma', adjust: { temperature: -0.15, tint: -0.05, contrast: 0.2, saturation: -0.1, vignette: 0.35 } },
  { id: 'sunset', name: 'Coucher de soleil', adjust: { temperature: 0.6, tint: 0.2, saturation: 0.2 } },
  { id: 'cyber', name: 'Cyber', adjust: { hue: 25, tint: 0.35, saturation: 0.35, contrast: 0.15 } },
  { id: 'matrix', name: 'Matrix', adjust: { tint: -0.6, saturation: -0.3, contrast: 0.25 } },
  { id: 'dramatic', name: 'Dramatique', adjust: { contrast: 0.5, saturation: -0.35, vignette: 0.5 } },
  { id: 'pastel', name: 'Pastel', adjust: { brightness: 0.12, contrast: -0.25, saturation: -0.2 } },
  { id: 'teal-orange', name: 'Teal & Orange', adjust: { temperature: 0.2, tint: -0.1, contrast: 0.25, saturation: 0.15, hue: -6 } },
  { id: 'golden', name: 'Heure dorée', adjust: { temperature: 0.5, brightness: 0.06, saturation: 0.15, contrast: 0.08 } },
  { id: 'moody', name: 'Sombre', adjust: { brightness: -0.12, contrast: 0.3, saturation: -0.3, vignette: 0.45 } },
  { id: 'bright', name: 'Lumineux', adjust: { brightness: 0.15, contrast: 0.05, saturation: 0.15 } },
  { id: 'clean', name: 'Net', adjust: { contrast: 0.12, saturation: 0.08, sharpen: 0.5 } },
  { id: 'summer', name: 'Été', adjust: { temperature: 0.3, saturation: 0.35, brightness: 0.08 } },
  { id: 'winter', name: 'Hiver', adjust: { temperature: -0.5, saturation: -0.2, brightness: 0.08 } },
  { id: 'forest', name: 'Forêt', adjust: { tint: -0.3, saturation: 0.1, contrast: 0.1, temperature: -0.1 } },
  { id: 'rose', name: 'Rosé', adjust: { tint: 0.35, temperature: 0.15, brightness: 0.05 } },
  { id: 'lavender', name: 'Lavande', adjust: { tint: 0.25, temperature: -0.25, saturation: -0.1, brightness: 0.06 } },
  { id: 'neon-night', name: 'Nuit néon', adjust: { hue: -20, tint: 0.3, saturation: 0.5, contrast: 0.25, brightness: -0.05 } },
  { id: 'polaroid', name: 'Polaroid', sepia: 0.2, adjust: { contrast: -0.15, brightness: 0.1, saturation: -0.1, vignette: 0.25 } },
  { id: 'kodak', name: 'Pellicule', sepia: 0.15, adjust: { temperature: 0.2, contrast: 0.15, saturation: 0.1 } },
  { id: 'faded-film', name: 'Film délavé', sepia: 0.25, adjust: { contrast: -0.35, brightness: 0.1, saturation: -0.3 } },
  { id: 'high-contrast', name: 'Contraste fort', adjust: { contrast: 0.6, saturation: 0.1 } },
  { id: 'soft', name: 'Doux', adjust: { contrast: -0.15, brightness: 0.06, blur: 0.04 } },
  { id: 'gotham', name: 'Gotham', adjust: { saturation: -0.6, contrast: 0.4, temperature: -0.25, vignette: 0.4 } },
  { id: 'chrome', name: 'Chrome', adjust: { saturation: -0.25, contrast: 0.35, brightness: 0.05, temperature: -0.1 } },
  { id: 'blockbuster', name: 'Blockbuster', adjust: { temperature: 0.15, tint: -0.15, contrast: 0.35, saturation: 0.05, vignette: 0.3 } },
  { id: 'anime', name: 'Anime', adjust: { saturation: 0.6, brightness: 0.08, contrast: 0.15, sharpen: 0.4 } },
  { id: 'retro-80', name: 'Années 80', adjust: { hue: 15, tint: 0.25, saturation: 0.3, contrast: 0.1 } },
  { id: 'toxic', name: 'Toxique', adjust: { hue: 60, saturation: 0.4, contrast: 0.2 } },
  { id: 'infrared', name: 'Infrarouge', adjust: { hue: 160, saturation: 0.3, contrast: 0.15 } },
  { id: 'bw-soft', name: 'N&B doux', adjust: { saturation: -1, contrast: -0.15, brightness: 0.08 } },
];

const DEFAULT_TEXT_STYLE = {
  fontId: 'Poppins-Black',
  fontSize: 0.075, // em en fraction de min(largeur, hauteur)
  color: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 0.08, // fraction de l'em
  shadowColor: '#000000',
  shadowOpacity: 0.5,
  shadowBlur: 0.1, // fraction de l'em
  shadowOffset: 0.05,
  bgColor: '#000000',
  bgOpacity: 0,
  bgPadding: 0.3,
  bgRadius: 0.25,
  align: 'center',
  uppercase: false,
  letterSpacing: 0,
  lineHeight: 1.15,
  italic: false,
  underline: false,
};

/** Styles de texte prêts à l'emploi. */
const TEXT_PRESETS = [
  { id: 'title', name: 'Titre', style: { fontId: 'Montserrat-Black', fontSize: 0.1, uppercase: true } },
  { id: 'subtitle', name: 'Sous-titre', style: { fontId: 'Poppins-Bold', fontSize: 0.05, strokeWidth: 0, shadowOpacity: 0.7 } },
  { id: 'yellow-pop', name: 'Jaune pop', style: { fontId: 'LuckiestGuy-Regular', color: '#FFE600', strokeWidth: 0.12, fontSize: 0.09 } },
  { id: 'label', name: 'Étiquette', style: { fontId: 'Poppins-ExtraBold', color: '#111111', strokeWidth: 0, shadowOpacity: 0, bgColor: '#FFFFFF', bgOpacity: 1, fontSize: 0.055 } },
  { id: 'red-label', name: 'Étiquette rouge', style: { fontId: 'Poppins-Black', color: '#FFFFFF', strokeWidth: 0, shadowOpacity: 0, bgColor: '#E11D48', bgOpacity: 1, fontSize: 0.055, uppercase: true } },
  { id: 'neon', name: 'Néon', style: { fontId: 'LilitaOne-Regular', color: '#FFFFFF', strokeColor: '#FF2BD6', strokeWidth: 0.05, shadowColor: '#FF2BD6', shadowOpacity: 1, shadowBlur: 0.6, shadowOffset: 0 } },
  { id: 'cinema', name: 'Cinéma', style: { fontId: 'BebasNeue-Regular', fontSize: 0.11, letterSpacing: 0.08, strokeWidth: 0, shadowOpacity: 0.6 } },
  { id: 'marker', name: 'Feutre', style: { fontId: 'PermanentMarker-Regular', fontSize: 0.08, strokeWidth: 0.06 } },
  { id: 'script', name: 'Manuscrit', style: { fontId: 'Pacifico-Regular', fontSize: 0.08, strokeWidth: 0, shadowOpacity: 0.6 } },
  { id: 'comic', name: 'BD', style: { fontId: 'Bangers-Regular', fontSize: 0.1, color: '#FFFFFF', strokeColor: '#1D4ED8', strokeWidth: 0.12, letterSpacing: 0.04 } },
  { id: 'gamer', name: 'Gamer', style: { fontId: 'RussoOne-Regular', fontSize: 0.07, color: '#5CF6FF', strokeColor: '#000000', strokeWidth: 0.1 } },
  { id: 'soft', name: 'Doux', style: { fontId: 'TitanOne-Regular', fontSize: 0.08, color: '#FFD1E8', strokeColor: '#9D174D', strokeWidth: 0.1 } },
  { id: 'impact', name: 'Impact', style: { fontId: 'Anton-Regular', fontSize: 0.1, uppercase: true, strokeWidth: 0.1 } },
  { id: 'gold', name: 'Or', style: { fontId: 'Montserrat-Black', fontSize: 0.085, color: '#FFD54A', strokeColor: '#5B3A00', strokeWidth: 0.08, shadowColor: '#FFB800', shadowOpacity: 0.6, shadowBlur: 0.4, shadowOffset: 0 } },
  { id: 'fire', name: 'Feu', style: { fontId: 'LuckiestGuy-Regular', fontSize: 0.09, color: '#FFB020', strokeColor: '#B91C1C', strokeWidth: 0.1, shadowColor: '#FF4D00', shadowOpacity: 0.9, shadowBlur: 0.5, shadowOffset: 0 } },
  { id: 'ice', name: 'Glace', style: { fontId: 'Kanit-Black', fontSize: 0.085, color: '#D9F6FF', strokeColor: '#0369A1', strokeWidth: 0.09, shadowColor: '#38BDF8', shadowOpacity: 0.8, shadowBlur: 0.5, shadowOffset: 0 } },
  { id: 'news', name: 'Bandeau info', style: { fontId: 'Kanit-Black', fontSize: 0.05, color: '#FFFFFF', strokeWidth: 0, shadowOpacity: 0, bgColor: '#DC2626', bgOpacity: 1, uppercase: true, bgRadius: 0.1 } },
  { id: 'green-label', name: 'Étiquette verte', style: { fontId: 'Poppins-Black', fontSize: 0.055, color: '#052E16', strokeWidth: 0, shadowOpacity: 0, bgColor: '#4ADE80', bgOpacity: 1 } },
  { id: 'pink-label', name: 'Étiquette rose', style: { fontId: 'Poppins-Black', fontSize: 0.055, color: '#FFFFFF', strokeWidth: 0, shadowOpacity: 0, bgColor: '#EC4899', bgOpacity: 1 } },
  { id: 'dark-box', name: 'Boîte sombre', style: { fontId: 'Poppins-Bold', fontSize: 0.05, color: '#FFFFFF', strokeWidth: 0, shadowOpacity: 0, bgColor: '#000000', bgOpacity: 0.7 } },
  { id: 'clean', name: 'Épuré', style: { fontId: 'Poppins-Bold', fontSize: 0.06, strokeWidth: 0, shadowOpacity: 0.35 } },
  { id: 'retro', name: 'Rétro', style: { fontId: 'Bangers-Regular', fontSize: 0.1, color: '#FF8A00', strokeColor: '#4C1D95', strokeWidth: 0.12, shadowColor: '#4C1D95', shadowOpacity: 1, shadowBlur: 0, shadowOffset: 0.08 } },
  { id: 'block', name: 'Bloc', style: { fontId: 'ArchivoBlack-Regular', fontSize: 0.085, color: '#FFFFFF', strokeColor: '#000000', strokeWidth: 0.06, shadowColor: '#000000', shadowOpacity: 1, shadowBlur: 0, shadowOffset: 0.09, uppercase: true } },
  { id: 'cyber', name: 'Cyber', style: { fontId: 'RussoOne-Regular', fontSize: 0.075, color: '#F0ABFC', strokeColor: '#22D3EE', strokeWidth: 0.05, shadowColor: '#22D3EE', shadowOpacity: 1, shadowBlur: 0.6, shadowOffset: 0 } },
  { id: 'horror', name: 'Horreur', style: { fontId: 'PermanentMarker-Regular', fontSize: 0.09, color: '#E11D48', strokeColor: '#000000', strokeWidth: 0.08, shadowColor: '#7F1D1D', shadowOpacity: 1, shadowBlur: 0.4, shadowOffset: 0 } },
  { id: 'kawaii', name: 'Kawaii', style: { fontId: 'TitanOne-Regular', fontSize: 0.08, color: '#FFFFFF', strokeColor: '#F472B6', strokeWidth: 0.14 } },
];

/**
 * Thèmes : un style complet appliqué en un clic (filtre, transitions, effet,
 * sous-titres, textes, son sur les transitions, animation des textes).
 */
const THEMES = [
  { id: 'viral', name: 'Viral TikTok', description: 'Couleurs éclatantes, zooms punchy, sous-titres Hormozi', colors: ['#FFE600', '#3DFF6E', '#111111'], filter: 'vivid', filterIntensity: 0.8, transition: 'zoomin', transitionDuration: 0.35, effect: 'zoom-punch', effectIntensity: 0.35, captionPreset: 'hormozi', textPreset: 'yellow-pop', textAnim: 'pop', sfx: 'whoosh' },
  { id: 'cinematic', name: 'Cinématique', description: 'Étalonnage film, fondus au noir, zoom lent', colors: ['#1F2937', '#F59E0B', '#FFFFFF'], filter: 'blockbuster', filterIntensity: 0.9, transition: 'fadeblack', transitionDuration: 0.8, effect: 'ken-burns', effectIntensity: 0.6, captionPreset: 'bebas', textPreset: 'cinema', textAnim: 'fade', sfx: 'swoosh-long' },
  { id: 'gaming', name: 'Gaming', description: 'Néon, glitchs, police gamer', colors: ['#22D3EE', '#F0ABFC', '#0B0B12'], filter: 'neon-night', filterIntensity: 0.7, transition: 'pixelize', transitionDuration: 0.4, effect: 'rgb-split', effectIntensity: 0.25, captionPreset: 'gaming', textPreset: 'gamer', textAnim: 'glitch', sfx: 'glitch' },
  { id: 'vlog', name: 'Vlog doux', description: 'Tons chauds, transitions fluides, texte épuré', colors: ['#FDE68A', '#F9A8D4', '#FFFFFF'], filter: 'golden', filterIntensity: 0.7, transition: 'smoothleft', transitionDuration: 0.6, effect: 'handheld', effectIntensity: 0.4, captionPreset: 'minimal', textPreset: 'clean', textAnim: 'rise', sfx: 'swipe' },
  { id: 'retro', name: 'Rétro VHS', description: 'Grain, couleurs passées, machine à écrire', colors: ['#FF8A00', '#4C1D95', '#FDE68A'], filter: 'vintage', filterIntensity: 0.9, transition: 'hblur', transitionDuration: 0.5, effect: 'vhs', effectIntensity: 0.5, captionPreset: 'typewriter', textPreset: 'retro', textAnim: 'bounce', sfx: 'rewind' },
  { id: 'energy', name: 'Énergie / Sport', description: 'Contraste fort, tremblements, impacts', colors: ['#EF4444', '#FFFFFF', '#000000'], filter: 'high-contrast', filterIntensity: 0.8, transition: 'slideleft', transitionDuration: 0.3, effect: 'camera-shake', effectIntensity: 0.25, captionPreset: 'impact', textPreset: 'impact', textAnim: 'zoom-blast', sfx: 'punch' },
  { id: 'news', name: 'Info / Actu', description: 'Sobre, bandeaux, sous-titres TV', colors: ['#DC2626', '#FFFFFF', '#111827'], filter: 'clean', filterIntensity: 0.8, transition: 'wipeleft', transitionDuration: 0.4, effect: null, captionPreset: 'subtitle-bar', textPreset: 'news', textAnim: 'slide-left', sfx: 'notification' },
  { id: 'dreamy', name: 'Rêveur', description: 'Pastel, lumière douce, karaoké', colors: ['#C4B5FD', '#F9A8D4', '#FFFFFF'], filter: 'lavender', filterIntensity: 0.8, transition: 'dissolve', transitionDuration: 0.8, effect: 'dreamy', effectIntensity: 0.5, captionPreset: 'karaoke', textPreset: 'script', textAnim: 'fade', sfx: 'sparkle' },
  { id: 'horror', name: 'Horreur', description: 'Sombre, flashs noirs, texte sanglant', colors: ['#7F1D1D', '#E11D48', '#000000'], filter: 'gotham', filterIntensity: 1, transition: 'fadeblack', transitionDuration: 0.6, effect: 'blackout', effectIntensity: 0.4, captionPreset: 'horror', textPreset: 'horror', textAnim: 'glitch', sfx: 'heartbeat' },
  { id: 'neon', name: 'Néon nuit', description: 'Cyberpunk, halo, cercles', colors: ['#FF2BD6', '#5CF6FF', '#0B0B12'], filter: 'cyber', filterIntensity: 0.8, transition: 'circleopen', transitionDuration: 0.5, effect: 'pulse-light', effectIntensity: 0.3, captionPreset: 'neon', textPreset: 'neon', textAnim: 'zoom-spin', sfx: 'zap' },
  { id: 'meme', name: 'Meme', description: 'Saturé, écrasements, gros textes BD', colors: ['#FFFFFF', '#1D4ED8', '#FFE600'], filter: 'vivid', filterIntensity: 1, transition: 'squeezeh', transitionDuration: 0.3, effect: 'zoom-punch', effectIntensity: 0.6, captionPreset: 'beast', textPreset: 'comic', textAnim: 'elastic', sfx: 'boing' },
  { id: 'luxury', name: 'Luxe', description: 'Noir et or, élégant, fondus lents', colors: ['#FFD54A', '#111111', '#FFFFFF'], filter: 'chrome', filterIntensity: 0.7, transition: 'fadeslow', transitionDuration: 0.9, effect: 'zoom-out-slow', effectIntensity: 0.5, captionPreset: 'gold', textPreset: 'gold', textAnim: 'fade', sfx: 'chime' },
  { id: 'anime', name: 'Anime', description: 'Couleurs vives, tranches, style manga', colors: ['#F472B6', '#FFFFFF', '#60A5FA'], filter: 'anime', filterIntensity: 0.8, transition: 'hrslice', transitionDuration: 0.4, effect: 'beat-zoom', effectIntensity: 0.4, captionPreset: 'kawaii', textPreset: 'kawaii', textAnim: 'pop', sfx: 'swoosh-fast' },
  { id: 'clean', name: 'Minimal pro', description: 'Net, discret, aucune fioriture', colors: ['#FFFFFF', '#111111', '#9CA3AF'], filter: 'clean', filterIntensity: 0.6, transition: 'fade', transitionDuration: 0.4, effect: null, captionPreset: 'minimal', textPreset: 'clean', textAnim: 'fade', sfx: null },
];

const DEFAULT_TRANSFORM = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false };
const DEFAULT_CROP = { left: 0, top: 0, right: 0, bottom: 0 };
const KEYFRAME_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'];

const ASPECT_RATIOS = [
  { id: '9:16', name: '9:16 (TikTok, Reels)', width: 1080, height: 1920 },
  { id: '16:9', name: '16:9 (YouTube)', width: 1920, height: 1080 },
  { id: '1:1', name: '1:1 (Carré)', width: 1080, height: 1080 },
  { id: '4:5', name: '4:5 (Instagram)', width: 1080, height: 1350 },
  { id: '3:4', name: '3:4', width: 1080, height: 1440 },
  { id: '21:9', name: '21:9 (Cinéma)', width: 2520, height: 1080 },
];

// ---------------------------------------------------------------------------
// Projet
// ---------------------------------------------------------------------------

let idCounter = 0;
function uid(prefix) {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix || 'id'}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter.toString(36)}`;
}

function createProject(opts) {
  const o = opts || {};
  const ratio = ASPECT_RATIOS.find((r) => r.id === o.aspect) || ASPECT_RATIOS[0];
  return {
    version: 1,
    settings: {
      aspect: ratio.id,
      width: o.width || ratio.width,
      height: o.height || ratio.height,
      fps: o.fps || 30,
      background: { type: 'color', color: '#000000' },
      normalizeAudio: false,
    },
    tracks: [
      { id: uid('trk'), kind: 'caption', name: 'Sous-titres' },
      { id: uid('trk'), kind: 'visual', name: 'Texte & stickers' },
      { id: uid('trk'), kind: 'visual', name: 'Incrustation' },
      { id: uid('trk'), kind: 'visual', name: 'Vidéo principale', main: true },
      { id: uid('trk'), kind: 'audio', name: 'Audio' },
      { id: uid('trk'), kind: 'audio', name: 'Effets sonores' },
    ],
    clips: [],
    transitions: [],
  };
}

const isVisual = (c) => c.type === 'video' || c.type === 'image' || c.type === 'text' || c.type === 'sticker';
const hasSourceAudio = (c) => c.type === 'audio' || (c.type === 'video' && c.hasAudio !== false);
const clipEnd = (c) => c.start + c.duration;

function mainTrack(project) {
  return project.tracks.find((t) => t.main) || project.tracks.find((t) => t.kind === 'visual');
}

function clipsOnTrack(project, trackId) {
  return project.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

function transitionBetween(project, fromId, toId) {
  return project.transitions.find((t) => t.fromId === fromId && t.toId === toId) || null;
}

/** Durée maximale d'une transition entre deux clips (ne peut pas manger plus de la moitié d'un clip). */
function maxTransitionDuration(a, b) {
  return Math.max(0.1, Math.min(a.duration, b.duration) / 2 - 0.01);
}

/**
 * Piste principale "magnétique" (comme CapCut) : les clips s'enchaînent sans
 * trou dans l'ordre de leur début ; une transition fait se chevaucher deux
 * clips voisins de sa durée. Les transitions orphelines sont supprimées.
 * Modifie le projet en place et le retourne.
 */
function packMainTrack(project) {
  const main = mainTrack(project);
  if (!main) return project;
  const clips = clipsOnTrack(project, main.id);
  const valid = [];
  let cursor = 0;
  clips.forEach((clip, i) => {
    const prev = clips[i - 1];
    let overlap = 0;
    if (prev) {
      const tr = transitionBetween(project, prev.id, clip.id);
      if (tr) {
        tr.duration = Math.min(tr.duration, maxTransitionDuration(prev, clip));
        overlap = tr.duration;
        valid.push(tr);
      }
    }
    clip.start = Math.max(0, cursor - overlap);
    cursor = clip.start + clip.duration;
  });
  const mainIds = new Set(clips.map((c) => c.id));
  project.transitions = project.transitions.filter((t) => !mainIds.has(t.fromId) || valid.includes(t));
  project.transitions = project.transitions.filter((t) => mainIds.has(t.fromId) && mainIds.has(t.toId));
  return project;
}

function projectDuration(project) {
  return project.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

/** Durée maximale d'un clip média compte tenu de la source, du point d'entrée et de la vitesse. */
function maxClipDuration(clip) {
  if (clip.type === 'image' || clip.type === 'text' || clip.type === 'sticker' || clip.type === 'caption') return Infinity;
  const remaining = (clip.mediaDuration || 0) - (clip.trimStart || 0);
  return Math.max(0.05, remaining / (clip.speed || 1));
}

/** Position dans la source (s) pour un temps local du clip. */
function sourceTimeAt(clip, localT) {
  return (clip.trimStart || 0) + localT * (clip.speed || 1);
}

// ---------------------------------------------------------------------------
// Expressions (communes ffmpeg / JS)
// ---------------------------------------------------------------------------

const HELPERS = {
  sin: Math.sin,
  cos: Math.cos,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  exp: Math.exp,
  sqrt: Math.sqrt,
  floor: Math.floor,
  hypot: Math.hypot,
  clip: (x, a, b) => Math.min(b, Math.max(a, x)),
  lt: (a, b) => (a < b ? 1 : 0),
  gt: (a, b) => (a > b ? 1 : 0),
  gte: (a, b) => (a >= b ? 1 : 0),
  lte: (a, b) => (a <= b ? 1 : 0),
  between: (x, a, b) => (x >= a && x <= b ? 1 : 0),
  mod: (a, b) => a - Math.floor(a / b) * b,
  PI: Math.PI,
};
const HELPER_NAMES = Object.keys(HELPERS);
const compiled = new Map();

/** Compile une formule (variables e, t, k, d, i) en fonction JS. */
function compileFormula(src) {
  let fn = compiled.get(src);
  if (!fn) {
    // eslint-disable-next-line no-new-func
    const factory = new Function(...HELPER_NAMES, 'e', 't', 'k', 'd', 'i', `return (${src});`);
    const helperValues = HELPER_NAMES.map((n) => HELPERS[n]);
    fn = (vars) => factory(...helperValues, vars.e, vars.t, vars.k, vars.d, vars.i);
    compiled.set(src, fn);
  }
  return fn;
}

/** Substitue les variables d'une formule par des expressions ffmpeg. */
function substitute(src, vars) {
  return src.replace(/\b(e|t|k|d|i)\b/g, (m) => (vars[m] !== undefined ? `(${vars[m]})` : m));
}

function num(n) {
  const v = Math.round(n * 10000) / 10000;
  return Object.is(v, -0) ? '0' : String(v);
}

/**
 * Liste des "contributions" de mouvement d'un clip : animations d'entrée, de
 * sortie, de boucle et effets de mouvement. Chaque contribution fournit des
 * formules et les valeurs/expressions de ses variables.
 */
function motionContributions(clip) {
  const out = [];
  const d = clip.duration;
  const animIn = clip.animIn;
  const animOut = clip.animOut;
  if (animIn && animIn.type && IN_OUT_FORMULAS[animIn.type]) {
    const dur = Math.max(0.05, Math.min(animIn.duration || 0.5, d));
    out.push({
      formulas: IN_OUT_FORMULAS[animIn.type],
      js: (t) => {
        const p = HELPERS.clip(t / dur, 0, 1);
        return { e: 1 - Math.pow(1 - p, 3) };
      },
      ff: (T) => ({ e: `1-pow(1-clip(${T}/${num(dur)},0,1),3)` }),
    });
  }
  if (animOut && animOut.type) {
    const def = ANIMATIONS_OUT.find((a) => a.id === animOut.type);
    const formulas = def && IN_OUT_FORMULAS[def.formula];
    if (formulas) {
      const dur = Math.max(0.05, Math.min(animOut.duration || 0.5, d));
      const st = d - dur;
      out.push({
        formulas,
        js: (t) => {
          const p = HELPERS.clip((t - st) / dur, 0, 1);
          return { e: 1 - Math.pow(p, 3) };
        },
        ff: (T) => ({ e: `1-pow(clip((${T}-${num(st)})/${num(dur)},0,1),3)` }),
      });
    }
  }
  if (clip.animLoop && clip.animLoop.type && LOOP_FORMULAS[clip.animLoop.type]) {
    const k = clip.animLoop.speed || 1;
    out.push({
      formulas: LOOP_FORMULAS[clip.animLoop.type],
      js: (t) => ({ t, k, d }),
      ff: (T) => ({ t: T, k: num(k), d: num(d) }),
    });
  }
  for (const fx of clip.effects || []) {
    const def = EFFECTS.find((e) => e.id === fx.id);
    if (!def || !def.motion) continue;
    const i = fx.intensity === undefined ? 0.6 : fx.intensity;
    out.push({
      formulas: def.motion,
      js: (t) => ({ t, d, i }),
      ff: (T) => ({ t: T, d: num(d), i: num(i) }),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Images clés
// ---------------------------------------------------------------------------

function sortedKeys(clip, prop) {
  const list = clip.keyframes && clip.keyframes[prop];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.slice().sort((a, b) => a.t - b.t);
}

function interpolateKeys(keys, t) {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) {
      const span = Math.max(1e-6, b.t - a.t);
      let p = (t - a.t) / span;
      if (a.ease === 'ease') p = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      return a.v + (b.v - a.v) * p;
    }
  }
  return keys[keys.length - 1].v;
}

/** Expression ffmpeg par morceaux (linéaire / ease-in-out) d'une liste d'images clés. */
function keysExpr(keys, T) {
  if (keys.length === 1) return num(keys[0].v);
  let expr = num(keys[keys.length - 1].v);
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i];
    const b = keys[i + 1];
    const span = Math.max(1e-6, b.t - a.t);
    const p = `clip((${T}-${num(a.t)})/${num(span)},0,1)`;
    const eased = a.ease === 'ease' ? `(lt(${p},0.5)*2*pow(${p},2)+gte(${p},0.5)*(1-pow(2-2*${p},2)/2))` : p;
    // if(lt(T, b.t), seg, reste) écrit sans "if" : seg*lt + reste*gte
    expr = `(lt(${T},${num(b.t)})*(${num(a.v)}+${num(b.v - a.v)}*${eased})+gte(${T},${num(b.t)})*(${expr}))`;
  }
  return expr;
}

function baseValue(clip, prop) {
  const tr = Object.assign({}, DEFAULT_TRANSFORM, clip.transform);
  return tr[prop];
}

/**
 * État visuel d'un clip au temps local t (secondes depuis son début) :
 * { x, y, scale, rotation, opacity } — x/y en fraction du canevas.
 */
function visualStateAt(clip, t) {
  const state = {};
  for (const prop of KEYFRAME_PROPS) {
    const keys = sortedKeys(clip, prop);
    state[prop] = keys ? interpolateKeys(keys, t) : baseValue(clip, prop);
  }
  for (const c of motionContributions(clip)) {
    const vars = c.js(t);
    const f = c.formulas;
    if (f.dx) state.x += compileFormula(f.dx)(vars);
    if (f.dy) state.y += compileFormula(f.dy)(vars);
    if (f.s) state.scale *= compileFormula(f.s)(vars);
    if (f.r) state.rotation += compileFormula(f.r)(vars);
    if (f.a) state.opacity *= compileFormula(f.a)(vars);
  }
  state.opacity = HELPERS.clip(state.opacity, 0, 1);
  return state;
}

/**
 * Mêmes valeurs que visualStateAt, sous forme d'expressions ffmpeg en
 * fonction de l'expression temporelle locale `T` (ex. 't' ou '(t-3.5)').
 * Retourne aussi `animated` : quelles composantes varient dans le temps.
 */
function visualStateExprs(clip, T) {
  const exprs = {};
  const animated = {};
  for (const prop of KEYFRAME_PROPS) {
    const keys = sortedKeys(clip, prop);
    exprs[prop] = keys ? keysExpr(keys, T) : num(baseValue(clip, prop));
    animated[prop] = Boolean(keys && keys.length > 1);
  }
  for (const c of motionContributions(clip)) {
    const vars = c.ff(T);
    const f = c.formulas;
    if (f.dx) {
      exprs.x = `${exprs.x}+(${substitute(f.dx, vars)})`;
      animated.x = true;
    }
    if (f.dy) {
      exprs.y = `${exprs.y}+(${substitute(f.dy, vars)})`;
      animated.y = true;
    }
    if (f.s) {
      exprs.scale = `${exprs.scale}*(${substitute(f.s, vars)})`;
      animated.scale = true;
    }
    if (f.r) {
      exprs.rotation = `${exprs.rotation}+(${substitute(f.r, vars)})`;
      animated.rotation = true;
    }
    if (f.a) {
      exprs.opacity = `${exprs.opacity}*(${substitute(f.a, vars)})`;
      animated.opacity = true;
    }
  }
  exprs.opacity = `clip(${exprs.opacity},0,1)`;
  return { exprs, animated };
}

/** Échantillonne l'état sur toute la durée (pour trouver les extrêmes, ex. échelle max). */
function sampleStates(clip, fps) {
  const step = 1 / (fps || 30);
  const states = [];
  for (let t = 0; t <= clip.duration + 1e-6; t += step) states.push(visualStateAt(clip, Math.min(t, clip.duration)));
  return states;
}

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------

/** Dimensions source après recadrage. */
function croppedSourceSize(clip) {
  const crop = Object.assign({}, DEFAULT_CROP, clip.crop);
  const w = (clip.width || 1) * Math.max(0.01, 1 - crop.left - crop.right);
  const h = (clip.height || 1) * Math.max(0.01, 1 - crop.top - crop.bottom);
  return { w, h };
}

/**
 * Taille (px) du calque à l'échelle 1 dans un canevas W×H.
 * Médias : ajustés au canevas (contain par défaut, cover si fit === 'cover').
 * Texte / sticker : clip.box { w, h } calculé par le frontend à la résolution du projet.
 */
function baseLayerSize(clip, W, H) {
  if (clip.type === 'text' || clip.type === 'sticker') {
    const box = clip.box || { w: W * 0.5, h: H * 0.1 };
    return { w: box.w, h: box.h };
  }
  const { w, h } = croppedSourceSize(clip);
  const f = clip.fit === 'cover' ? Math.max(W / w, H / h) : Math.min(W / w, H / h);
  return { w: w * f, h: h * f };
}

// ---------------------------------------------------------------------------
// Couleur
// ---------------------------------------------------------------------------

const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** Produit de matrices couleur 4×5 (b appliquée après a). */
function mulMatrix(b, a) {
  const out = new Array(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? b[r * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += b[r * 5 + k] * a[k * 5 + c];
      out[r * 5 + c] = v;
    }
  }
  return out;
}

function saturationMatrix(s) {
  // Même matrice que le filtre CSS saturate() / feColorMatrix type="saturate".
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function hueMatrix(deg) {
  // Même matrice que hue-rotate() / feColorMatrix type="hueRotate".
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0, 0,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function sepiaMatrix(amount) {
  const a = 1 - amount;
  return [
    0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0, 0,
    0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0, 0,
    0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Ajustements effectifs d'un clip = réglages manuels + filtre prédéfini × intensité. */
function effectiveAdjust(clip) {
  const adj = Object.assign({}, DEFAULT_ADJUST, clip.adjust);
  const filter = clip.filter && FILTER_PRESETS.find((f) => f.id === clip.filter.id);
  let sepia = 0;
  if (filter) {
    const k = clip.filter.intensity === undefined ? 1 : clip.filter.intensity;
    for (const [key, v] of Object.entries(filter.adjust)) adj[key] += v * k;
    sepia = (filter.sepia || 0) * k;
  }
  adj.saturation = Math.max(-1, adj.saturation);
  return { adjust: adj, sepia };
}

/**
 * Matrice couleur 4×5 (valeurs RVBA normalisées 0..1, décalages en 5e colonne)
 * correspondant aux ajustements du clip. Utilisée telle quelle par l'aperçu
 * (feColorMatrix en sRGB) et par ffmpeg (colorchannelmixer + lutrgb).
 */
function colorMatrix(clip) {
  const { adjust: a, sepia } = effectiveAdjust(clip);
  let m = IDENTITY.slice();
  // Luminosité (multiplicative, comme CSS brightness) puis contraste autour de 0.5.
  const b = 1 + a.brightness * 0.6;
  const c = 1 + a.contrast;
  m = mulMatrix([b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0], m);
  m = mulMatrix([c, 0, 0, 0, 0.5 - 0.5 * c, 0, c, 0, 0, 0.5 - 0.5 * c, 0, 0, c, 0, 0.5 - 0.5 * c, 0, 0, 0, 1, 0], m);
  if (a.saturation) m = mulMatrix(saturationMatrix(1 + a.saturation), m);
  if (a.hue) m = mulMatrix(hueMatrix(a.hue), m);
  if (sepia) m = mulMatrix(sepiaMatrix(Math.min(1, sepia)), m);
  if (a.temperature || a.tint) {
    const tr = 1 + a.temperature * 0.25 + a.tint * 0.08;
    const tg = 1 - a.tint * 0.2;
    const tb = 1 - a.temperature * 0.25 + a.tint * 0.08;
    m = mulMatrix([tr, 0, 0, 0, 0, 0, tg, 0, 0, 0, 0, 0, tb, 0, 0, 0, 0, 0, 1, 0], m);
  }
  if ((clip.effects || []).some((e) => e.id === 'invert')) {
    m = mulMatrix([-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0], m);
  }
  return m;
}

function isIdentityMatrix(m) {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-4);
}

// ---------------------------------------------------------------------------
// Fabriques de clips
// ---------------------------------------------------------------------------

function baseVisual() {
  return {
    transform: Object.assign({}, DEFAULT_TRANSFORM),
    crop: Object.assign({}, DEFAULT_CROP),
    adjust: Object.assign({}, DEFAULT_ADJUST),
    filter: { id: 'none', intensity: 1 },
    effects: [],
    animIn: null,
    animOut: null,
    animLoop: null,
    keyframes: {},
    chromaKey: { enabled: false, color: '#00FF00', similarity: 0.3, blend: 0.1 },
  };
}

/** Crée un clip à partir d'un média ({ id, kind, url, duration, width, height, hasAudio, name }). */
function createMediaClip(media, trackId, start) {
  const kind = media.kind;
  const common = {
    id: uid('clp'),
    trackId,
    start: start || 0,
    name: media.name,
    mediaId: media.id,
    src: media.url,
    mediaDuration: media.duration || 0,
    trimStart: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
  };
  if (kind === 'audio') {
    return Object.assign(common, { type: 'audio', duration: Math.max(0.1, media.duration || 1) });
  }
  if (kind === 'image') {
    return Object.assign(common, baseVisual(), { type: 'image', duration: 3, width: media.width, height: media.height, fit: 'contain', hasAudio: false });
  }
  return Object.assign(common, baseVisual(), {
    type: 'video',
    duration: Math.max(0.1, media.duration || 1),
    width: media.width,
    height: media.height,
    fit: 'contain',
    hasAudio: media.hasAudio !== false,
  });
}

function createTextClip(trackId, start, text, presetId) {
  const preset = TEXT_PRESETS.find((p) => p.id === presetId);
  return Object.assign(baseVisual(), {
    id: uid('clp'),
    trackId,
    type: 'text',
    start: start || 0,
    duration: 3,
    name: 'Texte',
    text: text || 'Votre texte',
    textStyle: Object.assign({}, DEFAULT_TEXT_STYLE, preset ? preset.style : {}),
    box: null,
  });
}

function createStickerClip(trackId, start, emoji) {
  return Object.assign(baseVisual(), {
    id: uid('clp'),
    trackId,
    type: 'sticker',
    start: start || 0,
    duration: 3,
    name: emoji,
    emoji,
    box: null,
  });
}

function createCaptionClip(trackId, start, duration, words, captionStyle) {
  return {
    id: uid('clp'),
    trackId,
    type: 'caption',
    start: start || 0,
    duration: Math.max(0.5, duration || 1),
    name: 'Sous-titres',
    words: words || [],
    captionStyle: captionStyle || null,
  };
}

module.exports = {
  TRANSITIONS,
  ANIMATIONS_IN,
  ANIMATIONS_OUT,
  ANIMATIONS_LOOP,
  IN_OUT_FORMULAS,
  LOOP_FORMULAS,
  EFFECTS,
  DEFAULT_ADJUST,
  FILTER_PRESETS,
  DEFAULT_TEXT_STYLE,
  TEXT_PRESETS,
  DEFAULT_TRANSFORM,
  DEFAULT_CROP,
  KEYFRAME_PROPS,
  ASPECT_RATIOS,
  THEMES,
  uid,
  createProject,
  isVisual,
  hasSourceAudio,
  clipEnd,
  mainTrack,
  clipsOnTrack,
  transitionBetween,
  maxTransitionDuration,
  packMainTrack,
  projectDuration,
  maxClipDuration,
  sourceTimeAt,
  compileFormula,
  visualStateAt,
  visualStateExprs,
  sampleStates,
  interpolateKeys,
  croppedSourceSize,
  baseLayerSize,
  colorMatrix,
  isIdentityMatrix,
  effectiveAdjust,
  createMediaClip,
  createTextClip,
  createStickerClip,
  createCaptionClip,
};
