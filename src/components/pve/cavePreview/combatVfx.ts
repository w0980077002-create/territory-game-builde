import type { Enemy, World } from '../../../game/cavePreviewWorld/engine';
import { animationState, visualId } from './actorAnimation';
import type { BladeSegment } from './heroRig';
import { hash, light } from './kit';

type Ctx = CanvasRenderingContext2D;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export type VisualQuality = 'high' | 'low';
/** Measured drawing budget, independent of world time and combat. Hysteresis
 * avoids quality oscillation; essential danger signals survive the low tier.
 */
export class CaveVisualBudget {
  quality: VisualQuality;
  private samples = 0;
  private cost = 0;
  constructor(memory = 8) { this.quality = memory <= 2 ? 'low' : 'high'; }
  sample(ms: number) {
    this.cost += Math.min(100, Math.max(0, ms));
    if (++this.samples < 90) return;
    const mean = this.cost / this.samples;
    if (mean > 11) this.quality = 'low';
    else if (mean < 4) this.quality = 'high';
    this.cost = this.samples = 0;
  }
}

const phaseColors = ['#ffc574', '#cf96ff', '#ff6e81'];
export function bossTelegraph(c: Ctx, w: World, e: Enemy, x: number, y: number, heroX: number, scale: number, reduced: boolean, quality: VisualQuality) {
  if (e.hp <= 0 || e.species !== 'boss') return;
  const p = animationState(e, w.time, reduced), color = phaseColors[w.bossPhase - 1] ?? phaseColors[0];
  const id = visualId(w, e);
  c.save();
  // Secondary elements are separate from the rigid original portrait.
  if (!reduced && quality === 'high' && id === 'spider_queen') {
    c.strokeStyle = '#d8c7ff'; c.lineWidth = .7; c.globalAlpha = .25;
    for (let i = -1; i <= 1; i++) {
      const anchor = x + i * 42 * scale;
      c.beginPath(); c.moveTo(anchor, y - 230 * scale);
      c.quadraticCurveTo(anchor + Math.sin(w.time * 1.8 + i) * 8, y - 170 * scale, x + i * 28 * scale, y - 100 * scale); c.stroke();
    }
  }
  if (p.windup) {
    const radius = (e.heavy ? 91 : 63) * scale;
    c.globalAlpha = .12 + p.preparation * .16;
    c.fillStyle = color; c.beginPath(); c.ellipse(heroX + 6 * scale, y + 2, radius, 13 * scale, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = .75; c.strokeStyle = color; c.lineWidth = (e.heavy ? 3 : 2) * scale;
    c.beginPath(); c.ellipse(heroX + 6 * scale, y + 2, radius, 13 * scale, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (reduced ? 1 : p.preparation)); c.stroke();
    // Phase 1: single ring; 2: cross marks; 3: outward danger spokes.
    for (let mark = 0; mark < w.bossPhase * 2; mark++) {
      const a = mark * Math.PI / w.bossPhase;
      const px = heroX + 6 * scale + Math.cos(a) * radius, py = y + 2 + Math.sin(a) * 13 * scale;
      c.beginPath(); c.moveTo(px - 3 * scale, py - 4 * scale); c.lineTo(px + 3 * scale, py + 4 * scale); c.stroke();
    }
    // The warning glyph swells with the windup; it sits above the head, never over the hero.
    const swell = reduced ? 1 : 1 + p.preparation * .35 + (e.heavy ? Math.sin(w.time * 22) * .06 : 0);
    c.globalAlpha = 1; c.fillStyle = color; c.font = `900 ${(e.heavy ? 26 : 21) * scale * swell}px system-ui`; c.textAlign = 'center';
    const outlined = c as Ctx & { strokeText?: Ctx['strokeText'] };
    if (typeof outlined.strokeText === 'function') { c.strokeStyle = '#1a0810'; c.lineWidth = 4 * scale; c.lineJoin = 'round'; outlined.strokeText(e.heavy ? '!!' : '!', x, y - 232 * scale); }
    c.fillText(e.heavy ? '!!' : '!', x, y - 232 * scale);
  }
  c.restore();
}

/** Furthest the blade physically reaches from the hero's centre, in stage units. Beyond it
 * the engine's already-scheduled hit is carried by the arc, so a landed blow never reads as a
 * swing at the air. Presentation only: the hit itself was decided by the engine. */
export const BLADE_REACH = 96;
const canGlow = typeof document !== 'undefined';
/** One forked lightning stroke between two points. `seed` keeps each target's bolt distinct;
 * the shape re-rolls on the simulation clock, so a paused frame is frozen. */
export function bolt(c: Ctx, x0: number, y0: number, x1: number, y1: number, progress: number, time: number, seed: number, scale: number, reduced: boolean, quality: VisualQuality, fade = 1) {
  const reach = reduced ? 1 : Math.min(1, progress * 1.35), flick = Math.floor(time * 28), steps = 9;
  const px = (s: number) => x0 + (x1 - x0) * s / steps * reach;
  const py = (s: number) => y0 + (y1 - y0) * s / steps * reach + (s === 0 || s === steps || reduced ? 0 : (hash(seed * 7.1 + s * 3.3 + flick * 1.7) - .5) * 24 * scale * Math.sin(s / steps * Math.PI));
  c.save(); c.lineCap = 'round';
  if (canGlow && !reduced) { c.globalAlpha = fade * .8; light(c, '#58c8ff', x0, y0, 15 * scale, .9); }
  for (const [width, color, alpha] of (quality === 'high' ? [[9, '#2a6fe0', .32], [4.4, '#58c8ff', .85], [1.7, '#f2fdff', 1]] : [[4.4, '#58c8ff', .85], [1.7, '#f2fdff', 1]]) as [number, string, number][]) {
    c.globalAlpha = fade * alpha * (reduced ? .8 : .45 + progress * .55); c.strokeStyle = color; c.lineWidth = width * scale;
    c.beginPath(); c.moveTo(px(0), py(0)); for (let s = 1; s <= steps; s++) c.lineTo(px(s), py(s)); c.stroke();
  }
  if (!reduced && quality === 'high') for (const at of [3, 6]) {
    // Short forks tear off the main stroke.
    const dir = hash(seed * 3.9 + at + flick) > .5 ? -1 : 1, len = (16 + hash(seed + at * 2.3 + flick) * 20) * scale;
    c.globalAlpha = fade * .8 * progress; c.strokeStyle = '#bfefff'; c.lineWidth = 1.3 * scale;
    c.beginPath(); c.moveTo(px(at), py(at)); c.lineTo(px(at) + len * .45, py(at) + dir * len * .55); c.lineTo(px(at) + len, py(at) + dir * len * .5 + (hash(at + flick) - .5) * 10 * scale); c.stroke();
  }
  if (canGlow) { c.globalAlpha = fade; light(c, '#9be4ff', px(steps), py(steps), (12 + progress * 16) * scale, .95); light(c, '#ffffff', px(steps), py(steps), 6 * scale * progress, 1); }
  c.restore();
}
/** Blade -> named pending target. Pure projection of an ALREADY scheduled
 * hit. No target search that could grant extra range, no damage callback.
 */
export function electricCut(c: Ctx, w: World, floor: number, scale: number, reduced: boolean, quality: VisualQuality, blade?: BladeSegment) {
  const ids = w.cleaveImpact > w.time ? w.cleaveTargets : w.heroImpact > w.time ? [w.target] : [];
  const contact = w.cleaveImpact > w.time ? w.cleaveImpact : w.heroImpact;
  if (!ids.length || contact - w.time > .19 || w.pose !== 'attack') return;
  const fromX = blade?.tip.x ?? w.heroX - w.cameraX + 47 * scale, fromY = blade?.tip.y ?? floor - 96 * scale;
  const progress = clamp(1 - (contact - w.time) / .19);
  for (const id of ids) {
    const target = w.enemies.find(e => e.id === id && e.hp > 0);
    if (!target || target.worldX - w.heroX < BLADE_REACH + (target.species === 'boss' ? 100 : 34)) continue;
    const toX = target.worldX - w.cameraX - (target.species === 'boss' ? 52 : 19) * scale, toY = floor - (target.species === 'boss' ? 84 : 55) * scale + (target.lane - 1) * 7 * scale;
    bolt(c, fromX, fromY, toX, toY, progress, w.time, id, scale, reduced, quality);
  }
}

const bladeHistory = new WeakMap<World, { action: number; samples: { time: number; blade: BladeSegment }[] }>();
/** Swept blade geometry sampled from the existing rig, no synthetic arc or
 * extra timer. Paused frames cannot add trails; a new action/reload resets it.
 */
export function bladeTrail(c: Ctx, w: World, blade: BladeSegment | undefined, reduced: boolean, quality: VisualQuality) {
  let history = bladeHistory.get(w);
  if (!blade || w.pose !== 'attack' || reduced || quality === 'low') { bladeHistory.delete(w); return; }
  const last = history?.samples[history.samples.length - 1];
  if (!history || history.action !== w.heroActionAt || (last && (w.time < last.time || w.time - last.time > .1))) { history = { action: w.heroActionAt, samples: [] }; bladeHistory.set(w, history); }
  if (!history.samples.length || w.time > history.samples[history.samples.length - 1].time) history.samples.push({ time: w.time, blade });
  while (history.samples.length > 1 && w.time - history.samples[0].time > .12) history.samples.shift();
  const list = history.samples;
  c.save();
  for (let i = 1; i < list.length; i++) {
    // A tapering ribbon: the newest sweep is brightest, older ones cool and thin out.
    const a = list[i - 1].blade, b = list[i].blade, k = i / (list.length - 1 || 1);
    c.globalAlpha = .1 + k * .34; c.fillStyle = k > .6 ? '#fffbe6' : '#ffd66e';
    c.beginPath(); c.moveTo(a.tip.x, a.tip.y); c.lineTo(b.tip.x, b.tip.y);
    c.lineTo(b.tip.x + (b.grip.x - b.tip.x) * (.35 + k * .4), b.tip.y + (b.grip.y - b.tip.y) * (.35 + k * .4));
    c.lineTo(a.tip.x + (a.grip.x - a.tip.x) * (.2 + k * .35), a.tip.y + (a.grip.y - a.tip.y) * (.2 + k * .35)); c.closePath(); c.fill();
  }
  c.restore();
}
