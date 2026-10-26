/**
 * Fichiers à importer : dossiers glissés-déposés (parcourus récursivement),
 * filtrage des médias et captures d'écran collées (Ctrl+V).
 */
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react';
import { uploadMedia } from './api';
import type { Media } from './types';

const MEDIA_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|wmv|flv|mpg|mpeg|3gp|ts|mts|mp3|wav|m4a|aac|ogg|oga|opus|flac|wma|png|jpe?g|gif|webp|bmp|avif|heic|tiff?)$/i;

/** Garde les vidéos, sons et images (selon le type MIME ou l'extension). */
export function isMediaFile(file: File) {
  return /^(video|audio|image)\//.test(file.type) || MEDIA_EXT.test(file.name);
}

// Types minimaux de l'API « File and Directory Entries » (webkitGetAsEntry).
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (list: FsEntry[]) => void, err: (e: unknown) => void) => void };
}

async function readEntry(entry: FsEntry, out: File[], depth = 0): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((ok, err) => entry.file!(ok, err)).catch(() => null);
    if (file) out.push(file);
    return;
  }
  if (!entry.isDirectory || !entry.createReader || depth > 8) return;
  const reader = entry.createReader();
  // readEntries renvoie les entrées par paquets : on lit jusqu'à un paquet vide.
  for (;;) {
    const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err)).catch(() => []);
    if (batch.length === 0) break;
    for (const child of batch) await readEntry(child, out, depth + 1);
  }
}

/** Tous les fichiers médias d'un glisser-déposer, dossiers compris. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items || [])
    .map((item) => (item.kind === 'file' ? ((item as any).webkitGetAsEntry?.() as FsEntry | null) : null))
    .filter(Boolean) as FsEntry[];
  if (entries.length === 0) return Array.from(dt.files).filter(isMediaFile);
  const out: File[] = [];
  for (const entry of entries) await readEntry(entry, out);
  return out.filter(isMediaFile);
}

/** Images (captures d'écran) et fichiers d'un collage, renommés de façon lisible. */
export function filesFromPaste(e: ClipboardEvent | ReactClipboardEvent): File[] {
  const items = Array.from(e.clipboardData?.items || []);
  const stamp = new Date().toLocaleString('fr-FR').replace(/[/:]/g, '-').replace(/\s+/g, ' ');
  return items
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f && isMediaFile(f))
    .map((f, i) => (/^image\.(png|jpe?g)$/i.test(f.name) ? new File([f], `Capture ${stamp}${i ? ` (${i + 1})` : ''}.${f.type === 'image/jpeg' ? 'jpg' : 'png'}`, { type: f.type }) : f));
}

/** Le glisser contient-il des fichiers (et non un clip déplacé dans l'éditeur) ? */
export function dragHasFiles(e: DragEvent | ReactDragEvent) {
  return Array.from(e.dataTransfer?.types || []).includes('Files');
}

/** Où en est un envoi : de quoi afficher « 3/12 · clip.mp4 · 45/120 Mo · 18 Mo/s · ~6 s ». */
export interface UploadInfo {
  percent: number;
  loaded: number;
  total: number;
  done: number;
  count: number;
  /** Fichiers en cours d'envoi. */
  current: string[];
  /** Octets par seconde (moyenne glissante). */
  speed: number;
  /** Secondes restantes estimées (null au début). */
  eta: number | null;
  /** 'upload' : envoi ; 'processing' : tout est envoyé, le serveur analyse les derniers fichiers. */
  phase: 'upload' | 'processing';
}

const CONCURRENCY = 3;

/**
 * Envoi fichier par fichier, 3 en parallèle : chaque fichier apparaît dès qu'il
 * est prêt (onEach) au lieu d'attendre tout un paquet, et la progression
 * détaillée (fichier courant, Mo, vitesse, temps restant) est remontée.
 */
export async function uploadMany(files: File[], onProgress?: (percent: number, info: UploadInfo) => void, onEach?: (media: Media[]) => void) {
  const media: Media[] = [];
  const errors: { name: string; error: string }[] = [];
  const total = files.reduce((acc, f) => acc + f.size, 0) || 1;
  const loadedBy = new Map<number, number>();
  const active = new Set<number>();
  let done = 0;
  let next = 0;
  const t0 = performance.now();
  let lastEmit = 0;

  const emit = (force = false) => {
    const now = performance.now();
    if (!force && now - lastEmit < 150) return;
    lastEmit = now;
    const loaded = [...loadedBy.values()].reduce((a, b) => a + b, 0);
    const elapsed = (now - t0) / 1000;
    const speed = elapsed > 0.3 ? loaded / elapsed : 0;
    const allSent = loaded >= total;
    onProgress?.(Math.min(100, (loaded / total) * 100), {
      percent: Math.min(100, (loaded / total) * 100),
      loaded,
      total,
      done,
      count: files.length,
      current: [...active].map((i) => files[i].name),
      speed,
      eta: speed > 0 && !allSent ? (total - loaded) / speed : null,
      phase: allSent ? 'processing' : 'upload',
    });
  };

  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const file = files[i];
      active.add(i);
      emit(true);
      try {
        const res = await uploadMedia([file], (pct) => {
          loadedBy.set(i, (file.size * pct) / 100);
          emit();
        });
        media.push(...res.media);
        errors.push(...(res.errors || []));
        if (res.media.length) onEach?.(res.media);
      } catch (err: any) {
        errors.push(...(err?.errors || [{ name: file.name, error: err?.message || 'Échec de l’envoi' }]));
      }
      loadedBy.set(i, file.size);
      active.delete(i);
      done += 1;
      emit(true);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  return { media, errors };
}

const MB = 1024 * 1024;

/** Texte de progression : « 3/12 · clip.mp4 · 45 / 120 Mo · 18 Mo/s · ~6 s ». */
export function describeUpload(info: UploadInfo | null) {
  if (!info) return '';
  const size = (b: number) => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(1)} Go` : `${(b / MB).toFixed(b < 10 * MB ? 1 : 0)} Mo`);
  const eta = info.eta === null ? '' : info.eta < 60 ? ` · ~${Math.max(1, Math.round(info.eta))} s` : ` · ~${Math.round(info.eta / 60)} min`;
  if (info.phase === 'processing') return `Analyse des fichiers… ${info.done}/${info.count}`;
  return `${Math.min(info.done + 1, info.count)}/${info.count} · ${size(info.loaded)} / ${size(info.total)}${info.speed ? ` · ${size(info.speed)}/s` : ''}${eta}`;
}
