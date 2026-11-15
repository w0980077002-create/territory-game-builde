/**
 * Travelling cave world. Every layer is projected from the engine camera with its own depth,
 * so the road, the walls and the far vaults pass at different speeds. Nothing here owns
 * gameplay state: scenery is derived from world coordinates and the simulation clock, so a
 * paused expedition is a frozen world.
 */
import { BIOMES, type Biome } from '../../../game/cavePreviewWorld/catalog';
import type { World } from '../../../game/cavePreviewWorld/engine';

type Ctx = CanvasRenderingContext2D;
type Images = Map<string, HTMLImageElement>;
const ROOT = 'assets/territory/cave-expedition/';
const hash = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const mod = (v: number, m: number) => ((v % m) + m) % m;

/** Shared stage geometry: horizon of the walkable floor and the line the party's feet stand on. */
export function stageLayout(h: number) {
  return { horizon: h * .64, floor: h * .805, scale: Math.max(.7, Math.min(1, h / 480)) };
}

const glows = new Map<string, HTMLCanvasElement>();
function glow(color: string) {
  let g = glows.get(color);
  if (!g) {
    g = document.createElement('canvas'); g.width = g.height = 64;
    const c = g.getContext('2d')!, r = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, color); r.addColorStop(.35, color + '88'); r.addColorStop(1, color + '00');
    c.fillStyle = r; c.fillRect(0, 0, 64, 64); glows.set(color, g);
  }
  return g;
}
export function light(c: Ctx, color: string, x: number, y: number, radius: number, alpha: number) {
  if (alpha <= .01) return;
  const a = c.globalAlpha; c.globalAlpha = a * Math.min(1, alpha);
  c.drawImage(glow(color), x - radius, y - radius, radius * 2, radius * 2); c.globalAlpha = a;
}

/** Walkable floor strips are cut once from the painted chambers and feathered into the far wall. */
const grounds = new Map<Biome, HTMLCanvasElement>();
function ground(images: Images, biome: Biome) {
  let strip = grounds.get(biome);
  if (!strip) {
    const crystal = biome === 'crystal';
    const img = images.get(ROOT + (crystal ? 'crystal-chamber.webp' : 'chambers.webp'))!;
    const panel = { crystal: 0, spore: 0, ember: 1, astral: 2, forge: 3 }[biome];
    const sw = crystal ? img.width : img.width / 2, sh = crystal ? img.height : img.height / 2;
    strip = document.createElement('canvas'); strip.width = 768; strip.height = 200;
    const c = strip.getContext('2d')!;
    c.drawImage(img, (panel % 2) * sw, Math.floor(panel / 2) * sh + sh * .64, sw, sh * .26, 0, 0, 768, 200);
    const fade = c.createLinearGradient(0, 0, 0, 30); fade.addColorStop(0, '#000'); fade.addColorStop(1, '#0000');
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = fade; c.fillRect(0, 0, 768, 30);
    c.globalCompositeOperation = 'source-over';
    grounds.set(biome, strip);
  }
  return strip;
}
/** Mirrored endless tiling: neighbouring copies always share an edge, so there is never a seam. */
function tile(c: Ctx, shift: number, width: number, draw: (x: number, flipped: boolean) => void) {
  const first = Math.floor(shift / width);
  for (let n = first; n * width - shift < 430; n++) draw(n * width - shift, mod(n, 2) === 1);
}

