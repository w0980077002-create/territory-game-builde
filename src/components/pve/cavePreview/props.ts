/** Original hand-built scenery kit of the cave: thick-contour, cel-shaded props painted once
 * into cached sprites (never per frame) and placed at true world addresses by world.ts.
 * No image downloads, no gameplay state. Every district owns a distinct set, so a new gate
 * leads to a new place rather than a new tint.
 */
import type { Biome } from '../../../game/cavePreviewWorld/catalog';
import { hash, surface, type Ctx } from './kit';

const INK = '#170d16';
export interface Prop { canvas: HTMLCanvasElement; width: number; height: number; /** Y of the ground/ceiling line inside the sprite box. */ origin: number; /** Light source inside the prop, in prop units from the base centre. */ glow?: { x: number; y: number; r: number; color: string }; /** Live flame anchor. */ fire?: { x: number; y: number; hot: boolean } }
interface Tone { light: string; mid: string; dark: string; deep: string; glow: string }
const TONES: Record<string, Tone> = {
  cyan: { light: '#e6fdff', mid: '#5fdcf2', dark: '#1f7fae', deep: '#103f66', glow: '#64e7ff' },
  violet: { light: '#f3e8ff', mid: '#b88dff', dark: '#6440bd', deep: '#2f1f6b', glow: '#c6a0ff' },
  amber: { light: '#fff5cc', mid: '#ffb84d', dark: '#cf7420', deep: '#74390f', glow: '#ffb45b' },
  ember: { light: '#ffc2a6', mid: '#e0502f', dark: '#74201c', deep: '#331015', glow: '#ff805f' },
  moss: { light: '#dcffc4', mid: '#74d97c', dark: '#2f9152', deep: '#164c2f', glow: '#a0ef7c' },
  plum: { light: '#f6d6ff', mid: '#c078e6', dark: '#6d3a9c', deep: '#35184f', glow: '#d79bff' },
};
const STONE: Record<Biome, [string, string, string]> = {
  crystal: ['#7f9bb5', '#4a637d', '#27384e'], spore: ['#7f9a80', '#4c6654', '#283b33'], ember: ['#a58a6c', '#6e563f', '#3d2e24'],
  astral: ['#8f86b8', '#5a5186', '#2f2a52'], forge: ['#8a6a66', '#573f40', '#2e2126'],
};

function poly(points: number[]) { const p = new Path2D(); for (let i = 0; i < points.length; i += 2) p.lineTo(points[i], points[i + 1]); p.closePath(); return p; }
/** Smooth closed outline through the given points. */
function blob(points: number[]) {
  const p = new Path2D(), n = points.length / 2, at = (i: number) => [points[(i % n) * 2], points[(i % n) * 2 + 1]];
  const [ax, ay] = at(n - 1), [bx, by] = at(0); p.moveTo((ax + bx) / 2, (ay + by) / 2);
  for (let i = 0; i < n; i++) { const [x, y] = at(i), [nx, ny] = at(i + 1); p.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2); }
  p.closePath(); return p;
}
function ink(c: Ctx, path: Path2D, fill: string | CanvasGradient, width = 2.6) {
  c.fillStyle = fill; c.fill(path); c.lineWidth = width; c.strokeStyle = INK; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(path);
}
/** Paint shading INSIDE a silhouette, then restore. */
function inside(c: Ctx, path: Path2D, paint: () => void) { c.save(); c.clip(path); paint(); c.restore(); }
function grad(c: Ctx, y0: number, y1: number, top: string, bottom: string) { const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, top); g.addColorStop(1, bottom); return g; }

