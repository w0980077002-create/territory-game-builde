import { portalsFor, portalOffset, DIFFICULTY } from '../../../game/cavePreviewWorld/engine';
import { drawHero, HERO_PARTS, type BladeSegment } from './heroRig';
import { CaveLife, drawBackdrop, drawForeground, stageLayout } from './world';
import { clamp01, comicText, easeBack, flashDraw, hash, light, pool, burst, type Ctx } from './kit';
import { StageMemory, PHASE_COLORS, bossFinale, bossPresence, bossScreen, cameraKick, comicWord, deathFlight, deathFx, districtCard, endingScreen, floatText, impactFx, irisOpen, killingBlow, phaseShiftFx, portalDive, slamFx, telegraphFx, type NumberTone } from './stageFx';
import { CRYSTAL_ASSETS, warmCrystalEnvironment } from './crystalEnvironment';
import { warmProps } from './props';
import { drawPortal, PORTAL_ART, warmPortals, portalFocused, focusPortal } from './portals';
import { BIOMES, BIOME_EN, CREATURES, APPROVED_CAVE_ART, caveActorArt } from '../../../game/cavePreviewWorld/catalog';
import { animationPaths, prepareAnimations, drawCaveActor } from './actorAnimation';
import { bossTelegraph, electricCut, bladeTrail, bolt, BLADE_REACH, type VisualQuality } from './combatVfx';
import type { World, Pose } from '../../../game/cavePreviewWorld/engine';
export const ASSET_ROOT = 'assets/territory/';
export const PARTY = ['heroes/male_viking', 'followers/northern_warrior', 'followers/forest_healer'];
export const POSES = ['idle', 'attack', 'hit', 'block', 'dodge', 'death'] as const;
/** Canvas art plus every HUD picture, so the portable build embeds one complete set. */
export function assetPaths() {
  return [...APPROVED_CAVE_ART.map(id => `cave-expedition/approved/${id}.webp`), 'cave-expedition/creatures.webp', 'cave-expedition/chambers.webp', 'cave-expedition/biomes.webp', 'cave-expedition/party-run.webp', 'cave-expedition/crystal-chamber.webp', 'ui/wooden-plaque.webp', PORTAL_ART.slice(ASSET_ROOT.length), ...CRYSTAL_ASSETS.map(id => `cave-expedition/${id}`),
    ...['astral','ember'].map(id => `cave/playtest/wings-${id}.svg`),
    ...['potion-mana', 'potion-fire', 'potion-green'].map(id => `ui/items/${id}.webp`),
    ...HERO_PARTS.map(part => `combat2d/male_viking/${part}.webp`),
    ...PARTY.flatMap(p => POSES.map(s => `characters/${p}/${s}.webp`))].map(p => ASSET_ROOT + p)
    .concat(animationPaths(), ['nav-city.webp','nav-inventory.webp','nav-hero-crown.webp','nav-battle.webp','nav-map-parchment.webp','nav-games.webp','nav-clan.webp',
      'ic-honor.webp', 'ic-blessing.webp', 'ic-settings.webp', 'blue-gem.webp', 'potion-hp-viking.webp', 'potion-hp-large-viking.webp', 'elixir-defense-viking.webp', 'potion-time-viking.webp']);
}
export type Images = Map<string, HTMLImageElement>;
export async function loadImages(resolve: (s: string) => string, signal?: AbortSignal): Promise<Images> {
  const images: Images = new Map();
  prepareAnimations(images, resolve, signal);
  await Promise.all(assetPaths().filter(path => !animationPaths().includes(path)).map(path => new Promise<void>((ok, fail) => {
    const img = new Image(); img.onload = () => { images.set(path, img); ok(); };
    // New scenery is optional: a failed decorative download must not block the cave.
    img.onerror = () => (path === PORTAL_ART || CRYSTAL_ASSETS.some(id => path.endsWith('/' + id))) ? ok() : fail(new Error(`Не удалось загрузить ${path}`));
    img.src = resolve(path);
  })));
  warmCrystalEnvironment(images); warmPortals(images); warmProps();
  // Generated atlases carry faint alpha haze around the figures; over the dark road it reads as a box.
  for (const path of [ASSET_ROOT + 'cave-expedition/creatures.webp', ASSET_ROOT + 'cave-expedition/party-run.webp']) {
    const img = images.get(path)!, clean = document.createElement('canvas'); clean.width = img.width; clean.height = img.height;
    const context = clean.getContext('2d', { willReadFrequently: true })!; context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, clean.width, clean.height), px = data.data;
    for (let i = 3; i < px.length; i += 4) px[i] = px[i] < 40 ? 0 : px[i] < 110 ? Math.round((px[i] - 40) * 110 / 70) : px[i];
    context.putImageData(data, 0, 0); images.set(path, clean as unknown as HTMLImageElement);
  }
  // Warm sprite anchors before the first interactive frame.
  for (const [path, img] of images) {
    const cols = path.endsWith('party-run.webp') ? 4 : path.endsWith('creatures.webp') ? 6 : 1;
    const rows = path.endsWith('party-run.webp') ? 3 : path.endsWith('creatures.webp') ? 4 : 1;
    if (path.includes('characters/') || path.includes('/approved/') || cols > 1) for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) foot(img, col * img.width / cols, row * img.height / rows, img.width / cols, img.height / rows);
  }
  return images;
}
function text(c: CanvasRenderingContext2D, value: string, x: number, y: number, size = 16, color = '#fff2c6') {
  c.fillStyle = color; c.font = `bold ${size}px system-ui`; c.textAlign = 'center'; c.shadowColor = '#050a12'; c.shadowBlur = 4; c.fillText(value, x, y); c.shadowBlur = 0;
}
interface Bounds { x: number; y: number; width: number; height: number }
const bounds = new WeakMap<HTMLImageElement, Map<string, Bounds>>();
function frameBounds(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number): Bounds {
  let cells = bounds.get(img); if (!cells) { cells = new Map(); bounds.set(img, cells); }
  const key = `${sx}/${sy}`; const cached = cells.get(key); if (cached) return cached;
  const surface = document.createElement('canvas'); surface.width = sw; surface.height = sh;
  const context = surface.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const pixels = context.getImageData(0, 0, sw, sh).data;
  let left = sw, top = sh, right = 0, bottom = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (pixels[(y * sw + x) * 4 + 3] > 48) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  const result = bottom ? { x: left, y: top, width: right - left, height: bottom - top } : { x: 0, y: 0, width: sw, height: sh };
  cells.set(key, result); return result;
}
function foot(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
  const frame = frameBounds(img, sx, sy, sw, sh); return (frame.y + frame.height) / sh;
}
function sprite(c: Ctx, img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, x: number, y: number, maxWidth: number, maxHeight: number) {
  const b = frameBounds(img, sx, sy, sw, sh), scale = Math.min(maxWidth / b.width, maxHeight / b.height);
  c.drawImage(img, sx + b.x, sy + b.y, b.width, b.height, x - b.width * scale / 2, y - b.height * scale, b.width * scale, b.height * scale);
}
/** Soft contact shadow: a dark core inside a wider penumbra seats the actor on the stone. */
function shadow(c: Ctx, x: number, y: number, size: number, weight = 1) {
  c.fillStyle = '#02070b'; const a = c.globalAlpha;
  c.globalAlpha = a * .2 * weight; c.beginPath(); c.ellipse(x, y + 2, size * .36, size * .058 + 2, 0, 0, 7); c.fill();
  c.globalAlpha = a * .36 * weight; c.beginPath(); c.ellipse(x, y + 2, size * .25, size * .034 + 1.5, 0, 0, 7); c.fill();
  c.globalAlpha = a;
}
function bar(c: Ctx, x: number, y: number, width: number, value: number, color: string) {
  c.fillStyle = '#080b12'; c.fillRect(x - width / 2 - 1.5, y - 1.5, width + 3, 7);
  c.fillStyle = '#2b1c22'; c.fillRect(x - width / 2, y, width, 4);
  c.fillStyle = color; c.fillRect(x - width / 2, y, width * clamp01(value), 4);
  c.fillStyle = '#ffffff66'; c.fillRect(x - width / 2, y, width * clamp01(value), 1.2);
}
function party(c: Ctx, images: Images, index: number, pose: Pose, x: number, y: number, size: number, time: number, fade = 1, actionAge = 0) {
  shadow(c, x, y, size); c.save(); c.globalAlpha = fade;
  // Actual pose sequence, with a planted return after contact. Damage uses the same clock.
  if (pose === 'hit') { c.translate(-9 * Math.max(0, 1 - actionAge / .4), 0); }
  if (pose === 'dodge') { c.translate(-24 * Math.sin(Math.min(1, actionAge / .45) * Math.PI), 0); }
  if (pose === 'run') {
    const img = images.get(ASSET_ROOT + 'cave-expedition/party-run.webp')!;
    const col = Math.floor(time * 9 + index) % 4;
    sprite(c, img, col * img.width / 4, index * img.height / 3, img.width / 4, img.height / 3, x, y, size, size);
  } else {
    const frame = pose === 'attack' && (actionAge < .1 || actionAge > .6) ? 'idle' : pose;
    const img = images.get(ASSET_ROOT + `characters/${PARTY[index]}/${frame}.webp`)!;
    sprite(c, img, 0, 0, img.width, img.height, x, y, size, size);
  }
  c.restore();
}
const life = new CaveLife();
const memory = new StageMemory();
const BOSS_SIZE = 232;
const WORDS = { ru: ['ХРЯСЬ!', 'БАМ!', 'БДЫЩ!'], en: ['CRASH!', 'BAM!', 'BOOM!'] };
/** World X of the spark waiting on the first stretch of every chamber. */
export const runeX = (w: World) => w.roomX + 455;
/** The sword's cut: a tapered crescent instead of a hairline arc. */
function slashFx(c: Ctx, x: number, y: number, age: number, scale: number, wide: boolean, reduced: boolean) {
  const t = age / (wide ? .4 : .26); if (t >= 1) return;
  const r = (wide ? 78 : 33) * scale * (reduced ? 1 : .8 + t * .4);
  c.save(); c.translate(x, y); c.rotate(reduced ? -.4 : -1 + t * 1.5); c.globalAlpha *= (1 - t) ** 1.2 * .9;
  c.beginPath(); c.arc(0, 0, r, -.95, 1.35); c.arc(-r * .16, r * .03, r * .93, 1.26, -.86, true); c.closePath();
  c.fillStyle = '#ffcf5a'; c.fill();
  c.beginPath(); c.arc(0, 0, r * .985, -.75, 1.15); c.arc(-r * .1, r * .02, r * .95, 1.08, -.68, true); c.closePath();
  c.fillStyle = '#fffbe8'; c.fill();
  c.restore();
}
export function render(c: CanvasRenderingContext2D, w: World, images: Images, height: number, en = false, reduced = false, lobbyTime = 0, quality: VisualQuality = 'high') {
  const h = height; const { floor, horizon, scale: actorScale } = stageLayout(h); const theme = BIOMES[w.biome];
  const low = quality === 'low', calm = reduced || low, age = w.time - w.phaseAt;
  c.clearRect(0, 0, 430, h);
  life.step(w, h, calm);
  memory.observe(w, lobbyTime);
  const heroX = w.heroX - w.cameraX, gates = portalsFor(w);
  const gateX = w.selected !== null ? w.portalX + portalOffset(w, w.selected) - w.cameraX : heroX;
  // Impacts shake and punch the camera, not the HUD. Both decay on the simulation clock.
  const kick = cameraKick(w, memory, calm), dive = w.phase === 'NEXT_ROOM' ? clamp01(age / .62) : 0;
  const shake = calm ? 0 : Math.min(.65, w.shake) + kick.jolt * .3, zoom = kick.zoom + (reduced ? 0 : dive * dive * .42);
  c.save(); c.translate(Math.sin(w.time * 71) * 5 * shake, Math.cos(w.time * 53) * 3.5 * shake);
  if (zoom > 0) { const fx = dive ? gateX : heroX + 60 * actorScale, fy = floor - 66 * actorScale; c.translate(fx, fy); c.scale(1 + zoom, 1 + zoom); c.translate(-fx, -fy); }
  drawBackdrop(c, w, images, h, life, calm);
  // The arch the party came through stays behind at its world address.
  if (w.phase !== 'PORTAL_CHOICE') focusPortal(-1);
  if (w.phase !== 'LOBBY') { c.save(); c.globalAlpha = .85; drawPortal(c, images, w.roomX + 96 - w.cameraX, floor - 22 * actorScale, theme.color, w.time, .86 * actorScale, {risk:1, biome:w.biome, beyond:w.route[w.route.length - 2], reduced}); c.restore(); }
  if (w.phase === 'RUN_RIGHT' && !w.runeCollected && w.heroX < runeX(w) + 60) {
    const x = runeX(w) - w.cameraX, y = floor - 96 * actorScale + Math.sin(w.time * 2.6) * 5;
    light(c, '#8fe9ff', x, y, 34, .7); pool(c, '#8fe9ff', x, floor, 42, 10, .4);
    c.save(); c.translate(x, y); c.rotate(w.time * 1.2); c.fillStyle = '#eaffff';
    c.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 4 : 12, a = i * Math.PI / 4; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.fill(); c.restore();
    if (!calm) for (let i = 0; i < 4; i++) { const a = w.time * 2.4 + i * 1.57; light(c, '#d8fbff', x + Math.cos(a) * 19, y + Math.sin(a) * 8, 3.5, .8); }
  }
  const isPortal = w.portalX > w.roomX && w.portalX - w.cameraX < 620;
  if (w.phase === 'LOBBY') drawPortal(c, images, 318, floor - 22 * actorScale, '#a485ff', lobbyTime, 1.25 * actorScale, {risk:3, biome:w.biome, beyond:'crystal', available:true, reduced});
  let gateLight = '';
  if (isPortal) {
    const since = (w.phase === 'NEXT_ROOM' ? 1.2 : 0) + age;
    gates.forEach((p, i) => {
      const x = w.portalX + portalOffset(w, i) - w.cameraX, picked = w.selected === i, other = w.selected !== null && !picked;
      const tone = w.rules === 2 ? DIFFICULTY[i].color : BIOMES[p.biome].color;
      if (picked || (w.selected === null && portalFocused(i))) gateLight = tone;
      c.save(); if (other) c.globalAlpha = reduced ? .38 : 1 - clamp01(since / .45) * .55;
      drawPortal(c, images, x, floor - 14 * actorScale, tone, w.time, 1.06 * actorScale, {risk:(w.rules === 2 ? i+1 : 2) as 1|2|3, biome:p.biome, beyond:p.biome, available:w.phase==='PORTAL_CHOICE', focused:portalFocused(i), selectedAge:picked ? since : null, rejectedAge:other ? since : null, stars:w.rules === 2 ? i + 1 : 0, heroDx:picked ? heroX - x : undefined, tall:1.22, reduced});
      if (w.rules !== 2) text(c, p.symbol, x, floor - 212 * actorScale, 22, tone);
      c.restore();
    });
    if (!gateLight && w.phase === 'PORTAL_CHOICE') gateLight = w.rules === 2 ? DIFFICULTY[1].color : theme.color;
  }
  const fading = w.phase === 'NEXT_ROOM' ? Math.max(0, 1 - age * 2) : 1;
  const followerY = [floor - 15 * actorScale, floor - 31 * actorScale];
  for (const i of [1, 0]) {
    const pose = w.followerHp[i] <= 0 ? 'death' : w.followerPose[i];
    const acted = Math.max(0, w.time - (w.followerUntil[i] - (pose === 'attack' ? .75 : pose === 'dodge' ? .45 : .4)));
    const target = w.enemies.find(e => e.id === w.followerTarget[i]);
    const travel = !i && pose === 'attack' && target ? Math.max(0, target.worldX - w.followerX[i] - 80) * Math.sin(Math.min(1, acted / .75) * Math.PI) : 0;
    const x = w.followerX[i] - w.cameraX + travel;
    party(c, images, i + 1, pose, x, followerY[i], (i ? 100 : 110) * actorScale, w.followerStride[i] / 15.5, fading, acted);
    if (w.followerHp[i] > 0) bar(c, x, followerY[i] - (i ? 92 : 98) * actorScale, 36, w.followerHp[i] / (i ? 220 : 260), i ? '#a0ef7c' : '#6accff');
    // The healer's projectile lands exactly when the scheduled damage is applied.
    if (i && target && w.followerImpact[i] > w.time) {
      const progress = Math.max(0, 1 - (w.followerImpact[i] - w.time) / .42);
      if (progress > 0) {
        const at = (k: number) => [x + (target.worldX - w.cameraX - x) * k, followerY[i] - 48 + (floor - 60 * actorScale - (followerY[i] - 48)) * k - Math.sin(k * Math.PI) * 30];
        for (let n = calm ? 0 : 4; n >= 0; n--) { const [px, py] = at(Math.max(0, progress - n * .045)); light(c, n ? '#9aff83' : '#e9ffcf', px, py, (n ? 9 - n * 1.4 : 11) * actorScale, n ? .5 - n * .08 : 1); }
        const [px, py] = at(progress); c.fillStyle = '#f4ffe2'; c.beginPath(); c.arc(px, py, 3.4 * actorScale, 0, 7); c.fill();
      }
    }
  }
  shadow(c, heroX, floor, 150 * actorScale, fading);
  if (gateLight) pool(c, gateLight, heroX + 8, floor + 1, 80 * actorScale, 15 * actorScale, .45);
  let blade: BladeSegment | undefined;
  const heroElapsed = Math.max(0, w.time - (w.pose === 'death' ? w.phaseAt : w.heroActionAt));
  const hero = (d: Ctx) => {
    if (w.wings !== 'none') {
      const wings = images.get(`assets/territory/cave/playtest/wings-${w.wings}.svg`);
      if (wings) { const beat = reduced ? 1 : 1 + Math.sin(w.time * (w.pose === 'run' ? 7 : 2.4)) * .045; d.save(); d.translate(heroX - 10 * actorScale, floor - 84 * actorScale); d.scale(beat, 2 - beat); d.drawImage(wings, -84 * actorScale, -80 * actorScale, 168 * actorScale, 118 * actorScale); d.restore(); }
    }
    drawHero(d, images, w.pose, heroElapsed, w.pose === 'run' ? w.distance / 11.5 : w.time, w.combo, heroX, floor, 176 * actorScale, reduced, w.rules === 2 ? segment => { blade = segment; } : undefined);
  };
  // The hero flashes red for the instant a blow actually lands on him.
  const wound = w.effects.find(f => f.kind === 'hit' && f.lane === 0 && f.text.startsWith('−') && Math.abs(f.x - w.heroX) < 1 && w.time - f.born < .14);
  c.save(); c.globalAlpha = fading;
  if (wound && !calm) flashDraw(c, heroX - 112 * actorScale, floor - 205 * actorScale, 236 * actorScale, 222 * actorScale, '#ff4a3d', (1 - (w.time - wound.born) / .14) * .62, hero); else hero(c);
  if (w.rules === 2) bladeTrail(c, w, blade, reduced, quality);
  c.restore();
  if (blade && !calm && w.pose === 'attack' && (w.heroImpact > w.time || w.cleaveImpact > w.time)) {
    // Anticipation: the edge gathers light until the exact frame of contact.
    const charge = clamp01(1 - ((w.cleaveImpact > w.time ? w.cleaveImpact : w.heroImpact) - w.time) / .3);
    light(c, '#fff3c2', blade.tip.x, blade.tip.y, (5 + charge * 13) * actorScale, .35 + charge * .6);
  }
  if (gateLight && !reduced) { c.save(); c.globalCompositeOperation = 'lighter'; light(c, gateLight, heroX + 14, floor - 78 * actorScale, 92 * actorScale, .16 + .05 * Math.sin(w.time * 3)); c.restore(); }
  if (w.shieldUntil > w.time) {
    const left = w.shieldUntil - w.time, pulse = reduced ? 1 : .8 + .2 * Math.sin(w.time * 9);
    c.save(); c.globalAlpha = Math.min(1, left * 3);
    light(c, '#7bcfff', heroX + 10, floor - 70 * actorScale, 92 * actorScale, .28 * pulse);
    c.strokeStyle = '#bfeaff'; c.lineWidth = 2.4; c.beginPath(); c.ellipse(heroX + 10, floor - 66 * actorScale, 56 * actorScale, 80 * actorScale, 0, 0, 7); c.stroke();
    c.strokeStyle = '#7bcfff'; c.lineWidth = 1; c.globalAlpha *= .7; c.beginPath(); c.ellipse(heroX + 10, floor - 66 * actorScale, 50 * actorScale, 73 * actorScale, 0, 0, 7); c.stroke();
    c.restore();
  }
  const atlas = images.get(ASSET_ROOT + 'cave-expedition/creatures.webp')!;
  for (const e of [...w.enemies].sort((a, b) => a.lane - b.lane)) {
    const isBoss = e.species === 'boss', dead = e.hp <= 0, fallen = w.time - e.deathAt;
    // The shell extends behind the boss's contact point. Ease that art anchor
    // inward as it approaches, keeping the full silhouette inside a narrow phone.
    const shellOffset = isBoss ? 25 * Math.max(0, Math.min(1, (300 - (e.worldX - w.heroX)) / 130)) : 0;
    const x = e.worldX - w.cameraX - shellOffset, y = floor + (e.lane - 1) * 7 * actorScale; const spec = CREATURES[e.species];
    if (x < -150 || x > 580) continue;
    const size = (isBoss ? (w.rules === 2 ? BOSS_SIZE : 206) : 136) * actorScale;
    const original = w.rules === 2 ? images.get(caveActorArt(e.species, w.floor)) : undefined;
    if (isBoss && w.rules === 2) { bossPresence(c, w, e, original, x, y, size, horizon, memory, reduced, low); telegraphFx(c, w, e, heroX, y, actorScale, reduced, low); bossTelegraph(c, w, e, x, y, heroX, actorScale, reduced, quality); }
    else if (isBoss && !dead) {
      c.save(); c.strokeStyle = theme.color; c.globalAlpha = .2 + w.bossPhase * .08; c.lineWidth = 2;
      c.beginPath(); c.ellipse(x, y - 80, 70 + w.bossPhase * 8, 98, 0, 0, Math.PI * 2); c.stroke();
      for (let rune = 0; rune < w.bossPhase * 3; rune++) { const a = rune * 2.4 + (reduced ? 0 : w.time * .3); c.fillStyle = theme.color; c.fillRect(x + Math.cos(a) * 85, y - 85 + Math.sin(a) * 90, 4, 7); } c.restore();
    }
    const flight = dead && !isBoss ? deathFlight(e, w.time, reduced) : null;
    const breathe = e.pose === 'idle' && !reduced ? 1 + Math.sin(w.time * 2.2 + e.id) * .018 : 1;
    const col = e.pose === 'run' ? 1 + Math.floor(w.time * 8) % 2 : e.pose === 'attack' ? 3 : e.pose === 'hit' ? 4 : e.pose === 'death' ? 5 : 0;
    if (!flight || fallen < .08) shadow(c, x, y, size, isBoss ? 1.25 : 1);
    // A hit may land during a pending enemy attack. Keep the windup and its
    // contact time intact, but still show directional armor recoil.
    const struck = dead ? undefined : [...w.effects].reverse().find(f => f.kind === 'impact' && f.lane === e.lane && Math.abs(f.x + 20 - e.worldX) < 22 && w.time - f.born < .16);
    // Foes flash white through the scratch surface; the large boss takes a cheap additive bloom instead.
    let flash = struck && !reduced && !isBoss ? Math.max(0, 1 - (w.time - struck.born) / .1) * .78 : 0, flashColor = '#ffffff';
    let bloom = struck && !reduced && isBoss ? Math.max(0, 1 - (w.time - struck.born) / .1) * .5 : 0;
    if (flight) flash = flight.white;
    if (isBoss && w.rules === 2 && !reduced) {
      const shift = w.time - memory.phaseAt;
      if (!dead && shift >= 0 && shift < .45) { flash = Math.max(flash, (1 - shift / .45) * .9); flashColor = PHASE_COLORS[w.bossPhase - 1]; }
      if (dead) bloom = .55 + .35 * Math.sin(fallen * 38);
    }
    let alpha = 1;
    if (dead) alpha = flight ? flight.alpha : isBoss && w.rules === 2 ? clamp01((1.08 - fallen) / .16) : Math.max(0, 1 - fallen / 1.4);
    else if (w.rules === 2 && isBoss && w.phase === 'BOSS') alpha = .45 + .55 * clamp01(age / .8);
    const body = (d: Ctx) => {
      if (w.rules !== 2 && e.pose === 'attack') { const duration = isBoss ? (e.heavy ? 1.45 : .95) : .5; const progress = Math.max(0, Math.min(1, 1 - (e.impact - w.time) / duration)); d.translate(e.impact > w.time ? 10 * Math.sin(progress * Math.PI) : -18 * Math.max(0, (e.poseUntil - w.time) / .3), 0); }
      if (flight) { const py = y - size * .45; d.translate(x + flight.dx * actorScale, py + flight.dy * actorScale); d.rotate(flight.turn); d.scale(flight.size, flight.size); d.translate(-x, -py); }
      else if (w.rules === 2 && !dead && !reduced) {
        if (struck && e.pose !== 'hit') d.translate(5 * (1 - (w.time - struck.born) / .16), 0);
        if (isBoss && w.bossPhase === 3) d.translate(Math.sin(w.time * 47) * 1.1, 0);
      }
      if (isBoss && dead && w.rules === 2 && !reduced) d.translate(Math.sin(w.time * 61) * 3, Math.cos(w.time * 47) * 1.5);
      if (w.rules === 2 && drawCaveActor(d, images, w, e, x, y, size, reduced)) {
        // Registered animation consumed only world state; legacy art remains below.
      } else if (original) {
        d.translate(x, y);
        if (!reduced) {
          if (e.pose === 'hit') d.translate(6, 0);
          if (e.pose === 'run') d.translate(0, -Math.abs(Math.sin(w.time * 9 + e.id)) * 3);
          if (e.pose === 'death') d.rotate(Math.min(.65, fallen * .9));
          if (e.pose === 'attack') d.rotate(-.05 * Math.sin(w.time * 5));
        }
        sprite(d, original, 0, 0, original.width, original.height, 0, 0, size, size * .94 * breathe);
      } else sprite(d, atlas, col * atlas.width / 6, spec.row * atlas.height / 4, atlas.width / 6, atlas.height / 4, x, y, size, size * .94 * breathe);
    };
    c.save(); c.globalAlpha = alpha;
    if (flash > .02 && !low) flashDraw(c, x - size * .8, y - size * (flight ? 2 : 1.2), size * (flight ? 2.4 : 1.6), size * (flight ? 2.2 : 1.35), flashColor, flash, body); else body(c);
    c.restore();
    if (bloom > .02 && !low) { c.save(); c.globalCompositeOperation = 'lighter'; light(c, '#fff1cf', x, y - size * .5, size * .52, bloom * alpha); c.restore(); }
    if (!dead && !isBoss) bar(c, x, y - size + 3, 50, e.hp / e.maxHp, '#ee6f7a');
    if (w.rules !== 2 && isBoss && !dead && e.impact > w.time) { c.fillStyle = '#f15d5d40'; c.fillRect(heroX - 40, floor - 6, 190, 10); }
  }
  if (w.rules === 2) electricCut(c, w, floor, actorScale, reduced, quality, blade);
  const master = w.enemies.find(e => e.species === 'boss');
  for (const e of w.enemies) if (e.hp <= 0 && e.species !== 'boss') deathFx(c, e, w.time, e.worldX - w.cameraX, floor + (e.lane - 1) * 7 * actorScale, actorScale, theme.color, reduced, low);
  if (master && master.hp > 0 && w.rules === 2) phaseShiftFx(c, w, memory, master.worldX - w.cameraX - 25, floor + (master.lane - 1) * 7 * actorScale, actorScale, reduced, low);
  if (memory.finale && w.rules === 2) bossFinale(c, memory.finaleAge(w, lobbyTime), memory.finale.x - w.cameraX - 25, floor + (memory.finale.lane - 1) * 7 * actorScale, actorScale, reduced, low);
  // One comic word at a time, and only for a blow that mattered.
  const worded = [...w.effects].reverse().find(f => f.kind === 'impact' && w.time - f.born < .62 && (killingBlow(w, f.born, f.lane) || (!!master && master.hp > 0 && Math.floor(f.born * 1.05) % 2 === 0)));
  for (const e of w.effects) {
    const since = w.time - e.born; const x = e.x - w.cameraX; const y = (e.lane < 0 ? followerY[-e.lane - 1] ?? floor : floor) - 92 * actorScale + Math.max(0, e.lane) * 9;
    const seed = e.born * 37.7 + e.x * .013 + e.lane;
    c.save();
    if (e.kind === 'impact') {
      const kill = killingBlow(w, e.born, e.lane);
      impactFx(c, x, y + 38, floor + (e.lane - 1) * 7 * actorScale, since, actorScale, seed, kill ? 1 : .4, theme.color, reduced, low);
      if (e === worded) comicWord(c, WORDS[en ? 'en' : 'ru'][Math.floor(hash(seed) * 3)], Math.max(64, Math.min(366, x - 26 * actorScale)), y - 74 * actorScale, since, actorScale, seed, reduced);
    }
    else if (e.kind === 'heal') {
      c.globalAlpha = 1 - since; pool(c, '#8df3ab', heroX, floor, (60 + since * 70) * actorScale, (13 + since * 12) * actorScale, .8);
      c.strokeStyle = '#8df3ab'; c.lineWidth = 2; c.beginPath(); c.ellipse(heroX, floor, 22 + since * 60, 8 + since * 14, 0, 0, 7); c.stroke();
      if (!reduced) burst(c, seed, since, heroX, floor - 10, { n: low ? 6 : 12, speed: 150, angle: -Math.PI / 2, spread: 1.5, gravity: -60, life: 1, size: 4, colors: ['#a4ffd1', '#e2ffe9', '#6fe59a'], shape: 'star', drag: 1.4 }, actorScale);
      c.globalAlpha = 1; floatText(c, e.text, heroX, floor - 150 * actorScale, since, actorScale, 'heal', seed, reduced);
    }
    else if (e.kind === 'slash') { const wide = e.lane === 0 && Math.abs(e.x - 70 - w.heroX) < 60 && !w.enemies.some(f => Math.abs(f.worldX - 25 - e.x) < 2); slashFx(c, x + (wide ? 0 : 20 * actorScale), y + 25, since, actorScale, wide, reduced);
      // Afterglow of the arc on a blow carried across a real gap.
      if (w.rules === 2 && !wide && since < .12 && blade && e.x + 25 - w.heroX >= BLADE_REACH + 34) bolt(c, blade.tip.x, blade.tip.y, x + 6 * actorScale, floor - 55 * actorScale + (e.lane - 1) * 7 * actorScale, 1, w.time, seed, actorScale, reduced, quality, 1 - since / .12);
    }
    else if (e.kind === 'shock') slamFx(c, x, floor, since, e.lane, actorScale, !!master?.heavy, reduced, low);
    else if (e.text === '!') {
      const pop = reduced ? 1 : easeBack(since / .16); c.globalAlpha = Math.min(1, 2.4 - since * 2.4);
      comicText(c, '!', x, y - 42 * actorScale, 30 * actorScale * pop, '#ffd15c', '#2a1608');
    }
    else {
      const taken = e.text.startsWith('−'), label = e.text === 'dodge' ? (en ? 'EVADE' : 'УКЛОН') : e.text === 'ward' ? (en ? 'WARD' : 'ЩИТ') : e.text === 'block' ? (en ? 'BLOCK' : 'БЛОК') : e.text;
      const dealt = e.kind === 'hit' && !taken && e.lane >= 0;
      const tone: NumberTone = e.kind === 'energy' ? 'info' : e.kind === 'block' || e.kind === 'dodge' ? 'guard' : taken ? 'take' : dealt && killingBlow(w, e.born, e.lane) ? 'big' : dealt ? 'deal' : 'info';
      floatText(c, label, x + (dealt ? 26 * actorScale : 0), y - (dealt ? 22 : e.lane < 0 ? 4 : 52) * actorScale, since, actorScale, tone, seed, reduced);
    }
    c.restore();
  }
  drawForeground(c, w, h, life, calm, images);
  c.restore();
  // Screen space: theatre that frames the fight without moving with the camera.
  const struckHero = w.effects.find(f => f.kind === 'hit' && f.lane === 0 && f.text.startsWith('−') && w.time - f.born < .4);
  if (struckHero && !reduced) {
    const edge = c.createRadialGradient(215, h * .55, h * .3, 215, h * .55, h * .8); edge.addColorStop(0, '#ff2a2a00'); edge.addColorStop(1, '#ff2a2a');
    c.globalAlpha = (1 - (w.time - struckHero.born) / .4) * Math.min(.5, .12 + Number(struckHero.text.slice(1)) / Math.max(1, w.maxHp) * 2.4); c.fillStyle = edge; c.fillRect(0, 0, 430, h); c.globalAlpha = 1;
  }
  if (w.rules === 2) { bossScreen(c, w, memory, h, en, reduced); endingScreen(c, w, memory, lobbyTime, h, heroX, floor, reduced, low); }
  // A new district announces itself the moment the party steps out of the gate.
  const arrived = w.rules === 2 && w.stars.length > 0 && w.wave === 0 && !w.bossSpawned ? (w.phase === 'ENTER' ? age : w.phase === 'RUN_RIGHT' && w.enemies.length ? .65 + age : -1) : -1;
  if (arrived >= .25) districtCard(c, en ? BIOME_EN[w.biome] : theme.name, `${en ? 'SECTION' : 'УЧАСТОК'} ${w.stars.length}/4 · ${'★'.repeat(w.stars[w.stars.length - 1] ?? 1)}`, arrived - .25, h, theme.color, reduced);
  // Stepping through an arch: light rushes past, then the next vault opens like an eye.
  if (w.phase === 'NEXT_ROOM') portalDive(c, clamp01(age / .6), gateX, floor - 66 * actorScale, h, w.selected !== null ? BIOMES[gates[w.selected].biome].color : theme.color, w.time, reduced);
  else if (w.phase === 'ENTER') irisOpen(c, clamp01(age / .65), w.roomX + 96 - w.cameraX, floor - 70 * actorScale, h, theme.color, reduced);
  else if (w.rules === 2 && w.phase === 'RUN_RIGHT' && !w.stars.length && w.time < .7) irisOpen(c, clamp01(w.time / .7), heroX, floor - 70 * actorScale, h, theme.color, reduced);
}
