import registry from './animationRegistry.json';
import { caveBoss } from '../../../game/cavePreviewWorld/catalog';
import type { Enemy, World } from '../../../game/cavePreviewWorld/engine';
import type { Images } from './renderer';

/** Art-only adaptation of VIKING actorGeometry.poseFrame and bossAnimation.bossPose.
 * Source pinned in animationRegistry.json. No combat/store/loot code is imported.
 * The three enemies have eight drawn poses; bosses have rigid procedural motion.
 */
export const ANIMATION_ROOT = 'assets/territory/cave-expedition/animation/';
export const animationPaths = () => [...Object.keys(registry.clips), ...Object.keys(registry.textures)].map(id => ANIMATION_ROOT + id + '.webp');
export type VisualId = keyof typeof registry.clips | keyof typeof registry.textures | 'spider_queen' | 'fungal_king' | 'fire_abyss_lord';
export function visualId(w: World, e: Enemy): VisualId {
  if (e.species === 'boss') return caveBoss(w.floor).art as VisualId;
  // Sparse biome skins, stable through checkpoint/reload and repeat floor runs.
  // They retain the existing species, HP, AI and wave position.
  if (e.id % 9 === 0 && w.floor >= 6) {
    if (w.biome === 'crystal' && e.species === 'shardling') return 'senior_driller';
    if (w.biome === 'spore' && e.species === 'moth') return 'moss_eater';
  }
  return e.species === 'eel' ? '08_armored_boar' : e.species === 'moth' ? '07_purple_mage' : '04_club_raider';
}

interface Loader { resolve: (path: string) => string; signal?: AbortSignal; requested: Set<string> }
const loaders = new WeakMap<Images, Loader>();
export function prepareAnimations(images: Images, resolve: Loader['resolve'], signal?: AbortSignal) {
  loaders.set(images, { resolve, signal, requested: new Set() });
}
/** Optional, on demand, once per mount. Never blocks the existing cave preload. */
export function animationImage(images: Images, id: VisualId) {
  const path = ANIMATION_ROOT + id + '.webp';
  if (images.has(path)) return images.get(path);
  const loader = loaders.get(images);
  if (!loader || loader.signal?.aborted || loader.requested.has(path)) return undefined;
  loader.requested.add(path);
  const image = new Image();
  const cleanup = () => { image.onload = image.onerror = null; loader.signal?.removeEventListener('abort', abort); };
  const abort = () => { cleanup(); image.removeAttribute('src'); };
  image.onload = () => { if (!loader.signal?.aborted && image.naturalWidth) images.set(path, image); cleanup(); };
  image.onerror = cleanup;
  loader.signal?.addEventListener('abort', abort, { once: true });
  try { image.src = loader.resolve(path); } catch { cleanup(); }
  return undefined;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
export function animationState(e: Enemy, time: number, reduced = false) {
  const duration = e.species === 'boss' ? (e.heavy ? 1.45 : .95) : .5;
  const windup = e.pose === 'attack' && e.impact > time;
  const release = e.pose === 'attack' && !windup;
  const recovery = release ? clamp((e.poseUntil - time) / .3) : 0;
  const preparation = windup ? clamp(1 - (e.impact - time) / duration) : 0;
  const death = e.pose === 'death' ? Math.max(.001, time - e.deathAt) : 0;
  let frame = 0;
  if (death) frame = death < .12 ? 6 : 7;
  else if (e.pose === 'hit') frame = 6;
  else if (windup) frame = 3;
  else if (release) frame = recovery > .45 ? 4 : 5;
  else if (e.pose === 'run' && !reduced) frame = 1 + Math.floor(time * 8 + e.id) % 2;
  const recoil = e.pose === 'hit' ? 7 * clamp((e.poseUntil - time) / .32) : 0;
  return { frame, preparation, recovery, windup, death, recoil };
}

/** One fixed scale over ALL eight frames, with the source's per-frame foot pivot.
 * No per-frame alpha scans or size pumping. Source enemies already face left.
 */
export function drawAnimatedEnemy(c: CanvasRenderingContext2D, image: HTMLImageElement, id: keyof typeof registry.clips, e: Enemy, time: number, x: number, y: number, size: number, reduced: boolean) {
  const clip = registry.clips[id], pose = animationState(e, time, reduced);
  if (image.naturalWidth !== clip.width || image.naturalHeight !== clip.height) return false;
  const frame = clip.frames[pose.frame];
  if (!frame || clip.frames.length !== 8) return false;
  const extent = Math.max(...clip.frames.map(f => Math.max(f.pivot[0], f.rect[2] - f.pivot[0]))) * 2;
  // Weapon sweeps extend beyond the body. Fitting the entire sweep into a
  // body-sized square would shrink the raider/mage to tiny figures.
  const scale = Math.min(size * 2.5 / extent, size * .94 / clip.referenceHeight);
  const [sx, sy, sw, sh] = frame.rect;
  const breath = !reduced && e.pose === 'idle' ? Math.sin(time * 2.2 + e.id) * .6 : 0;
  const shift = reduced ? 0 : pose.recoil + pose.preparation * 5 - pose.recovery * 12;
  c.drawImage(image, sx, sy, sw, sh, x + shift - frame.pivot[0] * scale, y - frame.pivot[1] * scale - breath, sw * scale, sh * scale);
  return true;
}

/** Original bossPose idea: fit a rotating, rigid high-resolution texture, never
 * stretch a portrait. Secondary motion is reserved for independent web/spores/VFX.
 */
export function drawProceduralActor(c: CanvasRenderingContext2D, img: HTMLImageElement, e: Enemy, time: number, x: number, y: number, size: number, reduced: boolean) {
  const p = animationState(e, time, reduced);
  const moving = e.pose === 'run';
  const angle = reduced ? 0 : p.death ? -.65 * clamp(p.death / .7) : e.pose === 'hit' ? .065 : p.windup ? .035 * Math.sin(time * 7) * p.preparation : p.recovery ? -.1 * Math.sin(p.recovery * Math.PI) : Math.sin(time * (moving ? 8 : 1.9)) * (moving ? .035 : .008);
  const bob = reduced ? 0 : (1 - Math.cos(time * (moving ? 16 : 1.9))) * size * (moving ? .008 : .002);
  // Fixed envelope fits every living pose without changing apparent body size.
  const ca = Math.abs(Math.cos(angle)), sa = Math.abs(Math.sin(angle));
  const scale = Math.min(size / (img.width + img.height * .11), size * .94 / (img.height + img.width * .11));
  const width = img.width * scale, height = img.height * scale;
  c.save(); c.translate(x + (reduced ? 0 : p.recoil + p.preparation * 6 - p.recovery * 13), y - bob - (height * ca + width * sa) / 2);
  c.rotate(angle); c.drawImage(img, -width / 2, -height / 2, width, height); c.restore();
}

export function drawCaveActor(c: CanvasRenderingContext2D, images: Images, w: World, e: Enemy, x: number, y: number, size: number, reduced: boolean) {
  const id = visualId(w, e);
  if (id in registry.clips) {
    const image = animationImage(images, id);
    return image ? drawAnimatedEnemy(c, image, id as keyof typeof registry.clips, e, w.time, x, y, size, reduced) : false;
  }
  const image = id in registry.textures ? animationImage(images, id) : images.get(`assets/territory/cave-expedition/approved/${id}.webp`);
  if (!image) return false;
  drawProceduralActor(c, image, e, w.time, x, y, size, reduced);
  return true;
}