function rocks(c: Ctx, biome: Biome, seed: number, spread = 22, size = 1) {
  const [light, mid, dark] = STONE[biome];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * spread * .8 + (hash(seed + i) - .5) * 8, r = (7 + hash(seed * 3 + i) * 7) * size, y = 0;
    const p = blob([x - r, y, x - r * .8, y - r * .9, x - r * .1, y - r * 1.25, x + r * .8, y - r * .8, x + r, y]);
    ink(c, p, mid, 2.2);
    inside(c, p, () => { c.fillStyle = dark; c.fillRect(x, y - r * 1.4, r * 1.2, r * 1.5); c.fillStyle = light; c.beginPath(); c.ellipse(x - r * .3, y - r * 1.02, r * .5, r * .22, -.3, 0, 7); c.fill(); });
  }
}
function shard(c: Ctx, t: Tone, x: number, w: number, tall: number, lean: number) {
  const tip = [x + lean, -tall], l = [x - w, 0], r = [x + w, 0], sl = [x - w * .72 + lean * .7, -tall * .78], sr = [x + w * .78 + lean * .7, -tall * .74];
  const p = poly([l[0], l[1], sl[0], sl[1], tip[0], tip[1], sr[0], sr[1], r[0], r[1]]);
  ink(c, p, grad(c, -tall, 0, t.mid, t.dark), 2.6);
  inside(c, p, () => {
    c.fillStyle = t.deep; c.globalAlpha = .55; c.beginPath(); c.moveTo(tip[0], tip[1]); c.lineTo(sr[0], sr[1]); c.lineTo(r[0], r[1]); c.lineTo(x + w * .15, 0); c.fill();
    c.fillStyle = t.light; c.globalAlpha = .9; c.beginPath(); c.moveTo(tip[0], tip[1]); c.lineTo(sl[0], sl[1]); c.lineTo(x - w * .25 + lean * .7, -tall * .7); c.fill();
    c.globalAlpha = .75; c.beginPath(); c.moveTo(x - w * .5, -tall * .1); c.lineTo(x - w * .28 + lean * .5, -tall * .62); c.lineTo(x - w * .1 + lean * .5, -tall * .6); c.lineTo(x - w * .34, -tall * .1); c.fill();
    c.globalAlpha = 1;
  });
  c.strokeStyle = INK; c.lineWidth = 1.2; c.beginPath(); c.moveTo(tip[0], tip[1]); c.lineTo(x + w * .15, 0); c.stroke();
}
function crystals(c: Ctx, biome: Biome, tone: Tone, seed: number, size = 1) {
  for (const [dx, w, tall, lean] of [[-17, 8, 34, -9], [15, 9, 42, 8], [-4, 11, 62, -2], [5, 7, 27, 6], [-11, 6, 20, -6]]) shard(c, tone, dx * size, w * size, (tall + hash(seed + dx) * 12) * size, lean * size);
  rocks(c, biome, seed, 24 * size, .8 * size);
}
function mushroom(c: Ctx, cap: Tone, x: number, tall: number, wide: number, tilt: number) {
  const top = -tall, stem = poly([x - wide * .2, 0, x - wide * .14 + tilt, top + 4, x + wide * .14 + tilt, top + 4, x + wide * .22, 0]);
  ink(c, stem, grad(c, top, 0, '#fff5e1', '#d9c7a8'), 2.2);
  inside(c, stem, () => { c.fillStyle = '#b79f82'; c.fillRect(x + wide * .04 + tilt * .5, top, wide, tall); });
  const cx = x + tilt, head = blob([cx - wide, top + 5, cx - wide * .92, top - wide * .45, cx - wide * .35, top - wide * .92, cx + wide * .4, top - wide * .9, cx + wide * .95, top - wide * .4, cx + wide, top + 5, cx, top + wide * .18]);
  ink(c, head, grad(c, top - wide, top + 6, cap.mid, cap.dark), 2.6);
  inside(c, head, () => {
    c.fillStyle = cap.light; c.globalAlpha = .85; c.beginPath(); c.ellipse(cx - wide * .32, top - wide * .62, wide * .42, wide * .18, -.35, 0, 7); c.fill();
    c.globalAlpha = 1; c.fillStyle = '#fffbe9';
    for (const [sx, sy, r] of [[.35, -.5, .13], [-.55, -.2, .1], [.6, -.12, .08], [-.05, -.34, .09]]) { c.beginPath(); c.ellipse(cx + sx * wide, top + sy * wide, r * wide, r * wide * .8, 0, 0, 7); c.fill(); }
    c.fillStyle = cap.deep; c.globalAlpha = .6; c.beginPath(); c.ellipse(cx, top + wide * .16, wide * .86, wide * .16, 0, 0, 7); c.fill(); c.globalAlpha = 1;
  });
}
function mushrooms(c: Ctx, biome: Biome, tone: Tone, seed: number, size = 1) {
  mushroom(c, tone, -15 * size, (22 + hash(seed) * 8) * size, 11 * size, -3 * size);
  mushroom(c, tone, 14 * size, (30 + hash(seed + 1) * 8) * size, 13 * size, 3 * size);
  mushroom(c, tone, -1 * size, (46 + hash(seed + 2) * 10) * size, 19 * size, 1 * size);
  rocks(c, biome, seed + 9, 26 * size, .55 * size);
}
function fern(c: Ctx, tone: Tone, seed: number, size = 1) {
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i - 2.5) * .42 + (hash(seed + i) - .5) * .2, len = (26 + hash(seed * 2 + i) * 18) * size, bend = (i - 2.5) * 5 * size;
    const tx = Math.cos(a) * len + bend, ty = Math.sin(a) * len, mx = Math.cos(a) * len * .5, my = Math.sin(a) * len * .62;
    const p = new Path2D(); p.moveTo(-2 * size, 0); p.quadraticCurveTo(mx - 5 * size, my, tx, ty); p.quadraticCurveTo(mx + 6 * size, my + 3 * size, 2 * size, 0); p.closePath();
    ink(c, p, i % 2 ? tone.mid : tone.dark, 2);
    c.strokeStyle = tone.light; c.lineWidth = 1; c.globalAlpha = .7; c.beginPath(); c.moveTo(0, -2 * size); c.quadraticCurveTo(mx, my, tx * .92, ty * .92); c.stroke(); c.globalAlpha = 1;
  }
}
function brazier(c: Ctx, hot: boolean) {
  c.strokeStyle = INK; c.lineCap = 'round'; c.lineWidth = 6.5; c.beginPath(); c.moveTo(-13, 0); c.lineTo(-4, -34); c.moveTo(13, 0); c.lineTo(4, -34); c.moveTo(0, 0); c.lineTo(0, -34); c.stroke();
  c.strokeStyle = hot ? '#5b4747' : '#6b5a48'; c.lineWidth = 3; c.beginPath(); c.moveTo(-13, 0); c.lineTo(-4, -34); c.moveTo(13, 0); c.lineTo(4, -34); c.moveTo(0, 0); c.lineTo(0, -34); c.stroke();
  const bowl = poly([-17, -45, 17, -45, 11, -32, -11, -32]);
  ink(c, bowl, grad(c, -45, -32, hot ? '#7b5552' : '#8a7460', '#33262a'), 2.6);
  c.fillStyle = hot ? '#ff9a5c' : '#ffcf7a'; c.fillRect(-14, -45.5, 28, 2.4);
  c.strokeStyle = '#d0a060'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-12, -39); c.lineTo(12, -39); c.stroke();
}
function lantern(c: Ctx, x: number, y: number, tone: string) {
  const body = poly([x - 6, y, x + 6, y, x + 7, y + 15, x - 7, y + 15]);
  ink(c, body, '#3b2a1c', 2.2); c.fillStyle = tone; c.fillRect(x - 4, y + 2.5, 8, 10.5); c.fillStyle = '#fff8dc'; c.fillRect(x - 1.8, y + 5, 3.6, 6);
  c.strokeStyle = INK; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x, y + 2.5); c.lineTo(x, y + 13); c.stroke();
  ink(c, poly([x - 8, y, x + 8, y, x + 4, y - 4, x - 4, y - 4]), '#5b4026', 2);
}
function post(c: Ctx, tall: number) {
  const beam = poly([-5, 0, -4, -tall, 4, -tall, 5, 0]);
  ink(c, beam, grad(c, -tall, 0, '#8a6238', '#4a321f'), 2.6);
  inside(c, beam, () => { c.fillStyle = '#3a2718'; c.fillRect(1, -tall, 6, tall); c.strokeStyle = '#3a2718'; c.lineWidth = 1; for (let y = -tall + 9; y < 0; y += 13) { c.beginPath(); c.moveTo(-5, y); c.lineTo(1, y + 4); c.stroke(); } });
  const arm = poly([-7, -tall + 3, 30, -tall + 1, 30, -tall + 8, -7, -tall + 11]);
  ink(c, arm, '#75532f', 2.4);
  ink(c, poly([3, -tall + 10, 16, -tall + 9, 4, -tall + 24]), '#5a3e25', 2);
  c.strokeStyle = INK; c.lineWidth = 1.6; c.beginPath(); c.moveTo(24, -tall + 8); c.lineTo(24, -tall + 16); c.stroke();
  lantern(c, 24, -tall + 18, '#ffb347');
}
function cart(c: Ctx, tone: Tone) {
  for (const [dx, tall] of [[-11, 15], [0, 21], [10, 14], [-4, 11]]) shard(c, tone, dx, 5.5, 28 + tall, dx * .2);
  const box = poly([-25, -32, 25, -32, 20, -9, -20, -9]);
  ink(c, box, grad(c, -32, -9, '#8f6a41', '#553a22'), 2.8);
  inside(c, box, () => { c.strokeStyle = '#3d2a18'; c.lineWidth = 1.2; for (const x of [-12, 0, 12]) { c.beginPath(); c.moveTo(x, -33); c.lineTo(x * .8, -8); c.stroke(); } c.fillStyle = '#3d2a1888'; c.fillRect(-26, -15, 52, 8); });
  c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.moveTo(-26, -31); c.lineTo(26, -31); c.stroke();
  c.strokeStyle = '#9aa0a8'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(-26, -31); c.lineTo(26, -31); c.stroke();
  for (const x of [-13, 13]) { const wheel = new Path2D(); wheel.arc(x, -5.5, 6.5, 0, 7); ink(c, wheel, '#4b4f58', 2.4); c.fillStyle = '#b9bec6'; c.beginPath(); c.arc(x, -5.5, 2, 0, 7); c.fill(); }
}
function obelisk(c: Ctx, biome: Biome, tone: Tone, tall: number) {
  const [light, mid, dark] = STONE[biome];
  const body = poly([-11, 0, -8, -tall, 0, -tall - 9, 8, -tall, 11, 0]);
  ink(c, body, grad(c, -tall, 0, light, mid), 2.8);
  inside(c, body, () => { c.fillStyle = dark; c.beginPath(); c.moveTo(0, -tall - 9); c.lineTo(8, -tall); c.lineTo(11, 0); c.lineTo(2.5, 0); c.fill(); });
  c.strokeStyle = tone.glow; c.lineWidth = 2; c.lineCap = 'round';
  for (let i = 0; i < 4; i++) { const y = -tall + 10 + i * (tall - 18) / 4; c.beginPath(); c.moveTo(-4, y); c.lineTo(0, y + 4); c.lineTo(-3, y + 8); c.moveTo(0, y + 4); c.lineTo(3.5, y + 2); c.stroke(); }
  ink(c, poly([-17, 0, -14, -7, 14, -7, 17, 0]), mid, 2.6);
  // A broken piece of the capstone hangs in the air.
  ink(c, poly([-5, -tall - 26, 4, -tall - 30, 8, -tall - 21, -2, -tall - 16]), light, 2.2);
  c.fillStyle = tone.light; c.beginPath(); c.arc(1, -tall - 23, 2, 0, 7); c.fill();
}
function anvil(c: Ctx) {
  const stump = poly([-13, 0, -11, -15, 11, -15, 13, 0]);
  ink(c, stump, grad(c, -15, 0, '#7a5433', '#40291a'), 2.6);
  const top = poly([-22, -30, 20, -30, 27, -25, 12, -22, 9, -15, -9, -15, -12, -22, -22, -23]);
  ink(c, top, grad(c, -30, -15, '#aeb4c0', '#4c515e'), 2.8);
  c.fillStyle = '#e9eef5'; c.fillRect(-20, -29.5, 38, 1.8);
  c.fillStyle = '#ff9a4d'; c.beginPath(); c.ellipse(1, -31, 9, 2, 0, 0, 7); c.fill();
  c.save(); c.translate(15, -33); c.rotate(-.5);
  ink(c, poly([-1.5, 0, 1.5, 0, 1.5, -22, -1.5, -22]), '#7a5433', 2); ink(c, poly([-8, -28, 8, -28, 8, -20, -8, -20]), '#6b7080', 2.4); c.restore();
}
function vent(c: Ctx, tone: Tone) {
  const mound = blob([-30, 0, -24, -12, -12, -24, 2, -30, 16, -22, 27, -11, 31, 0]);
  ink(c, mound, grad(c, -30, 0, '#5a4244', '#2a1c20'), 2.8);
  inside(c, mound, () => {
    c.strokeStyle = tone.mid; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
    for (const line of [[2, -29, -3, -18, 4, -10, -2, 0], [-3, -18, -14, -12, -18, -2], [4, -10, 15, -8, 21, 0]]) { c.beginPath(); for (let i = 0; i < line.length; i += 2) c.lineTo(line[i], line[i + 1]); c.stroke(); }
    c.strokeStyle = '#ffe2a8'; c.lineWidth = 1; for (const line of [[2, -29, -3, -18, 4, -10, -2, 0]]) { c.beginPath(); for (let i = 0; i < line.length; i += 2) c.lineTo(line[i], line[i + 1]); c.stroke(); }
  });
  c.fillStyle = '#ffd28a'; c.beginPath(); c.ellipse(2, -29, 5, 2, 0, 0, 7); c.fill();
}
function orb(c: Ctx, biome: Biome, tone: Tone) {
  const [light, mid, dark] = STONE[biome];
  ink(c, poly([-12, 0, -9, -9, 9, -9, 12, 0]), mid, 2.6);
  const col = poly([-6, -9, -5, -32, 5, -32, 6, -9]); ink(c, col, grad(c, -32, -9, light, mid), 2.6);
  inside(c, col, () => { c.fillStyle = dark; c.fillRect(1.5, -33, 6, 25); });
  ink(c, poly([-10, -32, 10, -32, 7, -38, -7, -38]), light, 2.4);
  const ball = new Path2D(); ball.arc(0, -52, 10, 0, 7); ink(c, ball, tone.mid, 2.6);
  inside(c, ball, () => { c.fillStyle = tone.dark; c.beginPath(); c.arc(4, -48, 10, 0, 7); c.fill(); c.fillStyle = tone.light; c.beginPath(); c.arc(-3.5, -56, 3.6, 0, 7); c.fill(); });
  c.fillStyle = '#ffffff'; for (const [x, y] of [[-16, -60], [15, -47], [-13, -42]]) { c.beginPath(); c.moveTo(x, y - 3); c.lineTo(x + 1, y - 1); c.lineTo(x + 3, y); c.lineTo(x + 1, y + 1); c.lineTo(x, y + 3); c.lineTo(x - 1, y + 1); c.lineTo(x - 3, y); c.lineTo(x - 1, y - 1); c.fill(); }
}
function totem(c: Ctx, biome: Biome, tone: Tone) {
  const [light, mid, dark] = STONE[biome];
  const body = blob([-12, 0, -13, -24, -10, -46, 0, -53, 10, -46, 13, -24, 12, 0]);
  ink(c, body, grad(c, -53, 0, light, mid), 2.8);
  inside(c, body, () => { c.fillStyle = dark; c.fillRect(3, -56, 14, 58); c.fillStyle = tone.dark; c.globalAlpha = .7; c.beginPath(); c.ellipse(-6, -4, 10, 5, 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(-2, -50, 9, 4, 0, 0, 7); c.fill(); c.globalAlpha = 1; });
  // A carved, softly glowing face: the garden is old and watches travellers.
  c.fillStyle = tone.glow; for (const x of [-5, 5]) { c.beginPath(); c.ellipse(x, -34, 2.6, 3.4, 0, 0, 7); c.fill(); }
  c.strokeStyle = tone.glow; c.lineWidth = 2; c.lineCap = 'round'; c.beginPath(); c.moveTo(-5, -22); c.quadraticCurveTo(0, -18, 5, -22); c.stroke();
}
/** Hanging pieces for the top edge of the frame: origin is the ceiling line. */
function stalactites(c: Ctx, biome: Biome, seed: number, rim: string) {
  const [, mid, dark] = STONE[biome];
  for (const [dx, w, tall] of [[-34, 13, 34], [24, 15, 46], [-6, 19, 70], [44, 9, 24]]) {
    const t = tall + hash(seed + dx) * 14, p = poly([dx - w, -3, dx - w * .45, t * .5, dx + w * .08, t, dx + w * .5, t * .46, dx + w, -3]);
    ink(c, p, grad(c, 0, t, dark, mid), 2.8);
    inside(c, p, () => { c.fillStyle = '#05060c'; c.globalAlpha = .45; c.fillRect(dx + w * .1, 0, w, t); c.globalAlpha = 1; });
    c.strokeStyle = rim; c.lineWidth = 1.6; c.globalAlpha = .8; c.beginPath(); c.moveTo(dx - w * .86, 2); c.lineTo(dx - w * .42, t * .5); c.lineTo(dx + w * .06, t - 2); c.stroke(); c.globalAlpha = 1;
  }
}
function vines(c: Ctx, tone: Tone, seed: number) {
  for (let i = 0; i < 5; i++) {
    const x = -44 + i * 22 + hash(seed + i) * 8, len = 44 + hash(seed * 3 + i) * 52, sway = (hash(seed * 5 + i) - .5) * 20;
    c.strokeStyle = INK; c.lineWidth = 5.5; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, -3); c.quadraticCurveTo(x + sway, len * .5, x + sway * .4, len); c.stroke();
    c.strokeStyle = tone.dark; c.lineWidth = 2.6; c.beginPath(); c.moveTo(x, -3); c.quadraticCurveTo(x + sway, len * .5, x + sway * .4, len); c.stroke();
    for (let k = 1; k <= 3; k++) { const t = k / 3.4, lx = x + sway * 2 * t * (1 - t) + sway * .4 * t * t, ly = len * t; ink(c, blob([lx, ly, lx + (k % 2 ? 9 : -9), ly + 3, lx + (k % 2 ? 6 : -6), ly + 10, lx, ly + 6]), tone.mid, 1.8); }
    const bulb = new Path2D(); bulb.ellipse(x + sway * .4, len + 5, 4.6, 6.2, 0, 0, 7); ink(c, bulb, tone.light, 2);
  }
}
function chains(c: Ctx, seed: number) {
  for (let i = 0; i < 3; i++) {
    const x = -34 + i * 34 + hash(seed + i) * 8, links = 5 + Math.floor(hash(seed * 2 + i) * 5);
    for (let k = 0; k < links; k++) { const link = new Path2D(); link.ellipse(x, 3 + k * 11, k % 2 ? 2.4 : 4.2, 6.4, 0, 0, 7); c.lineWidth = 5; c.strokeStyle = INK; c.stroke(link); c.lineWidth = 2; c.strokeStyle = k % 2 ? '#6a6f7c' : '#a3a8b4'; c.stroke(link); }
    const y = 3 + links * 11;
    if (i === 1) { const pot = blob([x - 13, y, x - 15, y + 12, x - 8, y + 21, x + 8, y + 21, x + 15, y + 12, x + 13, y]); ink(c, pot, grad(c, y, y + 21, '#5b5560', '#2a252c'), 2.6); c.fillStyle = '#ff8a3c'; c.beginPath(); c.ellipse(x, y + 1, 11, 2.6, 0, 0, 7); c.fill(); c.fillStyle = '#ffe2a8'; c.beginPath(); c.ellipse(x, y + 1, 6, 1.3, 0, 0, 7); c.fill(); }
    else { c.strokeStyle = INK; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 9, y + 12, x - 2, y + 15); c.stroke(); c.strokeStyle = '#a3a8b4'; c.lineWidth = 2; c.stroke(); }
  }
}
function gateRuin(c: Ctx, biome: Biome, tone: Tone) {
  const [light, mid, dark] = STONE[biome];
  for (const x of [-34, 34]) {
    const tall = x < 0 ? 112 : 78, col = poly([x - 12, 0, x - 10, -tall, x + 10, -tall, x + 12, 0]);
    ink(c, col, grad(c, -tall, 0, light, mid), 3);
    inside(c, col, () => { c.fillStyle = dark; c.fillRect(x + 3, -tall, 12, tall); c.strokeStyle = dark; c.lineWidth = 1.2; for (let y = -tall + 14; y < 0; y += 19) { c.beginPath(); c.moveTo(x - 12, y); c.lineTo(x + 12, y + 2); c.stroke(); } });
    ink(c, poly([x - 16, -tall, x + 16, -tall, x + 13, -tall - 9, x - 13, -tall - 9]), light, 2.8);
    c.strokeStyle = tone.glow; c.lineWidth = 2.2; c.lineCap = 'round'; c.beginPath(); c.moveTo(x - 3, -tall * .55); c.lineTo(x + 2, -tall * .47); c.lineTo(x - 2, -tall * .38); c.stroke();
  }
  const arch = new Path2D(); arch.moveTo(-46, -112); arch.quadraticCurveTo(-30, -150, 4, -146); arch.lineTo(2, -133); arch.quadraticCurveTo(-22, -134, -30, -112); arch.closePath();
  ink(c, arch, grad(c, -150, -112, light, mid), 3);
  ink(c, poly([16, -128, 27, -134, 31, -121, 21, -117]), light, 2.4);
}
function scaffold(c: Ctx) {
  for (const x of [-38, 38]) { const leg = poly([x - 5, 0, x - 4, -116, x + 4, -116, x + 5, 0]); ink(c, leg, grad(c, -116, 0, '#8a6238', '#49311e'), 2.8); inside(c, leg, () => { c.fillStyle = '#39261788'; c.fillRect(x + 1, -116, 6, 116); }); }
  ink(c, poly([-48, -116, 48, -116, 48, -105, -48, -105]), '#7a5632', 2.8);
  ink(c, poly([-38, -105, -30, -105, -12, -84, -19, -82]), '#5d4127', 2.2); ink(c, poly([38, -105, 30, -105, 12, -84, 19, -82]), '#5d4127', 2.2);
  ink(c, poly([-46, -62, 46, -68, 46, -60, -46, -54]), '#6a4a2b', 2.4);
  c.strokeStyle = INK; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-8, -105); c.lineTo(-8, -90); c.stroke();
  lantern(c, -8, -88, '#ffb347');
}
function furnace(c: Ctx, tone: Tone) {
  const body = poly([-34, 0, -30, -78, -18, -104, 18, -104, 30, -78, 34, 0]);
  ink(c, body, grad(c, -104, 0, '#6b5356', '#2c2026'), 3);
  inside(c, body, () => { c.fillStyle = '#1d141988'; c.fillRect(8, -104, 30, 104); c.strokeStyle = '#8b7275'; c.lineWidth = 2; for (const y of [-78, -48, -20]) { c.beginPath(); c.moveTo(-34, y); c.lineTo(34, y); c.stroke(); } });
  const mouth = new Path2D(); mouth.moveTo(-16, -8); mouth.lineTo(-16, -30); mouth.quadraticCurveTo(0, -48, 16, -30); mouth.lineTo(16, -8); mouth.closePath();
  ink(c, mouth, grad(c, -46, -8, '#ffe9a6', tone.mid), 2.8);
  for (const x of [-9, 0, 9]) { c.strokeStyle = INK; c.lineWidth = 2.6; c.beginPath(); c.moveTo(x, -9); c.lineTo(x, -36 + Math.abs(x) * .5); c.stroke(); }
  ink(c, poly([-12, -104, 12, -104, 9, -134, -9, -134]), '#4a383c', 2.8);
  c.fillStyle = tone.mid; c.beginPath(); c.ellipse(0, -134, 8.5, 2.6, 0, 0, 7); c.fill();
  for (const x of [-22, 22]) { const window = new Path2D(); window.arc(x, -66, 4.5, 0, 7); ink(c, window, tone.light, 2.2); }
}

