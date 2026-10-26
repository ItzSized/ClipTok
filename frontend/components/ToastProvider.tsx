'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
}

interface ToastContextValue {
  showToast: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const STYLES: Record<ToastType, { icon: any; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: 'border-emerald-500/30 bg-emerald-500/10', iconColor: 'text-emerald-400' },
  error: { icon: XCircle, ring: 'border-red-500/30 bg-red-500/10', iconColor: 'text-red-400' },
  info: { icon: Info, ring: 'border-fuchsia-500/30 bg-fuchsia-500/10', iconColor: 'text-fuchsia-400' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 w-[calc(100vw-3rem)] max-w-sm">
        {toasts.map((t) => {
          const style = STYLES[t.type];
          const Icon = style.icon;
          return (
            <div
              key={t.id}
              className={`animate-toast-in flex items-start gap-3 rounded-2xl border ${style.ring} backdrop-blur-xl bg-black/80 p-4 shadow-2xl`}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${style.iconColor}`} />
              <div className="flex-1 min-w-0">
                {t.title && <p className="text-sm font-bold text-white">{t.title}</p>}
                <p className="text-sm text-zinc-300 break-words">{t.message}</p>
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="text-zinc-500 hover:text-white transition-colors flex-shrink-0"
                aria-label="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé à l\'intérieur de <ToastProvider>');
  return ctx;
}
