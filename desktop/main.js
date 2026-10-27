/**
 * ClipTok — application Windows (Electron).
 *
 * Écran de démarrage → lance (ou réutilise) l'API et le site de ClipTok → ouvre
 * l'interface dans sa propre fenêtre. Icône dans la zone de notification pour
 * redémarrer les serveurs ou ouvrir les journaux. Les serveurs lancés par
 * l'application s'arrêtent avec elle.
 */
const { app, BrowserWindow, Tray, Menu, shell, dialog, ipcMain, session, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { createServices } = require('./launcher');

const SITE = 'http://localhost:3000';
const ICON = path.join(__dirname, 'build', 'icon.png');
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const LOG_DIR = () => path.join(app.getPath('userData'), 'logs');

let splash = null;
let win = null;
let tray = null;
let services = null;
let quitting = false;

// ------------------------------------------------------------------ réglages

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const settings = () => readJson(SETTINGS_FILE(), {});
function saveSettings(patch) {
  const next = { ...settings(), ...patch };
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(next, null, 2));
}

const isProject = (dir) => Boolean(dir) && fs.existsSync(path.join(dir, 'backend', 'server.js')) && fs.existsSync(path.join(dir, 'scripts', 'serve-frontend.js'));

/**
 * Dossier du projet ClipTok : choisi par l'utilisateur, sinon celui enregistré à la
 * création de l'installeur (app-config.json), sinon le dossier parent (lancement
 * depuis le dépôt avec `npm run app`). Introuvable → on le demande.
 */
async function projectDir() {
  const bundled = readJson(path.join(__dirname, 'app-config.json'), {});
  const found = [settings().projectDir, bundled.projectDir, path.resolve(__dirname, '..')].find(isProject);
  if (found) return found;
  const res = await dialog.showOpenDialog({
    title: 'Où se trouve le dossier ClipTok (AutoClipper) ?',
    properties: ['openDirectory'],
  });
  const dir = res.filePaths[0];
  if (!isProject(dir)) {
    dialog.showErrorBox('ClipTok', "Ce dossier ne contient pas ClipTok (backend/server.js introuvable).");
    return null;
  }
  saveSettings({ projectDir: dir });
  return dir;
}

// ------------------------------------------------------------------ fenêtres

function status(text, state = 'loading') {
  splash?.webContents.send('status', { text, state });
}

function createSplash() {
  splash = new BrowserWindow({
    width: 440,
    height: 320,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: '#09090b',
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash.show());
}

function createMain() {
  const bounds = settings().bounds || { width: 1600, height: 950 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'ClipTok',
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: { spellcheck: false },
  });
  // Logiciel : directement le tableau de bord (la page de connexion s'affiche si besoin).
  win.loadURL(`${SITE}/dashboard`);
  // « ready-to-show » ne vient pas toujours sous Windows (fenêtre cachée jamais peinte) :
  // on affiche dès la fin du chargement, avec une sécurité de 8 s.
  let shown = false;
  const reveal = () => {
    if (shown || !win || win.isDestroyed()) return;
    shown = true;
    if (settings().maximized !== false) win.maximize();
    win.show();
    splash?.destroy();
    splash = null;
  };
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', reveal);
  setTimeout(reveal, 8000);
  // Liens externes (sources web, YouTube, réseaux) : dans le navigateur ; liens internes : dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SITE) || url.startsWith('http://localhost:4000')) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON } };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(SITE)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  const remember = () => {
    if (!win || win.isDestroyed()) return;
    saveSettings({ maximized: win.isMaximized(), ...(win.isMaximized() ? {} : { bounds: win.getBounds() }) });
  };
  win.on('close', remember);
  win.on('closed', () => {
    win = null;
    app.quit();
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon-32.png')));
  tray.setToolTip('ClipTok');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir ClipTok', click: () => (win ? (win.show(), win.focus()) : null) },
      { type: 'separator' },
      { label: 'Redémarrer les serveurs', click: () => restartServices() },
      { label: 'Ouvrir les journaux', click: () => shell.openPath(LOG_DIR()) },
      { label: 'Dossier du projet…', click: () => changeProject() },
      { type: 'separator' },
      { label: 'Quitter', click: () => app.quit() },
    ])
  );
  tray.on('click', () => win && (win.show(), win.focus()));
}

/** Menu caché (barre masquée) : seulement des raccourcis qui ne gênent pas l'éditeur. */
function setMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Affichage',
        submenu: [
          { role: 'reload', accelerator: 'F5' },
          { role: 'forceReload', accelerator: 'CmdOrCtrl+F5' },
          { role: 'toggleDevTools', accelerator: 'F12' },
          { role: 'togglefullscreen', accelerator: 'F11' },
        ],
      },
    ])
  );
}

// ------------------------------------------------------------------ serveurs

async function startServices(dir) {
  services = createServices(dir, LOG_DIR());
  const onCrash = (s) => {
    if (quitting) return;
    dialog
      .showMessageBox({ type: 'error', title: 'ClipTok', message: `${s.name} s'est arrêté plusieurs fois de suite.`, detail: `Journal : ${s.logFile}`, buttons: ['Redémarrer', 'Ouvrir le journal', 'Ignorer'] })
      .then(({ response }) => (response === 0 ? s.restart() : response === 1 ? shell.openPath(s.logFile) : null));
  };
  services.api.onCrash = onCrash;
  services.site.onCrash = onCrash;
  // Les deux en parallèle ; le site peut compiler longtemps au tout premier lancement.
  await Promise.all([services.api.ensure((t) => status(t), 90000), services.site.ensure((t) => status(t), 8 * 60000)]);
}

function restartServices() {
  if (!services) return;
  for (const s of [services.api, services.site]) {
    if (s.external) continue;
    s.restart();
  }
  setTimeout(() => win?.reload(), 6000);
}

async function changeProject() {
  const res = await dialog.showOpenDialog({ title: 'Dossier du projet ClipTok', properties: ['openDirectory'] });
  const dir = res.filePaths[0];
  if (!dir) return;
  if (!isProject(dir)) return dialog.showErrorBox('ClipTok', "Ce dossier ne contient pas ClipTok (backend/server.js introuvable).");
  saveSettings({ projectDir: dir });
  app.relaunch();
  app.quit();
}

async function boot() {
  createSplash();
  const dir = await projectDir();
  if (!dir) return app.quit();
  status('Démarrage des serveurs…');
  try {
    await startServices(dir);
    status('Ouverture…', 'done');
    createMain();
  } catch (err) {
    status(err.message, 'error');
  }
}

// ------------------------------------------------------------------ cycle de vie

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.itzsized.cliptok');
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  ipcMain.on('splash-action', (_e, action) => {
    if (action === 'logs') shell.openPath(LOG_DIR());
    else if (action === 'retry') {
      services?.api.stop();
      services?.site.stop();
      splash?.destroy();
      splash = null;
      boot();
    } else if (action === 'quit') app.quit();
  });

  app.whenReady().then(() => {
    setMenu();
    createTray();
    // Micro, presse-papiers, notifications : autorisés pour ClipTok (localhost) uniquement.
    session.defaultSession.setPermissionRequestHandler((wc, _perm, cb) => cb(wc.getURL().startsWith(SITE)));
    boot();
  });

  app.on('before-quit', () => {
    quitting = true;
    services?.api.stop();
    services?.site.stop();
  });
  app.on('window-all-closed', () => app.quit());
}
