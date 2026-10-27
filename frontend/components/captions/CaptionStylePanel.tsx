'use client';

import { useEffect, useState } from 'react';
import { Plus, X, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd } from 'lucide-react';
import * as engine from '@shared/captionEngine';
import type { CaptionStyle } from '@shared/captionEngine';
import type { FontInfo } from '@/lib/types';
import { ensureAllFonts, fontFamilyFor } from '@/lib/fonts';
import { Section, Slider, ColorInput, Toggle, Select, Segmented } from '@/components/ui/controls';

interface Props {
  style: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Aperçu miniature d'un modèle (police réelle + couleur de surlignage). */
const rgba = (hex: string, a: number) => {
  const h = (hex || '#000000').replace('#', '').padEnd(6, '0');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

export function PresetCard({ preset, active, onClick }: { preset: engine.CaptionPreset; active: boolean; onClick: () => void }) {
  const s = engine.resolveStyle({ ...preset.style, preset: preset.id });
  const sample = s.uppercase ? 'LE MOT CLÉ' : 'Le mot clé';
  const [first, ...rest] = sample.split(' ');
  const stroke = s.outlineWidth > 0 ? `${Math.max(1, s.outlineWidth * 14)}px ${s.outlineColor}` : undefined;
  const hl = s.highlightColors[0];
  return (
    <button
      type="button"
      onClick={onClick}
      title={preset.description}
      className={`relative h-20 rounded-xl border overflow-hidden flex flex-col items-center justify-center gap-1 transition-all ${
        active ? 'border-fuchsia-500 ring-2 ring-fuchsia-500/30 bg-fuchsia-500/10' : 'border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-900 hover:border-white/30'
      }`}
    >
      <span
        className="text-[15px] leading-none whitespace-nowrap"
        style={{
          fontFamily: `"${fontFamilyFor(s.fontId)}", sans-serif`,
          color: s.textColor,
          WebkitTextStroke: stroke,
          paintOrder: 'stroke fill',
          textShadow: s.shadowOpacity > 0 && s.shadowDepth > 0 ? `2px 2px 0 rgba(0,0,0,${s.shadowOpacity})` : s.glow ? `0 0 8px ${s.outlineColor}` : undefined,
          background: s.background === 'box' ? rgba(s.backgroundColor, s.backgroundOpacity) : undefined,
          padding: s.background === 'box' ? '2px 4px' : undefined,
        }}
      >
        {first}{' '}
        <span
          style={{
            color: s.highlightMode === 'color' ? hl : s.highlightMode === 'box' ? s.highlightTextColor : undefined,
            background: s.highlightMode === 'box' ? hl : undefined,
            padding: s.highlightMode === 'box' ? '0 3px' : undefined,
            textDecoration: s.highlightMode === 'underline' ? 'underline' : undefined,
          }}
        >
          {rest[0]}
        </span>{' '}
        {rest.slice(1).join(' ')}
      </span>
      <span className="text-[10px] font-semibold text-zinc-400">{preset.name}</span>
    </button>
  );
}

export default function CaptionStylePanel({ style, onChange }: Props) {
  const [fonts, setFonts] = useState<FontInfo[]>([]);

  useEffect(() => {
    ensureAllFonts().then(setFonts).catch(() => {});
  }, []);

  const set = <K extends keyof CaptionStyle>(key: K, value: CaptionStyle[K]) => onChange({ ...style, [key]: value });

  const setHighlightColor = (i: number, color: string) => {
    const colors = style.highlightColors.slice();
    colors[i] = color;
    set('highlightColors', colors);
  };

  return (
    <div className="flex flex-col">
      <Section title="Modèles">
        <div className="grid grid-cols-2 gap-2">
          {engine.PRESETS.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              active={style.preset === p.id}
              onClick={() => onChange(engine.applyPreset(p.id, { positionX: style.positionX, positionY: style.positionY }))}
            />
          ))}
        </div>
      </Section>

      <Section title="Police">
        <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
          {fonts.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => set('fontId', f.id)}
              className={`px-2 py-2 rounded-lg text-sm truncate border transition-colors ${
                style.fontId === f.id ? 'border-fuchsia-500 bg-fuchsia-500/10 text-white' : 'border-white/10 bg-black/30 text-zinc-300 hover:border-white/30'
              }`}
              style={{ fontFamily: `"${fontFamilyFor(f.id)}", sans-serif` }}
              title={f.fullName}
            >
              {f.fullName}
            </button>
          ))}
        </div>
        <Slider label="Taille" value={style.fontSize} min={0.02} max={0.16} step={0.001} onChange={(v) => set('fontSize', v)} format={pct} />
        <Slider label="Espacement des lettres" value={style.letterSpacing} min={-0.05} max={0.3} onChange={(v) => set('letterSpacing', v)} format={pct} />
        <Toggle label="Majuscules" checked={style.uppercase} onChange={(v) => set('uppercase', v)} />
        <Segmented
          value={style.punctuation}
          onChange={(v) => set('punctuation', v)}
          options={[
            { value: 'keep', label: 'Garder la ponctuation' },
            { value: 'remove', label: 'Retirer' },
          ]}
        />
      </Section>

      <Section title="Couleurs & contour">
        <div className="grid grid-cols-7 gap-1.5" title="Palettes rapides">
          {engine.COLOR_PALETTES.map((pal) => (
            <button
              key={pal.id}
              onClick={() => onChange({ ...style, textColor: pal.textColor, outlineColor: pal.outlineColor, highlightColors: pal.highlightColors.slice() })}
              title={pal.name}
              className="h-7 rounded-md border border-white/10 hover:border-white/50 overflow-hidden flex"
            >
              <span className="flex-1" style={{ background: pal.textColor }} />
              <span className="flex-1" style={{ background: pal.highlightColors.length > 2 ? `linear-gradient(90deg, ${pal.highlightColors.join(',')})` : pal.highlightColors[0] }} />
              <span className="w-1.5" style={{ background: pal.outlineColor }} />
            </button>
          ))}
        </div>
        <ColorInput label="Texte" value={style.textColor} onChange={(v) => set('textColor', v)} />
        <ColorInput label="Contour" value={style.outlineColor} onChange={(v) => set('outlineColor', v)} />
        <Slider label="Épaisseur du contour" value={style.outlineWidth} min={0} max={0.25} step={0.005} onChange={(v) => set('outlineWidth', v)} format={pct} />
        <Toggle label="Halo lumineux (néon)" checked={style.glow} onChange={(v) => set('glow', v)} />
        <ColorInput label="Ombre" value={style.shadowColor} onChange={(v) => set('shadowColor', v)} />
        <Slider label="Opacité de l'ombre" value={style.shadowOpacity} min={0} max={1} onChange={(v) => set('shadowOpacity', v)} format={pct} />
        <Slider label="Distance de l'ombre" value={style.shadowDepth} min={0} max={0.2} step={0.005} onChange={(v) => set('shadowDepth', v)} format={pct} />
      </Section>

      <Section title="Mot actif (surlignage)">
        <Segmented
          value={style.highlightMode}
          onChange={(v) => set('highlightMode', v)}
          options={engine.HIGHLIGHT_MODES.map((m) => ({ value: m.id, label: m.name }))}
        />
        {style.highlightMode !== 'none' && (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-zinc-400">Couleurs (alternées entre les groupes)</span>
              <div className="flex flex-wrap gap-2 items-center">
                {style.highlightColors.map((c, i) => (
                  <div key={i} className="relative group">
                    <input type="color" value={c} onChange={(e) => setHighlightColor(i, e.target.value.toUpperCase())} className="w-9 h-9 rounded-lg bg-transparent border border-white/10 cursor-pointer" />
                    {style.highlightColors.length > 1 && (
                      <button
                        type="button"
                        onClick={() => set('highlightColors', style.highlightColors.filter((_, k) => k !== i))}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-800 border border-white/20 text-zinc-300 hidden group-hover:flex items-center justify-center"
                        aria-label="Retirer la couleur"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                ))}
                {style.highlightColors.length < 6 && (
                  <button
                    type="button"
                    onClick={() => set('highlightColors', [...style.highlightColors, '#FFFFFF'])}
                    className="w-9 h-9 rounded-lg border border-dashed border-white/20 text-zinc-400 hover:text-white flex items-center justify-center"
                    aria-label="Ajouter une couleur"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            {style.highlightMode === 'box' && (
              <>
                <ColorInput label="Texte dans la boîte" value={style.highlightTextColor} onChange={(v) => set('highlightTextColor', v)} />
                <Slider label="Marge de la boîte" value={style.boxPadding} min={0} max={0.5} onChange={(v) => set('boxPadding', v)} format={pct} />
              </>
            )}
            <Slider label="Agrandissement" value={style.highlightScale} min={1} max={1.6} onChange={(v) => set('highlightScale', v)} format={(v) => `${Math.round(v * 100)}%`} />
          </>
        )}
        <Toggle label="Colorer les mots criés (énergie audio)" checked={style.emphasizeLoud} onChange={(v) => set('emphasizeLoud', v)} />
        {style.emphasizeLoud && <ColorInput label="Couleur des mots criés" value={style.loudColor} onChange={(v) => set('loudColor', v)} />}
      </Section>

      <Section title="Animation">
        <div className="grid grid-cols-2 gap-1.5">
          {engine.ANIMATIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => set('animation', a.id)}
              className={`px-2 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                style.animation === a.id ? 'border-fuchsia-500 bg-fuchsia-500/10 text-white' : 'border-white/10 bg-black/30 text-zinc-400 hover:text-white'
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Position">
        <Segmented
          value={style.positionY < 0.35 ? 'top' : style.positionY > 0.62 ? 'bottom' : 'middle'}
          onChange={(v) => set('positionY', v === 'top' ? 0.2 : v === 'middle' ? 0.5 : 0.72)}
          options={[
            { value: 'top', label: <AlignVerticalJustifyStart className="w-4 h-4" />, title: 'Haut' },
            { value: 'middle', label: <AlignVerticalJustifyCenter className="w-4 h-4" />, title: 'Milieu' },
            { value: 'bottom', label: <AlignVerticalJustifyEnd className="w-4 h-4" />, title: 'Bas' },
          ]}
        />
        <Slider label="Vertical" value={style.positionY} min={0.05} max={0.95} onChange={(v) => set('positionY', v)} format={pct} />
        <Slider label="Horizontal" value={style.positionX} min={0.1} max={0.9} onChange={(v) => set('positionX', v)} format={pct} />
        <p className="text-[11px] text-zinc-600">Astuce : vous pouvez aussi glisser les sous-titres directement dans l'aperçu.</p>
      </Section>

      <Section title="Découpage" defaultOpen={false}>
        <Slider label="Mots par groupe" value={style.wordsPerPage} min={1} max={15} step={1} onChange={(v) => set('wordsPerPage', v)} format={(v) => String(v)} />
        <Slider label="Lignes max" value={style.maxLines} min={1} max={4} step={1} onChange={(v) => set('maxLines', v)} format={(v) => String(v)} />
        <Slider label="Caractères par ligne" value={style.maxCharsPerLine} min={6} max={60} step={1} onChange={(v) => set('maxCharsPerLine', v)} format={(v) => String(v)} />
        <Toggle label="Nouveau groupe à chaque phrase" checked={style.breakOnPunctuation} onChange={(v) => set('breakOnPunctuation', v)} />
      </Section>

      <Section title="Fond" defaultOpen={false}>
        <Segmented
          value={style.background}
          onChange={(v) => set('background', v)}
          options={[
            { value: 'none', label: 'Aucun' },
            { value: 'box', label: 'Bandeau' },
          ]}
        />
        {style.background === 'box' && (
          <>
            <ColorInput label="Couleur" value={style.backgroundColor} onChange={(v) => set('backgroundColor', v)} />
            <Slider label="Opacité" value={style.backgroundOpacity} min={0} max={1} onChange={(v) => set('backgroundOpacity', v)} format={pct} />
            <Slider label="Marge" value={style.boxPadding} min={0} max={0.5} onChange={(v) => set('boxPadding', v)} format={pct} />
          </>
        )}
      </Section>
    </div>
  );
}

export function FontSelect({ value, onChange, fonts }: { value: string; onChange: (id: string) => void; fonts: FontInfo[] }) {
  return <Select value={value} onChange={onChange} options={fonts.map((f) => ({ value: f.id, label: f.fullName }))} />;
}
