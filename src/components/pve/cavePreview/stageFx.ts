/** Stage direction of the cave: one coherent feedback language for hits, deaths, bosses,
 * portals and victory. READ-ONLY over World. Almost everything is a pure function of
 * existing world facts (effect.born, enemy.deathAt, phaseAt…), so pause, reload and the QA
 * fixture redraw identical frames. `StageMemory` remembers only two presentation facts the
 * engine does not store: when the boss phase changed and where the boss fell.
 */
import { caveBoss } from '../../../game/cavePreviewWorld/catalog';
import type { Enemy, World } from '../../../game/cavePreviewWorld/engine';
import { burst, clamp01, comicText, easeBack, easeOut, hash, light, pool, silhouette, starPath, window01, type Ctx } from './kit';

export const PHASE_COLORS = ['#ffc574', '#cf96ff', '#ff6e81'];
const PHASE_NAMES = { ru: ['Пробуждение', 'Раскол земли', 'Ярость Бездны'], en: ['Awakening', 'Earth rupture', 'Abyss fury'] };
const ROMAN = ['I', 'II', 'III'];
const ENDED = ['VICTORY', 'DEFEAT'];

export class StageMemory {
  private clock = -1; private bossPhase = 1; private phase = '';
  /** Simulation time of the last observed boss phase change. */
  phaseAt = -99;
  /** Where the boss fell; survives the engine clearing its enemy list at VICTORY. */
  finale: { x: number; lane: number; deathAt: number; idleAt: number | null } | null = null;
  /** Idle-clock moment the run ended in front of the player (null after a reload). */
  endedAt: number | null = null;
  observe(w: World, idle: number) {
    const jump = w.time - this.clock, resync = this.clock < 0 || jump < 0 || jump > 1.5;
    const boss = w.enemies.find(e => e.species === 'boss');
    if (resync) { this.phaseAt = -99; this.finale = null; this.endedAt = null; }
    else if (boss && boss.hp > 0 && w.bossPhase !== this.bossPhase) this.phaseAt = w.time;
    this.bossPhase = w.bossPhase;
    if (boss && boss.hp <= 0) this.finale = { x: boss.worldX, lane: boss.lane, deathAt: boss.deathAt, idleAt: this.finale?.idleAt ?? null };
    if (ENDED.includes(w.phase)) {
      if (!resync && !ENDED.includes(this.phase)) { this.endedAt = idle; if (this.finale) this.finale.idleAt = idle; }
    } else { this.endedAt = null; if (!boss) this.finale = null; }
    this.phase = w.phase; this.clock = w.time;
  }
  /** Seconds since the killing blow, continuing on the idle clock after the world stops. */
  finaleAge(w: World, idle: number) {
    const f = this.finale; if (!f) return -1;
    return w.time - f.deathAt + (f.idleAt === null ? (ENDED.includes(w.phase) ? 99 : 0) : idle - f.idleAt);
  }
  endedAge(w: World, idle: number) { return !ENDED.includes(w.phase) ? -1 : this.endedAt === null ? 99 : idle - this.endedAt; }
}

/** Camera punch-in and micro jolt derived from existing events. Zoom is inward only, so the
 * frame never shows an empty edge. */
export function cameraKick(w: World, memory: StageMemory, calm: boolean) {
  if (calm) return { zoom: 0, jolt: 0 };
  let zoom = 0, jolt = 0;
  for (const f of w.effects) {
    const age = w.time - f.born;
    if (f.kind === 'impact') { zoom = Math.max(zoom, .014 * Math.exp(-age * 15)); jolt = Math.max(jolt, .16 * Math.exp(-age * 17)); }
    else if (f.kind === 'shock') zoom = Math.max(zoom, .045 * Math.exp(-age * 6));
  }
  for (const e of w.enemies) if (e.hp <= 0) { const age = w.time - e.deathAt; zoom = Math.max(zoom, (e.species === 'boss' ? .07 : .026) * Math.exp(-age * (e.species === 'boss' ? 3 : 10))); jolt = Math.max(jolt, .3 * Math.exp(-age * 12)); }
  const shift = w.time - memory.phaseAt;
  if (shift >= 0 && shift < 1.5) { zoom = Math.max(zoom, .06 * Math.exp(-shift * 4)); jolt = Math.max(jolt, .9 * Math.exp(-shift * 5)); }
  return { zoom, jolt };
}

/** True when the impact effect is the blow that killed an enemy (same tick, same lane). */
export const killingBlow = (w: World, born: number, lane: number) => w.enemies.some(e => e.hp <= 0 && e.lane === lane && Math.abs(e.deathAt - born) < 1e-6);

