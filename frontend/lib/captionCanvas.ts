/**
 * Rendu canvas des sous-titres pour l'aperçu.
 *
 * Reproduit le fichier .ass généré par shared/captionEngine tel que libass le
 * dessine : même découpage (pages, lignes, mot actif), même police, mêmes
 * tailles (taille ASS -> taille CSS via emRatio), contours, ombres, boîtes et
 * animations.
 */
import * as engine from '@shared/captionEngine';
import type { CaptionPage, CaptionStyle, CaptionWordInput, PreparedWord } from '@shared/captionEngine';
import type { FontInfo } from './types';
import { fontFamilyFor } from './fonts';

export interface PreparedCaptions {
  style: CaptionStyle;
  pages: CaptionPage[];
}

/** Prépare (une fois par changement de mots/style) les pages à afficher. */
export function prepareCaptions(words: CaptionWordInput[], style: Partial<CaptionStyle>): PreparedCaptions {
  const resolved = engine.resolveStyle(style);
  return { style: resolved, pages: engine.paginate(engine.prepareWords(words, resolved), resolved) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function rgba(hex: string, alpha = 1) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Valeur d'une suite de transformations ASS \t(t0,t1,...) sur un paramètre d'échelle. */
function tween(ms: number, steps: [number, number, number][], initial: number) {
  let value = initial;
  for (const [t0, t1, target] of steps) {
    if (ms >= t1) value = target;
    else if (ms > t0) {
      value = value + (target - value) * ((ms - t0) / (t1 - t0));
      break;
    } else break;
  }
  return value;
}

/** Échelle (%) d'un mot au temps donné, identique aux balises \fscx générées. */
function wordScale(style: CaptionStyle, isActive: boolean, firstSlot: boolean, pageMs: number, wordMs: number) {
  const b = isActive && style.highlightMode !== 'none' ? style.highlightScale * 100 : 100;
  if (firstSlot && style.animation === 'pop') return tween(pageMs, [[0, 90, b * 1.08], [90, 160, b]], b * 0.6);
  if (isActive && style.animation === 'word-pop') return tween(wordMs, [[0, 90, b * 1.06], [90, 150, b]], 100);
  if (isActive && style.animation === 'bounce') return tween(wordMs, [[0, 80, b * 1.22], [80, 160, b * 0.94], [160, 220, b]], b);
  return b;
}

/**
 * Dessine les sous-titres du temps `t` dans un canevas W×H (coordonnées du
 * canevas = résolution de sortie mise à l'échelle).
 */
export function drawCaptions(ctx: CanvasRenderingContext2D, prepared: PreparedCaptions, font: FontInfo | null | undefined, t: number, W: number, H: number) {
  const { style, pages } = prepared;
  const state = engine.getStateAt(pages, t);
  if (!state) return;
  const m = engine.computeMetrics(style, W, H, font || undefined);
  const page = state.page;
  const family = font ? `"${fontFamilyFor(font.id)}"` : 'sans-serif';
  const emPx = m.emPx;
  const lineHeight = m.assSize;
  const ascent = (font?.ascentRatio ?? 0.8) * m.assSize;
  const pageMs = state.pageTime * 1000;
  const wordMs = state.wordTime * 1000;
  const firstSlot = state.activeIndex === 0;
  const karaoke = style.animation === 'karaoke';
  const typewriter = style.animation === 'typewriter';
  const hColor = engine.highlightColorFor(style, page.index);

  // Animations de page (premier créneau uniquement, comme \fad / \move).
  let alpha = 1;
  let offsetY = 0;
  if (style.animation === 'fade') alpha = clamp01(pageMs / 150);
  if (style.animation === 'slide-up') offsetY = emPx * 0.6 * (1 - clamp01(pageMs / 180));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  // letterSpacing est supporté par Chrome/Edge/Firefox récents.
  (ctx as any).letterSpacing = `${m.spacing}px`;

  type Laid = { word: PreparedWord; idx: number; x: number; width: number; scale: number };
  const laidLines: { items: Laid[]; width: number }[] = [];
  for (const line of page.lines) {
    const items: Laid[] = [];
    let width = 0;
    line.forEach((idx, k) => {
      const word = page.words[idx];
      const isActive = idx === state.activeIndex && !typewriter && !karaoke;
      const scale = karaoke ? 100 : wordScale(style, isActive, firstSlot, pageMs, wordMs);
      ctx.font = `${emPx * (scale / 100)}px ${family}`;
      const w = ctx.measureText(word.display).width;
      if (k > 0) {
        ctx.font = `${emPx}px ${family}`;
        width += ctx.measureText(' ').width;
      }
      items.push({ word, idx, x: width, width: w, scale });
      width += w;
    });
    laidLines.push({ items, width });
  }

  const blockH = lineHeight * laidLines.length;
  const top = m.y + offsetY - blockH / 2;

  const drawPass = (pass: 'box' | 'shadow' | 'outline' | 'fill') => {
    laidLines.forEach((line, li) => {
      const left = m.x - line.width / 2;
      const lineTop = top + li * lineHeight;
      for (const it of line.items) {
        const isActive = it.idx === state.activeIndex && !typewriter && !karaoke;
        const hidden = typewriter && it.idx > state.activeIndex;
        if (hidden) continue;
        const s = it.scale / 100;
        const size = emPx * s;
        // Le mot agrandi garde la ligne de base commune (comme libass avec \fscx/\fscy).
        const baseline = lineTop + ascent;
        const x = left + it.x;
        ctx.font = `${size}px ${family}`;

        if (pass === 'box') {
          const boxed = (style.highlightMode === 'box' && isActive) || style.background === 'box';
          if (!boxed) continue;
          const isHighlightBox = style.highlightMode === 'box' && isActive;
          ctx.fillStyle = isHighlightBox ? rgba(hColor, 1) : rgba(style.backgroundColor, style.backgroundOpacity);
          const boxH = lineHeight * s;
          ctx.fillRect(x - m.padding, baseline - ascent * s - m.padding, it.width + m.padding * 2, boxH + m.padding * 2);
          continue;
        }

        let color = style.textColor;
        if (style.emphasizeLoud && it.word.loud) color = style.loudColor;
        if (isActive && style.highlightMode === 'color') color = hColor;
        if (isActive && style.highlightMode === 'box') color = style.highlightTextColor;

        if (pass === 'shadow' && m.shadow > 0 && style.shadowOpacity > 0) {
          ctx.fillStyle = rgba(style.shadowColor, style.shadowOpacity);
          ctx.strokeStyle = rgba(style.shadowColor, style.shadowOpacity);
          if (m.outline > 0) {
            ctx.lineWidth = m.outline * 2;
            ctx.strokeText(it.word.display, x + m.shadow, baseline + m.shadow);
          }
          ctx.fillText(it.word.display, x + m.shadow, baseline + m.shadow);
        } else if (pass === 'outline' && m.outline > 0) {
          ctx.strokeStyle = rgba(style.outlineColor, 1);
          ctx.lineWidth = m.outline * 2;
          if (style.glow) {
            ctx.shadowColor = rgba(style.outlineColor, 1);
            ctx.shadowBlur = Math.max(2, m.outline * 0.8) * 2;
          }
          ctx.strokeText(it.word.display, x, baseline);
          ctx.shadowBlur = 0;
        } else if (pass === 'fill') {
          if (karaoke) {
            // Remplissage progressif (\kf) : partie gauche en couleur de surlignage.
            const slot = state.slots[it.idx];
            const progress = clamp01((t - slot.start) / Math.max(0.01, slot.end - slot.start));
            ctx.fillStyle = rgba(style.emphasizeLoud && it.word.loud ? style.loudColor : style.textColor, 1);
            ctx.fillText(it.word.display, x, baseline);
            if (progress > 0) {
              ctx.save();
              ctx.beginPath();
              ctx.rect(x, baseline - lineHeight * 2, it.width * progress, lineHeight * 4);
              ctx.clip();
              ctx.fillStyle = rgba(hColor, 1);
              ctx.fillText(it.word.display, x, baseline);
              ctx.restore();
            }
          } else {
            ctx.fillStyle = rgba(color, 1);
            ctx.fillText(it.word.display, x, baseline);
          }
          if (isActive && style.highlightMode === 'underline') {
            ctx.fillRect(x, baseline + size * 0.08, it.width, Math.max(2, size * 0.06));
          }
        }
      }
    });
  };

  drawPass('box');
  drawPass('shadow');
  drawPass('outline');
  drawPass('fill');
  ctx.restore();
}
