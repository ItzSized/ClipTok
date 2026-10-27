// Enregistre dans l'installeur l'emplacement du projet ClipTok (le dossier parent de desktop/).
const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(__dirname, '..', '..');
fs.writeFileSync(path.join(__dirname, '..', 'app-config.json'), JSON.stringify({ projectDir }, null, 2));
console.log(`[desktop] Projet : ${projectDir}`);
