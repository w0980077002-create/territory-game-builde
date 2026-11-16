/**
 * Travelling cave world. Every layer is projected from the engine camera with its own depth,
 * so the road, the walls and the far vaults pass at different speeds. Nothing here owns
 * gameplay state: scenery is derived from world coordinates and the simulation clock, so a
 * paused expedition is a frozen world.
 */
import { BIOMES, type Biome } from '../../../game/cavePreviewWorld/catalog';
import type { World } from '../../../game/cavePreviewWorld/engine';
import { drawCrystalBackdrop, drawCrystalForeground } from './crystalEnvironment';
import { burst, clamp01, hash, light, mod, pool, starPath } from './kit';
import { drawProp, kit as sceneryKit, type Prop } from './props';
export { light };

type Ctx = CanvasRenderingContext2D;
type Images = Map<string, HTMLImageElement>;
const ROOT = 'assets/territory/cave-expedition/';

/** Shared stage geometry: horizon of the walkable floor and the line the party's feet stand on. */
export function stageLayout(h: number) {
  return { horizon: h * .64, floor: h * .805, scale: Math.max(.7, Math.min(1, h / 480)) };
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
  private moteSeed = 0;
  // Cosmetic entropy must never consume the combat critical-strike RNG.
  private moteRandom() { return hash(++this.moteSeed); }
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
    for (let n = 0; n < count; n++) this.motes.push({ x: x + (this.moteRandom() - .5) * 14, y, vx: (this.moteRandom() - .5) * spread, vy: -this.moteRandom() * up, life: .45 + this.moteRandom() * .4, max: .85, size: 2 + this.moteRandom() * 3.5, color });
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

/** A live flame on a baked brazier or furnace: three tongues that lean and flare. */
function flame(c: Ctx, x: number, y: number, scale: number, time: number, seed: number, hot: boolean, flare: number) {
  const flick = Math.sin(time * 11 + seed * 50) * .06 + Math.sin(time * 4.3 + seed * 9) * .05;
  for (let n = 0; n < 3; n++) {
    const sway = Math.sin(time * (7 + n * 2) + seed * 20 + n) * 2.5 * scale, tall = (16 + n * 6 + flick * 30) * scale * (1 + flare * .55), wide = (9 - n * 2.6) * scale;
    c.fillStyle = (hot ? ['#ff4a22', '#ff9340', '#ffe9b0'] : ['#ff7a2e', '#ffb347', '#fff0b0'])[n]; c.globalAlpha = .92;
    c.beginPath(); c.moveTo(x - wide, y); c.quadraticCurveTo(x - wide * .7 + sway, y - tall * .6, x + sway * 1.4, y - tall + n * 6 * scale); c.quadraticCurveTo(x + wide * .7 + sway, y - tall * .6, x + wide, y); c.fill();
  }
  c.globalAlpha = 1; light(c, hot ? '#ff7a45' : '#ffac4d', x, y - 8 * scale, (62 + flare * 26) * scale, .5 + flick + flare * .2);
}
const SPARK: Record<Biome, string[]> = {
  crystal: ['#eaffff', '#7fe9ff', '#c9a0ff'], spore: ['#eaffc8', '#a0ef7c', '#d9a6ff'], ember: ['#fff0b0', '#ffb45b', '#ff8a3c'],
  astral: ['#ffffff', '#c6a0ff', '#8fd0ff'], forge: ['#ffe2a8', '#ff805f', '#ff4a22'],
};
/** Things standing along the road at true world addresses, right behind the party. They
 * notice the hero: lean as he passes, burn brighter while he is near and shed light after him. */
function roadside(c: Ctx, w: World, h: number, time: number, reduced: boolean) {
  const { horizon, scale } = stageLayout(h), cam = w.cameraX, base = horizon + h * .045, props = sceneryKit(w.biome).road, theme = BIOMES[w.biome];
  for (let n = Math.floor((cam - w.roomX - 120) / 330); n * 330 + w.roomX - cam < 560; n++) {
    if (n < 0) continue;
    const seed = hash(n * 5.3 + w.room * 17 + 2), wx = w.roomX + 300 + n * 330 + seed * 120, x = wx - cam;
    if (w.portalX > w.roomX && Math.abs(wx - w.portalX - 56) < 190) continue;
    if (Math.abs(wx - w.roomX - 455) < 46) continue; // the spark waiting on the first stretch keeps its own stage
    const prop = props[Math.floor(seed * 97) % props.length], size = scale * (1.02 + hash(n * 3.1 + 7) * .26);
    const passed = w.heroX - wx, near = Math.exp(-((passed / 120) ** 2)), sway = reduced ? 0 : Math.sin(passed / 15) * .1 * Math.exp(-Math.abs(passed) / 120) + Math.sin(time * 1.1 + seed * 30) * .008;
    const breath = reduced ? 0 : Math.sin(time * 1.6 + seed * 40);
    c.globalAlpha = 1; c.fillStyle = '#02070b'; c.globalAlpha = .34; c.beginPath(); c.ellipse(x, base + 2, 25 * size, 5 * size, 0, 0, 7); c.fill(); c.globalAlpha = 1;
    if (prop.glow) pool(c, prop.glow.color, x + prop.glow.x * size, base + 5, prop.glow.r * 1.5 * size, 13 * size, .3 + near * .3 + breath * .04);
    if (!drawProp(c, prop, x, base, size, prop.fire ? 0 : sway, prop.fire ? 0 : near * .03 * (reduced ? 0 : Math.sin(passed / 9)))) continue;
    if (prop.fire) flame(c, x + prop.fire.x * size, base + prop.fire.y * size, size, time, seed, prop.fire.hot, near);
    else if (prop.glow && !reduced) light(c, prop.glow.color, x + prop.glow.x * size, base + prop.glow.y * size, prop.glow.r * size * (1 + near * .25), .3 + near * .34 + breath * .05);
    // Just behind the hero the prop lets go of a little light: spores, sparks, crystal dust.
    if (!reduced && passed > 6 && passed < 190 && (prop.glow || prop.fire)) {
      const origin = prop.glow ?? { x: 0, y: -40 };
      burst(c, n * 9.7 + w.room * 3.1, (passed - 6) / 150, x + origin.x * size + Math.sin(time * 2 + n) * 2, base + origin.y * size, { n: 7, speed: 46, angle: -Math.PI / 2, spread: 2.6, gravity: -26, life: 1.2, size: 3, colors: SPARK[w.biome], shape: 'star', drag: 1.1, alpha: .9 }, size);
    }
  }
  // Each stride leaves a fading ring on the wet stone: the cave registers the party's steps.
  if (!reduced && w.pose === 'run') {
    const { floor } = stageLayout(h), stride = (w.distance / 46) % 1;
    c.strokeStyle = theme.color; c.lineWidth = 1.4 * (1 - stride); c.globalAlpha = (1 - stride) * .55;
    c.beginPath(); c.ellipse(w.heroX - cam - 10 - stride * 46, floor + 3, (8 + stride * 30) * scale, (2 + stride * 6) * scale, 0, 0, 7); c.stroke(); c.globalAlpha = 1;
  }
}
/** Landmarks in the middle distance (depth .5): a district's own architecture and growth. */
function landmarks(c: Ctx, w: World, h: number, time: number, reduced: boolean) {
  const { horizon } = stageLayout(h), pieces = sceneryKit(w.biome).mid; if (!pieces.length) return;
  const spacing = 290, shift = (w.cameraX - w.roomX) * .5, k = h / 560;
  for (let n = Math.floor((shift - 160) / spacing); n * spacing - shift < 560; n++) {
    const seed = hash(n * 3.7 + w.room * 41 + 5); if (seed < .14) continue;
    const prop = pieces[Math.floor(seed * 89) % pieces.length], size = k * (.92 + hash(n * 7.3 + 1) * .42), x = n * spacing + seed * 110 - shift, base = horizon + h * .014;
    c.globalAlpha = .9;
    if (!drawProp(c, prop, x, base, size)) continue;
    c.globalAlpha = 1;
    if (prop.fire) flame(c, x + prop.fire.x * size, base + prop.fire.y * size, size * .9, time, seed, prop.fire.hot, 0);
    // Budget: one modest halo per landmark, none on the low tier.
    if (prop.glow && !reduced) light(c, prop.glow.color, x + prop.glow.x * size, base + prop.glow.y * size, prop.glow.r * size * .62, .34 + .07 * Math.sin(time * 1.3 + seed * 20));
  }
  c.globalAlpha = 1;
}

/** Everything behind the party: far vault, mid silhouettes, the road and its lights. */
export function drawBackdrop(c: Ctx, w: World, images: Images, h: number, life: CaveLife, reduced: boolean) {
  const time = reduced ? 0 : w.time;
  if (w.biome === 'crystal' && drawCrystalBackdrop(c, w, images, h, reduced)) {
    roadside(c, w, h, time, reduced); life.drawBats(c, w, h); return;
  }
  const theme = BIOMES[w.biome], { horizon } = stageLayout(h), cam = w.cameraX;
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
  if (w.biome === 'forge') {
    // The heart of the rift burns from below: the vault is lit red and breathes.
    c.fillStyle = '#8f1d0a40'; c.fillRect(0, 0, 430, farH);
  }
  if (w.biome === 'astral' && !reduced) {
    // Now and then a star falls behind the broken vault.
    const cycle = mod(w.time + w.room * 2.3, 6.5);
    if (cycle < .55) {
      const k = cycle / .55, sx = 380 - k * 230 - mod((cam - w.roomX) * .1, 120), sy = h * (.06 + k * .17);
      c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = '#ffffff'; c.lineCap = 'round'; c.lineWidth = 1.8; c.globalAlpha = Math.sin(k * Math.PI);
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + 46, sy - 22); c.stroke(); light(c, '#e8dcff', sx, sy, 9, 1); c.restore();
    }
  }
  // Slow light shafts between the vault and the mid wall.
  if (!reduced) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let n = 0; n < 3; n++) {
      const x = mod(n * 190 + 60 - (cam - w.roomX) * .32, 620) - 95, sway = Math.sin(w.time * .35 + n * 2.1) * 12;
      const g = c.createLinearGradient(x, 0, x - 70, horizon); g.addColorStop(0, theme.color + '3c'); g.addColorStop(1, theme.color + '00');
      c.fillStyle = g; c.beginPath(); c.moveTo(x - 12 + sway, 0); c.lineTo(x + 30 + sway, 0); c.lineTo(x - 30, horizon + 6); c.lineTo(x - 112, horizon + 6); c.fill();
    }
    c.restore();
  }
  landmarks(c, w, h, time, reduced);
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
  if (w.biome === 'forge') {
    // Molten seams run under the road and pulse like a heartbeat.
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    for (let n = Math.floor((cam - w.roomX - 60) / 210); n * 210 + w.roomX - cam < 500; n++) {
      const k = hash(n * 4.9 + w.room), x = w.roomX + n * 210 + k * 90 - cam, y = h * (.86 + k * .09), beat = reduced ? .6 : .55 + .45 * Math.sin(w.time * 2.2 + n) ** 2;
      c.globalAlpha = .5 * beat; c.strokeStyle = '#ff6a2e'; c.lineWidth = 3.2;
      c.beginPath(); c.moveTo(x - 46, y - 4); c.lineTo(x - 12, y + 3); c.lineTo(x + 10, y - 3); c.lineTo(x + 48, y + 5); c.stroke();
      c.globalAlpha = .9 * beat; c.strokeStyle = '#ffe2a8'; c.lineWidth = 1; c.stroke();
      pool(c, '#ff5a2a', x, y, 80, 13, .3 * beat);
    }
    c.restore();
  }
  roadside(c, w, h, time, reduced);
  life.drawBats(c, w, h);
}