/** Contact: comic starburst, directional sparks, chips and a floor ripple. */
export function impactFx(c: Ctx, x: number, y: number, floorY: number, age: number, scale: number, seed: number, power: number, tone: string, reduced: boolean, low: boolean) {
  if (age < 0 || age > .6) return;
  c.save();
  if (age < .2) {
    const pop = reduced ? 1 : easeBack(age / .08) * (age > .1 ? 1 - (age - .1) / .1 * .35 : 1), r = (13 + power * 13) * scale * pop, turn = hash(seed) * 1.2;
    c.globalAlpha = age < .1 ? 1 : 1 - (age - .1) / .1;
    c.lineJoin = 'round';
    starPath(c, x, y, r * 1.18, r * .62, 9, turn); c.fillStyle = '#ff8a1f'; c.fill();
    starPath(c, x, y, r, r * .5, 9, turn); c.fillStyle = '#ffe566'; c.fill();
    starPath(c, x, y, r * .58, r * .26, 7, turn + .4); c.fillStyle = '#fffdf0'; c.fill();
  }
  if (!reduced) {
    c.globalAlpha = 1;
    burst(c, seed, age, x, y, { n: low ? 4 : 7 + Math.round(power * 6), speed: 270 + power * 120, angle: -.3, spread: 2.3, gravity: 520, life: .4, size: 2.7, colors: ['#fff6c8', '#ffc74d', '#ff8a3c'], shape: 'spark' }, scale);
    if (!low) burst(c, seed + 3.3, age, x, y, { n: 3 + Math.round(power * 4), speed: 180, angle: -.9, spread: 1.9, gravity: 760, life: .55, size: 3.4, colors: [tone, '#fff1d0', '#3a2a22'], shape: 'shard' }, scale);
    const ring = clamp01(age / .32);
    c.globalAlpha = (1 - ring) * .55; c.strokeStyle = '#fff1c4'; c.lineWidth = 2.2 * scale * (1 - ring);
    c.beginPath(); c.ellipse(x + 14 * scale, floorY, (16 + ring * 46) * scale, (4 + ring * 9) * scale, 0, 0, 6.3); c.stroke();
  }
  c.restore();
}

/** БАМ! / ХРЯСЬ! / БДЫЩ! on a spiky comic balloon. The caller shows at most one at a time. */
export function comicWord(c: Ctx, word: string, x: number, y: number, age: number, scale: number, seed: number, reduced: boolean) {
  if (age < 0 || age > .62) return;
  const pop = reduced ? 1 : easeBack(age / .13), fade = age > .44 ? 1 - (age - .44) / .18 : 1, size = 19 * scale;
  c.save(); c.translate(x, y - (reduced ? 0 : age * 26 * scale)); c.rotate(reduced ? 0 : -.16 + hash(seed) * .14); c.scale(pop, pop); c.globalAlpha *= fade;
  c.font = `italic 900 ${size}px "Arial Black","Segoe UI Black","Roboto Black",system-ui,sans-serif`;
  const half = c.measureText(word).width / 2 + 9 * scale, tall = size * .82;
  c.lineJoin = 'round'; c.beginPath();
  for (let i = 0; i < 22; i++) { const a = i / 22 * 6.2832, r = i % 2 ? 1 : 1.3 + hash(seed + i) * .16; c.lineTo(Math.cos(a) * half * r, Math.sin(a) * tall * r); }
  c.closePath(); c.fillStyle = '#2a1108'; c.lineWidth = 5 * scale; c.strokeStyle = '#2a1108'; c.stroke();
  c.fillStyle = '#ffe14a'; c.fill();
  comicText(c, word, 0, 1, size, '#ff4b2b', '#2a1108');
  c.restore();
}

export type NumberTone = 'deal' | 'big' | 'take' | 'heal' | 'guard' | 'info';
const NUMBER_FACE: Record<NumberTone, string> = { deal: '#fff3c4', big: '#ffd23e', take: '#ff8271', heal: '#a8ffd3', guard: '#9fdfff', info: '#9eeaff' };
/** Damage and status numbers: a quick pop, a readable outline, then a short float. */
export function floatText(c: Ctx, value: string, x: number, y: number, age: number, scale: number, tone: NumberTone, seed: number, reduced: boolean) {
  if (age < 0 || age > 1) return;
  const pop = reduced ? 1 : .55 + .45 * easeBack(age / .14), size = (tone === 'big' ? 23 : tone === 'deal' ? 18 : 15.5) * scale * pop;
  const drift = reduced ? 0 : (hash(seed) - .5) * 22 * scale + (tone === 'deal' || tone === 'big' ? age * 16 * scale : 0);
  c.save(); c.globalAlpha *= age > .7 ? 1 - (age - .7) / .3 : 1;
  comicText(c, value, x + drift, y - (reduced ? 12 : easeOut(age) * 44) * scale, size, NUMBER_FACE[tone], '#170b10', false);
  c.restore();
}

export interface Flight { dx: number; dy: number; turn: number; size: number; alpha: number; white: number }
/** A beaten foe is knocked clean out of the fight: a white smash frame, then a spinning arc
 * into the distance. Purely a drawing of the already-dead enemy. */
