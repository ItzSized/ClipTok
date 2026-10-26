'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Send,
  Loader2,
  Undo2,
  Check,
  AlertTriangle,
  Square,
  Bot,
  Globe,
  ExternalLink,
  History,
  SquarePen,
  Paperclip,
  Trash2,
  ChevronDown,
  Film,
  Captions,
  Scissors,
  Music,
  Wand2,
  Clapperboard,
  Brain,
  Plus,
  Gauge,
} from 'lucide-react';
import type { EditorProject } from '@shared/editorCore';
import { useEditorStore } from '../store';
import { useEngine } from '../engineContext';
import { buildAiContext, applyAiActions } from '../aiActions';
import { addAiMemory, aiEdit, deleteAiMemory, describeMedia, getAiMemory, getSfx, listMedia, type AiMemory, type AiSearch } from '@/lib/api';
import { AiModelPicker, useAiPrefs } from '@/components/ai-editor/AiModelPicker';
import AiUsagePanel from '@/components/ai-editor/AiUsagePanel';
import { getJSON, setJSON } from '@/lib/storage';
import { describeUpload, uploadMany, type UploadInfo } from '@/lib/mediaFiles';
import type { Media, SfxItem } from '@/lib/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** Fichiers joints au message (noms). */
  files?: string[];
  done?: string[];
  warnings?: string[];
  provider?: string;
  searches?: AiSearch[];
  /** Souvenirs ajoutés / retirés par l'IA pendant cette réponse. */
  remembered?: string[];
  forgotten?: number;
  undone?: boolean;
  error?: boolean;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const SUGGESTIONS: { icon: typeof Film; label: string; prompt: string }[] = [
  { icon: Clapperboard, label: 'Monter mes clips', prompt: 'Monte une vidéo dynamique avec tous mes clips, avec des transitions et un titre accrocheur' },
  { icon: Film, label: 'B-roll automatique', prompt: 'Illustre ce que je dis avec mes clips et captures (B-roll automatique)' },
  { icon: Captions, label: 'Sous-titres', prompt: 'Génère des sous-titres style Hormozi' },
  { icon: Scissors, label: 'Couper les silences', prompt: 'Coupe les silences de la vidéo' },
  { icon: Music, label: 'Whoosh aux transitions', prompt: 'Ajoute un whoosh à chaque transition' },
  { icon: Wand2, label: 'Style cinéma', prompt: 'Donne un style cinéma à toute la vidéo' },
];

const MAX_SESSIONS = 40;
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Historique des discussions d'un projet (navigateur). */
function storageKey(projectId: string) {
  return `cliptok:ai-chats:${projectId}`;
}

function relativeDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function AIPanel({
  projectId,
  initialPrompt,
  selectedMediaIds = [],
  onFilesAdded,
}: {
  projectId: string;
  initialPrompt?: string;
  selectedMediaIds?: string[];
  /** Fichiers importés depuis le chat (pour les afficher dans la médiathèque). */
  onFilesAdded?: (media: Media[]) => void;
}) {
  const store = useEditorStore();
  const engine = useEngine();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<'chat' | 'history' | 'memory' | 'usage'>('chat');
  const [memory, setMemory] = useState<AiMemory[]>([]);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [attached, setAttached] = useState<Media[]>([]);
  const [uploadInfo, setUploadInfo] = useState<UploadInfo | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const ai = useAiPrefs();
  const { providers } = ai;
  const { mode, webSearch } = ai.prefs;
  const abortRef = useRef<AbortController | null>(null);
  const sfxRef = useRef<SfxItem[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoSent = useRef(false);
  // États du projet avant chaque réponse (pour « Annuler ») : gardés en mémoire seulement (trop lourds à stocker).
  const snapshots = useRef(new Map<string, EditorProject>());

  const current = sessions.find((s) => s.id === currentId) || null;
  const messages = current?.messages || [];

  useEffect(() => {
    getAiMemory().then(setMemory).catch(() => { });
  }, []);

  // Chargement de l'historique du projet.
  useEffect(() => {
    const saved = getJSON<{ sessions?: ChatSession[]; currentId?: string | null }>(storageKey(projectId), {});
    setSessions(saved.sessions || []);
    setCurrentId(saved.currentId ?? null);
    setLoaded(true);
  }, [projectId]);

  useEffect(() => {
    if (loaded) setJSON(storageKey(projectId), { sessions: sessions.slice(0, MAX_SESSIONS), currentId });
  }, [sessions, currentId, loaded, projectId]);

  // Toute frappe hors d'un champ de saisie est redirigée vers la zone de discussion.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      setView('chat');
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, status, view]);

  // Zone de saisie qui s'agrandit avec le texte.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [input]);

  const configured = (providers || []).filter((p) => p.configured);

  /** Ajoute un message à la discussion (créée au besoin) ; retourne l'id de la discussion. */
  const push = (sessionId: string | null, msg: ChatMessage) => {
    const id = sessionId || newId();
    setSessions((list) => {
      const existing = list.find((s) => s.id === id);
      if (!existing) {
        const title = msg.role === 'user' ? msg.content.slice(0, 60) : 'Nouvelle discussion';
        return [{ id, title, createdAt: msg.at, updatedAt: msg.at, messages: [msg] }, ...list];
      }
      const updated = { ...existing, updatedAt: msg.at, messages: [...existing.messages, msg].slice(-200) };
      return [updated, ...list.filter((s) => s.id !== id)];
    });
    return id;
  };

  /** fresh : nouvelle discussion (demande initiale venue de « Créer avec l'IA »). */
  const send = async (text: string, fresh = false) => {
    const files = attached;
    const typed = text.trim();
    if ((!typed && files.length === 0) || busy || uploadingFiles) return;
    const focusIds = [...new Set([...selectedMediaIds, ...files.map((f) => f.id)])];
    setInput('');
    setAttached([]);
    setView('chat');
    const history = fresh ? [] : messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    const sessionId = push(fresh ? null : currentId, { id: newId(), role: 'user', content: typed || 'Voici des fichiers.', files: files.map((f) => f.name), at: Date.now() });
    setCurrentId(sessionId);
    setBusy(true);
    setStatus(mode === 'max' ? 'Analyse approfondie (peut prendre une minute)…' : webSearch ? 'L’IA réfléchit (et cherche sur le web si besoin)…' : 'L’IA réfléchit…');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let [media, sfx] = await Promise.all([listMedia(), sfxRef.current ? Promise.resolve(sfxRef.current) : getSfx()]);
      sfxRef.current = sfx;
      // Garantit que les fichiers tout juste joints au message figurent bien dans la liste envoyée à l'IA.
      for (const f of files) {
        if (!media.some((m) => m.id === f.id)) media = [f, ...media];
      }
      // Les médias sélectionnés pas encore « vus » par l'IA sont analysés d'abord.
      const unseen = media.filter((m) => focusIds.includes(m.id) && m.kind !== 'audio' && !m.vision).map((m) => m.id);
      if (unseen.length) {
        setStatus(`L’IA regarde vos médias (${unseen.length})…`);
        const { media: seen } = await describeMedia(unseen, controller.signal).catch(() => ({ media: [] as typeof media }));
        const byId = new Map(seen.map((m) => [m.id, m]));
        media = media.map((m) => byId.get(m.id) || m);
      }
      const mem = await getAiMemory().catch(() => memory);
      const { context, aliases } = buildAiContext(store, engine, media, sfx, focusIds, mem);
      // Les fichiers joints sont signalés à l'IA avec leurs identifiants mX exacts.
      const attachedDesc = files
        .map((f) => {
          const alias = aliases.mediaById.get(f.id);
          return `${alias ? `${alias} ` : ''}"${f.name}" (${f.kind})`;
        })
        .join(', ');
      const request = files.length ? `${typed || 'Voici des fichiers.'}\n\n(Fichiers joints à ce message : ${attachedDesc})` : typed;
      const res = await aiEdit({ request, history, context, ...ai.request, webSearch }, controller.signal);
      // Mémoire : souvenirs demandés par l'IA (médias en alias « m3 » → vrais médias).
      const remembered: string[] = [];
      for (const r of res.remember || []) {
        const cleanText = r.text
          .replace(/\b(m\d+)\b/g, (match) => aliases.media.get(match)?.name || match)
          .replace(/\s*\(\s*m\d+(?:\s*[-àa]\s*m\d+)?\s*\)/gi, '')
          .trim();
        if (!cleanText || mem.some((k) => k.text.trim().toLowerCase() === cleanText.toLowerCase())) continue;
        const fromAliases = r.media.map((a) => aliases.media.get(a) || [...aliases.media.values()].find((m) => m.name.toLowerCase() === a.toLowerCase())).filter(Boolean) as Media[];
        const linkedMedia = fromAliases.length ? fromAliases : files;
        const linked = linkedMedia.map((m) => ({ id: m.id, name: m.name }));
        try {
          await addAiMemory({ text: cleanText, media: linked });
          remembered.push(cleanText);
        } catch { }
      }
      let forgotten = 0;
      for (const k of res.forget || []) {
        const id = aliases.memory.get(k);
        if (id && (await deleteAiMemory(id).then(() => true).catch(() => false))) forgotten += 1;
      }
      if (remembered.length || forgotten) getAiMemory().then(setMemory).catch(() => { });
      const snapshot = JSON.parse(JSON.stringify(store.getState().project)) as EditorProject;
      setStatus(res.actions.length ? `Application de ${res.actions.length} action(s)…` : '');
      const result = await applyAiActions(store, engine, res.actions, aliases, sfx, (msg) => setStatus(msg), ai.request);
      const id = newId();
      if (result.done.length) snapshots.current.set(id, snapshot);
      push(sessionId, {
        id,
        role: 'assistant',
        at: Date.now(),
        content: res.reply || (result.done.length ? 'C’est fait !' : 'Je n’ai rien modifié.'),
        done: result.done,
        warnings: result.warnings,
        provider: `${res.provider} · ${res.model}`,
        searches: res.searches,
        remembered,
        forgotten,
      });
    } catch (err: any) {
      push(sessionId, { id: newId(), role: 'assistant', at: Date.now(), content: controller.signal.aborted ? 'Demande annulée.' : err.message || 'Erreur inconnue.', error: true });
    } finally {
      setBusy(false);
      setStatus('');
      abortRef.current = null;
    }
  };

  // Démarrage depuis « Créer avec l'IA » : la demande initiale part dans une nouvelle discussion.
  useEffect(() => {
    if (initialPrompt && providers && loaded && !autoSent.current) {
      autoSent.current = true;
      send(initialPrompt, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, providers, loaded]);

  const undo = (msgId: string) => {
    const snapshot = snapshots.current.get(msgId);
    if (!snapshot) return;
    store.update((p) => {
      Object.assign(p, JSON.parse(JSON.stringify(snapshot)));
    });
    snapshots.current.delete(msgId);
    setSessions((list) => list.map((s) => (s.id !== currentId ? s : { ...s, messages: s.messages.map((m) => (m.id === msgId ? { ...m, undone: true } : m)) })));
  };

  const newChat = () => {
    if (busy) return;
    setCurrentId(null);
    setView('chat');
    inputRef.current?.focus();
  };

  const removeSession = (id: string) => {
    setSessions((list) => list.filter((s) => s.id !== id));
    if (id === currentId) setCurrentId(null);
  };


  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950">
      {/* En-tête : discussion courante, historique, nouvelle discussion, réglages */}
      <div className="flex items-center gap-1 px-3 h-11 border-b border-white/5 flex-shrink-0">
        <button
          onClick={() => setView(view === 'history' ? 'chat' : 'history')}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left rounded-lg px-2 py-1 hover:bg-white/5"
          title="Historique des discussions"
        >
          <span className="text-sm font-bold text-white truncate">{view === 'history' ? 'Historique' : view === 'memory' ? 'Mémoire de l’IA' : view === 'usage' ? 'Usage & clés' : current?.title || 'Nouvelle discussion'}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 flex-shrink-0 transition-transform ${view === 'history' ? 'rotate-180' : ''}`} />
        </button>
        <button onClick={() => setView(view === 'history' ? 'chat' : 'history')} className={`w-8 h-8 rounded-lg flex items-center justify-center ${view === 'history' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`} title="Historique">
          <History className="w-4 h-4" />
        </button>
        <button onClick={() => setView(view === 'usage' ? 'chat' : 'usage')} className={`w-8 h-8 rounded-lg flex items-center justify-center ${view === 'usage' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`} title="Usage des IA et clés">
          <Gauge className="w-4 h-4" />
        </button>
        <button onClick={() => setView(view === 'memory' ? 'chat' : 'memory')} className={`w-8 h-8 rounded-lg flex items-center justify-center ${view === 'memory' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`} title="Mémoire de l'IA">
          <Brain className="w-4 h-4" />
        </button>
        <button onClick={newChat} disabled={busy} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5 disabled:opacity-40" title="Nouvelle discussion">
          <SquarePen className="w-4 h-4" />
        </button>
      </div>

      {/* Choix de l'IA : un seul menu (avancé replié). */}
      <div className="px-3 py-2 border-b border-white/5 flex-shrink-0">
        <AiModelPicker ai={ai} />
      </div>

      {view === 'usage' ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <AiUsagePanel compact />
        </div>
      ) : view === 'memory' ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Ce que l’IA retient pour tous tes projets : préférences, tes propres sons et musiques, ton style… Dis-lui simplement « retiens que… » dans le chat, ou ajoute un souvenir ici.
          </p>
          <div className="flex items-end gap-2 bg-white/[0.04] border border-white/10 rounded-xl p-2 focus-within:border-fuchsia-500/70">
            <textarea
              value={memoryDraft}
              onChange={(e) => setMemoryDraft(e.target.value)}
              rows={2}
              placeholder="Ex. : toujours mettre la musique Wii Party en fond à 20 %"
              className="flex-1 bg-transparent text-xs text-white outline-none resize-none placeholder-zinc-600"
            />
            <button
              onClick={async () => {
                const text = memoryDraft.trim();
                if (!text) return;
                // Les médias cochés sont associés au souvenir.
                const all = await listMedia().catch(() => []);
                const linked = all.filter((m) => selectedMediaIds.includes(m.id)).map((m) => ({ id: m.id, name: m.name }));
                await addAiMemory({ text, media: linked }).catch(() => null);
                setMemoryDraft('');
                getAiMemory().then(setMemory).catch(() => { });
              }}
              disabled={!memoryDraft.trim()}
              className="w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white flex items-center justify-center disabled:opacity-30 flex-shrink-0"
              title="Ajouter (les médias cochés y sont associés)"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {selectedMediaIds.length > 0 && <p className="text-[10px] text-fuchsia-300/80">Les {selectedMediaIds.length} média(s) coché(s) seront associés au souvenir.</p>}
          {memory.length === 0 && <p className="text-center text-[11px] text-zinc-600 py-6">Aucun souvenir pour l’instant.</p>}
          {memory.map((k) => (
            <div key={k.id} className="group rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="flex items-start gap-2">
                <Brain className="w-3.5 h-3.5 text-fuchsia-300 mt-0.5 flex-shrink-0" />
                <p className="flex-1 text-xs text-zinc-200 leading-relaxed">{k.text}</p>
                <button
                  onClick={async () => {
                    await deleteAiMemory(k.id).catch(() => null);
                    setMemory((list) => list.filter((x) => x.id !== k.id));
                  }}
                  className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"
                  title="Oublier"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              {k.media.length > 0 && (
                <div className="mt-1.5 ml-5 flex flex-wrap gap-1">
                  {k.media.map((m) => (
                    <span key={m.id} className="text-[10px] text-zinc-400 bg-white/5 border border-white/10 rounded-full px-2 py-0.5 max-w-[160px] truncate" title={m.name}>
                      {m.name}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-1 ml-5 text-[9px] text-zinc-600">{relativeDate(new Date(k.createdAt).getTime())}</p>
            </div>
          ))}
        </div>
      ) : view === 'history' ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
          <button onClick={newChat} disabled={busy} className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-white/15 text-xs font-semibold text-zinc-300 hover:text-white hover:border-white/30 disabled:opacity-40">
            <SquarePen className="w-3.5 h-3.5" /> Nouvelle discussion
          </button>
          {sessions.length === 0 && <p className="text-center text-[11px] text-zinc-600 py-8">Aucune discussion pour ce projet.</p>}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-2 rounded-xl px-3 py-2 cursor-pointer ${s.id === currentId ? 'bg-fuchsia-500/10 border border-fuchsia-500/30' : 'border border-transparent hover:bg-white/5'}`}
              onClick={() => {
                if (busy) return;
                setCurrentId(s.id);
                setView('chat');
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-200 truncate">{s.title}</p>
                <p className="text-[10px] text-zinc-500">
                  {relativeDate(s.updatedAt)} · {s.messages.length} message{s.messages.length > 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeSession(s.id);
                }}
                className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                title="Supprimer la discussion"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-4">
          {providers && configured.length === 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200 leading-relaxed">
              Aucune IA gratuite n’est configurée. Ajoutez au moins une clé dans <code>backend/.env</code> : <b>GEMINI_API_KEY</b> (aistudio.google.com), <b>GROQ_API_KEY</b>, <b>OPENROUTER_API_KEY</b>,{' '}
              <b>MISTRAL_API_KEY</b>, <b>CEREBRAS_API_KEY</b>, ou installez Ollama (<b>OLLAMA_MODEL</b>).
            </div>
          )}

          {messages.length === 0 && !busy && (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 py-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center shadow-lg shadow-fuchsia-500/20">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Que veux-tu monter ?</p>
                <p className="text-[11px] text-zinc-500 mt-1 max-w-[260px]">Décris ce que tu veux : clips, sons, textes, transitions, sous-titres… Chaque réponse s’annule en un clic.</p>
              </div>
              <div className="grid grid-cols-2 gap-1.5 w-full">
                {SUGGESTIONS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.label}
                      onClick={() => send(s.prompt)}
                      title={s.prompt}
                      className="flex items-center gap-2 text-left text-[11px] font-medium text-zinc-300 bg-white/[0.04] hover:bg-white/10 border border-white/10 rounded-xl px-2.5 py-2"
                    >
                      <Icon className="w-3.5 h-3.5 text-fuchsia-300 flex-shrink-0" />
                      <span className="truncate">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="self-end max-w-[85%] bg-gradient-to-br from-fuchsia-600/80 to-fuchsia-500/60 text-white text-xs leading-relaxed rounded-2xl rounded-br-md px-3 py-2 whitespace-pre-wrap shadow">
                {m.content}
                {m.files && m.files.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.files.map((f) => (
                      <span key={f} className="inline-flex items-center gap-1 max-w-[180px] text-[10px] bg-black/25 rounded-full px-2 py-0.5">
                        <Paperclip className="w-2.5 h-2.5 flex-shrink-0" /> <span className="truncate">{f}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div key={m.id} className="flex items-start gap-2 max-w-full">
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${m.error ? 'bg-red-500/20' : 'bg-gradient-to-br from-fuchsia-500 to-orange-400'}`}>
                  {m.error ? <AlertTriangle className="w-3.5 h-3.5 text-red-300" /> : <Bot className="w-3.5 h-3.5 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs leading-relaxed whitespace-pre-wrap ${m.error ? 'text-red-300' : 'text-zinc-200'}`}>{m.content}</p>

                  {m.searches && m.searches.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.searches.flatMap((sr) => sr.sources.slice(0, 3)).slice(0, 6).map((src, j) => (
                        <a key={j} href={src.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 max-w-[170px] text-[10px] text-sky-200/80 hover:text-white bg-sky-500/10 border border-sky-500/20 rounded-full px-2 py-0.5" title={src.url}>
                          <Globe className="w-2.5 h-2.5 flex-shrink-0" /> <span className="truncate">{src.title}</span>
                          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
                        </a>
                      ))}
                    </div>
                  )}

                  {m.done && m.done.length > 0 && (
                    <details className="mt-2 group/d">
                      <summary className={`list-none cursor-pointer inline-flex items-center gap-1 text-[11px] font-semibold ${m.undone ? 'text-zinc-500 line-through' : 'text-emerald-300'}`}>
                        <Check className="w-3 h-3" /> {m.done.length} modification{m.done.length > 1 ? 's' : ''}
                        <ChevronDown className="w-3 h-3 transition-transform group-open/d:rotate-180" />
                      </summary>
                      <ul className="mt-1 ml-1 pl-3 border-l border-white/10 flex flex-col gap-0.5">
                        {m.done.map((d, k) => (
                          <li key={k} className="text-[11px] text-zinc-400">
                            {d}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {((m.remembered && m.remembered.length > 0) || !!m.forgotten) && (
                    <button onClick={() => setView('memory')} className="mt-2 flex flex-col items-start gap-0.5 text-left">
                      {(m.remembered || []).map((r, k) => (
                        <span key={k} className="flex items-start gap-1.5 text-[11px] text-fuchsia-200">
                          <Brain className="w-3 h-3 mt-0.5 flex-shrink-0" /> Mémorisé : {r}
                        </span>
                      ))}
                      {!!m.forgotten && (
                        <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                          <Brain className="w-3 h-3" /> {m.forgotten} souvenir(s) oublié(s)
                        </span>
                      )}
                    </button>
                  )}

                  {m.warnings && m.warnings.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {m.warnings.map((w, k) => (
                        <li key={k} className="flex items-start gap-1.5 text-[11px] text-amber-300/90">
                          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {w}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-1.5 flex items-center gap-3">
                    <span className="text-[9px] text-zinc-600">{relativeDate(m.at)}</span>
                    {m.provider && <span className="text-[9px] text-zinc-600 truncate">{m.provider}</span>}
                    {m.undone ? (
                      <span className="text-[10px] text-zinc-500">Annulé</span>
                    ) : (
                      snapshots.current.has(m.id) && (
                        <button onClick={() => undo(m.id)} className="text-[10px] font-semibold text-zinc-400 hover:text-white flex items-center gap-1">
                          <Undo2 className="w-3 h-3" /> Annuler
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            )
          )}

          {busy && (
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center">
                <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
              </div>
              <span className="text-[11px] text-fuchsia-200/90">{status}</span>
            </div>
          )}
        </div>
      )}

      {/* Saisie */}
      <div className="p-3 pt-2 flex-shrink-0">
        {(attached.length > 0 || uploadingFiles) && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {attached.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1 max-w-[200px] text-[10px] text-zinc-200 bg-white/[0.06] border border-white/10 rounded-full pl-2 pr-1 py-0.5">
                <Paperclip className="w-2.5 h-2.5 flex-shrink-0 text-fuchsia-300" /> <span className="truncate">{f.name}</span>
                <button onClick={() => setAttached((list) => list.filter((x) => x.id !== f.id))} className="w-4 h-4 rounded-full hover:bg-white/10 text-zinc-500 hover:text-white flex items-center justify-center" title="Retirer">
                  ×
                </button>
              </span>
            ))}
            {uploadingFiles && (
              <span className="inline-flex items-center gap-1 text-[10px] text-fuchsia-200">
                <Loader2 className="w-3 h-3 animate-spin" /> {describeUpload(uploadInfo) || 'Envoi…'}
              </span>
            )}
          </div>
        )}
        <div className="flex items-end gap-1.5 bg-white/[0.04] border border-white/10 rounded-2xl pl-1.5 pr-1.5 py-1.5 focus-within:border-fuchsia-500/70 transition-colors">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="video/*,audio/*,image/*"
            className="hidden"
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              if (!files.length) return;
              setUploadingFiles(true);
              try {
                await uploadMany(files, (_, info) => setUploadInfo(info), (ready) => {
                  setAttached((list) => [...list, ...ready]);
                  onFilesAdded?.(ready);
                });
              } finally {
                setUploadingFiles(false);
                setUploadInfo(null);
                inputRef.current?.focus();
              }
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-8 h-8 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 flex items-center justify-center flex-shrink-0"
            title="Joindre des fichiers (sons, vidéos, images) à ton message"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Demande quelque chose à l’IA…"
            className="flex-1 bg-transparent text-xs text-white outline-none resize-none placeholder-zinc-600 py-1.5 max-h-[140px]"
          />
          {busy ? (
            <button onClick={() => abortRef.current?.abort()} className="w-8 h-8 rounded-xl bg-red-500/20 text-red-300 flex items-center justify-center flex-shrink-0" title="Arrêter">
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button onClick={() => send(input)} disabled={(!input.trim() && attached.length === 0) || uploadingFiles} className="w-8 h-8 rounded-xl bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white flex items-center justify-center disabled:opacity-30 flex-shrink-0" title="Envoyer (Entrée)">
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <p className="mt-1 px-1 text-[9px] text-zinc-600">Entrée pour envoyer · Maj+Entrée pour aller à la ligne · 📎 pour joindre tes sons, vidéos ou images</p>
      </div>
    </div>
  );
}
