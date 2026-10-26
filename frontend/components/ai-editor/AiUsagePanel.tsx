'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCw, Trash2, CheckCircle2, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { addAiKeys, getAiUsage, removeAiKey, type AiUsageReport } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

const STATUS: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  ok: { label: 'OK', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', icon: CheckCircle2 },
  'quota-day': { label: 'Quota du jour atteint', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30', icon: Clock },
  'quota-minute': { label: 'Pause 1 min', cls: 'text-amber-200 bg-amber-500/10 border-amber-500/20', icon: Clock },
  overloaded: { label: 'Saturé chez Google', cls: 'text-orange-300 bg-orange-500/10 border-orange-500/30', icon: AlertTriangle },
  slow: { label: 'Trop lent', cls: 'text-orange-300 bg-orange-500/10 border-orange-500/30', icon: AlertTriangle },
  missing: { label: 'Modèle introuvable', cls: 'text-zinc-400 bg-white/5 border-white/10', icon: XCircle },
  invalid: { label: 'Clé refusée', cls: 'text-red-300 bg-red-500/10 border-red-500/30', icon: XCircle },
  limited: { label: 'À court de quota', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30', icon: Clock },
};

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
const fmtNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n));

function Pill({ status, until }: { status: string; until?: string | null }) {
  const s = STATUS[status] || STATUS.ok;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold border rounded-full px-1.5 py-0.5 whitespace-nowrap ${s.cls}`}>
      <Icon className="w-2.5 h-2.5" /> {s.label}
      {until && status !== 'ok' ? ` → ${fmtTime(until)}` : ''}
    </span>
  );
}

/**
 * Usage des IA gratuites : chaque clé (masquée), ses requêtes et jetons du jour
 * par modèle, son état (quota atteint, saturé…), et l'ajout de clés depuis le site.
 * Les clés tournent automatiquement : la moins utilisée passe en premier.
 */
export default function AiUsagePanel({ compact = false }: { compact?: boolean }) {
  const { showToast } = useToast();
  const [report, setReport] = useState<AiUsageReport | null>(null);
  const [provider, setProvider] = useState('gemini');
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    getAiUsage().then(setReport).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const add = async () => {
    setAdding(true);
    try {
      const { added } = await addAiKeys(provider, draft);
      showToast({ type: 'success', message: added ? `${added} clé(s) ajoutée(s) : elles tournent automatiquement.` : 'Ces clés étaient déjà enregistrées.' });
      setDraft('');
      load();
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setAdding(false);
    }
  };

  if (!report) {
    return (
      <div className="flex items-center justify-center py-10 text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const configured = report.providers.filter((p) => p.keys.length > 0);
  const totalRequests = configured.reduce((a, p) => a + p.keys.reduce((b, k) => b + k.requests, 0), 0);
  const totalTokens = configured.reduce((a, p) => a + p.keys.reduce((b, k) => b + k.tokens, 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-zinc-500 leading-relaxed ${compact ? 'text-[11px]' : 'text-sm'}`}>
          Aujourd’hui : <b className="text-zinc-200">{totalRequests}</b> requêtes · <b className="text-zinc-200">{fmtNum(totalTokens)}</b> jetons. Quotas remis à zéro à{' '}
          <b className="text-zinc-200">{fmtTime(report.resetAt)}</b>. La clé la moins utilisée passe toujours en premier ; une clé à court de quota est sautée automatiquement.
        </p>
        <button onClick={load} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 flex-shrink-0" title="Actualiser">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {configured.map((p) => {
        const reqs = p.keys.reduce((a, k) => a + k.requests, 0);
        const usable = p.keys.filter((k) => k.status === 'ok').length;
        return (
          <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
              <KeyRound className="w-3.5 h-3.5 text-fuchsia-300" />
              <span className="text-xs font-bold text-white flex-1">{p.name}</span>
              <span className="text-[10px] text-zinc-500">
                {usable}/{p.keys.length} clé(s) dispo · {reqs} req.
              </span>
            </div>
            {(() => {
              const shared = new Map<string, number>();
              for (const k of p.keys) if (k.project) shared.set(k.project.letter, k.project.size);
              return shared.size > 0 ? (
                <p className="px-3 pt-2 text-[10px] text-sky-200/80 leading-relaxed">
                  {[...shared].map(([l, n]) => `${n} clés dans le projet ${l}`).join(' · ')} : les clés d’un même projet Google partagent un seul quota (20 requêtes / jour / modèle). Pour plus de quota, crée tes clés avec « Create API key in new project ».
                </p>
              ) : null;
            })()}
            {p.cooledModels.length > 0 && (
              <div className="px-3 pt-2 flex flex-wrap gap-1">
                {p.cooledModels.map((m) => (
                  <span key={m.model} className="text-[10px] text-zinc-400">
                    {m.model} <Pill status={m.reason} until={m.until} />
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-col">
              {p.keys.map((k) => {
                const id = `${p.id}:${k.id}`;
                const expanded = open === id;
                return (
                  <div key={k.id} className="border-t border-white/5 first:border-t-0">
                    <button onClick={() => setOpen(expanded ? null : id)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03]">
                      <code className="text-[11px] text-zinc-300 font-mono">{k.masked}</code>
                      <span className="text-[9px] uppercase tracking-wide text-zinc-600">{k.source === 'env' ? '.env' : 'site'}</span>
                      {k.project && (
                        <span className="text-[9px] font-bold text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded px-1" title={`${k.project.size} clés du même projet Google : elles partagent le même quota`}>
                          projet {k.project.letter}
                        </span>
                      )}
                      <span className="flex-1" />
                      <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                        {k.requests} req. · {fmtNum(k.tokens)} jetons
                      </span>
                      <Pill status={k.status} />
                    </button>
                    {expanded && (
                      <div className="px-3 pb-2 flex flex-col gap-1">
                        {k.models.length === 0 && <p className="text-[10px] text-zinc-600">Pas encore utilisée aujourd’hui.</p>}
                        {k.models.map((m) => (
                          <div key={m.model} className="flex items-center gap-2 text-[10px]">
                            <span className="text-zinc-400 truncate flex-1" title={m.model}>
                              {m.model}
                            </span>
                            <span className="text-zinc-500 whitespace-nowrap">
                              {m.ok}/{m.requests} ok{m.rateLimited ? ` · ${m.rateLimited} quota` : ''} · {fmtNum(m.tokensIn + m.tokensOut)} j.
                            </span>
                            <Pill status={m.status} until={m.until} />
                          </div>
                        ))}
                        {k.source === 'site' && (
                          <button
                            onClick={async () => {
                              await removeAiKey(p.id, k.id).catch((err) => showToast({ type: 'error', message: err.message }));
                              load();
                            }}
                            className="self-start mt-1 flex items-center gap-1 text-[10px] text-zinc-500 hover:text-red-400"
                          >
                            <Trash2 className="w-3 h-3" /> Retirer cette clé
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="rounded-xl border border-dashed border-white/15 p-3 flex flex-col gap-2">
        <span className="text-xs font-semibold text-zinc-300">Ajouter des clés gratuites</span>
        <div className="flex gap-2">
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none">
            {report.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={compact ? 2 : 3}
          placeholder="Collez une ou plusieurs clés (une par ligne ou séparées par des virgules)"
          className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none resize-none font-mono focus:border-fuchsia-500"
        />
        <button onClick={add} disabled={!draft.trim() || adding} className="self-end flex items-center gap-1.5 text-xs font-bold bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white px-3 py-1.5 rounded-lg disabled:opacity-40">
          {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Ajouter
        </button>
        <p className="text-[10px] text-zinc-600">Les clés sont gardées sur ce PC (backend/data) et ne sont jamais réaffichées en entier.</p>
      </div>
    </div>
  );
}
