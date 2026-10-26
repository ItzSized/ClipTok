'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import * as core from '@shared/editorCore';
import { getSfx } from '@/lib/api';
import type { SfxItem } from '@/lib/types';
import { useToast } from '@/components/ToastProvider';
import { useEditor, useEditorStore } from '../store';
import { applyTheme } from '../aiActions';

/** Thèmes en un clic : filtre, transitions, effet, sous-titres, textes et sons assortis. */
export default function ThemesPanel() {
  const store = useEditorStore();
  const current = useEditor((s) => s.project.settings.theme);
  const { showToast } = useToast();
  const [sfx, setSfx] = useState<SfxItem[]>([]);
  const [withSfx, setWithSfx] = useState(true);

  useEffect(() => {
    getSfx().then(setSfx).catch(() => {});
  }, []);

  const apply = (id: string) => {
    try {
      const theme = applyTheme(store, id, sfx, { sfx: withSfx });
      showToast({ type: 'success', message: `Thème « ${theme.name} » appliqué (Ctrl+Z pour annuler).` });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-zinc-500 leading-relaxed">
        Habille toute la vidéo en un clic : couleurs, transitions, effet, style des sous-titres et des textes. Les sous-titres générés ensuite prennent aussi le style du thème.
      </p>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" checked={withSfx} onChange={(e) => setWithSfx(e.target.checked)} className="accent-cyan-500" />
        Ajouter un son sur chaque transition
      </label>
      <div className="grid grid-cols-2 gap-2">
        {core.THEMES.map((t) => {
          const active = current === t.id;
          return (
            <button
              key={t.id}
              onClick={() => apply(t.id)}
              className={`relative text-left rounded-xl border p-2.5 transition-colors ${active ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/10 bg-white/[0.03] hover:border-white/30'}`}
            >
              <div className="flex h-8 rounded-md overflow-hidden mb-2">
                {t.colors.map((c) => (
                  <span key={c} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <p className="text-xs font-bold text-white">{t.name}</p>
              <p className="text-[10px] text-zinc-500 leading-snug mt-0.5">{t.description}</p>
              {active && (
                <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