interface Mote { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string }
interface Bat { x: number; y: number; vx: number; vy: number; seed: number; flying: boolean; gone: boolean }
/** Cosmetic life of the cave: startled bats, footstep dust, drifting light. Driven by the simulation clock. */
export class CaveLife {
  private clock = -1; private stride = 0; private room = -1; private motes: Mote[] = [];
  private bats = new Map<number, Bat[]>();
  private roost(w: World, index: number) {
    const key = w.room * 100 + index; let list = this.bats.get(key);
    if (!list) {
      const x = w.roomX + 470 + index * 610;
      list = [0, 1, 2].map(n => ({ x: x + n * 15 - 15, y: 0, vx: 0, vy: 0, seed: hash(key * 7 + n), flying: false, gone: false }));
      this.bats.set(key, list);
      if (this.bats.size > 8) this.bats.delete(this.bats.keys().next().value as number);
    }
    return list;
  }
  private near(w: World) { const i = Math.floor((w.cameraX - w.roomX - 470 + 305) / 610); return [i, i + 1].filter(n => n >= 0); }
  puff(x: number, y: number, color: string, count: number, spread = 60, up = 50) {
    for (let n = 0; n < count; n++) this.motes.push({ x: x + (Math.random() - .5) * 14, y, vx: (Math.random() - .5) * spread, vy: -Math.random() * up, life: .45 + Math.random() * .4, max: .85, size: 2 + Math.random() * 3.5, color });
  }
  step(w: World, h: number, reduced: boolean) {
    const dt = this.clock < 0 || w.time < this.clock ? 0 : Math.min(.1, w.time - this.clock); this.clock = w.time;
    if (this.room !== w.room) { this.room = w.room; this.motes = []; this.stride = w.distance; }
    if (!dt) return;
    const { floor } = stageLayout(h);
    for (const i of this.near(w)) for (const b of this.roost(w, i)) {
      if (b.gone) continue;
      if (!b.flying) {
        if (b.x - w.heroX < 150 && !reduced) { b.flying = true; b.vx = (b.seed - .3) * 190; b.vy = 30 + b.seed * 40; b.y = h * .1; }
      } else { b.x += b.vx * dt; b.y += b.vy * dt; b.vy -= 95 * dt; if (b.y < -30) b.gone = true; }
    }
    if (w.distance - this.stride > 44) { this.stride = w.distance; if (!reduced) this.puff(w.heroX - 16, floor, '#d9d2c4', 3, 46, 34); }
    for (const m of this.motes) { m.life -= dt; m.x += m.vx * dt; m.y += m.vy * dt; m.vy += 55 * dt; }
    this.motes = this.motes.filter(m => m.life > 0).slice(-70);
  }
  /** Bats hang from the vault at depth 1 and leave when the party walks under them. */
  drawBats(c: Ctx, w: World, h: number) {
    for (const i of this.near(w)) for (const b of this.roost(w, i)) {
      if (b.gone) continue;
      const x = b.x - w.cameraX, y = b.flying ? b.y : h * .1 + b.seed * 9;
      if (x < -30 || x > 460) continue;
      c.save(); c.translate(x, y); c.fillStyle = '#0d0a14';
      if (!b.flying) { c.beginPath(); c.ellipse(0, 0, 3.5, 7, 0, 0, 7); c.fill(); c.fillStyle = '#ffd98a'; c.fillRect(-1.6, 3, 1, 1); c.fillRect(.8, 3, 1, 1); }
      else {
        const flap = Math.sin(w.time * 22 + b.seed * 9) * 7;
        c.beginPath(); c.ellipse(0, 0, 3, 4.5, 0, 0, 7); c.fill();
        c.beginPath(); c.moveTo(0, -1); c.quadraticCurveTo(-8, -6 - flap, -15, flap); c.quadraticCurveTo(-8, 1, 0, 3);
        c.quadraticCurveTo(8, 1, 15, flap); c.quadraticCurveTo(8, -6 - flap, 0, -1); c.fill();
      }
      c.restore();
    }
  }
  drawMotes(c: Ctx, w: World) {
    for (const m of this.motes) {
      c.globalAlpha = Math.max(0, m.life / m.max) * .42; c.fillStyle = m.color;
      c.beginPath(); c.arc(m.x - w.cameraX, m.y, m.size * (1.6 - m.life / m.max), 0, 7); c.fill();
    }
    c.globalAlpha = 1;
  }
}

