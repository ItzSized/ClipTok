/**
 * launcher.js — démarre (ou réutilise) les deux serveurs de ClipTok :
 *   - l'API : backend/server.js (port 4000) ;
 *   - le site : scripts/serve-frontend.js (port 3000, version compilée de Next.js).
 * Un serveur déjà lancé (ex. `npm run dev` dans un terminal) est réutilisé tel quel.
 * Les serveurs lancés ici sont surveillés (redémarrés s'ils plantent) et arrêtés
 * à la fermeture de l'application. Leurs sorties vont dans des journaux.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

/** Le serveur répond-il (n'importe quel code HTTP) ? */
function ping(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Node.js du système (celui de `npm run dev`) ; à défaut, le Node intégré à
 * Electron (ELECTRON_RUN_AS_NODE) : l'application marche même sans Node installé.
 */
function findNode() {
  try {
    const out = spawnSync('where', ['node'], { encoding: 'utf8', windowsHide: true });
    const first = (out.stdout || '').split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith('node.exe'));
    if (first) return { bin: first.trim(), env: {} };
  } catch {}
  return { bin: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGTERM');
}

class Service {
  /**
   * @param {object} o
   * @param {string} o.name   nom affiché
   * @param {string} o.url    adresse testée pour savoir si le serveur répond
   * @param {string} o.script script Node à lancer
   * @param {string} o.cwd
   * @param {object} o.env
   * @param {string} o.logFile
   */
  constructor(o) {
    Object.assign(this, o);
    this.child = null;
    this.external = false;
    this.stopping = false;
    this.restarts = [];
  }

  log(text) {
    try {
      fs.appendFileSync(this.logFile, text);
    } catch {}
  }

  spawn() {
    const node = findNode();
    this.log(`\n===== ${new Date().toLocaleString('fr-FR')} : démarrage (${node.bin}) =====\n`);
    const child = spawn(node.bin, [this.script], { cwd: this.cwd, env: { ...process.env, ...this.env, ...node.env }, windowsHide: true });
    this.child = child;
    child.stdout.on('data', (d) => this.log(d.toString()));
    child.stderr.on('data', (d) => this.log(d.toString()));
    child.on('exit', (code) => {
      this.log(`\n===== arrêt (code ${code}) =====\n`);
      // Arrêt voulu, ou ancien processus remplacé par un redémarrage manuel.
      if (this.stopping || this.child !== child) return;
      // Plantage : redémarrage automatique (au plus 5 fois par minute).
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => now - t < 60000);
      if (this.restarts.length >= 5) return this.onCrash?.(this);
      this.restarts.push(now);
      setTimeout(() => !this.stopping && this.spawn(), 1500);
    });
  }

  /** Lance le serveur s'il ne répond pas déjà, puis attend qu'il réponde. */
  async ensure(onStatus, timeoutMs) {
    if (await ping(this.url)) {
      this.external = true;
      onStatus?.(`${this.name} : déjà lancé, réutilisé`);
      return;
    }
    onStatus?.(`${this.name} : démarrage…`);
    this.spawn();
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ping(this.url)) return;
      if (this.child && this.child.exitCode !== null && this.restarts.length >= 5) break;
      await sleep(700);
      const s = Math.round((Date.now() - t0) / 1000);
      if (s > 15) onStatus?.(`${this.name} : démarrage… (${s} s${s > 40 ? ', premier lancement : compilation du site' : ''})`);
    }
    throw new Error(`${this.name} ne répond pas (voir ${this.logFile}).`);
  }

  stop() {
    this.stopping = true;
    killTree(this.child);
  }

  restart() {
    this.stopping = true;
    killTree(this.child);
    this.stopping = false;
    this.external = false;
    this.restarts = [];
    this.spawn();
  }
}

/** Les deux serveurs de ClipTok pour un dossier de projet donné. */
function createServices(projectDir, logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  // Journaux remis à zéro s'ils dépassent 5 Mo.
  for (const f of ['api.log', 'site.log']) {
    const p = path.join(logDir, f);
    try {
      if (fs.statSync(p).size > 5 * 1024 * 1024) fs.writeFileSync(p, '');
    } catch {}
  }
  const backend = path.join(projectDir, 'backend');
  const venvScripts = path.join(backend, 'venv', 'Scripts');
  const venvPython = path.join(venvScripts, 'python.exe');
  // Lancée depuis le menu Démarrer, l'application n'a pas le venv dans le PATH : on l'ajoute.
  const env = {
    PATH: fs.existsSync(venvScripts) ? `${venvScripts};${process.env.PATH || ''}` : process.env.PATH,
    ...(fs.existsSync(venvPython) && !process.env.PYTHON_PATH ? { PYTHON_PATH: venvPython } : {}),
    FORCE_COLOR: '0',
  };
  return {
    api: new Service({ name: 'API', url: 'http://localhost:4000/api/sfx', script: path.join(backend, 'server.js'), cwd: backend, env, logFile: path.join(logDir, 'api.log') }),
    site: new Service({ name: 'Site', url: 'http://localhost:3000/', script: path.join(projectDir, 'scripts', 'serve-frontend.js'), cwd: projectDir, env, logFile: path.join(logDir, 'site.log') }),
  };
}

module.exports = { createServices, ping };
