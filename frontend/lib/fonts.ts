'use client';

import { getFonts, absoluteFileUrl } from './api';
import type { FontInfo } from './types';

/*
 * Les polices viennent du backend (/fonts/*.ttf) : ce sont exactement les
 * fichiers que libass utilise au rendu, l'aperçu est donc fidèle.
 */

let catalogPromise: Promise<FontInfo[]> | null = null;
const loaded = new Map<string, Promise<void>>();

export function fontFamilyFor(fontId: string): string {
  return `ct_${fontId.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

export function loadFontCatalog(): Promise<FontInfo[]> {
  if (!catalogPromise) {
    catalogPromise = getFonts().catch((err) => {
      catalogPromise = null;
      throw err;
    });
  }
  return catalogPromise;
}

/** Charge une police (une seule fois) et l'enregistre dans document.fonts. */
export function ensureFont(font: FontInfo): Promise<void> {
  let p = loaded.get(font.id);
  if (!p) {
    const face = new FontFace(fontFamilyFor(font.id), `url(${absoluteFileUrl(font.url)})`);
    p = face
      .load()
      .then((f) => {
        document.fonts.add(f);
      })
      .catch((err) => {
        loaded.delete(font.id);
        console.warn('Police non chargée', font.id, err);
      });
    loaded.set(font.id, p);
  }
  return p;
}

export async function ensureFontById(fontId: string): Promise<FontInfo | null> {
  const fonts = await loadFontCatalog();
  const font = fonts.find((f) => f.id === fontId) || null;
  if (font) await ensureFont(font);
  return font;
}

export async function ensureAllFonts(): Promise<FontInfo[]> {
  const fonts = await loadFontCatalog();
  await Promise.all(fonts.map(ensureFont));
  return fonts;
}