export function deathFlight(e: Enemy, time: number, reduced: boolean): Flight {
  const t = Math.max(0, time - e.deathAt);
  if (reduced) return { dx: 0, dy: 0, turn: 0, size: 1, alpha: Math.max(0, 1 - t / .9), white: 0 };
  const hold = .075; if (t < hold) return { dx: 5 * t / hold, dy: 0, turn: .08, size: 1, alpha: 1, white: .85 };
  const u = t - hold, k = hash(e.id * 3.1 + 1), k2 = hash(e.id * 5.7 + 2);
  return { dx: (220 + k * 110) * u, dy: (-440 - k2 * 110) * u + 230 * u * u, turn: u * (8 + k * 6), size: Math.max(.34, 1 - u * .66), alpha: u < .6 ? 1 : Math.max(0, 1 - (u - .6) / .3), white: Math.max(0, .55 - u * 3) };
}
/** Dust where the foe stood and a twinkle where it vanished. */
export function deathFx(c: Ctx, e: Enemy, time: number, x: number, y: number, scale: number, tone: string, reduced: boolean, low: boolean) {
  const t = time - e.deathAt; if (t < 0 || t > 1.2 || reduced) return;
  c.save();
  burst(c, e.id * 9.7 + 4, t, x, y - 6 * scale, { n: low ? 4 : 8, speed: 120, angle: -Math.PI / 2, spread: 3.6, gravity: -40, life: .6, size: 6.5, colors: ['#e7dccb', '#cfc4b4'], shape: 'smoke', drag: 4, alpha: .6 }, scale);
  if (!low) burst(c, e.id * 4.1 + 8, t, x, y - 44 * scale, { n: 7, speed: 250, angle: -1, spread: 3.2, gravity: 620, life: .75, size: 3.6, colors: [tone, '#fff3cf', '#ffd45e'], shape: 'star' }, scale);
  // Speed lines along the launch for the first instants.
  if (t > .07 && t < .3) {
    const f = deathFlight(e, time, false); c.globalAlpha = (1 - (t - .07) / .23) * .7; c.strokeStyle = '#fff6da'; c.lineCap = 'round';
    for (let i = 0; i < 3; i++) { const o = (i - 1) * 13 * scale; c.lineWidth = (2.4 - i * .5) * scale; c.beginPath(); c.moveTo(x + f.dx * .25, y - 50 * scale + f.dy * .25 + o); c.lineTo(x + f.dx * .9, y - 50 * scale + f.dy * .9 + o); c.stroke(); }
  }
  const tw = window01(t, .68, 1.08);
  if (tw > 0) {
    const f = deathFlight(e, e.deathAt + .82, false), px = x + f.dx, py = y - 50 * scale + f.dy;
    c.globalAlpha = tw; light(c, '#fff6da', px, py, 22 * scale * tw, .9);
    c.fillStyle = '#fffdf2'; starPath(c, px, py, 11 * scale * tw, 2.2 * scale * tw, 4, time * 3); c.fill();
  }
  c.restore();
}

