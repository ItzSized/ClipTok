/**
 * fonts.js
 *
 * Catalogue des polices embarquées (backend/assets/fonts). Chaque police est
 * servie au navigateur sur /fonts/<fichier> (aperçu) ET passée à libass via
 * `fontsdir` lors du rendu ffmpeg : l'aperçu et le rendu utilisent donc
 * exactement le même fichier.
 *
 * libass dimensionne une police de taille S de sorte que
 * (usWinAscent + usWinDescent) = S pixels, alors que le CSS dimensionne l'em.
 * On expose donc `emRatio = unitsPerEm / (winAscent + winDescent)` : la taille
 * CSS équivalente à une taille ASS S vaut S * emRatio.
 */
const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.join(__dirname, '..', 'assets', 'fonts');

function readTables(buf) {
  let offset = 0;
  const tag = buf.toString('latin1', 0, 4);
  if (tag === 'ttcf') offset = buf.readUInt32BE(12); // première police d'une collection
  const numTables = buf.readUInt16BE(offset + 4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + i * 16;
    tables[buf.toString('latin1', rec, rec + 4)] = {
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12),
    };
  }
  return tables;
}

function decodeName(buf, start, length, platformId) {
  const slice = buf.subarray(start, start + length);
  if (platformId === 0 || platformId === 3) {
    // UTF-16BE
    let out = '';
    for (let i = 0; i + 1 < slice.length; i += 2) out += String.fromCharCode(slice.readUInt16BE(i));
    return out;
  }
  return slice.toString('latin1');
}

function readNames(buf, table) {
  const names = {};
  if (!table) return names;
  const base = table.offset;
  const count = buf.readUInt16BE(base + 2);
  const stringOffset = base + buf.readUInt16BE(base + 4);
  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12;
    const platformId = buf.readUInt16BE(rec);
    const languageId = buf.readUInt16BE(rec + 4);
    const nameId = buf.readUInt16BE(rec + 6);
    const length = buf.readUInt16BE(rec + 8);
    const off = buf.readUInt16BE(rec + 10);
    // On privilégie les noms Windows anglais (3 / 0x409), sinon le premier trouvé.
    const preferred = platformId === 3 && languageId === 0x409;
    if (names[nameId] && !preferred) continue;
    names[nameId] = decodeName(buf, stringOffset + off, length, platformId);
  }
  return names;
}

function parseFont(filePath) {
  const buf = fs.readFileSync(filePath);
  const tables = readTables(buf);
  const head = tables.head;
  const os2 = tables['OS/2'];
  const hhea = tables.hhea;
  const unitsPerEm = head ? buf.readUInt16BE(head.offset + 18) : 1000;

  let ascent = 0;
  let descent = 0;
  if (os2 && os2.length >= 78) {
    ascent = buf.readUInt16BE(os2.offset + 74); // usWinAscent
    descent = buf.readUInt16BE(os2.offset + 76); // usWinDescent
  }
  if (ascent + descent === 0 && hhea) {
    ascent = buf.readInt16BE(hhea.offset + 4);
    descent = -buf.readInt16BE(hhea.offset + 6);
  }
  const weightClass = os2 ? buf.readUInt16BE(os2.offset + 4) : 400;
  const names = readNames(buf, tables.name);

  return {
    // Nom utilisé par libass pour retrouver la police (le "full name" est toujours unique).
    assName: names[4] || names[1] || path.basename(filePath, path.extname(filePath)),
    family: names[16] || names[1] || names[4],
    fullName: names[4] || names[1],
    weight: weightClass,
    emRatio: ascent + descent > 0 ? unitsPerEm / (ascent + descent) : 1,
    // Ascendante/descendante en fraction de la taille ASS (pour placer le texte en aperçu).
    ascentRatio: ascent + descent > 0 ? ascent / (ascent + descent) : 0.8,
  };
}

let cache = null;

/** Liste des polices disponibles : [{ id, file, assName, family, emRatio, ... }]. */
function listFonts() {
  if (cache) return cache;
  let files = [];
  try {
    files = fs.readdirSync(FONTS_DIR).filter((f) => /\.(ttf|otf)$/i.test(f));
  } catch {
    files = [];
  }
  cache = files
    .map((file) => {
      try {
        const meta = parseFont(path.join(FONTS_DIR, file));
        return { id: path.basename(file, path.extname(file)), file, url: `/fonts/${encodeURIComponent(file)}`, ...meta };
      } catch (err) {
        console.warn(`[fonts] Police illisible ignorée (${file}) : ${err.message}`);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  return cache;
}

function getFont(id) {
  return listFonts().find((f) => f.id === id) || null;
}

const mirroredDirs = new Set();

/**
 * Retourne un chemin vers le dossier des polices relatif à `jobDir`, garanti sur
 * le même disque (sans ':' sous Windows) pour le filtre `ass=...:fontsdir=...` de FFmpeg.
 */
function fontsRelFor(jobDir) {
  let targetDir = FONTS_DIR;
  const resolvedJob = path.resolve(jobDir);
  if (path.parse(resolvedJob).root.toLowerCase() !== path.parse(FONTS_DIR).root.toLowerCase()) {
    const mirrorDir = path.join(resolvedJob, '..', '_fonts');
    if (!mirroredDirs.has(mirrorDir)) {
      try {
        fs.mkdirSync(mirrorDir, { recursive: true });
        for (const f of fs.readdirSync(FONTS_DIR)) {
          if (!/\.(ttf|otf)$/i.test(f)) continue;
          const dst = path.join(mirrorDir, f);
          if (!fs.existsSync(dst)) fs.copyFileSync(path.join(FONTS_DIR, f), dst);
        }
        mirroredDirs.add(mirrorDir);
      } catch (err) {
        console.warn(`[fonts] Impossible de synchroniser les polices vers ${mirrorDir} : ${err.message}`);
      }
    }
    if (mirroredDirs.has(mirrorDir)) targetDir = mirrorDir;
  }
  return path.relative(resolvedJob, targetDir) || '.';
}

module.exports = { FONTS_DIR, listFonts, getFont, parseFont, fontsRelFor };
