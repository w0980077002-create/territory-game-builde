/** One cosmetic gate renderer for every cave biome. Never owns a gameplay timer,
 * hitbox, transition, reward or saved field. All expensive art is warmed at load.
 */
import type { Biome } from '../../../game/cavePreviewWorld/catalog';
import { burst, clamp01, hash, light, pool, starPath, surface as kitSurface } from './kit';

type Ctx = CanvasRenderingContext2D;
type Images = Map<string, HTMLImageElement>;
export const PORTAL_ART = 'assets/territory/cave-expedition/portal-arches.webp';
const PALETTES = ['#80e7a3', '#64c9ff', '#d4a0ff', '#64e7ff', '#a0ef7c', '#ffb45b', '#c6a0ff', '#ff805f', '#a485ff'];
const lowDetail = typeof navigator !== 'undefined' && navigator.hardwareConcurrency <= 4;
const cores = new Map<string, { well: HTMLCanvasElement; spiral: HTMLCanvasElement; halo: HTMLCanvasElement; reflection: HTMLCanvasElement; beam: HTMLCanvasElement }>();
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
  // A standing column of light: soft across, fading upward. Baked once per colour.
  const beam = surface(64, 256), b = beam.c, across = b.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, color + '00'); across.addColorStop(.38, color + 'aa'); across.addColorStop(.5, '#ffffff'); across.addColorStop(.62, color + 'aa'); across.addColorStop(1, color + '00');
  b.fillStyle = across; b.fillRect(0, 0, 64, 256);
  const up = b.createLinearGradient(0, 0, 0, 256); up.addColorStop(0, '#0000'); up.addColorStop(.55, '#0006'); up.addColorStop(1, '#000');
  b.globalCompositeOperation = 'destination-in'; b.fillStyle = up; b.fillRect(0, 0, 64, 256);
  const result = { well: well.canvas, spiral: spiral.canvas, halo: halo.canvas, reflection: reflection.canvas, beam: beam.canvas };
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
/** A small soft window onto the district behind a gate: the player sees where it leads. */
const vistas = new WeakMap<Images, Map<Biome, HTMLCanvasElement | null>>();
function vista(images: Images, biome: Biome) {
  let made = vistas.get(images); if (!made) { made = new Map(); vistas.set(images, made); }
  if (made.has(biome)) return made.get(biome)!;
  const root = 'assets/territory/cave-expedition/', crystal = biome === 'crystal';
  const img = images.get(root + (crystal ? 'crystal-rift-depth.webp' : 'biomes.webp')) ?? (crystal ? images.get(root + 'crystal-chamber.webp') : undefined);
  let result: HTMLCanvasElement | null = null;
  if (img) {
    const s = kitSurface(40, 64), panel = { crystal: 0, spore: 1, ember: 2, astral: 3, forge: 2 }[biome];
    if (crystal) s.c.drawImage(img, img.width * .52, img.height * .06, img.width * .22, img.height * .56, 0, 0, 40, 64);
    else s.c.drawImage(img, (panel % 2) * img.width / 2 + img.width * .16, Math.floor(panel / 2) * img.height / 2 + 4, img.width * .17, img.height * .44, 0, 0, 40, 64);
    if (biome === 'forge') { s.c.fillStyle = '#b3240f55'; s.c.fillRect(0, 0, 40, 64); }
    result = s.canvas;
  }
  made.set(biome, result); return result;
}
export function warmPortals(images: Images) {
  PALETTES.forEach(core);
  const image = images.get(PORTAL_ART); if (image) archFrames(image);
  for (const biome of ['crystal', 'spore', 'ember', 'astral', 'forge'] as Biome[]) vista(images, biome);
}
export interface GateStyle {
  risk?: 1 | 2 | 3;
  biome?: Biome;
  /** District seen through the throat of the gate. */
  beyond?: Biome;
  available?: boolean;
  focused?: boolean;
  /** Seconds since the actual PORTAL_ENTER phase began, null before selection. */
  selectedAge?: number | null;
  /** Seconds since ANOTHER gate was chosen: this one seals itself. */
  rejectedAge?: number | null;
  /** Star medallions above the keystone (the floor's risk choice). */
  stars?: number;
  /** Hero position relative to the gate, in stage units, for the pull of a chosen gate. */
  heroDx?: number;
  /** Vertical stretch of the whole gate (taller choice gates; hitboxes are DOM and unchanged). */
  tall?: number;
  reduced?: boolean;
}
function fallbackArch(c: Ctx, height: number, color: string, risk: number) {
  // Still a stone gate if the optional atlas is unavailable. No new load gate.
  c.strokeStyle = '#172837'; c.lineWidth = 12;
  c.beginPath(); c.moveTo(-30, 0); c.lineTo(-30, -height * .58); c.quadraticCurveTo(-30, -height, 0, -height); c.quadraticCurveTo(30, -height, 30, -height * .58); c.lineTo(30, 0); c.stroke();
  c.strokeStyle = '#7c929d'; c.lineWidth = 2; c.stroke();
  for (let i = 0; i < risk; i++) { c.fillStyle = color; c.fillRect((i - (risk-1)/2) * 10 - 2, -height - 8 - i % 2 * 4, 4, 12); }
}
/** One gate = stone arch + a throat with real depth + a standing beam + a temper that grows
 * with the risk: ★ breathes, ★★ is orbited by rune stones, ★★★ crackles with lightning. */
