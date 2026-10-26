/**
 * Moteur d'aperçu de l'éditeur.
 *
 * Compose en temps réel, dans un <canvas>, l'image du projet au temps courant
 * en suivant exactement le modèle de shared/editorCore (mêmes formules
 * d'animation, mêmes tailles, même matrice couleur, transitions équivalentes
 * aux xfade d'ffmpeg). Gère aussi l'horloge de lecture et synchronise les
 * éléments <video>/<audio> (un par clip) sur cette horloge.
 */
import * as core from '@shared/editorCore';
import type { Clip, EditorProject, Track } from '@shared/editorCore';
import { absoluteFileUrl } from '@/lib/api';
import type { FontInfo } from '@/lib/types';
import { prepareCaptions, drawCaptions, type PreparedCaptions } from '@/lib/captionCanvas';
import { rasterizeClip, rasterKey } from './textRaster';
import { canvasFilterFor } from './colorFilter';
import { drawTransition } from './transitions';

type Listener = (time: number, playing: boolean) => void;

export interface LayerGeometry {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

let noiseCanvas: HTMLCanvasElement | null = null;
function noise() {
  if (!noiseCanvas) {
    noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = noiseCanvas.height = 256;
    const c = noiseCanvas.getContext('2d')!;
    const img = c.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }
  return noiseCanvas;
}

function makeCanvas() {
  return document.createElement('canvas');
}

function sized(c: HTMLCanvasElement, w: number, h: number) {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, W, H);
  return ctx;
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class PreviewEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  project: EditorProject;
  time = 0;
  playing = false;
  volume = 1;

  private videos = new Map<string, HTMLVideoElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private images = new Map<string, HTMLImageElement>();
  private rasters = new Map<string, { key: string; canvas: HTMLCanvasElement }>();
  private captions = new Map<string, { words: unknown; style: unknown; prepared: PreparedCaptions }>();
  private fonts = new Map<string, FontInfo>();
  private listeners = new Set<Listener>();
  private offA = makeCanvas();
  private offB = makeCanvas();
  private scratch = makeCanvas();
  private fx1 = makeCanvas();
  private fx2 = makeCanvas();
  private fx3 = makeCanvas();
  private raf = 0;
  private renderQueued = false;
  private playStartPerf = 0;
  private playStartTime = 0;
  private destroyed = false;

  constructor(project: EditorProject) {
    this.project = project;
  }