/** Mid-distance set pieces (depth .5): each biome has its own silhouettes with a rim of local light. */
function midPiece(c: Ctx, biome: Biome, seed: number, x: number, base: number, h: number, time: number) {
  const tall = h * (.2 + seed * .17), theme = BIOMES[biome].color;
  c.save(); c.translate(x, base);
  if (biome === 'crystal' || biome === 'astral') {
    const dark = biome === 'crystal' ? '#0c2a44' : '#241a4d';
    for (let n = 0; n < 4; n++) {
      const k = hash(seed * 31 + n), dx = (n - 1.5) * 17 + k * 8, w = 9 + k * 9, top = tall * (.5 + k * .5), lean = (k - .5) * 16;
      const g = c.createLinearGradient(0, -top, 0, 0); g.addColorStop(0, theme); g.addColorStop(.55, dark); g.addColorStop(1, '#070d18');
      c.fillStyle = g; c.globalAlpha = .82;
      c.beginPath(); c.moveTo(dx - w, 0); c.lineTo(dx - w * .6 + lean, -top * .82); c.lineTo(dx + lean, -top); c.lineTo(dx + w * .7 + lean, -top * .78); c.lineTo(dx + w, 0); c.fill();
      c.globalAlpha = .5; c.strokeStyle = '#ffffff'; c.lineWidth = .8;
      c.beginPath(); c.moveTo(dx + lean, -top); c.lineTo(dx + w * .1, 0); c.stroke();
    }
    c.globalAlpha = 1; light(c, theme, 0, -tall * .35, tall * .7, .2 + .06 * Math.sin(time * 1.3 + seed * 20));
    if (biome === 'astral') {
      // A shard of the old vault hangs in the air and slowly turns.
      const bob = Math.sin(time * .8 + seed * 12) * 5;
      c.fillStyle = '#3a2d74'; c.globalAlpha = .85; c.beginPath(); c.moveTo(34, -tall - 20 + bob); c.lineTo(46, -tall - 8 + bob); c.lineTo(39, -tall + 8 + bob); c.lineTo(27, -tall - 4 + bob); c.fill();
      light(c, '#c6a0ff', 37, -tall - 5 + bob, 16, .35);
    }
  } else if (biome === 'spore') {
    const stem = tall * .9, cap = 26 + seed * 22;
    c.globalAlpha = .88; c.strokeStyle = '#1b3a2c'; c.lineWidth = 7 + seed * 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-8 + seed * 14, -stem * .5, 3, -stem); c.stroke();
    const g = c.createLinearGradient(0, -stem - cap * .55, 0, -stem + 6); g.addColorStop(0, '#2c7a4c'); g.addColorStop(1, '#a8ff9a');
    c.fillStyle = g; c.beginPath(); c.moveTo(3 - cap, -stem + 4); c.quadraticCurveTo(3 - cap * .9, -stem - cap * .75, 3, -stem - cap * .6); c.quadraticCurveTo(3 + cap * .9, -stem - cap * .75, 3 + cap, -stem + 4); c.quadraticCurveTo(3, -stem - 5, 3 - cap, -stem + 4); c.fill();
    c.globalAlpha = 1; light(c, '#8dff8a', 3, -stem + 8, cap * 1.5, .26 + .07 * Math.sin(time * 1.1 + seed * 30));
  } else {
    // Old mine timbering with a swinging lantern; the forge adds a hot chain.
    const post = tall * .82, span = 46 + seed * 20, wood = c.createLinearGradient(0, -post, 0, 0);
    wood.addColorStop(0, biome === 'forge' ? '#5a3324' : '#5c4027'); wood.addColorStop(1, biome === 'forge' ? '#2b1712' : '#2c1e13');
    c.globalAlpha = .78; c.fillStyle = wood;
    c.fillRect(-span / 2 - 3.5, -post, 7, post); c.fillRect(span / 2 - 3.5, -post, 7, post); c.fillRect(-span / 2 - 9, -post - 3, span + 18, 8);
    c.strokeStyle = '#8a6238'; c.lineWidth = .8; c.strokeRect(-span / 2 - 9, -post - 3, span + 18, 8);
    const swing = Math.sin(time * 1.4 + seed * 15) * .09, lx = -span * .12;
    c.save(); c.translate(lx, -post + 7); c.rotate(swing);
    c.strokeStyle = '#120c08'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 22); c.stroke();
    if (biome === 'forge') { c.strokeStyle = '#3c2a26'; c.lineWidth = 3; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(span * .5, 0); c.lineTo(span * .5, post * .55); c.stroke(); c.setLineDash([]); }
    c.fillStyle = '#1b130d'; c.fillRect(-5, 20, 10, 13); c.fillStyle = '#ffd27a'; c.fillRect(-3, 23, 6, 8);
    c.globalAlpha = 1; light(c, biome === 'forge' ? '#ff7a45' : '#ffb85c', 0, 27, 30 + Math.sin(time * 9 + seed * 40) * 2.5, .5);
    c.restore();
  }
  c.restore();
}

