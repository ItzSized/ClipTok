const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_FILE = DB_FILE + '.bak';

const COLLECTIONS = ['clips', 'projects', 'users', 'teams', 'media', 'captionProjects', 'editorProjects', 'aiMemory'];

/*
 * La base est un simple fichier JSON, gardé en mémoire.
 * Les anciennes versions relisaient le fichier à chaque requête et écrivaient
 * sans verrou : deux requêtes simultanées (ex. "Tout supprimer") lisaient un
 * fichier en cours d'écriture -> db.json corrompu. Désormais :
 *   - l'état vit en mémoire (lectures instantanées et cohérentes) ;
 *   - chaque modification passe par `mutate`, exécutée l'une après l'autre ;
 *   - l'écriture est atomique (fichier temporaire puis rename) ;
 *   - une copie .bak du dernier état sain permet de récupérer en cas de souci.
 */
let state = null;
let lock = Promise.resolve();

function normalize(data) {
  const out = data && typeof data === 'object' ? data : {};
  for (const key of COLLECTIONS) if (!Array.isArray(out[key])) out[key] = [];
  return out;
}

async function tryLoad(file) {
  const raw = await fs.readFile(file, 'utf-8');
  return normalize(JSON.parse(raw));
}

async function initDB() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    state = await tryLoad(DB_FILE);
    await fs.copyFile(DB_FILE, BACKUP_FILE).catch(() => {});
  } catch (err) {
    if (err.code === 'ENOENT') {
      state = normalize({});
    } else {
      console.error('[DB] db.json illisible :', err.message);
      await fs.copyFile(DB_FILE, `${DB_FILE}.corrupted.${Date.now()}`).catch(() => {});
      try {
        state = await tryLoad(BACKUP_FILE);
        console.warn('[DB] État restauré depuis db.json.bak.');
      } catch {
        state = normalize({});
      }
    }
    await persist();
  }
}

