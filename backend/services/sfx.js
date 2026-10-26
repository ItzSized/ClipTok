/**
 * sfx.js
 *
 * Bibliothèque d'effets sonores intégrée à l'éditeur. Les sons sont synthétisés
 * par ffmpeg au premier démarrage (aucun fichier sous droits n'est embarqué) et
 * stockés dans assets/sfx, servis sur /sfx.
 */
const path = require('path');
const fs = require('fs/promises');
const { runFfmpeg, probeMedia } = require('./ffmpegUtils');
const { SFX_DIR } = require('./media');

const SR = 44100;

// Chaque son : source lavfi (aevalsrc/anoisesrc) + filtres optionnels.
const SOUNDS = [
  { id: 'whoosh', name: 'Whoosh', category: 'Transitions', src: `anoisesrc=d=0.7:c=pink:r=${SR}:a=0.9`, af: 'bandpass=f=1200:width_type=h:w=1600,afade=t=in:d=0.3:curve=exp,afade=t=out:st=0.3:d=0.4,volume=2.2' },
  { id: 'swoosh-fast', name: 'Swoosh rapide', category: 'Transitions', src: `anoisesrc=d=0.35:c=white:r=${SR}:a=0.7`, af: 'highpass=f=1500,lowpass=f=7000,afade=t=in:d=0.12,afade=t=out:st=0.12:d=0.23,volume=1.6' },
  { id: 'riser', name: 'Riser', category: 'Transitions', expr: '0.45*sin(2*PI*200*(pow(8,t/2)-1)/(log(8)/2))*min(1,t/1.5)', d: 2.2, af: 'afade=t=out:st=2.0:d=0.2' },
  { id: 'downlifter', name: 'Descente', category: 'Transitions', expr: '0.45*sin(2*PI*1600*(1-pow(0.125,t/1.5))/(log(8)/1.5))*exp(-t*1.2)', d: 1.6 },
  { id: 'pop', name: 'Pop', category: 'Interface', expr: '0.8*sin(2*PI*(380*t+40*(1-exp(-t*40))))*exp(-t*28)', d: 0.25 },
  { id: 'click', name: 'Clic', category: 'Interface', expr: '0.7*sin(2*PI*2200*t)*exp(-t*180)', d: 0.06 },
  { id: 'ding', name: 'Ding', category: 'Interface', expr: '0.5*sin(2*PI*1318.5*t)*exp(-t*3.5)+0.25*sin(2*PI*2637*t)*exp(-t*6)', d: 1.4 },
  { id: 'notification', name: 'Notification', category: 'Interface', expr: '0.45*(sin(2*PI*880*t)*between(t,0,0.12)*exp(-t*10)+sin(2*PI*1318.5*t)*gte(t,0.12)*exp(-(t-0.12)*6))', d: 0.8 },
  { id: 'coin', name: 'Pièce', category: 'Jeux', expr: '0.3*(sgn(sin(2*PI*988*t))*lt(t,0.08)+sgn(sin(2*PI*1319*t))*gte(t,0.08)*exp(-(t-0.08)*5))', d: 0.6 },
  { id: 'error', name: 'Erreur', category: 'Jeux', expr: '0.3*sgn(sin(2*PI*110*t))*(lt(t,0.18)+between(t,0.25,0.5))', d: 0.55 },
  { id: 'level-up', name: 'Level up', category: 'Jeux', expr: '0.28*sgn(sin(2*PI*(523*lt(t,0.1)+659*between(t,0.1,0.2)+784*between(t,0.2,0.3)+1046*gte(t,0.3))*t))*exp(-max(0,t-0.3)*4)', d: 0.9 },
  { id: 'boom', name: 'Boom', category: 'Impacts', expr: '0.95*sin(2*PI*(45*t+9*(1-exp(-t*10))))*exp(-t*2.8)', d: 1.8, af: 'lowpass=f=400,volume=1.8' },
  { id: 'hit', name: 'Impact', category: 'Impacts', expr: '0.9*sin(2*PI*(70*t+12*(1-exp(-t*30))))*exp(-t*9)+0.3*(random(0)*2-1)*exp(-t*35)', d: 0.6 },
  { id: 'heartbeat', name: 'Battement de cœur', category: 'Impacts', expr: '0.9*sin(2*PI*55*t)*(exp(-t*14)*lt(t,0.3)+exp(-(t-0.28)*14)*gte(t,0.28))', d: 0.9, af: 'lowpass=f=200,volume=2' },
  { id: 'glitch', name: 'Glitch', category: 'Effets', expr: '0.35*sgn(sin(2*PI*(220+880*lt(mod(t,0.09),0.03))*t))*lt(mod(t,0.07),0.045)', d: 0.7 },
  { id: 'shutter', name: 'Appareil photo', category: 'Effets', src: `anoisesrc=d=0.25:c=white:r=${SR}:a=0.8`, af: "volume='if(lt(t,0.03),1,if(lt(t,0.09),0.05,if(lt(t,0.13),0.8,0)))':eval=frame,highpass=f=2000" },
  { id: 'typing', name: 'Clavier', category: 'Effets', expr: '0.6*sin(2*PI*1800*t)*exp(-mod(t,0.11)*160)*lt(mod(t,0.11),0.04)', d: 1.2 },
  { id: 'censor', name: 'Bip censure', category: 'Effets', expr: '0.4*sin(2*PI*1000*t)', d: 0.8, af: 'afade=t=in:d=0.01,afade=t=out:st=0.78:d=0.02' },
  { id: 'magic', name: 'Magie', category: 'Effets', expr: '0.18*(sin(2*PI*1568*t)+sin(2*PI*2093*t*1.002)+sin(2*PI*2637*t))*(0.5+0.5*sin(2*PI*12*t))*exp(-t*1.8)', d: 1.6 },
  { id: 'tick', name: 'Tic-tac', category: 'Effets', expr: '0.6*sin(2*PI*(1500-500*gte(mod(t,1),0.5))*t)*exp(-mod(t,0.5)*120)', d: 2.0 },
  // --- Transitions
  { id: 'swoosh-long', name: 'Whoosh long', category: 'Transitions', src: `anoisesrc=d=1.4:c=pink:r=${SR}:a=0.9`, af: 'bandpass=f=900:width_type=h:w=1200,afade=t=in:d=0.7:curve=exp,afade=t=out:st=0.7:d=0.7,volume=2.4' },
  { id: 'swipe', name: 'Swipe', category: 'Transitions', src: `anoisesrc=d=0.25:c=white:r=${SR}:a=0.8`, af: 'bandpass=f=3000:width_type=h:w=3000,afade=t=in:d=0.05,afade=t=out:st=0.05:d=0.2,volume=1.5' },
  { id: 'rewind', name: 'Rembobinage', category: 'Transitions', expr: '0.3*sin(2*PI*(800+1200*mod(t*6,1))*t)*(1-mod(t*6,1))', d: 1.2 },
  { id: 'suspense', name: 'Suspense', category: 'Transitions', expr: '0.4*(sin(2*PI*55*t)+0.5*sin(2*PI*58*t))*(0.6+0.4*sin(2*PI*3*t))*min(1,t/0.8)', d: 3, af: 'afade=t=out:st=2.4:d=0.6' },
  // --- Interface
  { id: 'bell', name: 'Cloche', category: 'Interface', expr: '0.4*(sin(2*PI*880*t)+0.6*sin(2*PI*2210*t)+0.3*sin(2*PI*3520*t))*exp(-t*2.5)', d: 2 },
  { id: 'chime', name: 'Carillon', category: 'Interface', expr: '0.3*(sin(2*PI*1046.5*t)*exp(-t*4)+sin(2*PI*1318.5*t)*gte(t,0.12)*exp(-max(0,t-0.12)*4)+sin(2*PI*1568*t)*gte(t,0.24)*exp(-max(0,t-0.24)*4))', d: 1.5 },
  { id: 'beep', name: 'Bip', category: 'Interface', expr: '0.4*sin(2*PI*1000*t)', d: 0.15, af: 'afade=t=out:st=0.12:d=0.03' },
  { id: 'countdown', name: 'Compte à rebours', category: 'Interface', expr: '0.4*sin(2*PI*(880+880*gte(t,3))*t)*lt(mod(t,1),0.12+0.5*gte(t,3))', d: 3.7 },
  { id: 'success', name: 'Succès', category: 'Interface', expr: '0.3*sin(2*PI*(523*lt(t,0.09)+659*between(t,0.09,0.18)+784*between(t,0.18,0.27)+1046*gte(t,0.27))*t)*exp(-max(0,t-0.27)*3)', d: 1.0 },
  { id: 'bubble', name: 'Bulle', category: 'Interface', expr: '0.6*sin(2*PI*(400*t+600*t*t))*exp(-t*20)', d: 0.25 },
  { id: 'sparkle', name: 'Étincelles', category: 'Interface', expr: '0.2*sin(2*PI*(2000+1500*floor(mod(t*12,4)))*t)*exp(-mod(t,1/12)*30)*exp(-t*1.5)', d: 1.5 },
  // --- Impacts
  { id: 'bass-drop', name: 'Bass drop', category: 'Impacts', expr: '0.9*sin(2*PI*(35*t+21.25*(1-exp(-t*4))))*min(1,t*40)*exp(-t*1.1)', d: 2.5, af: 'lowpass=f=300,volume=1.6' },
  { id: 'punch', name: 'Coup de poing', category: 'Impacts', expr: '0.9*sin(2*PI*(90*t+15*(1-exp(-t*40))))*exp(-t*14)+0.5*(random(0)*2-1)*exp(-t*50)', d: 0.4 },
  { id: 'thud', name: 'Choc sourd', category: 'Impacts', expr: '0.9*sin(2*PI*(55*t+5*(1-exp(-t*20))))*exp(-t*8)', d: 0.6, af: 'lowpass=f=250,volume=1.6' },
  { id: 'clap', name: 'Clap', category: 'Impacts', src: `anoisesrc=d=0.2:c=white:r=${SR}:a=0.9`, af: 'bandpass=f=1500:width_type=h:w=2000,afade=t=out:st=0.01:d=0.15,volume=1.4' },
  { id: 'cinematic-hit', name: 'Impact cinéma', category: 'Impacts', expr: '0.8*sin(2*PI*(38*t+6*(1-exp(-t*6))))*exp(-t*1.5)+0.4*(random(0)*2-1)*exp(-t*6)', d: 3, af: 'lowpass=f=900,aecho=0.8:0.7:120:0.35,volume=1.6' },
  { id: 'drumroll', name: 'Roulement de tambour', category: 'Impacts', src: `anoisesrc=d=2:c=pink:r=${SR}:a=0.8`, af: "volume='0.4+0.6*abs(sin(2*PI*14*t))':eval=frame,lowpass=f=1500,afade=t=in:d=1.5,afade=t=out:st=1.8:d=0.2" },
  // --- Jeux
  { id: 'laser', name: 'Laser', category: 'Jeux', expr: '0.35*sin(2*PI*(200*t+120*(1-exp(-t*15))))*exp(-t*6)', d: 0.5 },
  { id: 'fail', name: 'Échec (trombone)', category: 'Jeux', expr: '0.35*sgn(sin(2*PI*(392*lt(t,0.35)+370*between(t,0.35,0.7)+349*between(t,0.7,1.05)+330*gte(t,1.05))*t))*exp(-max(0,t-1.05)*1.5)', d: 2.0, af: 'lowpass=f=1800' },
  { id: 'tada', name: 'Tada', category: 'Jeux', expr: '0.2*(sgn(sin(2*PI*523*t))+sgn(sin(2*PI*659*t))+sgn(sin(2*PI*784*t)))*(lt(t,0.12)*0.6+gte(t,0.18))*exp(-max(0,t-0.18)*1.5)', d: 1.6, af: 'lowpass=f=3000' },
  { id: 'jump', name: 'Saut', category: 'Jeux', expr: '0.3*sgn(sin(2*PI*(300*t+900*t*t)))*exp(-t*6)', d: 0.35 },
  // --- Effets
  { id: 'zap', name: 'Zap électrique', category: 'Effets', expr: '0.3*sgn(sin(2*PI*(90+60*sin(2*PI*30*t))*t))*(random(0)*0.5+0.5)*exp(-t*5)', d: 0.6 },
  { id: 'boing', name: 'Boing', category: 'Effets', expr: '0.5*sin(2*PI*220*t+13.3*(1-cos(2*PI*9*t))*exp(-t*3))*exp(-t*3)', d: 1.2 },
  { id: 'scratch', name: 'Scratch vinyle', category: 'Effets', src: `anoisesrc=d=0.6:c=white:r=${SR}:a=0.8`, af: "volume='abs(sin(2*PI*5*t))':eval=frame,bandpass=f=1000:width_type=h:w=800,volume=2" },
  { id: 'alarm', name: 'Alarme', category: 'Effets', expr: '0.35*sgn(sin(2*PI*(700+300*gte(mod(t,0.5),0.25))*t))', d: 2, af: 'lowpass=f=3000' },
  { id: 'vibrate', name: 'Vibreur', category: 'Effets', expr: '0.6*sin(2*PI*150*t)*lt(mod(t,0.6),0.4)*(0.6+0.4*sin(2*PI*30*t))', d: 1.8, af: 'lowpass=f=400' },
  { id: 'wind', name: 'Vent', category: 'Ambiance', src: `anoisesrc=d=3:c=brown:r=${SR}:a=0.9`, af: "lowpass=f=600,volume='0.6+0.4*sin(2*PI*0.4*t)':eval=frame,afade=t=in:d=0.8,afade=t=out:st=2.2:d=0.8" },
  { id: 'crowd-wow', name: 'Waouh (foule)', category: 'Ambiance', src: `anoisesrc=d=1.6:c=pink:r=${SR}:a=0.8`, af: 'bandpass=f=500:width_type=h:w=500,afade=t=in:d=0.3,afade=t=out:st=0.6:d=1,volume=2.5' },
];

