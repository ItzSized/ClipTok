'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UploadCloud, Loader2, FolderOpen } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import { describeUpload, filesFromDrop, isMediaFile, uploadMany, type UploadInfo } from '@/lib/mediaFiles';
import type { Media } from '@/lib/types';

interface Props {
  accept?: string;
  multiple?: boolean;
  onUploaded: (media: Media[]) => void;
  title?: string;
  subtitle?: string;
  compact?: boolean;
  children?: ReactNode;
}

/** Zone de dépôt de fichiers (et de dossiers entiers) avec progression d'envoi. */
export default function UploadDropzone({ accept = 'video/*,audio/*,image/*', multiple = true, onUploaded, title, subtitle, compact, children }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const activeBatches = useRef(0);
  const { showToast } = useToast();

  // `webkitdirectory` n'est pas typé par React : posé directement sur l'élément.
  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const send = async (list: FileList | File[]) => {
    let files = Array.from(list).filter(isMediaFile);
    if (!multiple) files = files.slice(0, 1);
    if (files.length === 0) {
      if (Array.from(list).length) showToast({ type: 'error', message: 'Aucune vidéo, image ou son trouvé.' });
      return;
    }
    // Un envoi déjà en cours : les nouveaux fichiers rejoignent la file (progression commune).
    activeBatches.current += 1;
    if (activeBatches.current === 1) {
      setProgress(0);
      setInfo(null);
    }
    try {
      // Chaque fichier est transmis dès qu'il est prêt (il apparaît tout de suite dans la liste).
      const { media, errors } = await uploadMany(
        files,
        (pct, i) => {
          setProgress(pct);
          setInfo(i);
        },
        onUploaded
      );
      errors.slice(0, 5).forEach((e) => showToast({ type: 'error', message: `${e.name} : ${e.error}` }));
      if (files.length > 1 && media.length) showToast({ type: 'success', message: `${media.length} fichier(s) importé(s).` });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || "Échec de l'envoi." });
    } finally {
      activeBatches.current -= 1;
      if (activeBatches.current === 0) {
        setProgress(null);
        setInfo(null);
      }
    }
  };

  /** Fichiers choisis : copiés puis le champ est vidé tout de suite (on peut re-choisir pendant l'envoi). */
  const pick = (input: HTMLInputElement) => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length) send(files);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        send(await filesFromDrop(e.dataTransfer));
      }}
      className={`border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
        compact ? 'p-4 gap-1' : 'p-10 gap-2'
      } ${dragging ? 'border-fuchsia-500 bg-fuchsia-500/10 scale-[1.01]' : 'border-white/15 bg-black/20 hover:bg-white/5 hover:border-white/30'}`}
    >
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => pick(e.target)} />
      <input ref={folderRef} type="file" multiple className="hidden" onChange={(e) => pick(e.target)} />
      {progress !== null ? (
        <>
          <Loader2 className={`${compact ? 'w-5 h-5' : 'w-8 h-8'} text-fuchsia-400 animate-spin`} />
          <p className={`font-bold text-white ${compact ? 'text-xs' : 'text-sm'}`}>{info?.phase === 'processing' ? 'Analyse…' : `${Math.round(progress)} %`}</p>
          <div className="w-full max-w-xs h-1 bg-black/50 rounded-full overflow-hidden">
            <div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          {info && (
            <>
              <p className={`text-zinc-400 leading-tight ${compact ? 'text-[9px]' : 'text-xs'}`}>{describeUpload(info)}</p>
              {info.current[0] && <p className={`text-zinc-500 truncate max-w-full ${compact ? 'text-[9px]' : 'text-[11px]'}`} title={info.current.join(', ')}>{info.current[0]}</p>}
            </>
          )}
          {multiple && <p className={`text-fuchsia-300/70 ${compact ? 'text-[9px]' : 'text-[11px]'}`}>+ cliquez ou déposez pour en ajouter</p>}
        </>
      ) : (
        <>
          {children || (
            <>
              <UploadCloud className={`${compact ? 'w-5 h-5' : 'w-10 h-10'} text-zinc-500`} />
              <p className={`font-bold text-white ${compact ? 'text-xs' : 'text-lg'}`}>{title || 'Déposez vos fichiers ici'}</p>
              {subtitle && <p className={`text-zinc-500 ${compact ? 'text-[10px]' : 'text-sm'}`}>{subtitle}</p>}
            </>
          )}
          {multiple && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                folderRef.current?.click();
              }}
              className={`flex items-center gap-1 rounded-full border border-white/10 hover:border-white/30 text-zinc-400 hover:text-white ${compact ? 'mt-0.5 px-2 py-0.5 text-[10px]' : 'mt-2 px-3 py-1 text-xs'}`}
              title="Importer tout un dossier (sous-dossiers compris)"
            >
              <FolderOpen className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} /> Dossier
            </button>
          )}
        </>
      )}
    </div>
  );
}