/** Looming presence drawn BEHIND the boss: wall shadow, rune ring, rising aura, floor cracks. */
export function bossPresence(c: Ctx, w: World, boss: Enemy, img: HTMLImageElement | HTMLCanvasElement | undefined, x: number, y: number, size: number, horizon: number, memory: StageMemory, reduced: boolean, low: boolean) {
  const phase = w.bossPhase, color = PHASE_COLORS[phase - 1] ?? PHASE_COLORS[0], time = reduced ? 0 : w.time, scale = size / 232;
  const arrive = w.phase === 'BOSS' ? clamp01((w.time - w.phaseAt) / .9) : boss.hp > 0 && w.phase !== 'WAVE_SPAWN' ? 1 : 0;
  const dying = boss.hp <= 0 ? clamp01((w.time - boss.deathAt) / .8) : 0, presence = arrive * (1 - dying);
  c.save();
  if (img && presence > 0) {
    // The boss owns the far wall: a towering shadow that grows with every phase.
    const shade = silhouette(img), grow = 2.05 + phase * .2 + (reduced ? 0 : Math.sin(time * .8) * .03), sw = size * grow * shade.width / shade.height * .92, sh = size * grow * .92;
    const flick = phase === 3 && !reduced ? .82 + .18 * Math.sin(time * 17) * Math.sin(time * 7.3) : 1;
    c.globalAlpha = presence * (.36 + phase * .07) * flick;
    c.drawImage(shade, x - sw * .5 + 26 * scale + (reduced ? 0 : Math.sin(time * .6) * 3), horizon + 10 * scale - sh, sw, sh);
  }
  c.globalAlpha = 1;
  if (presence > 0) {
    const pulse = reduced ? .5 : .5 + .5 * Math.sin(time * (1.6 + phase * .7));
    pool(c, color, x, y + 2, 118 * scale, 24 * scale, presence * (.34 + phase * .08 + pulse * .1));
    // Carved summoning ring under the feet; one more band of glyphs per phase.
    c.strokeStyle = color; c.lineWidth = 1.6 * scale; c.globalAlpha = presence * .7;
    c.beginPath(); c.ellipse(x, y + 2, 96 * scale, 19 * scale, 0, 0, 6.3); c.stroke();
    c.globalAlpha = presence * .4; c.beginPath(); c.ellipse(x, y + 2, 82 * scale, 15.5 * scale, 0, 0, 6.3); c.stroke();
    c.fillStyle = color;
    for (let i = 0; i < 6 + phase * 4; i++) {
      const a = i / (6 + phase * 4) * 6.2832 + time * (.25 + phase * .12), gx = x + Math.cos(a) * 89 * scale, gy = y + 2 + Math.sin(a) * 17.2 * scale;
      c.globalAlpha = presence * (.45 + .4 * Math.sin(a * 3 + time * 2) ** 2);
      c.beginPath(); c.moveTo(gx, gy - 3.2 * scale); c.lineTo(gx + 2.6 * scale, gy); c.lineTo(gx, gy + 3.2 * scale); c.lineTo(gx - 2.6 * scale, gy); c.fill();
    }
    // From phase 2 the floor itself breaks: glowing fissures crawl out from the boss.
    if (phase >= 2) {
      const open = clamp01((w.time - memory.phaseAt) / .5 + (memory.phaseAt < 0 ? 1 : 0));
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (let i = 0; i < (phase === 3 ? 7 : 4); i++) {
        const dir = Math.PI + (hash(i * 3.3 + 1) - .5) * 1.5 + (i % 3 === 0 ? Math.PI : 0), reach = (90 + hash(i * 7.7) * 120) * open * scale;
        c.beginPath(); c.moveTo(x, y + 3);
        for (let s = 1; s <= 5; s++) { const d = reach * s / 5, wob = (hash(i * 13 + s) - .5) * 16 * scale; c.lineTo(x + Math.cos(dir) * d + wob * .4, y + 3 + Math.sin(dir) * d * .22 + wob * .16); }
        c.globalAlpha = presence * .3; c.strokeStyle = '#120812'; c.lineWidth = 4.2 * scale; c.stroke();
        c.globalAlpha = presence * (.55 + pulse * .35); c.strokeStyle = color; c.lineWidth = 1.5 * scale; c.stroke();
      }
    }
    if (!reduced) {
      const count = low ? 5 : 9 + phase * 3;
      for (let i = 0; i < count; i++) {
        const u = (time * (.32 + phase * .08) + hash(i * 2.9)) % 1, px = x + (hash(i * 5.3 + 2) - .5) * 190 * scale + Math.sin(time * 1.4 + i) * 6, py = y - u * 215 * scale;
        light(c, color, px, py, (3 + hash(i) * 4) * scale * (1.2 - u), presence * Math.sin(u * Math.PI) * .85);
      }
    }
  }
  c.restore();
}

/** Extra danger read for an incoming boss attack, on top of the existing ring. */
export function telegraphFx(c: Ctx, w: World, boss: Enemy, heroX: number, y: number, scale: number, reduced: boolean, low: boolean) {
  if (boss.hp <= 0 || boss.impact <= w.time) return;
  const total = boss.heavy ? 1.45 : .95, k = clamp01(1 - (boss.impact - w.time) / total), color = PHASE_COLORS[w.bossPhase - 1] ?? PHASE_COLORS[0];
  const radius = (boss.heavy ? 91 : 63) * scale, zx = heroX + 6 * scale;
  c.save();
  pool(c, color, zx, y + 2, radius * 1.25, 17 * scale * 1.25, .25 + k * .45);
  if (boss.heavy) {
    // A column of gathering force over the marked ground: where the collapse will land.
    const pulse = reduced ? 1 : .75 + .25 * Math.sin(w.time * 26), top = y - 210 * scale;
    const beam = c.createLinearGradient(0, top, 0, y); beam.addColorStop(0, color + '00'); beam.addColorStop(1, color);
    c.globalAlpha = (.1 + k * .3) * pulse; c.fillStyle = beam;
    c.beginPath(); c.moveTo(zx - radius * .86, y); c.lineTo(zx - radius * (.5 - k * .2), top); c.lineTo(zx + radius * (.5 - k * .2), top); c.lineTo(zx + radius * .86, y); c.fill();
    if (!reduced && !low) for (let i = 0; i < 6; i++) {
      const u = (w.time * 1.9 + hash(i * 4.1)) % 1, px = zx + (hash(i * 9.1) - .5) * radius * 1.5, py = top + u * (y - top);
      c.globalAlpha = k * (1 - u * .4); c.fillStyle = i % 2 ? '#fff1dc' : color;
      c.beginPath(); c.moveTo(px, py - 9 * scale); c.lineTo(px + 2.4 * scale, py); c.lineTo(px, py + 3 * scale); c.lineTo(px - 2.4 * scale, py); c.fill();
    }
  }
  c.restore();
}