/** Road-side lights standing at true world addresses right behind the party (depth 1). */
function roadLight(c: Ctx, biome: Biome, seed: number, x: number, base: number, scale: number, time: number) {
  const theme = BIOMES[biome].color, flick = Math.sin(time * 11 + seed * 50) * .06 + Math.sin(time * 4.3 + seed * 9) * .05;
  c.save(); c.translate(x, base); c.scale(scale, scale);
  c.fillStyle = '#02070b66'; c.beginPath(); c.ellipse(0, 2, 20, 4.5, 0, 0, 7); c.fill();
  if (biome === 'ember' || biome === 'forge') {
    c.strokeStyle = '#17110d'; c.lineWidth = 3.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-11, 0); c.lineTo(-4, -34); c.moveTo(11, 0); c.lineTo(4, -34); c.moveTo(0, 0); c.lineTo(0, -34); c.stroke();
    c.fillStyle = '#241812'; c.beginPath(); c.moveTo(-14, -42); c.lineTo(14, -42); c.lineTo(9, -31); c.lineTo(-9, -31); c.fill();
    c.strokeStyle = '#8a6a3c'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-14, -42); c.lineTo(14, -42); c.stroke();
    for (let n = 0; n < 3; n++) {
      const sway = Math.sin(time * (7 + n * 2) + seed * 20 + n) * 2.5, tall = 15 + n * 6 + flick * 30;
      c.fillStyle = ['#ff7a2e', '#ffb347', '#fff0b0'][n]; c.globalAlpha = .9;
      c.beginPath(); c.moveTo(-8 + n * 2.5, -42); c.quadraticCurveTo(-6 + sway, -42 - tall * .6, sway * 1.4, -42 - tall + n * 6); c.quadraticCurveTo(6 + sway, -42 - tall * .6, 8 - n * 2.5, -42); c.fill();
    }
    c.globalAlpha = 1; light(c, '#ffac4d', 0, -50, 62, .5 + flick); light(c, '#ff9a3c', 0, 4, 46, .22 + flick);
  } else if (biome === 'spore') {
    for (let n = 0; n < 3; n++) {
      const dx = (n - 1) * 13, tall = 15 + hash(seed * 9 + n) * 16, cap = 8 + hash(seed * 5 + n) * 5;
      c.strokeStyle = '#d9f5c8'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(dx, 0); c.lineTo(dx + 1, -tall); c.stroke();
      const g = c.createLinearGradient(0, -tall - cap, 0, -tall + 3); g.addColorStop(0, '#3fae63'); g.addColorStop(1, '#c9ffb0');
      c.fillStyle = g; c.beginPath(); c.moveTo(dx - cap, -tall + 2); c.quadraticCurveTo(dx, -tall - cap * 1.5, dx + cap + 2, -tall + 2); c.quadraticCurveTo(dx, -tall - 2, dx - cap, -tall + 2); c.fill();
    }
    light(c, '#9dff8a', 0, -22, 52, .42 + flick); light(c, '#9dff8a', 0, 4, 40, .18);
  } else {
    for (let n = 0; n < 4; n++) {
      const k = hash(seed * 13 + n), dx = (n - 1.5) * 10, w = 5 + k * 5, top = 18 + k * 30, lean = (n - 1.5) * 5;
      const g = c.createLinearGradient(0, -top, 0, 0); g.addColorStop(0, '#f4fdff'); g.addColorStop(.4, theme); g.addColorStop(1, biome === 'astral' ? '#2b1c63' : '#0d3a5c');
      c.fillStyle = g; c.beginPath(); c.moveTo(dx - w, 0); c.lineTo(dx - w * .5 + lean, -top * .8); c.lineTo(dx + lean, -top); c.lineTo(dx + w * .6 + lean, -top * .75); c.lineTo(dx + w, 0); c.fill();
      c.strokeStyle = '#ffffffaa'; c.lineWidth = .7; c.beginPath(); c.moveTo(dx + lean, -top); c.lineTo(dx, 0); c.stroke();
    }
    light(c, theme, 0, -20, 58, .42 + flick); light(c, theme, 0, 4, 44, .2);
  }
  c.restore();
}

