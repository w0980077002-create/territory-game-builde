/** Crystal-only scenery. No gameplay state; all motion uses the simulation clock.
 * Painted depth, independent ruins/shards, road and near ledges travel at .16/.46/1/1.3.
 * Static lighting and feathering are prepared once, never rebuilt per frame.
 */
import type { World } from '../../../game/cavePreviewWorld/engine';

type Ctx = CanvasRenderingContext2D;
type Images = Map<string, HTMLImageElement>;
const ROOT = 'assets/territory/cave-expedition/';
export const CRYSTAL_ASSETS = ['crystal-rift-depth.webp', 'crystal-rift-props.webp'];
// Geometry and painted storytelling are identical on small Android CPUs; only
// the optional animated accents are reduced. No extra render target or filter.
const lowDetail = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency <= 4 || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4);
const mod = (v: number, m: number) => ((v % m) + m) % m;
const seed = (n: number) => { const v = Math.sin(n * 127.1 + 19.7) * 43758.5453; return v - Math.floor(v); };
function surface(width: number, height: number) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  return { canvas, c: canvas.getContext('2d')! };
}
function feather(c: Ctx, width: number, height: number, edge: number) {
  c.globalCompositeOperation = 'destination-in';
  const g = c.createLinearGradient(0, 0, width, 0);
  g.addColorStop(0, '#0000'); g.addColorStop(edge / width, '#000');
  g.addColorStop(1 - edge / width, '#000'); g.addColorStop(1, '#0000');
  c.fillStyle = g; c.fillRect(0, 0, width, height); c.globalCompositeOperation = 'source-over';
}
interface Art { depth: HTMLCanvasElement; road: HTMLCanvasElement; props: HTMLCanvasElement[]; mist: HTMLCanvasElement; ray: HTMLCanvasElement }
const artCache = new WeakMap<HTMLImageElement, Art>();
function prepare(images: Images): Art | undefined {
  const painting = images.get(ROOT + CRYSTAL_ASSETS[0]), atlas = images.get(ROOT + CRYSTAL_ASSETS[1]);
  if (!painting || !atlas) return; // Existing biome renderer remains the fallback.
  const previous = artCache.get(painting); if (previous) return previous;
  const depth = surface(1280, 560);
  depth.c.drawImage(painting, 0, 0, painting.width, painting.height * .65, 0, 0, 1280, 560);
  // Dark matched edges overlap instead of mirrored copies or a hard tile boundary.
  feather(depth.c, 1280, 560, 100);
  const road = surface(1024, 240);
  road.c.drawImage(painting, 0, painting.height * .65, painting.width, painting.height * .35, 0, 0, 1024, 240);
  feather(road.c, 1024, 240, 100);
  // Three isolated props in the production atlas; clean only faint export haze.
  const props = [[0, 0, .332, .97], [.34, .14, .337, .83], [.686, .59, .31, .38]].map(([x, y, width, height]) => {
    const s = surface(Math.round(atlas.width * width), Math.round(atlas.height * height));
    s.c.drawImage(atlas, atlas.width * x, atlas.height * y, atlas.width * width, atlas.height * height, 0, 0, s.canvas.width, s.canvas.height);
    const data = s.c.getImageData(0, 0, s.canvas.width, s.canvas.height);
    for (let i = 3; i < data.data.length; i += 4) {
      const a = data.data[i]; data.data[i] = a < 60 ? 0 : a < 160 ? Math.round((a - 60) * 160 / 100) : a;
    }
    s.c.putImageData(data, 0, 0); return s.canvas;
  });
  const mist = surface(256, 64), m = mist.c.createRadialGradient(128, 32, 0, 128, 32, 128);
  m.addColorStop(0, '#78dfea26'); m.addColorStop(1, '#78dfea00');
  mist.c.scale(1, .25); mist.c.fillStyle = m; mist.c.fillRect(0, 0, 256, 256);
  const ray = surface(128, 256), r = ray.c.createLinearGradient(0, 0, 0, 256);
  r.addColorStop(0, '#9cefff28'); r.addColorStop(1, '#9cefff00'); ray.c.fillStyle = r;
  ray.c.beginPath(); ray.c.moveTo(90, 0); ray.c.lineTo(105, 0); ray.c.lineTo(100, 256); ray.c.lineTo(0, 256); ray.c.fill();
  const result = { depth: depth.canvas, road: road.canvas, props, mist: mist.canvas, ray: ray.canvas };
  artCache.set(painting, result); return result;
}
/** Called during loading, before interactive rendering or the first combat frame. */
export function warmCrystalEnvironment(images: Images) { prepare(images); }
function prop(c: Ctx, img: HTMLCanvasElement, x: number, base: number, height: number) {
  const width = img.width * height / img.height;
  if (x + width / 2 < -10 || x - width / 2 > 440) return;
  c.drawImage(img, x - width / 2, base - height, width, height);
}
/** Overlapping strips have dark matched edges; never reverse an identifiable landmark. */
function repeat(c: Ctx, img: HTMLCanvasElement, shift: number, width: number, y: number, height: number) {
  const pitch = width * .92;
  for (let n = Math.floor((shift - width) / pitch); n * pitch - shift < 430; n++)
    c.drawImage(img, n * pitch - shift, y, width, height);
}
export function drawCrystalBackdrop(c: Ctx, w: World, images: Images, h: number, reduced: boolean): boolean {
  const art = prepare(images); if (!art) return false;
  const time = reduced ? 0 : w.time, horizon = h * .64, camera = w.cameraX;
  c.save(); c.fillStyle = '#071c30'; c.fillRect(0, 0, 430, h);
  const depthH = horizon + 4, depthW = Math.max(640, depthH * 1280 / 560), shift = camera * .16 + 36;
  repeat(c, art.depth, shift, depthW, 0, depthH);
  // Water highlights are attached to painted falls, at the SAME projection as the vault.
  const pitch = depthW * .92;
  for (let n = Math.floor((shift - depthW) / pitch); n * pitch - shift < 430; n++) {
    const origin = n * pitch - shift;
    for (const [sx, sy, length] of [[.73, .3, .2], [.66, .54, .39], [.8, .46, .27]]) {
      const x = origin + sx * depthW, y = sy * depthH, height = length * depthH;
      if (x < -5 || x > 435) continue;
      c.strokeStyle = '#9cffff'; c.lineWidth = 1;
      for (let i = 0; i < (lowDetail ? 2 : 4); i++) {
        c.globalAlpha = .12 + i * .025;
        const start = mod(time * 24 + i * height / 4, height);
        c.beginPath(); c.moveTo(x + i * 1.5, y + start); c.lineTo(x + i * 1.5, y + Math.min(height, start + 14)); c.stroke();
      }
    }
  }
  c.globalAlpha = .55;
  for (let i = 0; i < (lowDetail ? 1 : 2); i++) {
    const x = mod(150 + i * 310 - camera * .23, 720) - 140;
    c.drawImage(art.ray, x + Math.sin(time * .22 + i) * 6, 0, 160, horizon);
  }
  // Broken arches and huge shards at different world addresses reveal a lost route.
  const mid = camera * .46;
  for (let n = Math.floor((mid - 180) / 380); n * 380 - mid < 600; n++) {
    const k = seed(n + 3), x = n * 380 + 35 + k * 70 - mid;
    const index = mod(n, 3) === 1 ? 1 : 0, tall = h * (index ? .36 : .34 + k * .13);
    c.globalAlpha = index ? .65 : .82;
    prop(c, art.props[index], x, horizon + h * .008, tall);
    if (!index) { c.globalAlpha = .035 + .015 * Math.sin(time * .8 + n); c.drawImage(art.mist, x - 60, horizon - tall * .75, 120, tall * .8); }
  }
  c.globalAlpha = 1; c.fillStyle = '#0a2339'; c.fillRect(0, horizon, 430, h - horizon);
  repeat(c, art.road, camera, Math.max(700, (h - horizon) * 1024 / 240), horizon - 1, h - horizon + 2);
  // Sparse water glints below the foot line. No bloom across actor silhouettes.
  for (let i = Math.floor((camera - 80) / 150); i * 150 - camera < 510; i++) {
    const k = seed(i * 5 + 1), x = i * 150 - camera + 65;
    const y = h * (.85 + k * .08);
    c.globalAlpha = .12 + .035 * Math.sin(time * 1.4 + i);
    c.drawImage(art.mist, x - 44, y - 4, 88, 8);
    c.strokeStyle = '#79e2ef'; c.lineWidth = .6;
    c.beginPath(); c.moveTo(x - 16, y); c.lineTo(x + 12, y); c.moveTo(x - 8, y + 3); c.lineTo(x + 21, y + 3); c.stroke();
  }
  // Small fungus shelves sit behind the actors, never at their head height.
  for (let n = Math.floor((camera - 80) / 460); n * 460 - camera < 540; n++) {
    c.globalAlpha = .8;
    prop(c, art.props[2], n * 460 + 260 - camera, horizon + h * .035, h * .065);
  }
  c.restore(); return true;
}
export function drawCrystalForeground(c: Ctx, w: World, images: Images, h: number, reduced: boolean) {
  const art = prepare(images); if (!art) return false;
  const time = reduced ? 0 : w.time, camera = w.cameraX;
  c.save();
  // Atmospheric wisps remain below the combat silhouette band.
  c.globalAlpha = .23;
  for (let i = 0; i < (lowDetail ? 1 : 2); i++) {
    const x = mod(i * 340 - camera * .7 + time * 3, 760) - 260;
    c.drawImage(art.mist, x, h * .88, 350, h * .1);
  }
  // Foreground depth stays in the lowest 6%, safely below every actor's feet.
  const near = camera * 1.3;
  for (let n = Math.floor((near - 160) / 510); n * 510 - near < 600; n++) {
    c.globalAlpha = .9;
    prop(c, art.props[2], n * 510 + seed(n) * 110 - near, h + 9, h * .06);
  }
  const fighting = ['FIGHT', 'BOSS', 'APPROACH'].includes(w.phase);
  for (let i = 0; i < (reduced ? 5 : lowDetail ? 6 : 12); i++) {
    const k = seed(i + 14), depth = i % 2 ? .35 : .8;
    const x = mod(i * 73 - camera * depth + Math.sin(time * .4 + i) * 9, 470) - 20;
    const y = h * (.1 + k * .42) + Math.sin(time * .5 + i) * 3;
    c.globalAlpha = (fighting ? .18 : .32) * (.7 + .3 * Math.sin(time + i));
    c.fillStyle = i % 4 ? '#7feaff' : '#c69aff'; c.fillRect(x, y, 1.3, 1.3);
  }
  c.restore(); return true;
}
