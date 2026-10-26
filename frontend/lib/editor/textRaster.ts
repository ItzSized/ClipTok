/**
 * Rastérisation des clips texte et sticker.
 *
 * Le même code sert à l'aperçu (canevas mis en cache) et à l'export (PNG
 * envoyés au backend, superposés par ffmpeg) : le texte exporté est donc
 * identique au pixel près à ce que l'on voit, emojis en couleur compris.
 */
import type { Clip, TextStyle } from '@shared/editorCore';
import * as core from '@shared/editorCore';
import { fontFamilyFor } from '@/lib/fonts';

function rgba(hex: string, alpha = 1) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Dessine le clip dans un nouveau canevas à l'échelle `scale` (1 = résolution
 * du projet). Le canevas a exactement la taille du calque (clip.box × scale).
 */
export function rasterizeClip(clip: Clip, projectW: number, projectH: number, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const ref = Math.min(projectW, projectH) * scale;

  if (clip.type === 'sticker') {
    const size = ref * 0.22;
    const pad = size * 0.15;
    canvas.width = Math.ceil(size + pad * 2);
    canvas.height = Math.ceil(size * 1.15 + pad * 2);
    ctx.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(clip.emoji || '⭐', canvas.width / 2, canvas.height / 2 + size * 0.05);
    return canvas;
  }

  const style: TextStyle = { ...core.DEFAULT_TEXT_STYLE, ...(clip.textStyle || {}) };
  const em = style.fontSize * ref;
  const family = `"${fontFamilyFor(style.fontId)}", sans-serif`;
  const font = `${style.italic ? 'italic ' : ''}${em}px ${family}`;
  const raw = clip.text || ' ';
  const lines = (style.uppercase ? raw.toLocaleUpperCase('fr-FR') : raw).split('\n');
  const stroke = style.strokeWidth * em;
  const shadowBlur = style.shadowOpacity > 0 ? style.shadowBlur * em : 0;
  const shadowOffset = style.shadowOpacity > 0 ? style.shadowOffset * em : 0;
  const lineH = em * style.lineHeight;
  const bg = style.bgOpacity > 0;
  const bgPad = bg ? style.bgPadding * em : 0;

  ctx.font = font;
  (ctx as any).letterSpacing = `${style.letterSpacing * em}px`;
  const widths = lines.map((l) => ctx.measureText(l || ' ').width);
  const textW = Math.max(...widths, em * 0.5);
  const textH = lineH * lines.length;
  const margin = Math.ceil(stroke + shadowBlur * 1.5 + Math.abs(shadowOffset) + 4);
  canvas.width = Math.ceil(textW + bgPad * 2 + margin * 2);
  canvas.height = Math.ceil(textH + bgPad * 2 + margin * 2);

  // Le redimensionnement réinitialise le contexte : on reconfigure.
  ctx.font = font;
  (ctx as any).letterSpacing = `${style.letterSpacing * em}px`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const left = margin + bgPad;
  const top = margin + bgPad;

  if (bg) {
    ctx.fillStyle = rgba(style.bgColor, style.bgOpacity);
    roundRect(ctx, margin, margin, textW + bgPad * 2, textH + bgPad * 2, style.bgRadius * em);
    ctx.fill();
  }

  const xFor = (i: number) => (style.align === 'left' ? left : style.align === 'right' ? left + textW - widths[i] : left + (textW - widths[i]) / 2);

  const drawText = (mode: 'stroke' | 'fill') => {
    lines.forEach((line, i) => {
      const y = top + lineH * i + lineH / 2;
      if (mode === 'stroke') ctx.strokeText(line, xFor(i), y);
      else ctx.fillText(line, xFor(i), y);
      if (mode === 'fill' && style.underline) ctx.fillRect(xFor(i), y + em * 0.42, widths[i], Math.max(1, em * 0.06));
    });
  };

  // Ombre portée (dessinée une fois, sous le contour et le remplissage).
  if (style.shadowOpacity > 0 && (shadowBlur > 0 || shadowOffset !== 0)) {
    ctx.save();
    ctx.shadowColor = rgba(style.shadowColor, style.shadowOpacity);
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = shadowOffset;
    ctx.shadowOffsetY = shadowOffset;
    ctx.fillStyle = rgba(style.shadowColor, style.shadowOpacity);
    ctx.strokeStyle = rgba(style.shadowColor, style.shadowOpacity);
    if (stroke > 0) {
      ctx.lineWidth = stroke * 2;
      drawText('stroke');
    }
    drawText('fill');
    ctx.restore();
  }
  if (stroke > 0) {
    ctx.strokeStyle = rgba(style.strokeColor);
    ctx.lineWidth = stroke * 2;
    drawText('stroke');
  }
  ctx.fillStyle = rgba(style.color);
  drawText('fill');
  return canvas;
}

/** Clé de cache : change dès que le rendu du texte change. */
export function rasterKey(clip: Clip, projectW: number, projectH: number) {
  return JSON.stringify([clip.type, clip.text, clip.emoji, clip.textStyle, projectW, projectH]);
}