function sfxPath(id) {
  return path.join(SFX_DIR, `${id}.mp3`);
}

async function generateOne(sound) {
  const source = sound.src || `aevalsrc='${sound.expr}':s=${SR}:d=${sound.d}`;
  const filters = ['aformat=channel_layouts=stereo', sound.af, 'alimiter=limit=0.95'].filter(Boolean).join(',');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', source, '-af', filters, '-c:a', 'libmp3lame', '-b:a', '192k', sfxPath(sound.id)]);
}

let catalog = null;

const DURATIONS_FILE = path.join(SFX_DIR, 'durations.json');

/**
 * Génère les sons manquants (au démarrage) puis construit le catalogue. Les
 * durées sont mises en cache : les démarrages suivants ne lancent aucun ffprobe.
 */
async function ensureSfx() {
  await fs.mkdir(SFX_DIR, { recursive: true });
  let durations = {};
  try {
    durations = JSON.parse(await fs.readFile(DURATIONS_FILE, 'utf-8'));
  } catch {}
  let changed = false;
  const list = [];
  for (const sound of SOUNDS) {
    const file = sfxPath(sound.id);
    let generated = false;
    try {
      await fs.access(file);
    } catch {
      try {
        await generateOne(sound);
        generated = true;
      } catch (err) {
        console.warn(`[sfx] Génération de "${sound.id}" échouée : ${err.message.split('\n')[0]}`);
        continue;
      }
    }
    if (generated || !durations[sound.id]) {
      try {
        durations[sound.id] = (await probeMedia(file)).duration || sound.d || 1;
      } catch {
        durations[sound.id] = sound.d || 1;
      }
      changed = true;
    }
    list.push({ id: sound.id, name: sound.name, category: sound.category, url: `/sfx/${sound.id}.mp3`, duration: durations[sound.id] });
  }
  if (changed) await fs.writeFile(DURATIONS_FILE, JSON.stringify(durations, null, 2)).catch(() => {});
  catalog = list;
  return list;
}

function listSfx() {
  return catalog || [];
}

module.exports = { ensureSfx, listSfx };