type Painter = (c: Ctx) => Omit<Prop, 'canvas' | 'width' | 'height' | 'origin'> | void;
function bake(width: number, height: number, baseY: number, paint: Painter, resolution = 2, shade = 0, tint = '#05070d'): Prop {
  const s = surface(width * resolution, height * resolution);
  s.c.scale(resolution, resolution); s.c.translate(width / 2, baseY);
  const extra = paint(s.c) ?? {};
  // Pieces in front of the party sit in shadow, lit only along their contours.
  if (shade) { s.c.setTransform(1, 0, 0, 1, 0, 0); s.c.globalCompositeOperation = 'source-atop'; s.c.globalAlpha = shade; s.c.fillStyle = tint; s.c.fillRect(0, 0, s.canvas.width, s.canvas.height); }
  return { canvas: s.canvas, width, height, origin: baseY, ...extra };
}
export interface Kit { road: Prop[]; mid: Prop[]; near: Prop[]; hang: Prop[] }
const kits = new Map<Biome, Kit>();
/** All sprites of a district, painted on first use and kept for the life of the page. */
export function kit(biome: Biome): Kit {
  const made = kits.get(biome); if (made) return made;
  const t = TONES, glow = (tone: Tone, x: number, y: number, r: number) => ({ glow: { x, y, r, color: tone.glow } });
  const ground = (paint: Painter, width = 96, height = 96) => bake(width, height, height - 6, paint);
  const hung = (paint: Painter, width = 130, height = 126) => bake(width, height, 6, paint, 1.5, .42);
  // Near-frame pieces are baked small on purpose: a slightly soft edge reads as depth of field.
  // Landmarks stand deeper in the hall: a wash of the district's own air pushes them back.
  const AIR: Record<Biome, string> = { crystal: '#0e3550', spore: '#16382c', ember: '#3d2a20', astral: '#2a2156', forge: '#431a1c' };
  const far = (width: number, height: number, paint: Painter) => bake(width, height, height - 6, paint, 1.5, .3, AIR[biome]);
  const front = (paint: Painter, width = 130, height = 104) => bake(width, height, height - 4, paint, 1.25, .5);
  let result: Kit;
  if (biome === 'crystal') result = {
    road: [ground(c => { crystals(c, biome, t.cyan, 1); return glow(t.cyan, 0, -30, 60); }), ground(c => { mushrooms(c, biome, t.plum, 2, .8); return glow(t.plum, 0, -24, 46); }), ground(c => { rocks(c, biome, 5, 22, 1.2); fern(c, t.cyan, 3, .6); })],
    mid: [], near: [front(c => { crystals(c, biome, t.cyan, 7, 1.45); fern(c, t.plum, 4, .9); })], hang: [hung(c => stalactites(c, biome, 3, t.cyan.glow))],
  };
  else if (biome === 'spore') result = {
    road: [ground(c => { mushrooms(c, biome, t.moss, 3); return glow(t.moss, 0, -30, 60); }, 110, 104), ground(c => { totem(c, biome, t.moss); fern(c, t.moss, 6, .55); return glow(t.moss, 0, -32, 40); }), ground(c => { fern(c, t.moss, 2); rocks(c, biome, 4, 24, .9); }), ground(c => { mushrooms(c, biome, t.plum, 8, .75); return glow(t.plum, 0, -22, 44); })],
    mid: [far(190, 250, c => { mushroom(c, t.moss, 0, 170, 78, 8); mushroom(c, t.moss, -58, 74, 30, -6); fern(c, t.moss, 9, 1.5); return glow(t.moss, 6, -150, 130); })],
    near: [front(c => { fern(c, t.moss, 5, 2); mushrooms(c, biome, t.moss, 11, 1.1); })], hang: [hung(c => { vines(c, t.moss, 2); return glow(t.moss, 0, 70, 70); })],
  };
  else if (biome === 'ember') result = {
    road: [ground(c => { brazier(c, false); return { fire: { x: 0, y: -45, hot: false }, ...glow(t.amber, 0, -52, 68) }; }), ground(c => { cart(c, t.amber); return glow(t.amber, 0, -44, 50); }), ground(c => { post(c, 78); return glow(t.amber, 24, -50, 52); }, 96, 100), ground(c => { crystals(c, biome, t.amber, 4, .9); return glow(t.amber, 0, -28, 54); })],
    mid: [far(140, 170, c => { scaffold(c); return glow(t.amber, -8, -80, 70); }), far(150, 150, c => { crystals(c, biome, t.amber, 6, 2.1); return glow(t.amber, 0, -70, 110); })],
    near: [front(c => { rocks(c, biome, 8, 40, 2.2); crystals(c, biome, t.amber, 9, .9); })], hang: [hung(c => { stalactites(c, biome, 6, t.amber.glow); c.strokeStyle = INK; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-40, 0); c.lineTo(-40, 52); c.stroke(); lantern(c, -40, 52, '#ffb347'); return glow(t.amber, -40, 60, 60); })],
  };
  else if (biome === 'astral') result = {
    road: [ground(c => { obelisk(c, biome, t.violet, 46); return glow(t.violet, 0, -40, 56); }), ground(c => { orb(c, biome, t.violet); return glow(t.violet, 0, -52, 60); }), ground(c => { crystals(c, biome, t.violet, 5); return glow(t.violet, 0, -30, 58); }), ground(c => { rocks(c, biome, 2, 24, 1.1); fern(c, t.violet, 7, .5); })],
    mid: [far(140, 180, c => { gateRuin(c, biome, t.violet); return glow(t.violet, 0, -90, 90); }), far(120, 190, c => { obelisk(c, biome, t.violet, 124); return glow(t.violet, 0, -80, 90); })],
    near: [front(c => { crystals(c, biome, t.violet, 12, 1.4); rocks(c, biome, 3, 42, 1.6); })], hang: [hung(c => stalactites(c, biome, 9, t.violet.glow))],
  };
  else result = {
    road: [ground(c => { vent(c, t.ember); return glow(t.ember, 0, -22, 70); }), ground(c => { anvil(c); return glow(t.ember, 1, -30, 40); }), ground(c => { brazier(c, true); return { fire: { x: 0, y: -45, hot: true }, ...glow(t.ember, 0, -52, 70) }; }), ground(c => { crystals(c, biome, t.ember, 3, .85); return glow(t.ember, 0, -26, 54); })],
    mid: [far(110, 170, c => { furnace(c, t.ember); return { fire: { x: 0, y: -134, hot: true }, ...glow(t.ember, 0, -40, 110) }; })],
    near: [front(c => { vent(c, t.ember); rocks(c, biome, 5, 44, 1.9); })], hang: [hung(c => { chains(c, 4); return glow(t.ember, 0, 70, 56); })],
  };
  kits.set(biome, result); return result;
}
/** Paint every district kit during loading, never on the first combat frame. */
export function warmProps() { for (const biome of ['crystal', 'spore', 'ember', 'astral', 'forge'] as Biome[]) kit(biome); }

/** Draw a baked prop with its origin (ground or ceiling line, centre) at (x, base).
 * `lean` shears it around that line and `squash` presses it: cheap, sprite-only liveliness. */
export function drawProp(c: Ctx, prop: Prop, x: number, base: number, scale = 1, lean = 0, squash = 0) {
  const w = prop.width * scale, h = prop.height * scale, top = -prop.origin * scale;
  if (x + w / 2 < -20 || x - w / 2 > 450) return false;
  if (!lean && !squash) { c.drawImage(prop.canvas, x - w / 2, base + top, w, h); return true; }
  c.save(); c.translate(x, base); c.transform(1 + squash * .5, 0, lean, 1 - squash, 0, 0);
  c.drawImage(prop.canvas, -w / 2, top, w, h); c.restore(); return true;
}