/** Everything behind the party: far vault, mid silhouettes, the road and its lights. */
export function drawBackdrop(c: Ctx, w: World, images: Images, h: number, life: CaveLife, reduced: boolean) {
  const theme = BIOMES[w.biome], { horizon, scale } = stageLayout(h), cam = w.cameraX, time = reduced ? 0 : w.time;
  c.fillStyle = theme.sky; c.fillRect(0, 0, 430, h);
  // Far painted vault, depth .2.
  const wide = images.get(ROOT + 'biomes.webp')!, pw = wide.width / 2, ph = wide.height / 2;
  const farH = horizon + h * .05, farW = pw * farH / (ph * .76);
  tile(c, (cam - w.roomX) * .2 + w.room * 173 + 90, farW, (x, flipped) => {
    c.save();
    if (flipped) { c.translate(x + farW, 0); c.scale(-1, 1); } else c.translate(x, 0);
    c.drawImage(wide, (theme.art % 2) * pw + 1, Math.floor(theme.art / 2) * ph + 1, pw - 2, ph * .76, 0, 0, farW + 1, farH);
    c.restore();
  });
  if (w.biome === 'forge') { c.fillStyle = '#8f1d0a2e'; c.fillRect(0, 0, 430, farH); }
  // Slow light shafts between the vault and the mid wall.
  if (!reduced) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let n = 0; n < 3; n++) {
      const x = mod(n * 190 + 60 - (cam - w.roomX) * .32, 620) - 95, sway = Math.sin(w.time * .35 + n * 2.1) * 12;
      const g = c.createLinearGradient(x, 0, x - 70, horizon); g.addColorStop(0, theme.color + '30'); g.addColorStop(1, theme.color + '00');
      c.fillStyle = g; c.beginPath(); c.moveTo(x - 12 + sway, 0); c.lineTo(x + 30 + sway, 0); c.lineTo(x - 30, horizon + 6); c.lineTo(x - 112, horizon + 6); c.fill();
    }
    c.restore();
  }
  // Mid set pieces, depth .5, softened by haze.
  const spacing = 250, midShift = (cam - w.roomX) * .5;
  for (let n = Math.floor((midShift - 90) / spacing); n * spacing - midShift < 520; n++) {
    const seed = hash(n * 3.7 + w.room * 41 + 5);
    if (seed < .12) continue;
    midPiece(c, w.biome, seed, n * spacing + seed * 90 - midShift, horizon + h * .012, h, time);
  }
  const haze = c.createLinearGradient(0, horizon - h * .2, 0, horizon + h * .06);
  haze.addColorStop(0, theme.sky + '00'); haze.addColorStop(.72, theme.sky + '8c'); haze.addColorStop(1, theme.sky + '00');
  c.fillStyle = haze; c.fillRect(0, horizon - h * .2, 430, h * .26);
  // The road: true world speed.
  const strip = ground(images, w.biome), gh = h - horizon + 2, gw = 768 * gh / 200 * 1.12;
  tile(c, cam - w.roomX, gw, (x, flipped) => {
    c.save();
    if (flipped) { c.translate(x + gw, horizon - 2); c.scale(-1, 1); } else c.translate(x, horizon - 2);
    c.drawImage(strip, 0, 0, 768, 200, 0, 0, gw + 1, gh);
    c.restore();
  });
  // Road-side lights and the bats above them.
  const base = horizon + h * .045;
  for (let n = Math.floor((cam - w.roomX - 80) / 330); n * 330 + w.roomX - cam < 510; n++) {
    if (n < 0) continue;
    const seed = hash(n * 5.3 + w.room * 17 + 2), x = w.roomX + 300 + n * 330 + seed * 120;
    if (w.portalX > w.roomX && Math.abs(x - w.portalX - 56) < 170) continue;
    roadLight(c, w.biome, seed, x - cam, base, scale, time);
  }
  life.drawBats(c, w, h);
}

