'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

type ActiveDialog =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (v: string | null) => void }
  | null;

interface DialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveDialog>(null);
  const [promptValue, setPromptValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setActive({ kind: 'confirm', options, resolve });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    setPromptValue(options.initialValue || '');
    return new Promise<string | null>((resolve) => {
      setActive({ kind: 'prompt', options, resolve });
      setTimeout(() => inputRef.current?.select(), 50);
    });
  }, []);

  const close = (result: any) => {
    if (!active) return;
    (active.resolve as (value: any) => void)(result);
    setActive(null);
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {active && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in-up"
          style={{ animationDuration: '0.15s' }}
          onClick={() => close(active.kind === 'confirm' ? false : null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-3xl p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                {active.kind === 'confirm' && active.options.danger && (
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                )}
                <h3 className="text-lg font-bold text-white">{active.options.title}</h3>
              </div>
              <button
                onClick={() => close(active.kind === 'confirm' ? false : null)}
                className="text-zinc-500 hover:text-white transition-colors"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {active.kind === 'confirm' && (
              <>
                {active.options.message && (
                  <p className="text-zinc-400 text-sm mb-6">{active.options.message}</p>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => close(false)}
                    className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-white/10 text-white hover:bg-white/20 transition-colors"
                  >
                    {active.options.cancelLabel || 'Annuler'}
                  </button>
                  <button
                    onClick={() => close(true)}
                    className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors ${
                      active.options.danger
                        ? 'bg-red-500 text-white hover:bg-red-400'
                        : 'bg-white text-black hover:bg-fuchsia-100'
                    }`}
                  >
                    {active.options.confirmLabel || 'Confirmer'}
                  </button>
                </div>
              </>
            )}

            {active.kind === 'prompt' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (promptValue.trim()) close(promptValue.trim());
                }}
              >
                {active.options.label && (
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                    {active.options.label}
                  </label>
                )}
                <input
                  ref={inputRef}
                  autoFocus
                  type="text"
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  placeholder={active.options.placeholder}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-fuchsia-500 transition-colors text-white placeholder-zinc-600 mb-6"
                />
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => close(null)}
                    className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-white/10 text-white hover:bg-white/20 transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={!promptValue.trim()}
                    className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-white text-black hover:bg-fuchsia-100 transition-colors disabled:opacity-40"
                  >
                    {active.options.confirmLabel || 'Valider'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog doit être utilisé à l\'intérieur de <DialogProvider>');
  return ctx;
}
