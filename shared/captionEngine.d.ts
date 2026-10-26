// Types du moteur de sous-titres partagé (implémentation : captionEngine.js).

export type CaptionAnimation = 'none' | 'pop' | 'fade' | 'slide-up' | 'word-pop' | 'bounce' | 'karaoke' | 'typewriter';
export type HighlightMode = 'none' | 'color' | 'box' | 'underline';

export interface CaptionStyle {
  preset: string;
  fontId: string;
  fontSize: number;
  uppercase: boolean;
  letterSpacing: number;
  textColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowDepth: number;
  glow: boolean;
  background: 'none' | 'box';
  backgroundColor: string;
  backgroundOpacity: number;
  boxPadding: number;
  highlightMode: HighlightMode;
  highlightColors: string[];
  highlightTextColor: string;
  highlightScale: number;
  animation: CaptionAnimation;
  positionX: number;
  positionY: number;
  wordsPerPage: number;
  maxLines: number;
  maxCharsPerLine: number;
  breakOnPunctuation: boolean;
  punctuation: 'keep' | 'remove';
  emphasizeLoud: boolean;
  loudColor: string;
}

export interface CaptionWordInput {
  text?: string;
  word?: string;
  start: number;
  end: number;
  loud?: boolean;
  probability?: number;
}

export interface PreparedWord {
  text: string;
  display: string;
  start: number;
  end: number;
  loud: boolean;
}

export interface CaptionPage {
  index: number;
  start: number;
  end: number;
  words: PreparedWord[];
  lines: number[][];
}

export interface WordSlot {
  start: number;
  end: number;
}

export interface CaptionState {
  page: CaptionPage;
  activeIndex: number;
  pageTime: number;
  wordTime: number;
  slots: WordSlot[];
}

export interface CaptionPreset {
  id: string;
  name: string;
  description: string;
  style: Partial<CaptionStyle>;
}

export interface FontMetrics {
  assName: string;
  emRatio: number;
  ascentRatio?: number;
}

export interface CaptionMetrics {
  emPx: number;
  assSize: number;
  outline: number;
  shadow: number;
  spacing: number;
  padding: number;
  x: number;
  y: number;
}

export const DEFAULT_STYLE: CaptionStyle;
export const PRESETS: CaptionPreset[];
export const ANIMATIONS: { id: CaptionAnimation; name: string }[];
export const HIGHLIGHT_MODES: { id: HighlightMode; name: string }[];

export function resolveStyle(style?: Partial<CaptionStyle> | null): CaptionStyle;
export function applyPreset(presetId: string, keep?: Partial<CaptionStyle>): CaptionStyle;
export function getPreset(id: string): CaptionPreset;
export function prepareWords(words: CaptionWordInput[], style?: Partial<CaptionStyle>): PreparedWord[];
export function paginate(words: PreparedWord[], style?: Partial<CaptionStyle>): CaptionPage[];
export function layoutLines(words: PreparedWord[], maxChars: number, maxLines: number): number[][];
export function wordSlots(page: CaptionPage): WordSlot[];
export function getStateAt(pages: CaptionPage[], t: number): CaptionState | null;
export function highlightColorFor(style: CaptionStyle, pageIndex: number): string;
export function computeMetrics(style: Partial<CaptionStyle>, width: number, height: number, font?: FontMetrics | null): CaptionMetrics;
export function buildAss(opts: {
  words: CaptionWordInput[];
  style: Partial<CaptionStyle>;
  width: number;
  height: number;
  font?: FontMetrics | null;
  hook?: { text: string; duration?: number } | null;
}): string;
export function toSrt(words: CaptionWordInput[], style?: Partial<CaptionStyle>): string;
export function toVtt(words: CaptionWordInput[], style?: Partial<CaptionStyle>): string;
export function toPlainText(words: CaptionWordInput[]): string;
export function formatAssTime(seconds: number): string;
export function assColor(hex: string, opacity?: number): string;
export const COLOR_PALETTES: { id: string; name: string; textColor: string; outlineColor: string; highlightColors: string[] }[];