/** Boss blow landing: fissures, a rolling dust wall and thrown rock. */
export function slamFx(c: Ctx, x: number, floorY: number, age: number, phase: number, scale: number, heavy: boolean, reduced: boolean, low: boolean) {
  if (age < 0 || age > 1) return;
  const color = PHASE_COLORS[phase - 1] ?? PHASE_COLORS[0], k = heavy ? 1 : .62;
  c.save();
  if (reduced) { c.globalAlpha = 1 - age; c.strokeStyle = color; c.lineWidth = 3; c.beginPath(); c.ellipse(x, floorY, 85 * scale * k, 14 * scale * k, 0, 0, 6.3); c.stroke(); c.restore(); return; }
  pool(c, color, x, floorY, 170 * scale * k, 34 * scale * k, (1 - age) * .7);
  const open = easeOut(age / .16); c.lineCap = 'round'; c.lineJoin = 'round';
  for (let i = 0; i < (low ? 5 : 9); i++) {
    const dir = i / 9 * 6.2832 + hash(i * 3.7) * .5, reach = (70 + hash(i * 5.1) * 95) * open * scale * k;
    c.beginPath(); c.moveTo(x, floorY);
    for (let s = 1; s <= 4; s++) { const d = reach * s / 4, wob = (hash(i * 11 + s) - .5) * 15 * scale; c.lineTo(x + Math.cos(dir) * d + wob * .5, floorY + Math.sin(dir) * d * .24 + wob * .14); }
    c.globalAlpha = (1 - age) * .55; c.strokeStyle = '#150a12'; c.lineWidth = 5 * scale; c.stroke();
    c.globalAlpha = (1 - age) ** 1.5; c.strokeStyle = color; c.lineWidth = 1.8 * scale; c.stroke();
  }
  for (const delay of [0, .09]) {
    const r = clamp01((age - delay) / .5); if (r <= 0 || r >= 1) continue;
    c.globalAlpha = (1 - r) * .8; c.strokeStyle = delay ? color : '#fff3e0'; c.lineWidth = (6 - delay * 30) * scale * (1 - r);
    c.beginPath(); c.ellipse(x, floorY, r * 235 * scale * k, r * 42 * scale * k, 0, 0, 6.3); c.stroke();
  }
  c.globalAlpha = 1;
  burst(c, x * .13 + phase, age, x, floorY - 4, { n: low ? 6 : 12, speed: 210 * k, angle: -Math.PI / 2, spread: 3.3, gravity: -30, life: .85, size: 9, colors: ['#d9cdbd', '#b9ab9b'], shape: 'smoke', drag: 3.2, alpha: .5 }, scale);
  burst(c, x * .29 + phase * 3, age, x, floorY - 6, { n: low ? 6 : 14, speed: 380 * k, angle: -Math.PI / 2, spread: 2.2, gravity: 950, life: .95, size: 4.6, colors: ['#75624f', '#3f322a', color], shape: 'shard', drag: 1.2 }, scale);
  if (phase === 3 && heavy) for (let i = 0; i < 6; i++) {
    // The vault answers the third phase: shards drive into the marked ground.
    const fall = clamp01(age / (.16 + hash(i * 3.1) * .12)), px = x - 130 * scale + i * 52 * scale + hash(i) * 20, py = floorY - (1 - fall) * 260 * scale;
    c.globalAlpha = age < .5 ? 1 : 1 - (age - .5) / .5; c.fillStyle = color; c.strokeStyle = '#1a0a12'; c.lineWidth = 1.5 * scale;
    c.beginPath(); c.moveTo(px - 5 * scale, py - 30 * scale); c.lineTo(px + 5 * scale, py - 30 * scale); c.lineTo(px + 1.5 * scale, py); c.closePath(); c.fill(); c.stroke();
  }
  c.restore();
}

function banner(c: Ctx, top: string, main: string, h: number, age: number, life: number, color: string, reduced: boolean, slam = false) {
  if (age < 0 || age > life) return;
  const enter = reduced ? 1 : clamp01(age / .22), exit = age > life - .4 ? clamp01((life - age) / .4) : 1, y = h * .285;
  c.save(); c.globalAlpha = Math.min(enter * 1.4, 1) * exit;
  // Dark ribbon so the lettering reads over any district.
  const band = c.createLinearGradient(0, y - 34, 0, y + 34); band.addColorStop(0, '#05060c00'); band.addColorStop(.5, '#05060cb8'); band.addColorStop(1, '#05060c00');
  c.fillStyle = band; c.fillRect(0, y - 34, 430, 68);
  const reach = 150 * easeOut(enter);
  c.strokeStyle = color; c.lineWidth = 1.4;
  for (const dy of [-23, 23]) { c.beginPath(); c.moveTo(215 - reach, y + dy); c.lineTo(215 + reach, y + dy); c.stroke(); }
  c.fillStyle = color;
  for (const dx of [-reach, reach]) { c.beginPath(); c.moveTo(215 + dx, y - 27); c.lineTo(215 + dx + 4, y - 23); c.lineTo(215 + dx, y - 19); c.lineTo(215 + dx - 4, y - 23); c.fill(); }
  c.translate(215, y); const s = slam && !reduced ? 1 + (1 - easeOut(age / .2)) * 1.3 : 1; c.scale(s, s);
  c.font = '800 10px system-ui,sans-serif'; c.textAlign = 'center'; c.fillStyle = '#f4e3c0';
  (c as Ctx & { letterSpacing?: string }).letterSpacing = '2.5px'; c.fillText(top, 1, -9); (c as Ctx & { letterSpacing?: string }).letterSpacing = '0px';
  let size = 23; c.font = `900 ${size}px "Arial Black","Segoe UI Black","Roboto Black",system-ui,sans-serif`;
  const wide = c.measureText(main).width; if (wide > 380) size *= 380 / wide;
  comicText(c, main, 0, 8, size, color, '#12070f', false);
  c.restore();
}

