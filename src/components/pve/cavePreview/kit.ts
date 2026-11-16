/** Shared drawing kit of the cave presentation layer.
 * Everything here is cosmetic and PURE: a function of the arguments only. No gameplay state,
 * no timers, no Math.random. Particles are closed-form functions of an age, so a paused or
 * restored expedition redraws the exact same frame.
 */
export type Ctx = CanvasRenderingContext2D;
export const hash = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
export const mod = (v: number, m: number) => ((v % m) + m) % m;
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
/** Overshooting pop used by comic words, loot stars and impact bursts. */
export const easeBack = (t: number) => { const k = clamp01(t) - 1; return 1 + 2.7 * k * k * k + 1.7 * k * k; };
/** 0→1→0 window between two ages. */
export const window01 = (age: number, from: number, to: number) => age <= from || age >= to ? 0 : Math.sin((age - from) / (to - from) * Math.PI);

export function surface(width: number, height: number) {
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
  return { canvas, c: canvas.getContext('2d')! };
}

const glows = new Map<string, HTMLCanvasElement>();
function glow(color: string) {
  let g = glows.get(color);
  if (!g) {
    const s = surface(64, 64), r = s.c.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, color); r.addColorStop(.35, color + '88'); r.addColorStop(1, color + '00');
    s.c.fillStyle = r; s.c.fillRect(0, 0, 64, 64); g = s.canvas; glows.set(color, g);
  }
  return g;
}
/** Soft cached light. One drawImage, no per-frame gradient. Colours are #rrggbb. */
export function light(c: Ctx, color: string, x: number, y: number, radius: number, alpha: number) {
  if (alpha <= .01 || radius <= 0) return;
  const a = c.globalAlpha; c.globalAlpha = a * Math.min(1, alpha);
  c.drawImage(glow(color), x - radius, y - radius, radius * 2, radius * 2); c.globalAlpha = a;
}
/** Elliptical light pool on the floor (wet stone reflection of a light source). */
export function pool(c: Ctx, color: string, x: number, y: number, rx: number, ry: number, alpha: number) {
  if (alpha <= .01) return;
  const a = c.globalAlpha; c.globalAlpha = a * Math.min(1, alpha);
  c.drawImage(glow(color), x - rx, y - ry, rx * 2, ry * 2); c.globalAlpha = a;
}

