// Pont minimal pour l'écran de démarrage : état du lancement et boutons en cas d'erreur.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cliptok', {
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  action: (name) => ipcRenderer.send('splash-action', name),
});