/** Screen-space boss theatre: arrival title, phase banners, danger vignette, death flash. */
export function bossScreen(c: Ctx, w: World, memory: StageMemory, h: number, en: boolean, reduced: boolean) {
  const boss = w.enemies.find(e => e.species === 'boss'), color = PHASE_COLORS[w.bossPhase - 1] ?? PHASE_COLORS[0], lang = en ? 'en' : 'ru';
  if (boss && boss.hp > 0 && w.phase === 'BOSS') {
    const age = w.time - w.phaseAt, identity = caveBoss(w.floor);
    if (age < 2.5) {
      if (!reduced) {
        // Cinema bars and a single flash: the floor master has arrived.
        const bars = window01(age, 0, 2.5) ** .35 * h * .045;
        c.fillStyle = '#04050a'; c.fillRect(0, 0, 430, bars); c.fillRect(0, h - bars, 430, bars);
        c.globalAlpha = .34 * Math.exp(-age * 5); c.fillStyle = color; c.fillRect(0, 0, 430, h); c.globalAlpha = 1;
      }
      banner(c, en ? `FLOOR ${w.floor} · MASTER OF THE DEPTH` : `ЭТАЖ ${w.floor} · ХОЗЯИН ГЛУБИНЫ`, (en ? identity.en : identity.ru).toUpperCase(), h, age, 2.5, color, reduced);
    }
    const shift = w.time - memory.phaseAt;
    if (shift >= 0 && shift < 2.1 && w.bossPhase > 1) {
      if (!reduced) { c.globalAlpha = .5 * Math.exp(-shift * 6); c.fillStyle = shift < .05 ? '#ffffff' : color; c.fillRect(0, 0, 430, h); c.globalAlpha = 1; }
      banner(c, `${en ? 'PHASE' : 'ФАЗА'} ${ROMAN[w.bossPhase - 1]}`, PHASE_NAMES[lang][w.bossPhase - 1].toUpperCase(), h, shift, 2.1, color, reduced, true);
    }
    // Heavy attack closing in: the edges of the screen take the phase colour.
    if (boss.heavy && boss.impact > w.time) {
      const k = clamp01(1 - (boss.impact - w.time) / 1.45), pulse = reduced ? 1 : .7 + .3 * Math.sin(w.time * 20);
      const edge = c.createRadialGradient(215, h * .55, h * .32, 215, h * .55, h * .78); edge.addColorStop(0, color + '00'); edge.addColorStop(1, color);
      c.globalAlpha = k * .34 * pulse; c.fillStyle = edge; c.fillRect(0, 0, 430, h); c.globalAlpha = 1;
    }
    if (w.bossPhase === 3) {
      const edge = c.createRadialGradient(215, h * .55, h * .36, 215, h * .55, h * .8); edge.addColorStop(0, '#ff2f4d00'); edge.addColorStop(1, '#ff2f4d');
      c.globalAlpha = reduced ? .12 : .1 + .07 * Math.sin(w.time * 4.6); c.fillStyle = edge; c.fillRect(0, 0, 430, h); c.globalAlpha = 1;
    }
  }
}

