/** One cosmetic gate renderer for every cave biome. Never owns a gameplay timer,
 * hitbox, transition, reward or saved field. All expensive art is warmed at load.
 */
import type { Biome } from '../../../game/cavePreviewWorld/catalog';

type Ctx = CanvasRenderingContext2D;
type Images = Map<string, HTMLImageElement>;
export const PORTAL_ART = 'assets/territory/cave-expedition/portal-arches.webp';
const PALETTES = ['#80e7a3', '#64c9ff', '#d4a0ff', '#64e7ff', '#a0ef7c', '#ffb45b', '#c6a0ff', '#ff805f', '#a485ff'];
const lowDetail = typeof navigator !== 'undefined' && navigator.hardwareConcurrency <= 4;
const cores = new Map<string, { well: HTMLCanvasElement; spiral: HTMLCanvasElement; halo: HTMLCanvasElement; reflection: HTMLCanvasElement }>();
const frames = new WeakMap<HTMLImageElement, HTMLCanvasElement[]>();
let focus = -1;
/** Ephemeral pointer/keyboard presentation; deliberately outside World/checkpoints. */
export function focusPortal(index: number) { focus = index; }
export function portalFocused(index: number) { return focus === index; }
function surface(w: number, h: number) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  return { canvas, c: canvas.getContext('2d')! };
}
function core(color: string) {
  const previous = cores.get(color); if (previous) return previous;
  const well = surface(192, 256), g = well.c.createRadialGradient(96, 127, 3, 96, 127, 127);
  g.addColorStop(0, '#020619'); g.addColorStop(.2, '#081127'); g.addColorStop(.52, color + 'b8');
  g.addColorStop(.8, '#121c3b'); g.addColorStop(1, '#030817');
  well.c.fillStyle = g; well.c.fillRect(0, 0, 192, 256);
  const spiral = surface(256, 256), s = spiral.c;
  s.translate(128, 128); s.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    // Painted filaments wind into the dark throat; opposite-speed cached layers
    // create depth without allocating paths or gradients on the live frame.
    for (let band = 0; band < 3; band++) {
      s.strokeStyle = band === 2 ? '#e5ffff' : color; s.globalAlpha = [ .17, .48, .74 ][band];
      s.lineWidth = [14, 5, 1.3][band]; s.beginPath();
      for (let j = 0; j <= 100; j++) {
        const k = j / 100, r = 9 + k * 108, a = arm * Math.PI * 2 / 3 + k * 5.4;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (j) s.lineTo(x, y); else s.moveTo(x, y);
      }
      s.stroke();
    }
  }
  const halo = surface(128, 128), glow = halo.c.createRadialGradient(64, 64, 7, 64, 64, 64);
  glow.addColorStop(0, color + 'a0'); glow.addColorStop(.45, color + '65'); glow.addColorStop(1, color + '00');
  halo.c.fillStyle = glow; halo.c.fillRect(0, 0, 128, 128);
  const reflection = surface(192, 48), r = reflection.c;
  r.translate(96, 24); r.scale(1, .25);
  const rg = r.createRadialGradient(0, 0, 0, 0, 0, 90); rg.addColorStop(0, color + '95'); rg.addColorStop(1, color + '00');
  r.fillStyle = rg; r.fillRect(-96, -96, 192, 192);
  // Wet-floor ribbons are baked into the reflected light, not full actor copies.
  r.fillStyle = color + '88'; for (let i = 0; i < 4; i++) r.fillRect(-44 + i * 7, -25 + i * 14, 82 - i * 12, 1.5);
  const result = { well: well.canvas, spiral: spiral.canvas, halo: halo.canvas, reflection: reflection.canvas };
  cores.set(color, result); return result;
}
function archFrames(image: HTMLImageElement) {
  const cached = frames.get(image); if (cached) return cached;
  const list = [[0, .3, .29, .58], [.295, .15, .33, .73], [.63, .06, .37, .82]].map(([x,y,w,h]) => {
    const frame = surface(160, 300);
    frame.c.drawImage(image, x * image.width, y * image.height, w * image.width, h * image.height, 0, 0, 160, 300);
    return frame.canvas;
  });
  frames.set(image, list); return list;
}
export function warmPortals(images: Images) {
  PALETTES.forEach(core);
  const image = images.get(PORTAL_ART); if (image) archFrames(image);
}
export interface GateStyle {
  risk?: 1 | 2 | 3;
  biome?: Biome;
  available?: boolean;
  focused?: boolean;
  /** Seconds since the actual PORTAL_ENTER phase began, null before selection. */
  selectedAge?: number | null;
  reduced?: boolean;
}
function fallbackArch(c: Ctx, height: number, color: string, risk: number) {
  // Still a stone gate if the optional atlas is unavailable. No new load gate.
  c.strokeStyle = '#172837'; c.lineWidth = 12;
  c.beginPath(); c.moveTo(-30, 0); c.lineTo(-30, -height * .58); c.quadraticCurveTo(-30, -height, 0, -height); c.quadraticCurveTo(30, -height, 30, -height * .58); c.lineTo(30, 0); c.stroke();
  c.strokeStyle = '#7c929d'; c.lineWidth = 2; c.stroke();
  for (let i = 0; i < risk; i++) { c.fillStyle = color; c.fillRect((i - (risk-1)/2) * 10 - 2, -height - 8 - i % 2 * 4, 4, 12); }
}
export function drawPortal(c: Ctx, images: Images, x: number, y: number, color: string, clock: number, size = 1, style: GateStyle = {}) {
  const risk = style.risk ?? 2, h = [124,134,143][risk-1], width = [74,78,80][risk-1];
  if (x + 65 * size < 0 || x - 65 * size > 430) return;
  const time = style.reduced ? 0 : clock, art = core(color), age = style.selectedAge ?? -1;
  const chosen = age >= 0, charge = chosen && !style.reduced && age < .18 ? age / .18 : 0;
  const impact = chosen && !style.reduced ? Math.max(0, 1 - Math.abs(age - .24) / .1) : 0;
  const wake = style.focused ? 1 : style.available ? .5 : 0;
  const power = .7 + risk * .08 + wake * .15 + (chosen ? .3 : 0);
  c.save(); c.translate(x, y); c.scale(size, size);
  c.globalAlpha *= .45 + wake * .1 + (chosen ? .18 : 0);
  c.drawImage(art.reflection, -55, -2, 110, 22);
  c.restore(); c.save(); c.translate(x, y); c.scale(size, size);
  const alpha = c.globalAlpha;
  c.globalAlpha = alpha * (.17 + wake * .08 + impact * .5);
  c.drawImage(art.halo, -66, -h - 15, 132, h + 34);
  c.globalAlpha = alpha;
  // The opaque stone stays planted; only the energy anticipates the impact.
  c.save(); c.translate(0, -h * .44); c.scale(1 - charge * .09 + impact * .055, 1 - charge * .06);
  c.beginPath(); c.ellipse(0, 0, 25, h * .39, 0, 0, Math.PI * 2); c.clip();
  c.drawImage(art.well, -25, -h * .39, 50, h * .78);
  c.save(); c.scale(1, h * .39 / 25);
  c.globalCompositeOperation = 'screen'; c.globalAlpha = alpha * power * .83;
  c.rotate(-time * (.32 + risk * .08)); c.drawImage(art.spiral, -25, -25, 50, 50);
  if (!lowDetail) { c.rotate(time * .76 + 1.2); c.globalAlpha = alpha * .25; c.drawImage(art.spiral, -22, -22, 44, 44); }
  c.restore();
  // A deep pupil behind the tiny glint sells a tunnel, not a flat white oval.
  c.globalAlpha = alpha * .8; c.fillStyle = '#040b20'; c.beginPath(); c.ellipse(0, 0, 4.5, 8, 0, 0, 7); c.fill();
  c.globalAlpha = alpha * (.65 + impact * .35); c.drawImage(art.halo, -11, -18, 22, 36);
  c.fillStyle = '#edffff'; c.fillRect(-.65, -1.6, 1.3, 3.2); c.restore();
  const image = images.get(PORTAL_ART);
  if (image) c.drawImage(archFrames(image)[risk-1], -width/2, -h, width, h);
  else fallbackArch(c, h, color, risk);
  // Lit inner bevel and carved rune sockets remain legible without colour.
  c.globalAlpha = alpha * (.5 + wake * .18 + charge * .2);
  c.strokeStyle = color; c.lineWidth = 1.1;
  c.beginPath(); c.ellipse(0, -h * .43, 25, h * .38, 0, Math.PI, Math.PI * 2); c.stroke();
  for (let i = 0; i < risk; i++) {
    const rx = (i-(risk-1)/2)*9, ry = -h + 14 + Math.abs(i-(risk-1)/2)*4;
    c.fillStyle = color; c.beginPath(); c.moveTo(rx,ry-2); c.lineTo(rx+2,ry+1); c.lineTo(rx,ry+4); c.lineTo(rx-2,ry+1); c.fill();
  }
  // Biome details share the same frame/core; no five independent portal systems.
  c.globalAlpha = alpha * .7; c.strokeStyle = style.biome === 'spore' ? '#a5df84' : '#c8ac68'; c.lineWidth = 1;
  if (style.biome === 'spore') { c.beginPath(); c.moveTo(-33,-9); c.quadraticCurveTo(-20,-25,-31,-46); c.stroke(); }
  if (style.biome === 'forge' || style.biome === 'ember') { c.strokeRect(-37,-h*.25,10,4); c.strokeRect(27,-h*.25,10,4); }
  const count = style.reduced ? 0 : lowDetail ? 3 : 5 + risk;
  c.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a = i * 2.4 - time * .65, r = 27 + Math.sin(time + i) * 2;
    c.globalAlpha = alpha * (.2 + .2 * Math.sin(time * 1.3 + i) ** 2);
    c.fillRect(Math.cos(a)*r-1, -h*.43+Math.sin(a)*h*.35, 1.5, 2.2);
  }
  if (chosen && !style.reduced) {
    c.globalAlpha = alpha * (.18 + .24 * Math.exp(-Math.max(0,age-.35)*2));
    c.strokeStyle = color; c.lineWidth = 1.4;
    const pull = Math.min(1, Math.max(0,(age-.28)/.8));
    c.beginPath(); c.ellipse(0,-h*.43,27-pull*13,h*(.36-pull*.13),0,0,Math.PI*2); c.stroke();
  }
  if (impact > 0) { c.globalAlpha = alpha * impact * .85; c.drawImage(art.halo,-47,-h*.43-65,94,130); }
  c.restore();
}
