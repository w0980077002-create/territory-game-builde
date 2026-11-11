import { motionStops, type FighterMotion, type Joint } from '../../combat2d/fighterAnimations';
import type { Pose } from '../../../game/cavePreviewWorld/engine';

export const HERO_PARTS = ['head', 'torso', 'arm-right', 'arm-left', 'leg-right', 'leg-left', 'weapon', 'shield'];
const ROOT = 'assets/territory/combat2d/male_viking/';
type Transform = { x: number; y: number; angle: number };
const timelines = new Map<FighterMotion, { at: number; joints: Partial<Record<Joint, Transform>> }[]>();
function timeline(motion: FighterMotion) {
  let cached = timelines.get(motion);
  if (!cached) {
    cached = motionStops(motion).map(stop => ({ at: stop.at, joints: Object.fromEntries(Object.entries(stop.pose).map(([key, value]) => {
      const translate = value.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      return [key, { x: translate ? Number(translate[1]) : 0, y: translate ? Number(translate[2]) : 0, angle: Number(value.match(/rotate\(([-\d.]+)deg\)/)?.[1] ?? 0) }];
    })) }));
    timelines.set(motion, cached);
  }
  return cached;
}
/** The existing approved cutouts and joint choreography, sampled on the DEMO clock.
 * Pausing freezes bones, weapon and impact together; no CSS-only attack timer. */
export function drawHero(c: CanvasRenderingContext2D, images: Map<string, HTMLImageElement>, pose: Pose, elapsed: number, time: number, combo: number, x: number, y: number, size: number, reduced: boolean) {
  const motion: FighterMotion = pose === 'attack' ? (['slash', 'thrust', 'overhead'] as const)[combo % 3] : pose === 'run' ? 'idle' : pose;
  const stops = timeline(motion);
  const ms = pose === 'hit' ? Math.min(810, 350 + elapsed * 1700) : pose === 'block' ? Math.min(500, 240 + elapsed * 800) : pose === 'dodge' ? Math.min(810, 180 + elapsed * 950) : Math.min(810, elapsed / .7 * 810);
  const end = stops.findIndex(stop => stop.at >= ms);
  const a = stops[Math.max(0, (end < 0 ? stops.length - 1 : end) - 1)], b = stops[end < 0 ? stops.length - 1 : end];
  const mix = Math.min(1, Math.max(0, (ms - a.at) / Math.max(1, b.at - a.at)));
  const joint = (key: Joint, draw: () => void) => {
    const from = a.joints[key] ?? { x: 0, y: 0, angle: 0 }, to = b.joints[key] ?? from;
    let angle = from.angle + (to.angle - from.angle) * mix;
    if (pose === 'run' && !reduced) {
      if (key.startsWith('leg-')) angle += Math.sin(time * 12 + (key.endsWith('left') ? Math.PI : 0)) * 28;
      if (key.startsWith('knee-')) angle += Math.max(0, Math.sin(time * 12 + (key.endsWith('left') ? Math.PI : 0))) * 30;
      if (key === 'arm-right') angle += Math.sin(time * 12) * 13;
    }
    if (pose === 'idle' && !reduced) {
      if (key === 'torso') angle += Math.sin(time * 1.8) * .9;
      if (key === 'head') angle += Math.sin(time * 1.4 + .8) * 1.4;
      if (key === 'arm-right') angle += Math.sin(time * 1.8) * 1.7;
    }
    c.save(); c.translate(from.x + (to.x - from.x) * mix, from.y + (to.y - from.y) * mix); c.rotate(angle * Math.PI / 180); draw(); c.restore();
  };
  const image = (part: string, dx: number, dy: number, width: number, height: number) => c.drawImage(images.get(ROOT + part + '.webp')!, dx, dy, width, height);
  const clip = (x: number, y: number, width: number, height: number, draw: () => void) => { c.save(); c.beginPath(); c.rect(x, y, width, height); c.clip(); draw(); c.restore(); };
  const arm = (left: boolean) => {
    const side = left ? 'left' : 'right';
    c.save(); c.translate(left ? 194 : 318, 258);
    joint(`arm-${side}`, () => {
      c.fillStyle = '#e99a59'; c.beginPath(); c.ellipse(0, 9, 24, 25, 0, 0, 7); c.fill();
      clip(-45, -25, 90, 94, () => image(`arm-${side}`, -34, -18, 72, 145));
      c.translate(0, 57);
      joint(`forearm-${side}`, () => {
        c.fillStyle = '#e99a59'; c.beginPath(); c.arc(0, 0, 19, 0, 7); c.fill();
        clip(-45, -9, 90, 84, () => image(`arm-${side}`, -34, -75, 72, 145));
        c.translate(3, 57);
        if (left) joint('shield', () => image('shield', -83, -108, 166, 222));
        else joint('weapon', () => image('weapon', -30, -205, 65, 224));
      });
    }); c.restore();
  };
  const leg = (left: boolean) => {
    const side = left ? 'left' : 'right'; c.save(); c.translate(left ? -35 : 31, 0);
    joint(`leg-${side}`, () => {
      clip(-55, -20, 120, 84, () => image(`leg-${side}`, left ? -43 : -39, -13, left ? 92 : 99, 121));
      c.translate(0, 53); joint(`knee-${side}`, () => clip(-55, -12, 120, 80, () => image(`leg-${side}`, left ? -43 : -39, -66, left ? 92 : 99, 121)));
    }); c.restore();
  };
  c.save(); c.translate(x - size / 2, y - size * 500 / 512); c.scale(size / 512, size / 512);
  c.translate(256, 390);
  joint('root', () => {
    leg(true); leg(false);
    joint('torso', () => {
      c.translate(-256, -390); image('torso', 169, 220, 175, 219);
      c.save(); c.translate(258, 238); joint('head', () => image('head', -77, -139, 155, 186)); c.restore();
      arm(true); arm(false);
    });
  }); c.restore();
}