/** Phase change as an event in the world: shockwaves, a pillar of light and thrown stone. */
export function phaseShiftFx(c: Ctx, w: World, memory: StageMemory, x: number, y: number, scale: number, reduced: boolean, low: boolean) {
  const age = w.time - memory.phaseAt; if (age < 0 || age > 1.6 || reduced) return;
  const color = PHASE_COLORS[w.bossPhase - 1] ?? PHASE_COLORS[0];
  c.save(); c.globalCompositeOperation = 'lighter';
  const pillar = Math.exp(-age * 3.2);
  c.globalAlpha = pillar * .8; light(c, color, x, y - 150 * scale, 150 * scale, 1);
  c.globalAlpha = pillar; c.fillStyle = color; c.fillRect(x - 26 * scale * pillar, y - 520 * scale, 52 * scale * pillar, 520 * scale);
  c.fillStyle = '#ffffff'; c.fillRect(x - 9 * scale * pillar, y - 520 * scale, 18 * scale * pillar, 520 * scale);
  c.globalCompositeOperation = 'source-over';
  for (const delay of [0, .14, .3]) {
    const r = clamp01((age - delay) / .7); if (r <= 0 || r >= 1) continue;
    c.globalAlpha = (1 - r) * .9; c.strokeStyle = delay === .14 ? '#fff6e6' : color; c.lineWidth = 7 * scale * (1 - r);
    c.beginPath(); c.ellipse(x, y, r * 430 * scale, r * 70 * scale, 0, 0, 6.3); c.stroke();
  }
  c.globalAlpha = 1;
  burst(c, w.bossPhase * 17.3, age, x, y - 90 * scale, { n: low ? 10 : 22, speed: 420, angle: -Math.PI / 2, spread: 5.6, gravity: 620, life: 1.3, size: 5, colors: [color, '#fff3d6', '#3a2a35'], shape: 'shard', drag: 1.6 }, scale);
  burst(c, w.bossPhase * 5.9, age, x, y - 90 * scale, { n: low ? 8 : 16, speed: 520, angle: 0, spread: 6.3, gravity: 0, life: .6, size: 3.2, colors: ['#ffffff', color], shape: 'spark', drag: 3 }, scale);
  c.restore();
}

/** The fall of the floor master. `age` runs from the killing blow and continues past the
 * moment the simulation stops, so the eruption completes under the victory window. */
export function bossFinale(c: Ctx, age: number, x: number, y: number, scale: number, reduced: boolean, low: boolean) {
  if (age < 0 || age > 5 || reduced) return;
  const gold = '#ffd978';
  c.save(); c.globalCompositeOperation = 'lighter';
  if (age < 1.5) {
    // Light breaks out of the body: turning rays and a swelling core.
    const grow = easeOut(age / 1.1), cy = y - 96 * scale;
    c.translate(x, cy);
    for (let i = 0; i < (low ? 6 : 10); i++) {
      const a = i / (low ? 6 : 10) * 6.2832 + age * .9 + hash(i) * .3, len = (60 + hash(i * 3) * 150) * grow * scale, wide = .045 + hash(i * 7) * .05;
      c.globalAlpha = (.2 + grow * .35) * (age > 1.1 ? 1 - (age - 1.1) / .4 : 1); c.fillStyle = i % 3 ? gold : '#ffffff';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a - wide) * len, Math.sin(a - wide) * len); c.lineTo(Math.cos(a + wide) * len, Math.sin(a + wide) * len); c.fill();
    }
    c.translate(-x, -cy); c.globalAlpha = 1;
    light(c, '#fff3c9', x, cy, (40 + grow * 90) * scale, .5 + grow * .5);
  }
  c.globalCompositeOperation = 'source-over';
  for (const [at, ox, oy] of [[.12, -34, -120], [.34, 30, -70], [.56, -12, -160], [.8, 40, -130], [.98, -30, -60]]) {
    const a = age - at; if (a < 0 || a > .5) continue;
    impactFx(c, x + ox * scale, y + oy * scale, y, a, scale, at * 31, 1, gold, false, low);
  }
  const blast = age - 1.1;
  if (blast >= 0) {
    c.globalCompositeOperation = 'lighter';
    const pillar = Math.exp(-blast * 1.5);
    c.globalAlpha = pillar * .85; c.fillStyle = gold; c.fillRect(x - 34 * scale * pillar, y - 640 * scale, 68 * scale * pillar, 640 * scale);
    c.fillStyle = '#ffffff'; c.fillRect(x - 12 * scale * pillar, y - 640 * scale, 24 * scale * pillar, 640 * scale);
    light(c, '#fff2c4', x, y - 100 * scale, 240 * scale, pillar);
    c.globalCompositeOperation = 'source-over';
    for (const delay of [0, .12, .26]) {
      const r = clamp01((blast - delay) / .8); if (r <= 0 || r >= 1) continue;
      c.globalAlpha = (1 - r) * .9; c.strokeStyle = delay === .12 ? '#ffffff' : gold; c.lineWidth = 8 * scale * (1 - r);
      c.beginPath(); c.ellipse(x, y, r * 460 * scale, r * 76 * scale, 0, 0, 6.3); c.stroke();
    }
    c.globalAlpha = 1;
    burst(c, 77.7, blast, x, y - 100 * scale, { n: low ? 14 : 30, speed: 520, angle: -Math.PI / 2, spread: 6.3, gravity: 540, life: 1.7, size: 6, colors: [gold, '#fff6da', '#c98cff', '#ff8f6b'], shape: 'shard', drag: 1.5 }, scale);
    burst(c, 12.4, blast, x, y - 100 * scale, { n: low ? 10 : 22, speed: 380, angle: -Math.PI / 2, spread: 5, gravity: 260, life: 2, size: 5.5, colors: ['#fff6da', gold], shape: 'star', drag: 1.9 }, scale);
  }
  c.restore();
}

