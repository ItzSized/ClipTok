/**
 * Transitions de l'aperçu, calquées sur les transitions xfade d'ffmpeg
 * utilisées à l'export (même sens d'entrée, même forme).
 * A = clip sortant, B = clip entrant, p = progression 0 -> 1.
 */

type Src = HTMLCanvasElement;

let tmp: HTMLCanvasElement | null = null;
function scratch(W: number, H: number) {
  if (!tmp) tmp = document.createElement('canvas');
  if (tmp.width !== W || tmp.height !== H) {
    tmp.width = W;
    tmp.height = H;
  }
  const c = tmp.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.filter = 'none';
  c.clearRect(0, 0, W, H);
  return { canvas: tmp, ctx: c };
}

function clipped(ctx: CanvasRenderingContext2D, src: Src, path: (c: CanvasRenderingContext2D) => void) {
  ctx.save();
  ctx.beginPath();
  path(ctx);
  ctx.clip();
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

/** Balayage doux : B révélé derrière un dégradé qui se déplace. */
function smooth(ctx: CanvasRenderingContext2D, A: Src, B: Src, p: number, W: number, H: number, dir: 'left' | 'right' | 'up' | 'down') {
  ctx.drawImage(A, 0, 0);
  const { canvas, ctx: c } = scratch(W, H);
  c.drawImage(B, 0, 0);
  const horizontal = dir === 'left' || dir === 'right';
  const len = horizontal ? W : H;
  const soft = len * 0.25;
  const edge = -soft + p * (len + 2 * soft);
  let g: CanvasGradient;
  if (dir === 'left') g = c.createLinearGradient(W, 0, 0, 0);
  else if (dir === 'right') g = c.createLinearGradient(0, 0, W, 0);
  else if (dir === 'up') g = c.createLinearGradient(0, H, 0, 0);
  else g = c.createLinearGradient(0, 0, 0, H);
  const a = Math.min(1, Math.max(0, (edge - soft / 2) / len));
  const b = Math.min(1, Math.max(0, (edge + soft / 2) / len));
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(a, 'rgba(0,0,0,1)');
  g.addColorStop(Math.max(a, b), 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.globalCompositeOperation = 'destination-in';
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  ctx.drawImage(canvas, 0, 0);
}

export function drawTransition(ctx: CanvasRenderingContext2D, type: string, A: Src, B: Src, rawP: number, W: number, H: number) {
  const p = Math.min(1, Math.max(0, rawP));
  const maxR = Math.hypot(W, H) / 2;
  ctx.save();
  switch (type) {
    case 'fadeblack':
    case 'fadewhite': {
      const color = type === 'fadeblack' ? '#000' : '#fff';
      ctx.drawImage(p < 0.5 ? A : B, 0, 0);
      ctx.globalAlpha = p < 0.5 ? p * 2 : (1 - p) * 2;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'wipeleft':
      ctx.drawImage(A, 0, 0);
      clipped(ctx, B, (c) => c.rect(W * (1 - p), 0, W * p, H));
      break;
    case 'wiperight':
      ctx.drawImage(A, 0, 0);
      clipped(ctx, B, (c) => c.rect(0, 0, W * p, H));
      break;
    case 'wipeup':
      ctx.drawImage(A, 0, 0);
      clipped(ctx, B, (c) => c.rect(0, H * (1 - p), W, H * p));
      break;
    case 'wipedown':
      ctx.drawImage(A, 0, 0);
      clipped(ctx, B, (c) => c.rect(0, 0, W, H * p));
      break;
    case 'smoothleft':
      smooth(ctx, A, B, p, W, H, 'left');
      break;
    case 'smoothright':
      smooth(ctx, A, B, p, W, H, 'right');
      break;
    case 'smoothup':
      smooth(ctx, A, B, p, W, H, 'up');
      break;
    case 'smoothdown':
      smooth(ctx, A, B, p, W, H, 'down');
      break;
    case 'slideleft':
      ctx.drawImage(A, -W * p, 0);
      ctx.drawImage(B, W * (1 - p), 0);
      break;
    case 'slideright':
      ctx.drawImage(A, W * p, 0);
      ctx.drawImage(B, -W * (1 - p), 0);
      break;
    case 'slideup':
      ctx.drawImage(A, 0, -H * p);
      ctx.drawImage(B, 0, H * (1 - p));
      break;
    case 'slidedown':
      ctx.drawImage(A, 0, H * p);
      ctx.drawImage(B, 0, -H * (1 - p));
      break;
    case 'circleopen':
      ctx.drawImage(A, 0, 0);
      clipped(ctx, B, (c) => c.arc(W / 2, H / 2, maxR * p, 0, Math.PI * 2));
      break;
    case 'circleclose':
      ctx.drawImage(B, 0, 0);
      clipped(ctx, A, (c) => c.arc(W / 2, H / 2, maxR * (1 - p), 0, Math.PI * 2));
      break;
    case 'radial':
      ctx.drawImage(A, 0, 0);
      clipped(ctx, B, (c) => {
        c.moveTo(W / 2, H / 2);
        c.arc(W / 2, H / 2, maxR * 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        c.closePath();
      });
      break;
    case 'horzopen':
      ctx.drawImage(A, 0, 0);
      clipped(ctx, B, (c) => c.rect(0, H / 2 - (H * p) / 2, W, H * p));
      break;
    case 'vertopen':
      ctx.drawImage(A, 0, 0);
      clipped(ctx, B, (c) => c.rect(W / 2 - (W * p) / 2, 0, W * p, H));
      break;
    case 'rectcrop': {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const k = p < 0.5 ? 1 - p * 2 : p * 2 - 1;
      clipped(ctx, p < 0.5 ? A : B, (c) => c.rect((W * (1 - k)) / 2, (H * (1 - k)) / 2, W * k, H * k));
      break;
    }
    case 'zoomin': {
      ctx.drawImage(B, 0, 0);
      ctx.globalAlpha = 1 - p;
      const s = 1 + p;
      ctx.drawImage(A, (W - W * s) / 2, (H - H * s) / 2, W * s, H * s);
      break;
    }
    case 'squeezeh':
      ctx.drawImage(B, 0, 0);
      ctx.drawImage(A, 0, (H * p) / 2, W, H * (1 - p));
      break;
    case 'squeezev':
      ctx.drawImage(B, 0, 0);
      ctx.drawImage(A, (W * p) / 2, 0, W * (1 - p), H);
      break;
    case 'hblur': {
      const blur = Math.sin(Math.PI * p) * Math.max(W, H) * 0.03;
      ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(A, 0, 0);
      ctx.globalAlpha = p;
      ctx.drawImage(B, 0, 0);
      break;
    }
    case 'pixelize': {
      const { canvas, ctx: c } = scratch(W, H);
      const cells = Math.max(1, Math.round(1 + Math.sin(Math.PI * p) * 40));
      const sw = Math.max(1, Math.round(W / cells));
      const sh = Math.max(1, Math.round(H / cells));
      c.drawImage(A, 0, 0, sw, sh);
      c.globalAlpha = p;
      c.drawImage(B, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, sw, sh, 0, 0, W, H);
      break;
    }
    case 'fadefast':
    case 'fadeslow':
      ctx.drawImage(A, 0, 0);
      ctx.globalAlpha = type === 'fadefast' ? Math.sqrt(p) : p * p;
      ctx.drawImage(B, 0, 0);
      break;
    case 'fadegrays': {
      // A passe en gris, puis B arrive depuis le gris.
      const g = Math.sin(Math.PI * p);
      ctx.filter = `grayscale(${g})`;
      ctx.drawImage(A, 0, 0);
      ctx.globalAlpha = p;
      ctx.drawImage(B, 0, 0);
      break;
    }
    case 'distance': {
      ctx.drawImage(B, 0, 0);
      ctx.globalAlpha = 1 - p;
      const s = 1 - 0.25 * p;
      ctx.drawImage(A, (W - W * s) / 2, (H - H * s) / 2, W * s, H * s);
      break;
    }
    case 'wipetl':
    case 'wipetr':
    case 'wipebl':
    case 'wipebr': {
      ctx.drawImage(A, 0, 0);
      const x = type === 'wipetl' || type === 'wipebl' ? 0 : W * (1 - p);
      const y = type === 'wipetl' || type === 'wipetr' ? 0 : H * (1 - p);
      clipped(ctx, B, (c) => c.rect(x, y, W * p, H * p));
      break;
    }
    case 'diagtl':
    case 'diagtr':
    case 'diagbl':
    case 'diagbr': {
      ctx.drawImage(A, 0, 0);
      const ox = type === 'diagtl' || type === 'diagbl' ? 0 : W;
      const oy = type === 'diagtl' || type === 'diagtr' ? 0 : H;
      const dx = ox === 0 ? 1 : -1;
      const dy = oy === 0 ? 1 : -1;
      clipped(ctx, B, (c) => {
        c.moveTo(ox, oy);
        c.lineTo(ox + dx * 2 * p * W, oy);
        c.lineTo(ox, oy + dy * 2 * p * H);
        c.closePath();
      });
      break;
    }
    case 'coverleft':
      ctx.drawImage(A, 0, 0);
      ctx.drawImage(B, W * (1 - p), 0);
      break;
    case 'coverright':
      ctx.drawImage(A, 0, 0);
      ctx.drawImage(B, -W * (1 - p), 0);
      break;
    case 'coverup':
      ctx.drawImage(A, 0, 0);
      ctx.drawImage(B, 0, H * (1 - p));
      break;
    case 'coverdown':
      ctx.drawImage(A, 0, 0);
      ctx.drawImage(B, 0, -H * (1 - p));
      break;
    case 'revealleft':
      ctx.drawImage(B, 0, 0);
      ctx.drawImage(A, -W * p, 0);
      break;
    case 'revealright':
      ctx.drawImage(B, 0, 0);
      ctx.drawImage(A, W * p, 0);
      break;
    case 'revealup':
      ctx.drawImage(B, 0, 0);
      ctx.drawImage(A, 0, -H * p);
      break;
    case 'revealdown':
      ctx.drawImage(B, 0, 0);
      ctx.drawImage(A, 0, H * p);
      break;
    case 'circlecrop': {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const k = p < 0.5 ? 1 - p * 2 : p * 2 - 1;
      clipped(ctx, p < 0.5 ? A : B, (c) => c.arc(W / 2, H / 2, maxR * k, 0, Math.PI * 2));
      break;
    }
    case 'horzclose':
      ctx.drawImage(B, 0, 0);
      clipped(ctx, A, (c) => c.rect(0, (H * p) / 2, W, H * (1 - p)));
      break;
    case 'vertclose':
      ctx.drawImage(B, 0, 0);
      clipped(ctx, A, (c) => c.rect((W * p) / 2, 0, W * (1 - p), H));
      break;
    case 'hlslice':
    case 'hrslice':
    case 'vuslice':
    case 'vdslice':
    case 'hlwind':
    case 'hrwind':
    case 'vuwind':
    case 'vdwind': {
      // Bandes révélées en décalé (tranches régulières, ou irrégulières pour le « vent »).
      ctx.drawImage(A, 0, 0);
      const vertical = type[0] === 'h'; // tranches verticales qui balaient horizontalement
      const reverse = type === 'hlslice' || type === 'hlwind' || type === 'vuslice' || type === 'vuwind';
      const wind = type.endsWith('wind');
      const n = wind ? 48 : 10;
      clipped(ctx, B, (c) => {
        for (let i = 0; i < n; i++) {
          const order = wind ? (Math.sin(i * 12.9898) * 43758.5453) % 1 : i / n;
          const delay = Math.abs(order) * 0.5;
          const lp = Math.min(1, Math.max(0, (p - delay) / 0.5));
          if (lp <= 0) continue;
          if (vertical) {
            const size = W / n;
            const idx = reverse ? n - 1 - i : i;
            if (wind) c.rect(reverse ? W * (1 - lp) : 0, (H / n) * i, W * lp, H / n + 1);
            else c.rect(idx * size + (reverse ? size * (1 - lp) : 0), 0, size * lp + 1, H);
          } else {
            const size = H / n;
            const idx = reverse ? n - 1 - i : i;
            if (wind) c.rect((W / n) * i, reverse ? H * (1 - lp) : 0, W / n + 1, H * lp);
            else c.rect(0, idx * size + (reverse ? size * (1 - lp) : 0), W, size * lp + 1);
          }
        }
      });
      break;
    }
    case 'fade':
    case 'dissolve':
    default:
      ctx.drawImage(A, 0, 0);
      ctx.globalAlpha = p;
      ctx.drawImage(B, 0, 0);
      break;
  }
  ctx.restore();
}