/** Hanging and near pieces that frame the stage (depths 1.2 and 1.4), always clear of the actors. */
function frame(c: Ctx, w: World, h: number, time: number, reduced: boolean) {
  const set = sceneryKit(w.biome), { scale } = stageLayout(h), cam = w.cameraX;
  const drawSet = (list: Prop[], depth: number, gap: number, base: number, size: number, lift: number) => {
    if (!list.length) return;
    const shift = (cam - w.roomX) * depth;
    for (let n = Math.floor((shift - 200) / gap); n * gap - shift < 620; n++) {
      const seed = hash(n * 7.9 + w.room * 23 + depth * 11); if (seed < .25) continue;
      const prop = list[Math.floor(seed * 71) % list.length], x = n * gap + seed * 150 - shift, k = size * (.85 + seed * .4);
      const sway = lift || reduced ? 0 : Math.sin(time * .9 + seed * 20) * .018;
      if (!drawProp(c, prop, x, base + lift * k, k, sway)) continue;
      if (prop.glow && !reduced) light(c, prop.glow.color, x + prop.glow.x * k, base + lift * k + prop.glow.y * k, prop.glow.r * k * .7, .34 + .08 * Math.sin(time * 1.4 + seed * 9));
    }
  };
  drawSet(set.hang, 1.2, 400, -4, scale * .82, 0);
  drawSet(set.near, 1.4, 470, h, scale * 1.5, 46);
}
/** Close foreground (depth 1.35) and atmosphere in front of the party. */
export function drawForeground(c: Ctx, w: World, h: number, life: CaveLife, reduced: boolean, images?: Images) {
  const theme = BIOMES[w.biome], cam = w.cameraX, { horizon, floor } = stageLayout(h), time = reduced ? 0 : w.time;
  life.drawMotes(c, w);
  const crystal = w.biome === 'crystal' && !!images && drawCrystalForeground(c, w, images, h, reduced);
  if (!crystal) {
    // The air of each district: fireflies, embers, falling star dust.
    const tones = SPARK[w.biome];
    for (let i = 0; i < (reduced ? 8 : 18); i++) {
      const depth = i % 3 === 0 ? 1.25 : .62, k = hash(i * 9.1), band = Math.max(60, floor - 40);
      const x = mod(i * 67.3 - (cam - w.roomX) * depth + Math.sin(time * .4 + i) * 14, 470) - 20;
      let py = 30 + mod(i * 43.1, band);
      const twinkle = (.3 + (Math.sin(time * 2 + i) + 1) * .3) * (depth > 1 ? 1 : .7);
      if (w.biome === 'ember' || w.biome === 'forge') { py = 30 + mod(i * 43.1 - time * (w.biome === 'forge' ? 26 : 14) * (.6 + k), band); light(c, tones[i % 3], x, py, (2.2 + k * 2.6) * (depth > 1 ? 1.4 : 1), twinkle); }
      else if (w.biome === 'spore') light(c, tones[i % 3], x + Math.sin(time * 1.3 + i * 2) * 9, py + Math.cos(time * .9 + i) * 7, 3 + k * 3.2, twinkle * (.6 + .4 * Math.sin(time * 3.1 + i * 5) ** 2));
      else { c.globalAlpha = twinkle; c.fillStyle = tones[i % 3]; starPath(c, x, py + Math.sin(time * .7 + i) * 4, 1.6 + k * 2.6, .6, 4, time * .6 + i); c.fill(); c.globalAlpha = 1; }
    }
    // Low mist rolls across the road in the district's own light.
    if (!reduced) for (let i = 0; i < 2; i++) pool(c, theme.color, mod(i * 300 - (cam - w.roomX) * .8 + w.time * 5, 760) - 160, h * .93, 190, h * .05, .11);
  }
  frame(c, w, h, time, reduced);
  if (w.biome === 'forge') { c.save(); c.globalCompositeOperation = 'lighter'; pool(c, '#ff4a1c', 215, h + 4, 240, h * .08, .42 + (reduced ? 0 : .12 * Math.sin(w.time * 1.9))); c.restore(); }
  // Soft frame: keeps the eye on the road and seats the scene into the wooden HUD.
  const top = c.createLinearGradient(0, 0, 0, h * .2); top.addColorStop(0, '#04060bb0'); top.addColorStop(1, '#04060b00');
  c.fillStyle = top; c.fillRect(0, 0, 430, h * .2);
  const low = c.createLinearGradient(0, h * .9, 0, h); low.addColorStop(0, '#04060b00'); low.addColorStop(1, '#04060b9c');
  c.fillStyle = low; c.fillRect(0, h * .9, 430, h * .1);
  const boss = w.enemies.find(e => e.species === 'boss' && e.hp > 0);
  if (boss && boss.worldX - cam < 520) {
    // The hall dims around the master of the floor; the dark deepens with every phase.
    const arrive = w.phase === 'BOSS' ? clamp01((w.time - w.phaseAt) / 1.2) : 0;
    const shade = c.createRadialGradient(215, horizon, 90, 215, horizon, 330);
    shade.addColorStop(0, '#22133f00'); shade.addColorStop(1, `rgba(30,8,40,${(.16 + w.bossPhase * .1) * (.4 + .6 * arrive)})`);
    c.fillStyle = shade; c.fillRect(0, 0, 430, h);
  }
}