  // ---------------------------------------------------------------- setup

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.requestRender();
  }

  setFonts(list: FontInfo[]) {
    for (const f of list) this.fonts.set(f.id, f);
    this.rasters.clear();
    this.requestRender();
  }

  setProject(project: EditorProject) {
    // Réactivation possible après destroy() (double montage de React en mode strict).
    this.destroyed = false;
    this.project = project;
    this.syncElements();
    this.syncMedia();
    this.requestRender();
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  get duration() {
    return core.projectDuration(this.project);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    for (const el of [...this.videos.values(), ...this.audios.values()]) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.videos.clear();
    this.audios.clear();
  }

  private emit() {
    for (const fn of this.listeners) fn(this.time, this.playing);
  }

  private track(id: string): Track | undefined {
    return this.project.tracks.find((t) => t.id === id);
  }

  /** Crée / supprime les éléments média nécessaires aux clips du projet. */
  private syncElements() {
    const ids = new Set(this.project.clips.map((c) => c.id));
    for (const [id, el] of this.videos) {
      if (!ids.has(id)) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        this.videos.delete(id);
      }
    }
    for (const [id, el] of this.audios) {
      if (!ids.has(id)) {
        el.pause();
        this.audios.delete(id);
      }
    }
    for (const clip of this.project.clips) {
      if (!clip.src) continue;
      const url = absoluteFileUrl(clip.src);
      if (clip.type === 'video') {
        let el = this.videos.get(clip.id);
        if (!el || el.dataset.src !== url) {
          el = el || document.createElement('video');
          el.crossOrigin = 'anonymous';
          el.preload = 'auto';
          el.playsInline = true;
          el.dataset.src = url;
          el.src = url;
          el.addEventListener('seeked', () => this.requestRender());
          el.addEventListener('loadeddata', () => this.requestRender());
          this.videos.set(clip.id, el);
        }
      } else if (clip.type === 'audio') {
        let el = this.audios.get(clip.id);
        if (!el || el.dataset.src !== url) {
          el = el || document.createElement('audio');
          el.crossOrigin = 'anonymous';
          el.preload = 'auto';
          el.dataset.src = url;
          el.src = url;
          this.audios.set(clip.id, el);
        }
      } else if (clip.type === 'image' && !this.images.has(url)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => this.requestRender();
        img.src = url;
        this.images.set(url, img);
      }
    }
  }

  // -------------------------------------------------------------- lecture

  play() {
    if (this.playing) return;
    if (this.time >= this.duration - 0.02) this.time = 0;
    this.playing = true;
    this.playStartPerf = performance.now();
    this.playStartTime = this.time;
    this.syncMedia();
    this.loop();
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.syncMedia();
    this.requestRender();
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    this.time = Math.max(0, Math.min(t, Math.max(this.duration, 0)));
    if (this.playing) {
      this.playStartPerf = performance.now();
      this.playStartTime = this.time;
    }
    this.syncMedia(true);
    this.requestRender();
    this.emit();
  }

  private loop = () => {
    if (!this.playing || this.destroyed) return;
    this.time = this.playStartTime + (performance.now() - this.playStartPerf) / 1000;
    if (this.time >= this.duration) {
      this.time = this.duration;
      this.playing = false;
      this.syncMedia();
      this.render();
      this.emit();
      return;
    }
    this.syncMedia();
    this.render();
    this.emit();
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Gain (0..1) d'un clip à son temps local : fondus manuels + fondus croisés des transitions. */
  private gainAt(clip: Clip, local: number) {
    let g = 1;
    let fadeIn = clip.fadeIn || 0;
    let fadeOut = clip.fadeOut || 0;
    const before = this.project.transitions.find((t) => t.toId === clip.id);
    const after = this.project.transitions.find((t) => t.fromId === clip.id);
    if (before) fadeIn = Math.max(fadeIn, before.duration);
    if (after) fadeOut = Math.max(fadeOut, after.duration);
    if (fadeIn > 0) g *= Math.min(1, local / fadeIn);
    if (fadeOut > 0) g *= Math.min(1, (clip.duration - local) / fadeOut);
    return Math.max(0, Math.min(1, g));
  }

  /** Aligne chaque élément média sur l'horloge (lecture, position, volume). */
  private syncMedia(force = false) {
    const t = this.time;
    const sync = (clip: Clip, el: HTMLMediaElement) => {
      const track = this.track(clip.trackId);
      const local = t - clip.start;
      const active = local >= 0 && local < clip.duration && !(clip.type === 'video' && track?.hidden);
      if (!active) {
        if (!el.paused) el.pause();
        // Préchargement : on se place au point d'entrée juste avant que le clip commence.
        if (local < 0 && local > -2 && el.readyState >= 1 && Math.abs(el.currentTime - (clip.trimStart || 0)) > 0.1) el.currentTime = clip.trimStart || 0;
        return;
      }
      const desired = core.sourceTimeAt(clip, local);
      const audible = !clip.muted && !track?.muted && (clip.volume ?? 1) > 0 && (clip.type !== 'video' || clip.hasAudio !== false);
      el.muted = !audible;
      el.volume = Math.min(1, (clip.volume ?? 1) * this.gainAt(clip, local) * this.volume);
      if (this.playing) {
        const rate = Math.min(16, Math.max(0.0625, clip.speed || 1));
        if (el.playbackRate !== rate) el.playbackRate = rate;
        if (el.paused) {
          el.currentTime = desired;
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - desired) > 0.25 * rate) {
          el.currentTime = desired;
        }
      } else {
        if (!el.paused) el.pause();
        if (force || Math.abs(el.currentTime - desired) > 0.03) {
          if (el.readyState >= 1) el.currentTime = desired;
        }
      }
    };
    for (const clip of this.project.clips) {
      if (clip.type === 'video') {
        const el = this.videos.get(clip.id);
        if (el) sync(clip, el);
      } else if (clip.type === 'audio') {
        const el = this.audios.get(clip.id);
        if (el) sync(clip, el);
      }
    }
  }

  // --------------------------------------------------------------- rendu

  requestRender() {
    if (this.renderQueued || this.playing) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private sourceFor(clip: Clip): CanvasImageSource | null {
    if (clip.type === 'video') {
      const el = this.videos.get(clip.id);
      return el && el.readyState >= 2 ? el : null;
    }
    if (clip.type === 'image') {
      const img = clip.src ? this.images.get(absoluteFileUrl(clip.src)) : null;
      return img && img.complete && img.naturalWidth > 0 ? img : null;
    }
    if (clip.type === 'text' || clip.type === 'sticker') return this.rasterFor(clip);
    return null;
  }

  /** Canevas du texte / sticker à la résolution du projet (mis en cache). */
  rasterFor(clip: Clip) {
    const { width, height } = this.project.settings;
    const key = rasterKey(clip, width, height);
    const cached = this.rasters.get(clip.id);
    if (cached && cached.key === key) return cached.canvas;
    const canvas = rasterizeClip(clip, width, height, 1);
    this.rasters.set(clip.id, { key, canvas });
    return canvas;
  }

  /** Taille du calque (px projet) à l'échelle 1. */
  private baseSize(clip: Clip) {
    const { width, height } = this.project.settings;
    if (clip.type === 'text' || clip.type === 'sticker') {
      const r = this.rasterFor(clip);
      return { w: r.width, h: r.height };
    }
    return core.baseLayerSize(clip, width, height);
  }

  /** Géométrie du calque dans le canevas d'aperçu (pour la sélection et les poignées). */
  geometry(clip: Clip, t = this.time): LayerGeometry | null {
    if (!this.canvas) return null;
    const local = t - clip.start;
    if (local < 0 || local > clip.duration) return null;
    const k = this.canvas.width / this.project.settings.width;
    const s = core.visualStateAt(clip, Math.min(local, clip.duration));
    const base = this.baseSize(clip);
    return { cx: s.x * this.canvas.width, cy: s.y * this.canvas.height, w: base.w * s.scale * k, h: base.h * s.scale * k, rotation: s.rotation };
  }

  /** Clip visuel le plus haut sous le point (coordonnées du canevas). */
  hitTest(x: number, y: number): string | null {
    const order = this.visualOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const clip = order[i];
      const g = this.geometry(clip);
      if (!g) continue;
      const a = (-g.rotation * Math.PI) / 180;
      const dx = x - g.cx;
      const dy = y - g.cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= g.w / 2 && Math.abs(ly) <= g.h / 2) return clip.id;
    }
    return null;
  }

  /** Clips visuels actifs, du plus bas au plus haut (ordre de dessin). */
  private visualOrder(t = this.time): Clip[] {
    const out: Clip[] = [];
    const main = core.mainTrack(this.project);
    const tracks = this.project.tracks.filter((tr) => tr.kind === 'visual' && !tr.hidden).reverse();
    if (main && !main.hidden) out.push(...this.activeOn(main.id, t));
    for (const tr of tracks) if (!main || tr.id !== main.id) out.push(...this.activeOn(tr.id, t));
    return out.filter((c) => core.isVisual(c));
  }

  private activeOn(trackId: string, t: number) {
    return core.clipsOnTrack(this.project, trackId).filter((c) => t >= c.start && t < core.clipEnd(c));
  }

  render() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const t = this.time;
    const bg = this.project.settings.background || { type: 'color', color: '#000000' };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = bg.color || '#000';
    ctx.fillRect(0, 0, W, H);

    const main = core.mainTrack(this.project);
    if (main && !main.hidden) {
      const active = this.activeOn(main.id, t).filter((c) => c.type === 'video' || c.type === 'image');
      if (active.length >= 2) {
        const [A, B] = active;
        const tr = core.transitionBetween(this.project, A.id, B.id);
        const ca = sized(this.offA, W, H);
        const cb = sized(this.offB, W, H);
        this.drawMainFull(ca, A, W, H);
        this.drawMainFull(cb, B, W, H);
        const p = tr ? (t - B.start) / tr.duration : 1;
        drawTransition(ctx, tr ? tr.type : 'fade', this.offA, this.offB, p, W, H);
      } else if (active.length === 1) {
        this.drawMainFull(ctx, active[0], W, H);
      }
    }

    const tracks = this.project.tracks.filter((tr) => tr.kind === 'visual' && !tr.hidden).reverse();
    for (const tr of tracks) {
      if (main && tr.id === main.id) continue;
      for (const clip of this.activeOn(tr.id, t)) if (core.isVisual(clip)) this.drawLayer(ctx, clip, W, H);
    }

    for (const tr of this.project.tracks.filter((x) => x.kind === 'caption' && !x.hidden)) {
      for (const clip of this.activeOn(tr.id, t)) {
        if (clip.type !== 'caption' || !clip.words?.length) continue;
        const prepared = this.captionPrep(clip);
        const font = this.fonts.get(prepared.style.fontId);
        drawCaptions(ctx, prepared, font, t - clip.start, W, H);
      }
    }
  }

  private captionPrep(clip: Clip) {
    const cached = this.captions.get(clip.id);
    if (cached && cached.words === clip.words && cached.style === clip.captionStyle) return cached.prepared;
    const prepared = prepareCaptions(clip.words || [], clip.captionStyle || {});
    this.captions.set(clip.id, { words: clip.words, style: clip.captionStyle, prepared });
    return prepared;
  }

  /** Clip de la piste principale : fond (couleur ou flou) + calque. */
  private drawMainFull(ctx: CanvasRenderingContext2D, clip: Clip, W: number, H: number) {
    const bg = this.project.settings.background || { type: 'color', color: '#000000' };
    ctx.save();
    ctx.fillStyle = bg.color || '#000';
    ctx.fillRect(0, 0, W, H);
    const src = this.sourceFor(clip);
    if (bg.type === 'blur' && src && clip.type === 'video') {
      const sw = clip.width || W;
      const sh = clip.height || H;
      const cover = Math.max(W / sw, H / sh);
      ctx.filter = `blur(${Math.max(W, H) / 40}px) brightness(0.92)`;
      ctx.drawImage(src, (W - sw * cover) / 2, (H - sh * cover) / 2, sw * cover, sh * cover);
      ctx.filter = 'none';
    }
    ctx.restore();
    this.drawLayer(ctx, clip, W, H);
  }

  private drawLayer(ctx: CanvasRenderingContext2D, clip: Clip, W: number, H: number) {
    const src = this.sourceFor(clip);
    if (!src) return;
    const local = this.time - clip.start;
    const k = W / this.project.settings.width;
    const state = core.visualStateAt(clip, local);
    const base = this.baseSize(clip);
    const w = base.w * state.scale * k;
    const h = base.h * state.scale * k;
    if (w < 1 || h < 1 || state.opacity <= 0) return;

    // Rectangle source (recadrage) pour les médias.
    let sx = 0;
    let sy = 0;
    let sw = (src as HTMLCanvasElement).width || 1;
    let sh = (src as HTMLCanvasElement).height || 1;
    if (clip.type === 'video' || clip.type === 'image') {
      const nw = clip.type === 'video' ? (src as HTMLVideoElement).videoWidth : (src as HTMLImageElement).naturalWidth;
      const nh = clip.type === 'video' ? (src as HTMLVideoElement).videoHeight : (src as HTMLImageElement).naturalHeight;
      const crop = { ...core.DEFAULT_CROP, ...(clip.crop || {}) };
      sx = nw * crop.left;
      sy = nh * crop.top;
      sw = Math.max(1, nw * (1 - crop.left - crop.right));
      sh = Math.max(1, nh * (1 - crop.top - crop.bottom));
    }

    const effects = clip.effects || [];
    const needsScratch =
      clip.chromaKey?.enabled || effects.some((e) => ['pixelate', 'mirror', 'rgb-split', 'grain', 'vhs', 'vignette', 'old-film'].includes(e.id)) || (core.effectiveAdjust(clip).adjust.vignette > 0);

    let drawable: CanvasImageSource = src;
    let dsx = sx;
    let dsy = sy;
    let dsw = sw;
    let dsh = sh;
    if (needsScratch && clip.type !== 'text' && clip.type !== 'sticker') {
      drawable = this.processPixels(clip, src, sx, sy, sw, sh, w, h, k);
      dsx = 0;
      dsy = 0;
      dsw = (drawable as HTMLCanvasElement).width;
      dsh = (drawable as HTMLCanvasElement).height;
    }

    ctx.save();
    ctx.translate(state.x * W, state.y * H);
    ctx.rotate((state.rotation * Math.PI) / 180);
    ctx.scale(clip.transform?.flipH ? -1 : 1, clip.transform?.flipV ? -1 : 1);
    ctx.globalAlpha = state.opacity;
    ctx.filter = canvasFilterFor(clip, local, k);
    ctx.drawImage(drawable, dsx, dsy, dsw, dsh, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /** Effets "pixel" (chroma key, pixelisation, miroir, RVB, grain, vignettage) sur un canevas intermédiaire. */
  private processPixels(clip: Clip, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number, k: number) {
    const effects = clip.effects || [];
    const ctx = sized(this.scratch, w, h);
    const W = this.scratch.width;
    const H = this.scratch.height;
    const pix = effects.find((e) => e.id === 'pixelate');
    if (pix) {
      const f = Math.max(2, Math.round(4 + 36 * (pix.intensity ?? 0.6)));
      const tw = Math.max(1, Math.round(W / f));
      const th = Math.max(1, Math.round(H / f));
      const c2 = sized(this.fx1, tw, th);
      c2.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.fx1, 0, 0, tw, th, 0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
    } else {
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
    }

    if (clip.chromaKey?.enabled) {
      const [kr, kg, kb] = hexToRgb(clip.chromaKey.color);
      const sim = Math.max(0.01, clip.chromaKey.similarity) * 441.67;
      const blend = (clip.chromaKey.blend || 0) * 441.67;
      try {
        const img = ctx.getImageData(0, 0, W, H);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const dist = Math.hypot(d[i] - kr, d[i + 1] - kg, d[i + 2] - kb);
          if (dist < sim) d[i + 3] = 0;
          else if (blend > 0 && dist < sim + blend) d[i + 3] = Math.round((d[i + 3] * (dist - sim)) / blend);
        }
        ctx.putImageData(img, 0, 0);
      } catch {
        // Canevas "tainted" (média sans CORS) : on ignore le chroma key en aperçu.
      }
    }

    if (effects.some((e) => e.id === 'mirror')) {
      const half = Math.floor(W / 2);
      const c2 = sized(this.fx1, half, H);
      c2.drawImage(this.scratch, 0, 0, half, H, 0, 0, half, H);
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.fx1, 0, 0, half, H, 0, 0, half, H);
      ctx.restore();
    }

    const rgb = effects.find((e) => e.id === 'rgb-split' || e.id === 'vhs');
    if (rgb) {
      const px = Math.max(1, (rgb.id === 'vhs' ? 6 : 14) * (rgb.intensity ?? 0.6) * k * 1.0);
      const channels: [HTMLCanvasElement, string, number][] = [
        [this.fx1, '#ff0000', -px],
        [this.fx2, '#00ff00', 0],
        [this.fx3, '#0000ff', px],
      ];
      for (const [c, color] of channels) {
        const cc = sized(c, W, H);
        cc.drawImage(this.scratch, 0, 0);
        cc.globalCompositeOperation = 'multiply';
        cc.fillStyle = color;
        cc.fillRect(0, 0, W, H);
        cc.globalCompositeOperation = 'destination-in';
        cc.drawImage(this.scratch, 0, 0);
      }
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const [c, , dx] of channels) ctx.drawImage(c, dx, 0);
      ctx.globalCompositeOperation = 'source-over';
    }

    const grain = effects.find((e) => e.id === 'grain' || e.id === 'vhs' || e.id === 'old-film');
    if (grain) {
      const n = noise();
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.25 + 0.5 * (grain.intensity ?? 0.6);
      const ox = Math.floor(Math.random() * 256);
      const oy = Math.floor(Math.random() * 256);
      ctx.translate(-ox, -oy);
      ctx.fillStyle = ctx.createPattern(n, 'repeat')!;
      ctx.fillRect(ox, oy, W, H);
      ctx.restore();
    }

    const vig = effects.find((e) => e.id === 'vignette' || e.id === 'old-film');
    const vigAmount = Math.max(vig ? 0.3 + 0.6 * (vig.intensity ?? 0.6) : 0, core.effectiveAdjust(clip).adjust.vignette);
    if (vigAmount > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, vigAmount)})`);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    return this.scratch;
  }

  /** Image courante d'un clip vidéo à sa résolution native (pour "figer l'image"). */
  captureFrame(clipId: string): HTMLCanvasElement | null {
    const el = this.videos.get(clipId);
    if (!el || el.readyState < 2) return null;
    const c = document.createElement('canvas');
    c.width = el.videoWidth;
    c.height = el.videoHeight;
    c.getContext('2d')!.drawImage(el, 0, 0);
    return c;
  }
}
