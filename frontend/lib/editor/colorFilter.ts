/**
 * Filtres couleur de l'aperçu.
 *
 * La matrice couleur d'un clip (shared/editorCore.colorMatrix) est injectée
 * dans un <feColorMatrix> SVG (en sRGB, comme ffmpeg) puis appliquée au canevas
 * via ctx.filter = 'url(#id)'. L'export ffmpeg utilise la même matrice
 * (colorchannelmixer), l'aperçu est donc fidèle.
 */
import type { Clip } from '@shared/editorCore';
import * as core from '@shared/editorCore';

const SVG_NS = 'http://www.w3.org/2000/svg';
let svgRoot: SVGSVGElement | null = null;
const filters = new Map<string, string>(); // clé de matrice -> id du filtre

function root() {
  if (!svgRoot) {
    svgRoot = document.createElementNS(SVG_NS, 'svg');
    svgRoot.setAttribute('width', '0');
    svgRoot.setAttribute('height', '0');
    svgRoot.style.position = 'absolute';
    svgRoot.style.pointerEvents = 'none';
    document.body.appendChild(svgRoot);
  }
  return svgRoot;
}

function matrixFilterId(m: number[]) {
  const key = m.map((v) => v.toFixed(4)).join(' ');
  let id = filters.get(key);
  if (id) return id;
  id = `ctcm${filters.size}`;
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const fe = document.createElementNS(SVG_NS, 'feColorMatrix');
  fe.setAttribute('type', 'matrix');
  fe.setAttribute('values', key);
  filter.appendChild(fe);
  root().appendChild(filter);
  filters.set(key, id);
  return id;
}

/**
 * Valeur de ctx.filter pour un clip au temps local t.
 * `pxScale` convertit les pixels du projet en pixels du canevas d'aperçu.
 */
export function canvasFilterFor(clip: Clip, t: number, pxScale: number): string {
  const parts: string[] = [];
  const m = core.colorMatrix(clip);
  if (!core.isIdentityMatrix(m)) parts.push(`url(#${matrixFilterId(m)})`);
  const { adjust } = core.effectiveAdjust(clip);
  let blur = adjust.blur > 0 ? adjust.blur * 0.02 * 1080 : 0;
  let brightness = 0;
  for (const fx of clip.effects || []) {
    const i = fx.intensity ?? 0.6;
    if (fx.id === 'blur') blur += 2 + 30 * i;
    if (fx.id === 'flash') brightness += 0.6 * i * Math.pow(Math.max(0, Math.sin(2 * Math.PI * t * 2)), 12);
    if (fx.id === 'strobe') brightness += 0.7 * i * ((t % 0.25) < 0.06 ? 1 : 0);
    if (fx.id === 'vhs') parts.push('saturate(0.75) contrast(1.05)');
    if (fx.id === 'rainbow') parts.push(`hue-rotate(${((t * 120 * (0.3 + i)) % 360).toFixed(1)}deg)`);
    if (fx.id === 'pulse-light') brightness += 0.35 * i * (0.5 + 0.5 * Math.sin(2 * Math.PI * t * 2));
    if (fx.id === 'blackout') brightness -= 0.8 * i * Math.pow(Math.max(0, Math.sin(2 * Math.PI * t * 1.5)), 14);
    if (fx.id === 'dreamy') {
      parts.push(`brightness(${1 + 0.1 * i}) contrast(${1 - 0.12 * i}) saturate(${1 + 0.2 * i})`);
      blur += 1 + 2 * i;
    }
    if (fx.id === 'punch') parts.push(`contrast(${1 + 0.4 * i}) saturate(${1 + 0.5 * i})`);
    if (fx.id === 'old-film') parts.push('sepia(1)');
  }
  if (brightness !== 0) parts.push(`brightness(${Math.max(0, 1 + brightness * 2)})`);
  if (blur > 0) parts.push(`blur(${(blur * pxScale).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}
