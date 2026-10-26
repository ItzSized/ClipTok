/**
 * Lancement rapide du site : sert une version COMPILÉE de Next.js (pages
 * instantanées, aucune compilation à la visite), au lieu du mode dev qui
 * compile chaque page à la première visite (10 à 20 s par page sur ce PC).
 *
 *  - Une version compilée existe : elle démarre en 2-3 s.
 *  - Le code a changé : la nouvelle version se compile EN ARRIÈRE-PLAN pendant
 *    que l'ancienne reste en ligne, puis elle la remplace automatiquement.
 *  - Aucune version compilée (tout premier lancement) : le mode dev sert le site
 *    pendant la première compilation, puis la version compilée prend le relais.
 *
 * Deux dossiers de build alternent (.next-prod-a / .next-prod-b) pour ne jamais
 * écrire dans celui qui est servi.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const SHARED = path.join(__dirname, '..', 'shared');
const PORT = process.env.FRONTEND_PORT || '3000';
const NEXT_BIN = require.resolve('next/dist/bin/next', { paths: [FRONTEND] });
const DIRS = ['.next-prod-a', '.next-prod-b'];
const WATCHED = [
  ...['app', 'components', 'lib', 'hooks', 'public'].map((d) => path.join(FRONTEND, d)),
  SHARED,
  ...['next.config.js', 'tailwind.config.ts', 'postcss.config.js', 'package.json'].map((f) => path.join(FRONTEND, f)),
];

const log = (msg) => console.log(`[web] ${msg}`);

/** Date de la dernière modification du code (fichiers surveillés). */
function latestSourceChange() {
  let latest = 0;
  const walk = (p) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) if (!name.startsWith('.') && name !== 'node_modules') walk(path.join(p, name));
    } else if (st.mtimeMs > latest) latest = st.mtimeMs;
  };
  WATCHED.forEach(walk);
  return latest;
}

/** Build complet et utilisable d'un dossier : { dir, stamp } ou null. */
function buildInfo(dir) {
  try {
    const stamp = Number(fs.readFileSync(path.join(FRONTEND, dir, 'cliptok-stamp'), 'utf8'));
    fs.accessSync(path.join(FRONTEND, dir, 'BUILD_ID'));
    return { dir, stamp };
  } catch {
    return null;
  }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

let server = null; // { child, dir }
let liveDir = null; // version en ligne (ou en cours de mise en ligne) : jamais effacée par un build
let building = false;
let pending = false;

/** Le code a-t-il changé depuis la version en ligne ? */
function isStale() {
  const live = liveDir && buildInfo(liveDir);
  return !live || latestSourceChange() > live.stamp;
}

function startServer(mode, dir) {
  const args = mode === 'dev' ? [NEXT_BIN, 'dev', '-p', PORT] : [NEXT_BIN, 'start', '-p', PORT];
  const env = { ...process.env, ...(mode === 'dev' ? {} : { NEXT_DIST_DIR: dir }) };
  const child = spawn(process.execPath, args, { cwd: FRONTEND, env, stdio: 'inherit' });
  server = { child, dir: mode === 'dev' ? null : dir };
  liveDir = server.dir;
  log(mode === 'dev' ? `Mode dev (première compilation en cours) : http://localhost:${PORT}` : `Site prêt (version compilée ${dir}) : http://localhost:${PORT}`);
  if (mode === 'dev') {
    // Préchauffage des pages pendant la première compilation.
    spawn(process.execPath, [path.join(__dirname, 'warmup.js')], { stdio: 'inherit' });
  }
}

function swapTo(dir) {
  liveDir = dir;
  const old = server;
  killTree(old?.child);
  // Laisser le port se libérer avant de relancer.
  setTimeout(() => startServer('prod', dir), 800);
}

function build() {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  const target = DIRS.find((d) => d !== liveDir) || DIRS[0];
  const stamp = latestSourceChange();
  const t0 = Date.now();
  log(`Compilation de la nouvelle version en arrière-plan (${target})… le site reste disponible.`);
  fs.rmSync(path.join(FRONTEND, target), { recursive: true, force: true });
  const child = spawn(process.execPath, [NEXT_BIN, 'build'], {
    cwd: FRONTEND,
    env: { ...process.env, NEXT_DIST_DIR: target, NEXT_FAST_BUILD: '1', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  child.on('exit', (code) => {
    building = false;
    if (code === 0) {
      fs.writeFileSync(path.join(FRONTEND, target, 'cliptok-stamp'), String(stamp));
      log(`Nouvelle version compilée en ${Math.round((Date.now() - t0) / 1000)} s : mise en ligne.`);
      swapTo(target);
    } else {
      log(`Échec de la compilation (le site actuel reste en ligne) :\n${output.slice(-3000)}`);
    }
    // Modifié pendant la compilation : on recompile seulement si le code a vraiment changé depuis.
    if (pending) {
      pending = false;
      if (isStale()) build();
    }
  });
}

function watch() {
  let timer = null;
  const onChange = (file) => {
    if (file && /(^|[\\/])\.|~$|\.tmp$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (isStale()) build();
    }, 4000);
  };
  for (const p of WATCHED) {
    try {
      fs.watch(p, { recursive: fs.statSync(p).isDirectory() }, (_, file) => onChange(file));
    } catch {}
  }
}

(function main() {
  const builds = DIRS.map(buildInfo).filter(Boolean).sort((a, b) => b.stamp - a.stamp);
  const best = builds[0];
  if (best) {
    startServer('prod', best.dir);
    if (latestSourceChange() > best.stamp) build();
  } else {
    startServer('dev');
    build();
  }
  watch();
  const stop = () => {
    killTree(server?.child);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})();
