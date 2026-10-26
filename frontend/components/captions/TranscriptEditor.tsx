'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Replace, Trash2, Plus, Merge, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import type { TranscriptWord } from '@/lib/types';
import { NumberInput, formatTime } from '@/components/ui/controls';

interface Props {
  words: TranscriptWord[];
  onChange: (words: TranscriptWord[]) => void;
  currentTime: number;
  onSeek: (t: number) => void;
}

/** Regroupe les mots en paragraphes lisibles (fin de phrase ou silence > 0.8 s). */
function segment(words: TranscriptWord[]) {
  const groups: { start: number; indices: number[] }[] = [];
  let cur: number[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && cur.length > 0 && (w.start - prev.end > 0.8 || /[.!?…]$/.test(prev.text) || cur.length >= 30)) {
      groups.push({ start: words[cur[0]].start, indices: cur });
      cur = [];
    }
    cur.push(i);
  });
  if (cur.length) groups.push({ start: words[cur[0]].start, indices: cur });
  return groups;
}

export default function TranscriptEditor({ words, onChange, currentTime, onSeek }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [replace, setReplace] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const activeRef = useRef<HTMLSpanElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  const groups = useMemo(() => segment(words), [words]);
  const activeIndex = useMemo(() => {
    for (let i = 0; i < words.length; i++) if (currentTime >= words[i].start && currentTime < Math.max(words[i].end, words[i].start + 0.05)) return i;
    return -1;
  }, [words, currentTime]);

  const matches = useMemo(() => {
    if (!search.trim()) return new Set<number>();
    const needle = search.trim().toLowerCase();
    return new Set(words.map((w, i) => (w.text.toLowerCase().includes(needle) ? i : -1)).filter((i) => i >= 0));
  }, [words, search]);
  const lowConfidence = useMemo(() => words.filter((w) => (w.probability ?? 1) < 0.6).length, [words]);

  // Suivi automatique du mot en cours de lecture.
  useEffect(() => {
    if (!follow || !activeRef.current || !containerRef.current) return;
    const el = activeRef.current;
    const box = containerRef.current;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 40 || top > box.scrollTop + box.clientHeight - 60) {
      box.scrollTo({ top: top - box.clientHeight / 3, behavior: 'smooth' });
    }
  }, [activeIndex, follow]);

  const update = (i: number, patch: Partial<TranscriptWord>) => {
    const next = words.slice();
    next[i] = { ...next[i], ...patch, probability: 1 };
    onChange(next);
  };

  const commitEdit = () => {
    if (editing === null) return;
    const i = editing;
    const text = draft.trim();
    setEditing(null);
    if (!text) return removeWord(i);
    const parts = text.split(/\s+/);
    if (parts.length === 1) return update(i, { text });
    // Plusieurs mots saisis : on répartit la durée du mot d'origine.
    const w = words[i];
    const span = Math.max(0.05, w.end - w.start) / parts.length;
    const created = parts.map((p, k) => ({ ...w, text: p, start: w.start + k * span, end: w.start + (k + 1) * span, probability: 1 }));
    onChange([...words.slice(0, i), ...created, ...words.slice(i + 1)]);
  };

  const removeWord = (i: number) => {
    onChange(words.filter((_, k) => k !== i));
    setSelected(null);
  };

  const mergeWith = (i: number, j: number) => {
    const [a, b] = i < j ? [i, j] : [j, i];
    if (a < 0 || b >= words.length) return;
    const merged = { ...words[a], text: `${words[a].text} ${words[b].text}`, end: words[b].end, probability: 1 };
    onChange([...words.slice(0, a), merged, ...words.slice(b + 1)]);
    setSelected(a);
  };

  const insertAfter = (i: number) => {
    const w = words[i];
    const next = words[i + 1];
    const start = w.end;
    const end = next ? Math.max(start + 0.05, Math.min(next.start, start + 0.4)) : start + 0.4;
    const created = { text: 'mot', start, end, probability: 1 };
    onChange([...words.slice(0, i + 1), created, ...words.slice(i + 1)]);
    setSelected(i + 1);
    setEditing(i + 1);
    setDraft('mot');
  };

  const replaceAll = () => {
    if (!search.trim()) return;
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const test = new RegExp(escaped, 'i');
    const re = new RegExp(escaped, 'gi');
    onChange(words.map((w) => (test.test(w.text) ? { ...w, text: w.text.replace(re, replace), probability: 1 } : w)).filter((w) => w.text.trim()));
  };

  const sel = selected !== null ? words[selected] : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-col gap-2 pb-3 border-b border-white/5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un mot..."
              className="w-full bg-black/40 border border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs text-white outline-none focus:border-fuchsia-500"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowReplace((v) => !v)}
            className={`px-2.5 rounded-lg border text-xs ${showReplace ? 'border-fuchsia-500 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}
            title="Remplacer"
          >
            <Replace className="w-3.5 h-3.5" />
          </button>
        </div>
        {showReplace && (
          <div className="flex gap-2">
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="Remplacer par..."
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-fuchsia-500"
            />
            <button type="button" onClick={replaceAll} disabled={matches.size === 0} className="px-3 rounded-lg bg-white text-black text-xs font-bold disabled:opacity-40">
              Tout ({matches.size})
            </button>
          </div>
        )}
        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <span>
            {words.length} mots
            {lowConfidence > 0 && (
              <span className="ml-2 text-orange-400 inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {lowConfidence} à vérifier
              </span>
            )}
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-fuchsia-500" /> Suivre la lecture
          </label>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto py-3 pr-1 text-[15px] leading-8">
        {words.length === 0 && <p className="text-sm text-zinc-500">Aucun mot. Lancez la transcription.</p>}
        {groups.map((g, gi) => (
          <p key={gi} className="mb-3">
            <button type="button" onClick={() => onSeek(g.start)} className="text-[10px] font-mono text-zinc-600 hover:text-fuchsia-300 mr-2 align-middle">
              {formatTime(g.start)}
            </button>
            {g.indices.map((i) => {
              const w = words[i];
              if (editing === i) {
                return (
                  <input
                    key={i}
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    className="inline-block bg-fuchsia-500/20 border border-fuchsia-500 rounded px-1 mx-0.5 text-white outline-none"
                    style={{ width: `${Math.max(3, draft.length + 1)}ch` }}
                  />
                );
              }
              const isActive = i === activeIndex;
              const low = (w.probability ?? 1) < 0.6;
              // Pas d'espace avant une apostrophe, un trait d'union ou une ponctuation collée.
              const prev = words[i - 1];
              const glued = /^['’\-.,!?;:…)]/.test(w.text) || (prev && /['’\-(]$/.test(prev.text));
              return (
                <span key={i}>
                  {!glued && i !== g.indices[0] && ' '}
                <span
                  ref={isActive ? activeRef : undefined}
                  onClick={() => {
                    setSelected(i);
                    onSeek(w.start + 0.001);
                  }}
                  onDoubleClick={() => {
                    setEditing(i);
                    setDraft(w.text);
                  }}
                  title={`${w.start.toFixed(2)}s → ${w.end.toFixed(2)}s${low ? ' — faible confiance' : ''} (double-clic pour modifier)`}
                  className={`cursor-pointer rounded px-0.5 mx-[1px] transition-colors ${
                    isActive ? 'bg-fuchsia-500 text-white' : selected === i ? 'bg-white/15 text-white ring-1 ring-white/30' : matches.has(i) ? 'bg-yellow-400/25 text-yellow-100' : 'text-zinc-300 hover:bg-white/10'
                  } ${low ? 'underline decoration-dotted decoration-orange-400 underline-offset-4' : ''} ${w.loud ? 'font-semibold' : ''}`}
                >
                  {w.text}
                </span>
                </span>
              );
            })}
          </p>
        ))}
      </div>

      {sel && selected !== null && (
        <div className="border-t border-white/5 pt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white truncate flex-1">« {sel.text} »</span>
            <button type="button" onClick={() => mergeWith(selected, selected - 1)} disabled={selected === 0} className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30" title="Fusionner avec le mot précédent">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => mergeWith(selected, selected + 1)} disabled={selected >= words.length - 1} className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30" title="Fusionner avec le mot suivant">
              <Merge className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => insertAfter(selected)} className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10" title="Insérer un mot après">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => removeWord(selected)} className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10" title="Supprimer le mot">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-zinc-500 flex flex-col gap-1">
              Début (s)
              <NumberInput value={sel.start} onChange={(v) => update(selected, { start: Math.max(0, Math.min(v, sel.end - 0.01)) })} />
            </label>
            <label className="text-[11px] text-zinc-500 flex flex-col gap-1">
              Fin (s)
              <NumberInput value={sel.end} onChange={(v) => update(selected, { end: Math.max(sel.start + 0.01, v) })} />
            </label>
          </div>
          <button
            type="button"
            onClick={() => update(selected, { start: Math.max(0, currentTime), end: Math.max(currentTime + 0.05, sel.end) })}
            className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 self-start"
          >
            <ChevronRight className="w-3 h-3" /> Caler le début sur la tête de lecture
          </button>
        </div>
      )}
    </div>
  );
}
