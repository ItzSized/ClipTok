// Types du cœur de l'éditeur partagé (implémentation : editorCore.js).
import type { CaptionStyle } from './captionEngine';

export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  flipH: boolean;
  flipV: boolean;
}

export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Adjust {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  temperature: number;
  tint: number;
  blur: number;
  vignette: number;
  sharpen: number;
}

export interface Keyframe {
  t: number;
  v: number;
  ease?: 'linear' | 'ease';
}

export type KeyframeProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';

export interface AnimRef {
  type: string;
  duration: number;
}

export interface LoopRef {
  type: string;
  speed: number;
}

export interface EffectRef {
  id: string;
  intensity?: number;
}

export interface ChromaKey {
  enabled: boolean;
  color: string;
  similarity: number;
  blend: number;
}

export interface TextStyle {
  fontId: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowBlur: number;
  shadowOffset: number;
  bgColor: string;
  bgOpacity: number;
  bgPadding: number;
  bgRadius: number;
  align: 'left' | 'center' | 'right';
  uppercase: boolean;
  letterSpacing: number;
  lineHeight: number;
  italic: boolean;
  underline: boolean;
}

export type ClipType = 'video' | 'image' | 'audio' | 'text' | 'sticker' | 'caption';

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
  loud?: boolean;
  probability?: number;
}

export interface Clip {
  id: string;
  trackId: string;
  type: ClipType;
  start: number;
  duration: number;
  name?: string;
  // Médias
  mediaId?: string;
  src?: string;
  mediaDuration?: number;
  trimStart?: number;
  speed?: number;
  volume?: number;
  muted?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  fit?: 'contain' | 'cover';
  // Visuel
  transform?: Transform;
  crop?: Crop;
  adjust?: Adjust;
  filter?: { id: string; intensity: number };
  effects?: EffectRef[];
  animIn?: AnimRef | null;
  animOut?: AnimRef | null;
  animLoop?: LoopRef | null;
  keyframes?: Partial<Record<KeyframeProp, Keyframe[]>>;
  chromaKey?: ChromaKey;
  // Texte / sticker
  text?: string;
  textStyle?: TextStyle;
  emoji?: string;
  box?: { w: number; h: number } | null;
  // Sous-titres
  words?: CaptionWord[];
  captionStyle?: Partial<CaptionStyle> | null;
}

export type TrackKind = 'visual' | 'audio' | 'caption';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  main?: boolean;
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
}

export interface Transition {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  duration: number;
}

export interface ProjectSettings {
  aspect: string;
  width: number;
  height: number;
  fps: number;
  background: { type: 'color' | 'blur'; color: string };
  normalizeAudio: boolean;
  /** Thème appliqué (THEMES) : sert de style par défaut aux sous-titres générés ensuite. */
  theme?: string;
}

export interface EditorProject {
  version: number;
  settings: ProjectSettings;
  tracks: Track[];
  clips: Clip[];
  transitions: Transition[];
}

export interface VisualState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface MediaLike {
  id: string;
  kind: 'video' | 'audio' | 'image';
  url: string;
  duration: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  name: string;
}

interface CatalogItem {
  id: string;
  name: string;
  category?: string;
}

export const TRANSITIONS: CatalogItem[];
export const ANIMATIONS_IN: CatalogItem[];
export const ANIMATIONS_OUT: (CatalogItem & { formula: string })[];
export const ANIMATIONS_LOOP: CatalogItem[];
export const EFFECTS: (CatalogItem & { motion?: Record<string, string>; pixel?: boolean })[];
export const DEFAULT_ADJUST: Adjust;
export const FILTER_PRESETS: (CatalogItem & { adjust: Partial<Adjust>; sepia?: number })[];
export const DEFAULT_TEXT_STYLE: TextStyle;
export const TEXT_PRESETS: (CatalogItem & { style: Partial<TextStyle> })[];
export const DEFAULT_TRANSFORM: Transform;
export const DEFAULT_CROP: Crop;
export const KEYFRAME_PROPS: KeyframeProp[];
export const ASPECT_RATIOS: { id: string; name: string; width: number; height: number }[];
export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: string[];
  filter: string;
  filterIntensity: number;
  transition: string;
  transitionDuration: number;
  effect: string | null;
  effectIntensity?: number;
  captionPreset: string;
  textPreset: string;
  textAnim: string;
  sfx: string | null;
}
export const THEMES: Theme[];

export function uid(prefix?: string): string;
export function createProject(opts?: { aspect?: string; width?: number; height?: number; fps?: number }): EditorProject;
export function isVisual(c: Clip): boolean;
export function hasSourceAudio(c: Clip): boolean;
export function clipEnd(c: Clip): number;
export function mainTrack(p: EditorProject): Track | undefined;
export function clipsOnTrack(p: EditorProject, trackId: string): Clip[];
export function transitionBetween(p: EditorProject, fromId: string, toId: string): Transition | null;
export function maxTransitionDuration(a: Clip, b: Clip): number;
export function packMainTrack(p: EditorProject): EditorProject;
export function projectDuration(p: EditorProject): number;
export function maxClipDuration(c: Clip): number;
export function sourceTimeAt(c: Clip, localT: number): number;
export function compileFormula(src: string): (vars: Record<string, number>) => number;
export function visualStateAt(c: Clip, t: number): VisualState;
export function visualStateExprs(c: Clip, T: string): { exprs: Record<KeyframeProp, string>; animated: Record<KeyframeProp, boolean> };
export function sampleStates(c: Clip, fps?: number): VisualState[];
export function interpolateKeys(keys: Keyframe[], t: number): number;
export function croppedSourceSize(c: Clip): { w: number; h: number };
export function baseLayerSize(c: Clip, W: number, H: number): { w: number; h: number };
export function colorMatrix(c: Clip): number[];
export function isIdentityMatrix(m: number[]): boolean;
export function effectiveAdjust(c: Clip): { adjust: Adjust; sepia: number };
export function createMediaClip(media: MediaLike, trackId: string, start?: number): Clip;
export function createTextClip(trackId: string, start?: number, text?: string, presetId?: string): Clip;
export function createStickerClip(trackId: string, start?: number, emoji?: string): Clip;
export function createCaptionClip(trackId: string, start: number, duration: number, words?: CaptionWord[], captionStyle?: Partial<CaptionStyle> | null): Clip;