/** Close foreground (depth 1.35) and atmosphere in front of the party. */
export function drawForeground(c: Ctx, w: World, h: number, life: CaveLife, reduced: boolean) {
  const theme = BIOMES[w.biome], cam = w.cameraX, { horizon, floor } = stageLayout(h);
  life.drawMotes(c, w);
  // Drifting motes at two depths.
  for (let i = 0; i < (reduced ? 8 : 26); i++) {
    const depth = i % 3 === 0 ? 1.25 : .62, k = hash(i * 9.1);
    const x = mod(i * 67.3 - (cam - w.roomX) * depth + Math.sin(w.time * .4 + i) * 14, 470) - 20;
    const py = 30 + mod(i * 43.1, Math.max(60, floor - 40));
    c.globalAlpha = (.14 + (Math.sin((reduced ? 0 : w.time * 2) + i) + 1) * .16) * (depth > 1 ? 1 : .7); c.fillStyle = theme.color;
    if (w.biome === 'astral') { c.fillRect(x - 2, py, 5, 1); c.fillRect(x, py - 2, 1, 5); }
    else if (w.biome === 'ember' || w.biome === 'forge') c.fillRect(x, py - mod(w.time * (i % 3 + 8), 35), 1.5, 4);
    else { c.beginPath(); c.arc(x, py + Math.sin(w.time * .7 + i) * 4, w.biome === 'spore' ? 1.4 + k * 1.6 : i % 3 === 0 ? 2 : 1, 0, 7); c.fill(); }
  }
  c.globalAlpha = 1;
  // Near rocks and stalactites slide past faster than the road.
  const near = (cam - w.roomX) * 1.35, gap = 360;
  for (let n = Math.floor((near - 140) / gap); n * gap - near < 560; n++) {
    const seed = hash(n * 7.9 + w.room * 23 + 1), x = n * gap + seed * 150 - near;
    c.fillStyle = '#05080dee';
    if (seed > .34) {
      const tall = h * (.07 + seed * .09), wide = 30 + seed * 34;
      c.beginPath(); c.moveTo(x - wide, -2); c.lineTo(x - wide * .5, tall * .55); c.lineTo(x - wide * .2, tall * .3); c.lineTo(x + wide * .05, tall); c.lineTo(x + wide * .3, tall * .36); c.lineTo(x + wide * .62, tall * .62); c.lineTo(x + wide, -2); c.fill();
      c.strokeStyle = theme.color + '55'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + wide * .05, tall); c.lineTo(x + wide * .3, tall * .36); c.lineTo(x + wide * .62, tall * .62); c.stroke();
    }
    if (seed < .7) {
      const rx = x + 190, tall = h * (.035 + seed * .04), wide = 46 + seed * 50;
      c.beginPath(); c.moveTo(rx - wide, h + 2); c.lineTo(rx - wide * .7, h - tall * .7); c.lineTo(rx - wide * .2, h - tall); c.lineTo(rx + wide * .35, h - tall * .8); c.lineTo(rx + wide, h + 2); c.fill();
      c.strokeStyle = theme.color + '44'; c.lineWidth = 1; c.beginPath(); c.moveTo(rx - wide * .7, h - tall * .7); c.lineTo(rx - wide * .2, h - tall); c.lineTo(rx + wide * .35, h - tall * .8); c.stroke();
      light(c, theme.color, rx, h - tall, 26, .22);
    }
  }
  // Soft frame: keeps the eye on the road and seats the scene into the wooden HUD.
  const top = c.createLinearGradient(0, 0, 0, h * .2); top.addColorStop(0, '#04060bb0'); top.addColorStop(1, '#04060b00');
  c.fillStyle = top; c.fillRect(0, 0, 430, h * .2);
  const low = c.createLinearGradient(0, h * .9, 0, h); low.addColorStop(0, '#04060b00'); low.addColorStop(1, '#04060b9c');
  c.fillStyle = low; c.fillRect(0, h * .9, 430, h * .1);
  const boss = w.enemies.find(e => e.species === 'boss' && e.hp > 0);
  if (boss && boss.worldX - cam < 520) {
    const shade = c.createRadialGradient(215, horizon, 90, 215, horizon, 330);
    shade.addColorStop(0, '#22133f00'); shade.addColorStop(1, `rgba(46,14,58,${.1 + w.bossPhase * .06})`);
    c.fillStyle = shade; c.fillRect(0, 0, 430, h);
  }
}
