/**
 * États du projet avant chaque réponse de l'IA (pour « Annuler » et « reviens en
 * arrière »), gardés dans IndexedDB : ils survivent au rechargement de la page
 * sans encombrer le localStorage (un projet avec sous-titres pèse vite 100 Ko).
 */
import type { EditorProject } from '@shared/editorCore';

const DB_NAME = 'cliptok-ai';
const STORE = 'snapshots';
const MAX_PER_PROJECT = 20;

type Entry = { msgId: string; project: EditorProject };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Instantanés d'un projet (du plus ancien au plus récent). */
export async function loadSnapshots(projectId: string): Promise<Map<string, EditorProject>> {
  try {
    const list = ((await tx('readonly', (s) => s.get(projectId))) as Entry[] | undefined) || [];
    return new Map(list.map((e) => [e.msgId, e.project]));
  } catch {
    return new Map();
  }
}

/** Enregistre la liste (les plus anciens au-delà de la limite sont oubliés). */
export async function saveSnapshots(projectId: string, snapshots: Map<string, EditorProject>) {
  const list: Entry[] = [...snapshots.entries()].slice(-MAX_PER_PROJECT).map(([msgId, project]) => ({ msgId, project }));
  try {
    await tx('readwrite', (s) => s.put(list, projectId));
  } catch {
    // Stockage indisponible (navigation privée…) : l'annulation reste possible jusqu'au rechargement.
  }
}