const FONT = '"Arial Black","Segoe UI Black","Roboto Black",system-ui,sans-serif';
/** Thick-contour comic lettering: dark outline, drop offset, bright face. */
export function comicText(c: Ctx, value: string, x: number, y: number, size: number, face: string, outline = '#1c0d08', italic = true) {
  c.font = `${italic ? 'italic ' : ''}900 ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  c.lineWidth = Math.max(2.4, size * .2); c.strokeStyle = outline; c.strokeText(value, x, y + size * .07);
  c.fillStyle = face; c.fillText(value, x, y);
  c.textBaseline = 'alphabetic';
}

export interface BurstStyle {
  n: number; speed: number; angle: number; spread: number; gravity: number; life: number; size: number; colors: string[];
  shape: 'spark' | 'shard' | 'dot' | 'star' | 'smoke'; drag?: number; alpha?: number;
}
/** Deterministic particle burst: every particle is a closed-form function of `age`. */
export function burst(c: Ctx, seed: number, age: number, x: number, y: number, s: BurstStyle, scale = 1) {
  if (age < 0 || age > s.life) return;
  const base = c.globalAlpha, drag = s.drag ?? 2.4, travel = (1 - Math.exp(-drag * age)) / drag, slow = Math.exp(-drag * age);
  for (let i = 0; i < s.n; i++) {
    const k = hash(seed + i * 7.31), k2 = hash(seed * 1.7 + i * 3.11 + 5), k3 = hash(seed * .37 + i * 11.3 + 9);
    const life = s.life * (.55 + .45 * k3); if (age > life) continue;
    const u = age / life, a = s.angle + (k - .5) * s.spread, v = s.speed * (.45 + .75 * k2);
    const px = x + Math.cos(a) * v * travel * scale, py = y + (Math.sin(a) * v * travel + .5 * s.gravity * age * age) * scale;
    const size = s.size * (.6 + .7 * k3) * scale;
    c.globalAlpha = base * (s.alpha ?? 1) * (1 - u * u); c.fillStyle = s.colors[i % s.colors.length];
    if (s.shape === 'spark') {
      const vx = Math.cos(a) * v * slow, vy = Math.sin(a) * v * slow + s.gravity * age, len = Math.hypot(vx, vy) || 1, tail = size * 3.2 * (1 - u * .6);
      c.strokeStyle = c.fillStyle; c.lineWidth = Math.max(.8, size * .55); c.lineCap = 'round';
      c.beginPath(); c.moveTo(px, py); c.lineTo(px - vx / len * tail, py - vy / len * tail); c.stroke();
    } else if (s.shape === 'shard') {
      const r = k * 6.3 + age * (6 + k2 * 12) * (i % 2 ? 1 : -1);
      c.beginPath(); c.moveTo(px + Math.cos(r) * size, py + Math.sin(r) * size);
      c.lineTo(px + Math.cos(r + 2.3) * size * .7, py + Math.sin(r + 2.3) * size * .7);
      c.lineTo(px + Math.cos(r + 4.1) * size * .55, py + Math.sin(r + 4.1) * size * .55); c.fill();
    } else if (s.shape === 'star') {
      const r = size * (1 - u * .5);
      c.beginPath(); c.moveTo(px, py - r); c.lineTo(px + r * .26, py - r * .26); c.lineTo(px + r, py); c.lineTo(px + r * .26, py + r * .26);
      c.lineTo(px, py + r); c.lineTo(px - r * .26, py + r * .26); c.lineTo(px - r, py); c.lineTo(px - r * .26, py - r * .26); c.fill();
    } else {
      const r = s.shape === 'smoke' ? size * (1 + u * 2.2) : size * (1 - u * .4);
      if (s.shape === 'smoke') c.globalAlpha *= .55;
      c.beginPath(); c.arc(px, py, r, 0, 6.3); c.fill();
    }
  }
  c.globalAlpha = base;
}

let scratch: { canvas: HTMLCanvasElement; c: Ctx } | undefined;
/** Draws `draw` flooded with a colour (hit flash, phase flash) through one shared scratch
 * surface. Used only for the few frames of an actual impact, never as a steady-state cost. */
export function flashDraw(c: Ctx, x: number, y: number, width: number, height: number, color: string, alpha: number, draw: (c: Ctx) => void) {
  const m = c.getTransform();
  const dx = Math.floor(m.a * x + m.e) - 2, dy = Math.floor(m.d * y + m.f) - 2, dw = Math.ceil(m.a * width) + 4, dh = Math.ceil(m.d * height) + 4;
  if (alpha <= .01 || m.b || m.c || dw <= 4 || dh <= 4 || dw > 1600 || dh > 1600) { draw(c); return; }
  scratch ??= surface(dw, dh);
  if (scratch.canvas.width < dw) scratch.canvas.width = dw;
  if (scratch.canvas.height < dh) scratch.canvas.height = dh;
  const s = scratch.c;
  s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1; s.clearRect(0, 0, dw, dh);
  s.setTransform(m.a, 0, 0, m.d, m.e - dx, m.f - dy); s.save(); draw(s); s.restore();
  s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'source-atop'; s.globalAlpha = Math.min(1, alpha); s.fillStyle = color; s.fillRect(0, 0, dw, dh);
  s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(scratch.canvas, 0, 0, dw, dh, dx, dy, dw, dh); c.restore();
}

const silhouettes = new WeakMap<object, HTMLCanvasElement>();
/** Flat dark copy of a sprite, cached once per image: the giant wall shadow of a boss. */
export function silhouette(img: HTMLImageElement | HTMLCanvasElement, color = '#0a0416') {
  let s = silhouettes.get(img);
  if (!s) {
    const k = Math.min(1, 220 / Math.max(img.width, img.height)), made = surface(img.width * k, img.height * k);
    made.c.drawImage(img, 0, 0, made.canvas.width, made.canvas.height);
    made.c.globalCompositeOperation = 'source-in'; made.c.fillStyle = color; made.c.fillRect(0, 0, made.canvas.width, made.canvas.height);
    s = made.canvas; silhouettes.set(img, s);
  }
  return s;
}

/** 5-point star path centred on the origin. */
export function starPath(c: Ctx, x: number, y: number, outer: number, inner = outer * .46, points = 5, turn = -Math.PI / 2) {
  c.beginPath();
  for (let i = 0; i < points * 2; i++) { const r = i % 2 ? inner : outer, a = turn + i * Math.PI / points; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  c.closePath();
}