async function persist() {
  const tmpFile = DB_FILE + '.tmp';
  await fs.writeFile(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rename(tmpFile, DB_FILE);
      return;
    } catch (err) {
      // Windows : un antivirus/indexeur peut verrouiller brièvement le fichier.
      if (attempt === 4) {
        await fs.copyFile(tmpFile, DB_FILE);
        await fs.unlink(tmpFile).catch(() => {});
        return;
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

function ensureLoaded() {
  if (!state) throw new Error('Base de données non initialisée (initDB() doit être appelé au démarrage).');
  return state;
}

/** Exécute `fn(state)` en exclusivité puis persiste. Retourne le résultat de `fn`. */
function mutate(fn) {
  const run = lock.then(async () => {
    const db = ensureLoaded();
    const result = await fn(db);
    await persist();
    return result;
  });
  lock = run.catch((err) => console.error('[DB] Erreur écriture :', err));
  return run;
}

function read(fn) {
  return Promise.resolve(fn(ensureLoaded()));
}

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const byDateDesc = (field) => (a, b) => new Date(b[field] || 0) - new Date(a[field] || 0);

// ----------------- CLIPS -----------------

async function getClips() {
  return read((db) => clone(db.clips).sort(byDateDesc('createdAt')));
}

async function addClips(newClips, projectId) {
  return mutate((db) => {
    const now = new Date().toISOString();
    const withIds = newClips.map((c) => ({ ...c, id: c.id || uuidv4(), createdAt: c.createdAt || now }));
    const project = projectId ? db.projects.find((p) => p.id === projectId) : null;
    if (project) project.clips = [...withIds, ...(project.clips || [])];
    else db.clips = [...withIds, ...db.clips];
    return clone(withIds);
  });
}

/** Retrouve un clip où qu'il soit (liste globale ou projet). */
async function findClip(clipId) {
  return read((db) => {
    const inGlobal = db.clips.find((c) => c.id === clipId);
    if (inGlobal) return clone(inGlobal);
    for (const p of db.projects) {
      const c = (p.clips || []).find((x) => x.id === clipId);
      if (c) return clone(c);
    }
    return null;
  });
}

// ----------------- PROJECTS -----------------

async function getProjects() {
  return read((db) => clone(db.projects).sort(byDateDesc('createdAt')));
}

async function getProject(id) {
  return read((db) => clone(db.projects.find((p) => p.id === id)) || null);
}

async function createProject(name) {
  return mutate((db) => {
    const project = { id: uuidv4(), name: name || 'Nouveau Projet', createdAt: new Date().toISOString(), clips: [] };
    db.projects.push(project);
    return clone(project);
  });
}

async function renameProject(id, name) {
  return mutate((db) => {
    const project = db.projects.find((p) => p.id === id);
    if (!project) return null;
    project.name = name || project.name;
    return clone(project);
  });
}

async function deleteProject(id) {
  return mutate((db) => {
    const index = db.projects.findIndex((p) => p.id === id);
    if (index === -1) return null;
    const [removed] = db.projects.splice(index, 1);
    return removed;
  });
}

/** Retire le clip de sa liste actuelle (clips globaux ou un projet) et le retourne. */
function extractClipLocally(db, clipId) {
  let index = db.clips.findIndex((c) => c.id === clipId);
  if (index !== -1) return db.clips.splice(index, 1)[0];
  for (const project of db.projects) {
    index = (project.clips || []).findIndex((c) => c.id === clipId);
    if (index !== -1) return project.clips.splice(index, 1)[0];
  }
  return null;
}

async function deleteClip(clipId) {
  return mutate((db) => extractClipLocally(db, clipId));
}

async function deleteClips(clipIds) {
  return mutate((db) => clipIds.map((id) => extractClipLocally(db, id)).filter(Boolean));
}

async function moveClipToProject(clipId, targetProjectId) {
  return mutate((db) => {
    const clip = extractClipLocally(db, clipId);
    if (!clip) return null;
    const project = targetProjectId ? db.projects.find((p) => p.id === targetProjectId) : null;
    if (project) {
      if (!project.clips) project.clips = [];
      project.clips.unshift(clip);
    } else {
      db.clips.unshift(clip);
    }
    return clone(clip);
  });
}

// ----------------- USERS -----------------

async function createUser(email, passwordHash, name) {
  return mutate((db) => {
    const user = {
      id: uuidv4(),
      email: email.toLowerCase(),
      password: passwordHash,
      name: name || 'Utilisateur',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name || email)}`,
      language: 'fr',
      bio: '',
      teamId: null,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    return clone(user);
  });
}

async function getUserByEmail(email) {
  const needle = String(email || '').toLowerCase();
  return read((db) => clone(db.users.find((u) => u.email.toLowerCase() === needle)) || null);
}

async function getUserByIdentifier(identifier) {
  const needle = String(identifier || '').toLowerCase();
  return read(
    (db) => clone(db.users.find((u) => u.email.toLowerCase() === needle || (u.name && u.name.toLowerCase() === needle))) || null
  );
}

async function getUserById(id) {
  return read((db) => clone(db.users.find((u) => u.id === id)) || null);
}

async function updateUser(id, updates) {
  return mutate((db) => {
    const user = db.users.find((u) => u.id === id);
    if (!user) return null;
    Object.assign(user, updates);
    return clone(user);
  });
}

// ----------------- TEAMS -----------------

async function createTeam(name, ownerId) {
  return mutate((db) => {
    const team = {
      id: uuidv4(),
      name: name || 'Nouvelle Équipe',
      ownerId,
      inviteToken: Math.random().toString(36).substring(2, 10).toUpperCase(),
      createdAt: new Date().toISOString(),
    };
    db.teams.push(team);
    const owner = db.users.find((u) => u.id === ownerId);
    if (owner) owner.teamId = team.id;
    return clone(team);
  });
}

async function getTeamById(id) {
  return read((db) => clone(db.teams.find((t) => t.id === id)) || null);
}

async function getTeamByToken(token) {
  return read((db) => clone(db.teams.find((t) => t.inviteToken === token)) || null);
}

async function getTeamMembers(teamId) {
  return read((db) =>
    db.users.filter((u) => u.teamId === teamId).map((u) => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar }))
  );
}

// ----------------- GENERIC DOCUMENT COLLECTIONS -----------------
// media (fichiers importés), captionProjects (sous-titres), editorProjects (éditeur vidéo)

function listDocs(collection) {
  return read((db) => clone(db[collection]).sort(byDateDesc('updatedAt')));
}

function getDoc(collection, id) {
  return read((db) => clone(db[collection].find((d) => d.id === id)) || null);
}

function createDoc(collection, doc) {
  return mutate((db) => {
    const now = new Date().toISOString();
    const created = { id: uuidv4(), createdAt: now, updatedAt: now, ...doc };
    db[collection].push(created);
    return clone(created);
  });
}

function updateDoc(collection, id, updates) {
  return mutate((db) => {
    const doc = db[collection].find((d) => d.id === id);
    if (!doc) return null;
    Object.assign(doc, updates, { id, updatedAt: new Date().toISOString() });
    return clone(doc);
  });
}

function deleteDoc(collection, id) {
  return mutate((db) => {
    const index = db[collection].findIndex((d) => d.id === id);
    if (index === -1) return null;
    return db[collection].splice(index, 1)[0];
  });
}

module.exports = {
  initDB,
  getClips,
  addClips,
  findClip,
  deleteClip,
  deleteClips,
  getProjects,
  getProject,
  createProject,
  renameProject,
  deleteProject,
  moveClipToProject,
  createUser,
  getUserByEmail,
  getUserByIdentifier,
  getUserById,
  updateUser,
  createTeam,
  getTeamById,
  getTeamByToken,
  getTeamMembers,
  listDocs,
  getDoc,
  createDoc,
  updateDoc,
  deleteDoc,
};