/** Screen-space end of a run: white-gold flash, then a calm rain of golden light. */
export function endingScreen(c: Ctx, w: World, memory: StageMemory, idle: number, h: number, heroX: number, floor: number, reduced: boolean, low: boolean) {
  const ended = memory.endedAge(w, idle); if (ended < 0) return;
  if (w.phase === 'DEFEAT') {
    c.globalAlpha = clamp01(ended / 1.2) * .55; c.fillStyle = '#0a0308'; c.fillRect(0, 0, 430, h); c.globalAlpha = 1; return;
  }
  const finale = memory.finaleAge(w, idle);
  if (!reduced && finale >= 1.1 && finale < 2.2) { c.globalAlpha = .85 * Math.exp(-(finale - 1.1) * 4.5); c.fillStyle = '#fff6dc'; c.fillRect(0, 0, 430, h); c.globalAlpha = 1; }
  // Warm glory over the party; static under reduced motion.
  const rise = clamp01((ended - .25) / 1.2), time = reduced ? 0 : idle;
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < (low ? 4 : 7); i++) {
    const a = -Math.PI / 2 + (i - 3) * .23 + Math.sin(time * .35 + i) * .04, len = h * 1.1, wide = .05 + hash(i * 3.3) * .04;
    c.globalAlpha = rise * (.1 + .05 * Math.sin(time * .9 + i * 1.7)); c.fillStyle = '#ffdf8a';
    c.beginPath(); c.moveTo(heroX, floor - 40); c.lineTo(heroX + Math.cos(a - wide) * len, floor - 40 + Math.sin(a - wide) * len); c.lineTo(heroX + Math.cos(a + wide) * len, floor - 40 + Math.sin(a + wide) * len); c.fill();
  }
  c.globalAlpha = 1; pool(c, '#ffd978', heroX, floor, 150, 30, rise * .6);
  if (!reduced) for (let i = 0; i < (low ? 10 : 22); i++) {
    const u = (time * (.1 + hash(i * 1.9) * .08) + hash(i * 4.7)) % 1, px = hash(i * 8.3) * 430 + Math.sin(time * .8 + i) * 14, py = h * (1 - u);
    c.globalAlpha = rise * Math.sin(u * Math.PI) * .9; c.fillStyle = i % 4 ? '#ffe9a8' : '#ffffff';
    starPath(c, px, py, 2.2 + hash(i) * 3.2, .8, 4, time + i); c.fill();
  }
  c.restore();
}

/** District name card on arrival: the journey moved to a new place, not a new tint. */
export function districtCard(c: Ctx, title: string, subtitle: string, age: number, h: number, color: string, reduced: boolean) {
  banner(c, subtitle, title.toUpperCase(), h, age, 2.5, color, reduced);
}

/** Dive through the chosen gate: light rushes past the camera from the gate's throat. */
export function portalDive(c: Ctx, k: number, x: number, y: number, h: number, color: string, time: number, reduced: boolean) {
  if (k <= 0) return;
  if (reduced) { c.fillStyle = `rgba(8,5,20,${clamp01(k)})`; c.fillRect(0, 0, 430, h); return; }
  c.save();
  c.globalAlpha = clamp01(k * 1.3) * .5; light(c, color, x, y, 80 + k * 560, 1);
  c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const a = hash(i * 3.7) * 6.2832, u = (hash(i * 9.1) + time * 2.4 + k) % 1, near = 20 + u * u * 520 * k, len = 30 + u * 150 * k;
    c.globalAlpha = k * (1 - u * .5); c.strokeStyle = i % 3 ? color : '#ffffff'; c.lineWidth = 1 + u * 3;
    c.beginPath(); c.moveTo(x + Math.cos(a) * near, y + Math.sin(a) * near); c.lineTo(x + Math.cos(a) * (near + len), y + Math.sin(a) * (near + len)); c.stroke();
  }
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = clamp01((k - .45) / .55) ** 1.6; c.fillStyle = '#f6fbff'; c.fillRect(0, 0, 430, h);
  c.restore();
}
/** The next vault opens like an eye around the gate the party stepped out of. */
export function irisOpen(c: Ctx, k: number, x: number, y: number, h: number, color: string, reduced: boolean) {
  if (k >= 1) return;
  if (reduced) { c.fillStyle = `rgba(8,5,20,${clamp01(1 - k)})`; c.fillRect(0, 0, 430, h); return; }
  const radius = 10 + easeOut(k) * Math.hypot(430, h);
  c.save();
  c.fillStyle = '#060410'; c.beginPath(); c.rect(0, 0, 430, h); c.arc(x, y, radius, 0, 6.2832, true); c.fill('evenodd');
  c.globalAlpha = (1 - k) * .9; c.strokeStyle = color; c.lineWidth = 10 * (1 - k) + 2; c.beginPath(); c.arc(x, y, radius, 0, 6.2832); c.stroke();
  c.globalAlpha = (1 - k) ** 2 * .8; c.fillStyle = '#f6fbff'; c.fillRect(0, 0, 430, h);
  c.restore();
}
