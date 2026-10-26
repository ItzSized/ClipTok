'use client';

import { Clapperboard, Music, Type, Smile, Sparkles, ArrowLeftRight, Palette, Captions, Wand2 } from 'lucide-react';
import ThemesPanel from './panels/ThemesPanel';
import MediaPanel from './panels/MediaPanel';
import AudioPanel from './panels/AudioPanel';
import { TextPanel, StickersPanel, EffectsPanel, FiltersPanel, TransitionsPanel, CaptionsPanel } from './panels/LibraryPanels';

const TABS = [
  { id: 'media', label: 'Médias', icon: Clapperboard, Panel: MediaPanel },
  { id: 'audio', label: 'Audio', icon: Music, Panel: AudioPanel },
  { id: 'text', label: 'Texte', icon: Type, Panel: TextPanel },
  { id: 'stickers', label: 'Stickers', icon: Smile, Panel: StickersPanel },
  { id: 'effects', label: 'Effets', icon: Sparkles, Panel: EffectsPanel },
  { id: 'transitions', label: 'Transitions', icon: ArrowLeftRight, Panel: TransitionsPanel },
  { id: 'filters', label: 'Filtres', icon: Palette, Panel: FiltersPanel },
  { id: 'captions', label: 'Sous-titres', icon: Captions, Panel: CaptionsPanel },
  { id: 'themes', label: 'Thèmes', icon: Wand2, Panel: ThemesPanel },
] as const;

export type LeftTab = (typeof TABS)[number]['id'];

/** Panneau de ressources, onglets en haut comme dans CapCut. */
export default function LeftPanel({ tab, onTab }: { tab: LeftTab; onTab: (t: LeftTab) => void }) {
  const current = TABS.find((t) => t.id === tab) || TABS[0];
  const Panel = current.Panel;
  return (
    <div className="flex flex-col h-full min-h-0 bg-[#1b1b1f]">
      <nav className="flex flex-shrink-0 border-b border-white/5 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              className={`flex-1 min-w-[44px] py-2 flex flex-col items-center gap-1 text-[10px] font-semibold border-b-2 transition-colors ${
                active ? 'border-cyan-400 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-200'
              }`}
            >
              <Icon className={`w-[18px] h-[18px] ${active ? 'text-cyan-300' : ''}`} />
              {t.label}
            </button>
          );
        })}
      </nav>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <Panel />
      </div>
    </div>
  );
}