export function drawPortal(c: Ctx, images: Images, x: number, y: number, color: string, clock: number, size = 1, style: GateStyle = {}) {
  const risk = style.risk ?? 2, h = [124,134,143][risk-1], width = [74,78,80][risk-1];
  if (x + 90 * size < 0 || x - 90 * size > 430) return;
  const reduced = !!style.reduced, time = reduced ? 0 : clock, art = core(color), age = style.selectedAge ?? -1;
  const chosen = age >= 0, charge = chosen && !reduced && age < .18 ? age / .18 : 0;
  const impact = chosen && !reduced ? Math.max(0, 1 - Math.abs(age - .24) / .1) : 0;
  const sealed = style.rejectedAge != null && style.rejectedAge >= 0 ? (reduced ? 1 : clamp01(style.rejectedAge / .45)) : 0;
  const wake = style.focused ? 1 : style.available ? .5 : 0, open = 1 - sealed;
  const tempo = .9 + risk * .55, breath = reduced ? .5 : .5 + .5 * Math.sin(time * tempo + x * .05);
  const power = (.7 + risk * .08 + wake * .15 + (chosen ? .3 : 0)) * open;
  const cy = -h * .44, ry = h * .39;
  c.save(); c.translate(x, y); c.scale(size, size * (style.tall ?? 1));
  const alpha = c.globalAlpha;
  // A pocket of darkness behind the gate: its own light has something to burn against.
  c.globalAlpha = alpha * open * (.5 + wake * .12); light(c, '#03040c', 0, cy, h * .98, 1); c.globalAlpha = alpha;
  // Light spilled on the wet floor, breathing with the gate.
  c.globalAlpha = alpha * (.5 + wake * .15 + (chosen ? .2 : 0)) * open;
  c.drawImage(art.reflection, -55, -2, 110, 22);
  c.globalAlpha = alpha; pool(c, color, 0, 3, 58 + breath * 6 + wake * 8, 13, open * (.28 + wake * .16 + risk * .05 + impact * .4));
  if (open > 0) {
    // A rune circle burns on the floor in front of every gate; it turns faster with the risk.
    c.strokeStyle = color; c.lineWidth = 1.3; c.globalAlpha = alpha * open * (.5 + wake * .3);
    c.beginPath(); c.ellipse(0, 4, 43, 8.5, 0, 0, Math.PI * 2); c.stroke();
    c.globalAlpha *= .55; c.beginPath(); c.ellipse(0, 4, 35, 6.6, 0, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#f4ffff';
    for (let i = 0; i < 4 + risk * 2; i++) {
      const a = i / (4 + risk * 2) * Math.PI * 2 + time * (.3 + risk * .22), gx = Math.cos(a) * 39, gy = 4 + Math.sin(a) * 7.6;
      c.globalAlpha = alpha * open * (.4 + .5 * Math.sin(a * 2 + time * 3) ** 2);
      c.beginPath(); c.moveTo(gx, gy - 2.2); c.lineTo(gx + 1.8, gy); c.lineTo(gx, gy + 2.2); c.lineTo(gx - 1.8, gy); c.fill();
    }
  }
  // The standing beam: three pillars of light read the choice from across the hall.
  if (open > 0) {
    const flare = chosen ? Math.exp(-Math.max(0, age - .24) * 1.6) : 0, wide = 58 + risk * 7 + wake * 12 + flare * 50, tall = h + 190 + risk * 26;
    c.save(); c.globalCompositeOperation = 'lighter';
    c.globalAlpha = alpha * open * (.42 + risk * .07 + wake * .2 + breath * .1 + flare * .4) * (risk === 3 && !reduced ? .82 + .18 * Math.sin(time * 23) * Math.sin(time * 9.1) : 1);
    c.drawImage(art.beam, -wide / 2, -tall, wide, tall);
    c.globalAlpha *= .8; c.drawImage(art.beam, -wide * .22, -tall * .86, wide * .44, tall * .86);
    c.restore();
  }
  c.globalAlpha = alpha * (.2 + wake * .1 + impact * .5 + breath * .06) * open;
  c.drawImage(art.halo, -70, -h - 18, 140, h + 40);
  c.globalAlpha = alpha;
  // The opaque stone stays planted; only the energy anticipates the impact.
  c.save(); c.translate(0, cy); c.scale((1 - charge * .09 + impact * .055) * (1 - sealed * .88), 1 - charge * .06);
  c.beginPath(); c.ellipse(0, 0, 25, ry, 0, 0, Math.PI * 2); c.clip();
  c.drawImage(art.well, -25, -ry, 50, h * .78);
  // The district beyond, seen through the gate; it slides against the frame as the camera moves.
  const beyond = style.beyond ? vista(images, style.beyond) : null;
  if (beyond) {
    const slide = Math.max(-1, Math.min(1, (215 - x) / 215)) * 5, swell = reduced ? 0 : Math.sin(time * .7 + risk) * 1.5;
    c.globalAlpha = alpha * (.9 + wake * .1);
    c.drawImage(beyond, -31 - swell + slide, -ry - 4 - swell, 62 + swell * 2, ry * 2 + 8 + swell * 2);
    c.globalAlpha = alpha * .16; c.fillStyle = color; c.fillRect(-25, -ry, 50, ry * 2);
  }
  // Rings of light falling into the throat: real depth, not a flat swirl.
  c.lineWidth = 1.2;
  for (let i = 0; i < (lowDetail ? 3 : 5); i++) {
    const u = ((reduced ? .13 : time * (.28 + risk * .13)) + i / (lowDetail ? 3 : 5)) % 1, s = 1 - u * .92;
    c.globalAlpha = alpha * Math.sin(u * Math.PI) * (.34 + wake * .2) * power; c.strokeStyle = i % 2 ? '#f2ffff' : color; c.lineWidth = .5 + s * 1.7;
    c.beginPath(); c.ellipse(0, 0, 25 * s, ry * s, 0, 0, Math.PI * 2); c.stroke();
  }
  c.save(); c.scale(1, ry / 25);
  c.globalCompositeOperation = 'screen'; c.globalAlpha = alpha * power * .42;
  c.rotate(-time * (.32 + risk * .08)); c.drawImage(art.spiral, -25, -25, 50, 50);
  if (!lowDetail) { c.rotate(time * .76 + 1.2); c.globalAlpha = alpha * .16; c.drawImage(art.spiral, -22, -22, 44, 44); }
  c.restore();
  // Shadowed rim and a deep pupil sell a tunnel, not a flat white oval.
  c.globalAlpha = alpha * .55; c.strokeStyle = '#030512'; c.lineWidth = 7; c.beginPath(); c.ellipse(0, 0, 26, ry + 1, 0, 0, Math.PI * 2); c.stroke();
  c.globalAlpha = alpha * .7; c.fillStyle = '#040b20'; c.beginPath(); c.ellipse(0, 0, 4, 7, 0, 0, 7); c.fill();
  c.globalAlpha = alpha * (.7 + impact * .3); c.drawImage(art.halo, -12, -19, 24, 38);
  c.fillStyle = '#edffff'; c.fillRect(-.65, -1.6, 1.3, 3.2); c.restore();
  c.globalAlpha = alpha * (1 - sealed * .35);
  const image = images.get(PORTAL_ART);
  if (image) c.drawImage(archFrames(image)[risk-1], -width/2, -h, width, h);
  else fallbackArch(c, h, color, risk);
  // Lit inner bevel and carved rune sockets remain legible without colour.
  c.globalAlpha = alpha * (.55 + wake * .2 + charge * .2) * open;
  c.strokeStyle = color; c.lineWidth = 1.3;
  c.beginPath(); c.ellipse(0, -h * .43, 25, h * .38, 0, Math.PI, Math.PI * 2); c.stroke();
  for (let i = 0; i < risk; i++) {
    const rx = (i-(risk-1)/2)*9, ry2 = -h + 14 + Math.abs(i-(risk-1)/2)*4, lit = reduced ? 1 : .55 + .45 * Math.sin(time * tempo * 1.4 - i * 1.1) ** 2;
    c.globalAlpha = alpha * open * lit; light(c, color, rx, ry2 + 1, 6, .8);
    c.fillStyle = '#f7ffff'; c.beginPath(); c.moveTo(rx,ry2-2); c.lineTo(rx+2,ry2+1); c.lineTo(rx,ry2+4); c.lineTo(rx-2,ry2+1); c.fill();
  }
  // Biome details share the same frame/core; no five independent portal systems.
  c.globalAlpha = alpha * .7; c.strokeStyle = style.biome === 'spore' ? '#a5df84' : '#c8ac68'; c.lineWidth = 1;
  if (style.biome === 'spore') { c.beginPath(); c.moveTo(-33,-9); c.quadraticCurveTo(-20,-25,-31,-46); c.stroke(); }
  if (style.biome === 'forge' || style.biome === 'ember') { c.strokeRect(-37,-h*.25,10,4); c.strokeRect(27,-h*.25,10,4); }
  if (!reduced && open > 0) {
    // ★ drifting motes · ★★ orbiting rune stones · ★★★ lightning across the keystone.
    const count = lowDetail ? 4 : 6 + risk * 2;
    for (let i = 0; i < count; i++) {
      const u = (time * (.16 + risk * .07) + hash(i * 3.7 + risk)) % 1, side = i % 2 ? 1 : -1;
      const px = side * (30 + hash(i * 5.1) * 12 - u * 9), py = -u * (h + 26) + 4;
      c.globalAlpha = alpha * open * Math.sin(u * Math.PI) * (.55 + wake * .3);
      light(c, color, px + Math.sin(time * 2 + i) * 2.5, py, 2.6 + hash(i) * 2.2, 1);
    }
    if (risk >= 2) for (let i = 0; i < (risk === 3 ? 3 : 2); i++) {
      const a = time * (1.1 + risk * .25) + i * Math.PI * 2 / (risk === 3 ? 3 : 2), px = Math.cos(a) * 38, py = cy + Math.sin(a) * ry * .92, front = Math.sin(a + .6) > -.2;
      c.globalAlpha = alpha * open * (front ? 1 : .35);
      light(c, color, px, py, 7, .9); c.fillStyle = '#eafcff'; c.strokeStyle = '#10182c'; c.lineWidth = .8;
      c.beginPath(); c.moveTo(px, py - 4); c.lineTo(px + 2.6, py); c.lineTo(px, py + 4); c.lineTo(px - 2.6, py); c.closePath(); c.fill(); c.stroke();
    }
    if (risk === 3) {
      const tick = Math.floor(time * 13); c.lineCap = 'round'; c.lineJoin = 'round';
      for (let bolt = 0; bolt < 2; bolt++) {
        if (hash(tick * 1.3 + bolt * 9) < .42) continue;
        const from = hash(tick + bolt) * Math.PI, to = from + (hash(tick * 2.1 + bolt) - .5) * 2.2;
        c.beginPath();
        for (let s = 0; s <= 5; s++) {
          const a = Math.PI + from + (to - from) * s / 5, r = 1.12 + (hash(tick * 3.3 + bolt * 7 + s) - .5) * .32;
          c.lineTo(Math.cos(a) * 27 * r, cy + Math.sin(a) * ry * r);
        }
        c.globalAlpha = alpha * open * .5; c.strokeStyle = color; c.lineWidth = 3.2; c.stroke();
        c.globalAlpha = alpha * open; c.strokeStyle = '#ffffff'; c.lineWidth = 1; c.stroke();
      }
    }
  }
  if (style.stars) {
    // Risk medallions: gold stars on the keystone, lit one by one.
    for (let i = 0; i < style.stars; i++) {
      const sx = (i - (style.stars - 1) / 2) * 15, sy = -h - 17 - (reduced ? 0 : Math.sin(time * 2.2 + i * .9) * 1.5);
      c.globalAlpha = alpha * (1 - sealed * .6); light(c, color, sx, sy, 13, .75 + wake * .25);
      starPath(c, sx, sy + .8, 7.6, 3.5); c.fillStyle = '#2a1608'; c.fill();
      starPath(c, sx, sy, 6.4, 2.9); c.fillStyle = '#ffd86b'; c.fill();
      starPath(c, sx - .6, sy - .8, 2.6, 1.2); c.fillStyle = '#fff7d6'; c.fill();
    }
  }
  if (chosen && !reduced) {
    c.globalAlpha = alpha * (.18 + .24 * Math.exp(-Math.max(0,age-.35)*2));
    c.strokeStyle = color; c.lineWidth = 1.4;
    const pull = Math.min(1, Math.max(0,(age-.28)/.8));
    c.beginPath(); c.ellipse(0,-h*.43,27-pull*13,h*(.36-pull*.13),0,0,Math.PI*2); c.stroke();
    // The gate answers the choice: a ring across the floor and threads of light to the hero.
    const ring = clamp01((age - .2) / .6);
    if (ring > 0 && ring < 1) { c.globalAlpha = alpha * (1 - ring); c.lineWidth = 3 * (1 - ring) + .5; c.beginPath(); c.ellipse(0, 2, 30 + ring * 120, 6 + ring * 20, 0, 0, Math.PI * 2); c.stroke(); }
    if (style.heroDx !== undefined && style.heroDx < -24) {
      const hx = style.heroDx / size, grip = Math.min(1, age * 3.5);
      c.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const sway = Math.sin(time * 8 + i * 2.1) * 12, mx = hx * .5, my = cy - 26 + i * 22 + sway;
        c.globalAlpha = alpha * grip * .5; c.strokeStyle = i === 1 ? '#f4ffff' : color; c.lineWidth = i === 1 ? 1.2 : 2;
        c.beginPath(); c.moveTo(0, cy); c.quadraticCurveTo(mx, my, hx + 8, -56 + i * 8); c.stroke();
        for (let p = 0; p < 3; p++) {
          const u = (time * 1.7 + p / 3 + i * .21) % 1, v = 1 - u;
          c.globalAlpha = alpha * grip * Math.sin(u * Math.PI);
          light(c, color, v * v * (hx + 8) + 2 * v * u * mx, v * v * (-56 + i * 8) + 2 * v * u * my + u * u * cy, 4.5, 1);
        }
      }
    }
  }
  if (sealed > 0 && sealed < 1 && !reduced) { c.globalAlpha = alpha; burst(c, x * .7 + risk, style.rejectedAge ?? 0, 0, cy, { n: 6, speed: 60, angle: -Math.PI / 2, spread: 5, gravity: -30, life: .6, size: 5, colors: ['#1a2233', color], shape: 'smoke', drag: 3, alpha: .5 }); }
  if (impact > 0) { c.globalAlpha = alpha * impact * .85; c.drawImage(art.halo,-47,-h*.43-65,94,130); }
  c.restore();
}
