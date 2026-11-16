import type { Enemy, World } from '../../../game/cavePreviewWorld/engine';
import { animationState, visualId } from './actorAnimation';
import type { BladeSegment } from './heroRig';

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
    c.globalAlpha = 1; c.fillStyle = color; c.font = `bold ${18 * scale}px system-ui`; c.textAlign = 'center';
    c.fillText(e.heavy ? '!!' : '!', x, y - 205 * scale);
  }
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
  c.save(); c.lineCap = 'round';
  for (const id of ids) {
    const target = w.enemies.find(e => e.id === id && e.hp > 0);
    if (!target || target.worldX - w.heroX < 135) continue;
    const toX = target.worldX - w.cameraX - 19 * scale, toY = floor - 55 * scale + (target.lane - 1) * 7 * scale;
    c.globalAlpha = reduced ? .7 : .4 + progress * .6;
    if (!reduced && quality === 'high') { c.shadowColor = '#5dcfff'; c.shadowBlur = 10; }
    for (const [width, color] of [[5, '#368feb'], [1.7, '#e1fcff']] as const) {
      c.strokeStyle = color; c.lineWidth = width * scale; c.beginPath(); c.moveTo(fromX, fromY);
      for (let segment = 1; segment <= 9; segment++) {
        const t = segment / 9 * (reduced ? 1 : Math.min(1, progress * 1.3)), jitter = segment === 9 || reduced ? 0 : Math.sin(segment * 12.3 + Math.floor(w.time * 24)) * 7 * scale;
        c.lineTo(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t + jitter);
      }
      c.stroke();
    }
  }
  c.restore();
}

const bladeHistory = new WeakMap<World, { action: number; time: number; blade: BladeSegment; from?: BladeSegment }>();
/** Swept blade geometry sampled from the existing rig, no synthetic arc or
 * extra timer. Paused frames cannot add trails; a new action/reload resets it.
 */
export function bladeTrail(c: Ctx, w: World, blade: BladeSegment | undefined, reduced: boolean, quality: VisualQuality) {
  const previous = bladeHistory.get(w);
  if (!blade || w.pose !== 'attack' || reduced || quality === 'low') { bladeHistory.delete(w); return; }
  const from = previous?.time === w.time ? previous.from : previous && previous.action === w.heroActionAt && w.time > previous.time && w.time - previous.time < .1 ? previous.blade : undefined;
  if (from) {
    c.save(); c.fillStyle = '#fff0ad'; c.globalAlpha = .24;
    c.beginPath(); c.moveTo(from.tip.x, from.tip.y);
    c.lineTo(blade.tip.x, blade.tip.y); c.lineTo(blade.grip.x, blade.grip.y);
    c.lineTo(from.grip.x, from.grip.y); c.closePath(); c.fill(); c.restore();
  }
  bladeHistory.set(w, { action: w.heroActionAt, time: w.time, blade, from });
}

/** Small contact flash and directional chips at existing impact events only. */
export function contactFlash(c: Ctx, x: number, y: number, age: number, scale: number, reduced: boolean, quality: VisualQuality) {
  if (age < 0 || age > .24) return;
  const t = clamp(age / .24);
  c.save(); c.globalAlpha = (1 - t) * .9; c.fillStyle = '#fff4cf';
  c.beginPath(); c.ellipse(x, y, (reduced ? 8 : 8 + t * 13) * scale, (reduced ? 8 : 12 - t * 5) * scale, -.4, 0, Math.PI * 2); c.fill();
  if (!reduced && quality === 'high') {
    c.strokeStyle = '#ffbe65'; c.lineWidth = 2 * scale;
    for (let i = 0; i < 5; i++) {
      const a = -1.4 + i * .65, distance = (10 + t * 36) * scale;
      const px = x + Math.cos(a) * distance, py = y + Math.sin(a) * distance + t * t * 19 * scale;
      c.beginPath(); c.moveTo(px, py); c.lineTo(px - Math.cos(a) * 5 * scale, py - Math.sin(a) * 5 * scale); c.stroke();
    }
  }
  c.restore();
}
