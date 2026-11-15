import { portalsFor, portalOffset, DIFFICULTY } from '../../../game/cavePreviewWorld/engine';
import { drawHero, HERO_PARTS } from './heroRig';
import { CaveLife, drawBackdrop, drawForeground, light, stageLayout } from './world';
import { BIOMES, CREATURES } from '../../../game/cavePreviewWorld/catalog';
import type { World, Pose } from '../../../game/cavePreviewWorld/engine';
export const ASSET_ROOT = 'assets/territory/';
export const PARTY = ['heroes/male_viking', 'followers/northern_warrior', 'followers/forest_healer'];
export const POSES = ['idle', 'attack', 'hit', 'block', 'dodge', 'death'] as const;
/** Canvas art plus every HUD picture, so the portable build embeds one complete set. */
export function assetPaths() {
  return ['cave-expedition/creatures.webp', 'cave-expedition/chambers.webp', 'cave-expedition/biomes.webp', 'cave-expedition/party-run.webp', 'cave-expedition/crystal-chamber.webp', 'ui/wooden-plaque.webp',
    ...['astral','ember'].map(id => `cave/playtest/wings-${id}.svg`),
    ...['potion-mana', 'potion-fire', 'potion-green'].map(id => `ui/items/${id}.webp`),
    ...HERO_PARTS.map(part => `combat2d/male_viking/${part}.webp`),
    ...PARTY.flatMap(p => POSES.map(s => `characters/${p}/${s}.webp`))].map(p => ASSET_ROOT + p)
    .concat(['nav-city.webp','nav-inventory.webp','nav-hero-crown.webp','nav-battle.webp','nav-map-parchment.webp','nav-games.webp','nav-clan.webp',
      'ic-honor.webp', 'ic-blessing.webp', 'ic-settings.webp', 'blue-gem.webp', 'potion-hp-viking.webp', 'potion-hp-large-viking.webp', 'elixir-defense-viking.webp', 'potion-time-viking.webp']);
}
export type Images = Map<string, HTMLImageElement>;
export async function loadImages(resolve: (s: string) => string): Promise<Images> {
  const images: Images = new Map();
  await Promise.all(assetPaths().map(path => new Promise<void>((ok, fail) => {
    const img = new Image(); img.onload = () => { images.set(path, img); ok(); }; img.onerror = () => fail(new Error(`Не удалось загрузить ${path}`)); img.src = resolve(path);
  })));
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
    if (path.includes('characters/') || cols > 1) for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) foot(img, col * img.width / cols, row * img.height / rows, img.width / cols, img.height / rows);
  }
  return images;
}
function text(c: CanvasRenderingContext2D, value: string, x: number, y: number, size = 16, color = '#fff2c6') {
  c.fillStyle = color; c.font = `bold ${size}px system-ui`; c.textAlign = 'center'; c.shadowColor = '#050a12'; c.shadowBlur = 4; c.fillText(value, x, y); c.shadowBlur = 0;
}
export function portal(c: CanvasRenderingContext2D, x: number, y: number, color: string, t: number, size = 1) {
  c.save(); c.translate(x, y); c.scale(size, size);
  c.shadowColor = color; c.shadowBlur = 18;
  const glow = c.createRadialGradient(0, -53, 5, 0, -53, 58); glow.addColorStop(0, '#f5edff'); glow.addColorStop(.2, color); glow.addColorStop(1, '#080c2180');
  c.fillStyle = glow; c.beginPath(); c.ellipse(0, -50, 34, 57, 0, 0, Math.PI * 2); c.fill();
  c.shadowBlur = 0; c.strokeStyle = '#302d38'; c.lineWidth = 13; c.beginPath(); c.ellipse(0, -50, 39, 61, 0, Math.PI, Math.PI * 2); c.lineTo(39, 0); c.moveTo(-39, -50); c.lineTo(-39, 0); c.stroke();
  c.strokeStyle = '#b99662'; c.lineWidth = 3; c.beginPath(); c.ellipse(0, -50, 39, 61, 0, Math.PI, Math.PI * 2); c.stroke();
  for (let i = 0; i < 9; i++) { const a = t * 1.3 + i * .7; c.fillStyle = color; c.fillRect(Math.cos(a) * 28 - 1, -50 + Math.sin(a) * 47, 3, 5); }
  c.restore();
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
function sprite(c: CanvasRenderingContext2D, img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, x: number, y: number, maxWidth: number, maxHeight: number) {
  const b = frameBounds(img, sx, sy, sw, sh), scale = Math.min(maxWidth / b.width, maxHeight / b.height);
  c.drawImage(img, sx + b.x, sy + b.y, b.width, b.height, x - b.width * scale / 2, y - b.height * scale, b.width * scale, b.height * scale);
}
function shadow(c: CanvasRenderingContext2D, x: number, y: number, size: number) {
  c.fillStyle = '#02070b70'; c.beginPath(); c.ellipse(x, y + 2, size * .28, 5, 0, 0, 7); c.fill();
}
function party(c: CanvasRenderingContext2D, images: Images, index: number, pose: Pose, x: number, y: number, size: number, time: number, fade = 1, actionAge = 0) {
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
/** World X of the spark waiting on the first stretch of every chamber. */
export const runeX = (w: World) => w.roomX + 455;
export function render(c: CanvasRenderingContext2D, w: World, images: Images, height: number, en = false, reduced = false) {
  const h = height; const { floor, scale: actorScale } = stageLayout(h); const theme = BIOMES[w.biome];
  c.clearRect(0, 0, 430, h);
  life.step(w, h, reduced);
  // Impacts shake the camera, not the HUD. The offset decays on the simulation clock.
  const shake = reduced ? 0 : w.shake;
  c.save(); c.translate(Math.sin(w.time * 71) * 5 * shake, Math.cos(w.time * 53) * 3.5 * shake);
  drawBackdrop(c, w, images, h, life, reduced);
  // The arch the party came through stays behind at its world address.
  if (w.phase !== 'LOBBY') { c.save(); c.globalAlpha = .9; portal(c, w.roomX + 96 - w.cameraX, floor - 22 * actorScale, theme.color, w.time, .86 * actorScale); c.restore(); }
  if (w.phase === 'RUN_RIGHT' && !w.runeCollected && w.heroX < runeX(w) + 60) {
    const x = runeX(w) - w.cameraX, y = floor - 96 * actorScale + Math.sin(w.time * 2.6) * 5;
    light(c, '#8fe9ff', x, y, 34, .7); light(c, '#8fe9ff', x, floor, 30, .25);
    c.save(); c.translate(x, y); c.rotate(w.time * 1.2); c.fillStyle = '#eaffff';
    c.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 4 : 12, a = i * Math.PI / 4; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.fill(); c.restore();
  }
  const isPortal = w.portalX > w.roomX && w.portalX - w.cameraX < 620;
  if (w.phase === 'LOBBY') portal(c, 318, floor - 22 * actorScale, '#a485ff', performance.now() / 1000, 1.25 * actorScale);
  if (isPortal) {
    portalsFor(w).forEach((p, i) => {
      const x = w.portalX + portalOffset(w, i) - w.cameraX;
      c.save(); c.globalAlpha = w.selected !== null && w.selected !== i ? .38 : 1;
      portal(c, x, floor - 14 * actorScale, (w.rules === 2 ? DIFFICULTY[i].color : BIOMES[p.biome].color), w.time, (w.selected === i ? 1.08 : .98) * actorScale);
      text(c, w.rules === 2 ? '★'.repeat(i + 1) : p.symbol, x, floor - 150 * actorScale, 22, (w.rules === 2 ? DIFFICULTY[i].color : BIOMES[p.biome].color)); c.restore();
    });
  }
  const heroX = w.heroX - w.cameraX;
  const fading = w.phase === 'NEXT_ROOM' ? Math.max(0, 1 - (w.time - w.phaseAt) * 2) : 1;
  const followerY = [floor - 15 * actorScale, floor - 31 * actorScale];
  for (const i of [1, 0]) {
    const pose = w.followerHp[i] <= 0 ? 'death' : w.followerPose[i];
    const age = Math.max(0, w.time - (w.followerUntil[i] - (pose === 'attack' ? .75 : pose === 'dodge' ? .45 : .4)));
    const target = w.enemies.find(e => e.id === w.followerTarget[i]);
    const travel = !i && pose === 'attack' && target ? Math.max(0, target.worldX - w.followerX[i] - 80) * Math.sin(Math.min(1, age / .75) * Math.PI) : 0;
    const x = w.followerX[i] - w.cameraX + travel;
    party(c, images, i + 1, pose, x, followerY[i], (i ? 100 : 110) * actorScale, w.followerStride[i] / 15.5, fading, age);
    if (w.followerHp[i] > 0) {
      const barY = followerY[i] - (i ? 92 : 98) * actorScale;
      c.fillStyle = '#07121bcc'; c.fillRect(x - 19, barY, 38, 4);
      c.fillStyle = i ? '#a0ef7c' : '#6accff'; c.fillRect(x - 19, barY, 38 * w.followerHp[i] / (i ? 220 : 260), 4);
    }
    // The healer's projectile lands exactly when the scheduled damage is applied.
    if (i && target && w.followerImpact[i] > w.time) {
      const progress = Math.max(0, 1 - (w.followerImpact[i] - w.time) / .42);
      if (progress > 0) {
        const px = x + (target.worldX - w.cameraX - x) * progress, py = followerY[i] - 48 + (floor - 60 * actorScale - (followerY[i] - 48)) * progress - Math.sin(progress * Math.PI) * 30;
        c.save(); c.shadowColor = '#9aff83'; c.shadowBlur = 12; c.fillStyle = '#e2ffbd';
        c.beginPath(); c.arc(px, py, 5, 0, 7); c.fill(); c.restore();
      }
    }
  }
  shadow(c, heroX, floor, 150 * actorScale);
  c.save(); c.globalAlpha = fading;
  if (w.wings !== 'none') {
    const wings = images.get(`assets/territory/cave/playtest/wings-${w.wings}.svg`);
    if (wings) { const beat = reduced ? 1 : 1 + Math.sin(w.time * (w.pose === 'run' ? 7 : 2.4)) * .045; c.save(); c.translate(heroX - 10 * actorScale, floor - 84 * actorScale); c.scale(beat, 2 - beat); c.drawImage(wings, -84 * actorScale, -80 * actorScale, 168 * actorScale, 118 * actorScale); c.restore(); }
  }
  drawHero(c, images, w.pose, Math.max(0, w.time - (w.pose === 'death' ? w.phaseAt : w.heroActionAt)), w.pose === 'run' ? w.distance / 11.5 : w.time, w.combo, heroX, floor, 176 * actorScale, reduced);
  c.restore();
  if (w.shieldUntil > w.time) {
    c.save(); c.strokeStyle = '#7bcfff'; c.lineWidth = 2; c.shadowColor = '#84ddff'; c.shadowBlur = 10;
    c.beginPath(); c.ellipse(heroX + 10, floor - 62 * actorScale, 54 * actorScale, 76 * actorScale, 0, 0, 7); c.stroke(); c.restore();
  }
  const atlas = images.get(ASSET_ROOT + 'cave-expedition/creatures.webp')!;
  for (const e of [...w.enemies].sort((a, b) => a.lane - b.lane)) {
    // The shell extends behind the boss's contact point. Ease that art anchor
    // inward as it approaches, keeping the full silhouette inside a narrow phone.
    const shellOffset = e.species === 'boss' ? 25 * Math.max(0, Math.min(1, (300 - (e.worldX - w.heroX)) / 130)) : 0;
    const x = e.worldX - w.cameraX - shellOffset, y = floor + (e.lane - 1) * 7 * actorScale; const spec = CREATURES[e.species];
    if (x < -150 || x > 580) continue;
    const size = (e.species === 'boss' ? 196 : 116) * actorScale;
    if (e.species === 'boss' && e.hp > 0) {
      c.save(); c.strokeStyle = theme.color; c.globalAlpha = .2 + w.bossPhase * .08; c.lineWidth = 2;
      c.beginPath(); c.ellipse(x, y - 80, 70 + w.bossPhase * 8, 98, 0, 0, Math.PI * 2); c.stroke();
      for (let rune = 0; rune < w.bossPhase * 3; rune++) { const a = rune * 2.4 + (reduced ? 0 : w.time * .3); c.fillStyle = theme.color; c.fillRect(x + Math.cos(a) * 85, y - 85 + Math.sin(a) * 90, 4, 7); } c.restore();
    }
    const breathe = e.pose === 'idle' && !reduced ? 1 + Math.sin(w.time * 2.2 + e.id) * .018 : 1;
    const col = e.pose === 'run' ? 1 + Math.floor(w.time * 8) % 2 : e.pose === 'attack' ? 3 : e.pose === 'hit' ? 4 : e.pose === 'death' ? 5 : 0;
    shadow(c, x, y, size); c.save(); if (e.pose === 'attack') { const duration = e.species === 'boss' ? (e.heavy ? 1.45 : .95) : .5; const progress = Math.max(0, Math.min(1, 1 - (e.impact - w.time) / duration)); c.translate(e.impact > w.time ? 10 * Math.sin(progress * Math.PI) : -18 * Math.max(0, (e.poseUntil - w.time) / .3), 0); } if (!e.hp) c.globalAlpha = Math.max(0, 1 - (w.time - e.deathAt) / 1.4);
    sprite(c, atlas, col * atlas.width / 6, spec.row * atlas.height / 4, atlas.width / 6, atlas.height / 4, x, y, size, size * .94 * breathe);
    c.restore();
    if (e.hp > 0 && e.species !== 'boss') { c.fillStyle = '#0a0e15'; c.fillRect(x - 26, y - size + 4, 52, 5); c.fillStyle = '#ee6f7a'; c.fillRect(x - 26, y - size + 4, 52 * e.hp / e.maxHp, 5); }
    if (e.species === 'boss' && e.hp > 0 && e.impact > w.time) {  c.fillStyle = '#f15d5d40'; c.fillRect(heroX - 40, floor - 6, 190, 10); }
  }
  for (const e of w.effects) {
    const age = w.time - e.born; const x = e.x - w.cameraX; const y = (e.lane < 0 ? followerY[-e.lane - 1] ?? floor : floor) - 92 * actorScale + Math.max(0, e.lane) * 9;
    c.save(); c.globalAlpha = 1 - age;
    if (e.kind === 'impact') {
      const life = Math.min(1, age / .28); c.globalAlpha = 1 - life;
      c.strokeStyle = '#ffe8af'; c.lineWidth = 2;
      for (let ray = 0; ray < 7; ray++) { const a = ray * .9; c.beginPath(); c.moveTo(x + Math.cos(a) * 5, y + 38 + Math.sin(a) * 5); c.lineTo(x + Math.cos(a) * (12 + life * 24), y + 38 + Math.sin(a) * (12 + life * 24)); c.stroke(); }
      if (w.combo === 0 && age < .24) {
        c.translate(x, y - 22 - age * 28); c.rotate(-.12);
        text(c, en ? 'CRASH!' : 'ХРЯСЬ!', 0, 0, 23 + Math.sin(life * Math.PI) * 5, '#ffdb83');
      }
    }
    else if (e.kind === 'heal') {
      c.strokeStyle = '#8df3ab'; c.lineWidth = 2; c.beginPath(); c.ellipse(heroX, floor, 22 + age * 60, 8 + age * 14, 0, 0, 7); c.stroke();
      for (let p = 0; p < 5; p++) { const px = heroX - 45 + p * 23, py = floor - age * 110 - (p % 2) * 24; text(c, '+', px, py, 20, '#a4ffd1'); }
      text(c, e.text, heroX, floor - 170 - age * 30, 19, '#a4ffd1');
    }
    else if (e.kind === 'slash') { c.translate(x, y + 25); c.rotate(-.8 + age * 3); c.strokeStyle = '#fff0ad'; c.lineWidth = 7 * (1 - age); c.shadowColor = '#f9b658'; c.shadowBlur = 16; c.beginPath(); c.arc(0, 0, 40 + age * 25, -.8, 1.4); c.stroke(); }
    else if (e.kind === 'shock') {
      if (e.lane >= 2) { c.strokeStyle = theme.color; c.lineWidth = 3 * (1 - age); for (let crack = 0; crack < 5; crack++) { const px = x - 150 + crack * 65; c.beginPath(); c.moveTo(px, floor); c.lineTo(px + 20, floor - age * 60); c.lineTo(px + 10, floor - age * 90); c.stroke(); if (e.lane === 3) { c.fillStyle = theme.color; c.beginPath(); c.moveTo(px - 5, floor - 160 + age * 150); c.lineTo(px + 5, floor - 160 + age * 150); c.lineTo(px, floor - 142 + age * 150); c.fill(); } } }
      c.strokeStyle = '#f2a0ff'; c.lineWidth = 8 * (1 - age); c.beginPath(); c.ellipse(x, floor, age * 220, age * 38, 0, 0, 7); c.stroke(); }
    else if (e.text === '!') { c.globalAlpha = Math.min(1, 2.4 - age * 2.4); text(c, '!', x, y - 26 * actorScale - Math.sin(Math.min(1, age * 5) * Math.PI / 2) * 12, 30, '#ffd15c'); }
    else text(c, e.text === 'dodge' ? (en ? 'EVADE' : 'УКЛОН') : e.text === 'ward' ? (en ? 'WARD' : 'ЩИТ') : e.text === 'block' ? (en ? 'BLOCK' : 'БЛОК') : e.text, x, y - age * 46, 16, e.kind === 'energy' ? '#9eeaff' : e.kind === 'block' ? '#8fdcff' : '#ffe9be');
    c.restore();
  }
  drawForeground(c, w, h, life, reduced);
  c.restore();
  // Stepping through an arch: the chosen light floods the screen, then the next vault opens.
  if (w.phase === 'ENTER' || w.phase === 'NEXT_ROOM') {
    const k = w.phase === 'ENTER' ? Math.max(0, 1 - (w.time - w.phaseAt) / .65) : Math.min(1, (w.time - w.phaseAt) / .6);
    const tone = w.phase === 'NEXT_ROOM' && w.selected !== null ? BIOMES[portalsFor(w)[w.selected].biome].color : theme.color;
    c.fillStyle = `rgba(8,5,20,${k})`; c.fillRect(0, 0, 430, h);
    c.globalAlpha = k * .55; light(c, tone, w.phase === 'ENTER' ? w.roomX + 96 - w.cameraX : w.heroX - w.cameraX, floor - 70, 120 + k * 420, 1); c.globalAlpha = 1;
  }
}
