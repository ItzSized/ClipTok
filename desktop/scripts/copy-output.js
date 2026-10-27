// Copie l'installeur et la version portable dans « !_EXE_ET_INSTALLEUR » à la racine du projet.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const out = path.join(__dirname, '..', '..', '!_EXE_ET_INSTALLEUR');
fs.mkdirSync(out, { recursive: true });
const { version } = require('../package.json');
const files = [
  [`ClipTok Setup ${version}.exe`, `ClipTok_${version}_Installeur.exe`],
  [`ClipTok ${version}.exe`, 'ClipTok.exe'],
];
for (const [from, to] of files) {
  const src = path.join(dist, from);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(out, to));
  console.log(`[desktop] ${to} → ${out}`);
}
