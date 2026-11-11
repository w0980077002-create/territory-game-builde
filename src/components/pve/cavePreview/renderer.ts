import { drawHero, HERO_PARTS } from './heroRig';
import { BIOMES, CREATURES, PORTALS } from '../../../game/cavePreviewWorld/catalog';
import type { World, Pose } from '../../../game/cavePreviewWorld/engine';
export const ASSET_ROOT = 'assets/territory/';
export const PARTY = ['heroes/male_viking', 'followers/northern_warrior', 'followers/forest_healer'];
export const POSES = ['idle', 'attack', 'hit', 'block', 'dodge', 'death'] as const;
export function assetPaths() {
  return ['cave-expedition/creatures.webp', 'cave-expedition/chambers.webp', 'cave-expedition/biomes.webp', 'cave-expedition/party-run.webp', 'cave-expedition/crystal-chamber.webp', 'ui/wooden-plaque.webp',
    ...HERO_PARTS.map(part => `combat2d/male_viking/${part}.webp`),
    ...PARTY.flatMap(p => POSES.map(s => `characters/${p}/${s}.webp`)),
    ...['01-shadow-amulet', '02-void-axe', '04-azure-crystal'].map(p => `cave-loot/2026-11-06/${p}.webp`)].map(p => ASSET_ROOT + p);
}
export type Images = Map<string, HTMLImageElement>;
export async function loadImages(resolve: (s: string) => string): Promise<Images> {
  const images: Images = new Map();
  await Promise.all(assetPaths().map(path => new Promise<void>((ok, fail) => {
    const img = new Image(); img.onload = () => { images.set(path, img); ok(); }; img.onerror = () => fail(new Error(`Не удалось загрузить ${path}`)); img.src = resolve(path);
  })));
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
export function render(c: CanvasRenderingContext2D, w: World, images: Images, height: number, en = false, reduced = false) {
  const h = height; const floor = h * .77; const theme = BIOMES[w.biome];
  const actorScale = Math.min(1, h / 400);
  c.clearRect(0, 0, 430, h); c.fillStyle = theme.sky; c.fillRect(0, 0, 430, h);
  const chamber = images.get(ASSET_ROOT + (w.biome === 'crystal' ? 'cave-expedition/crystal-chamber.webp' : 'cave-expedition/chambers.webp'))!;
  const panel = { crystal: 0, spore: 0, ember: 1, astral: 2, forge: 3 }[w.biome];
  const sw = w.biome === 'crystal' ? chamber.width : chamber.width / 2;
  const sh = w.biome === 'crystal' ? chamber.height : chamber.height / 2;
  const scale = Math.max(480 / sw, (h + 30) / sh), width = sw * scale, paintedHeight = sh * scale;
  // Portrait paintings retain scale, broad floors and full room architecture.
  if (h < 360) {
    // Wide orientation uses the original wide art; do not crop to a bare portrait floor.
    const wide = images.get(ASSET_ROOT + 'cave-expedition/biomes.webp')!;
    const dw = Math.max(430, h * 2), dh = dw / 2;
    c.drawImage(wide, theme.art % 2 * wide.width / 2, Math.floor(theme.art / 2) * wide.height / 2, wide.width / 2, wide.height / 2, (430 - dw) / 2, h - dh, dw, dh);
  } else c.drawImage(chamber, (panel % 2) * sw, Math.floor(panel / 2) * sh, sw, sh, (430 - width) / 2 - Math.sin(w.cameraX / 450) * 18, h - paintedHeight, width, paintedHeight);
  const edge = c.createLinearGradient(0, floor + 35, 0, h);
  edge.addColorStop(0, '#07121a00'); edge.addColorStop(1, '#070d1466');
  c.fillStyle = edge; c.fillRect(0, floor + 35, 430, h - floor);
  for (let i = 0; i < (reduced ? 8 : 22); i++) {
    const x = ((i * 67.3 - w.cameraX * .4 + Math.sin(w.time * .4 + i) * 15) % 460 + 460) % 460;
    c.globalAlpha = .15 + (Math.sin((reduced ? 0 : w.time * 2) + i) + 1) * .17; c.fillStyle = theme.color;
    const py = 50 + (i * 43.1) % Math.max(60, floor - 60);
    if (w.biome === 'astral') { c.fillRect(x - 2, py, 5, 1); c.fillRect(x, py - 2, 1, 5); }
    else if (w.biome === 'ember' || w.biome === 'forge') { c.fillRect(x, py - (w.time * (i % 3 + 8)) % 35, 1.5, 4); }
    else { c.beginPath(); c.arc(x, py, w.biome === 'spore' ? 2.5 : i % 3 === 0 ? 2 : 1, 0, 7); c.fill(); }
  } c.globalAlpha = 1;
  if (!reduced && w.pose === 'run') {
    for (let i = 0; i < 5; i++) {
      const age = (w.time * 3 + i * .2) % 1;
      c.globalAlpha = (1 - age) * .16; c.fillStyle = '#cad5ce';
      c.beginPath(); c.ellipse(w.heroX - w.cameraX - age * 30, floor + 3 - age * 6, 3 + age * 9, 2 + age * 3, 0, 0, 7); c.fill();
    } c.globalAlpha = 1;
  }
  const isPortal = ['PORTAL_CHOICE', 'PORTAL_ENTER', 'NEXT_ROOM'].includes(w.phase);
  if (w.phase === 'LOBBY') { portal(c, 275, floor - 10, '#a485ff', performance.now() / 1000, 1.7); text(c, en ? 'DARK CAVE' : 'ТЁМНАЯ ПЕЩЕРА', 215, 47, 23); text(c, en ? 'One journey. Two choices. Three rooms.' : 'Один путь. Две развилки. Три комнаты.', 215, 73, 13); }
  if (isPortal) {
    PORTALS[Math.min(w.room, 1)].forEach((p, i) => {
      const x = w.portalX + i * 112 - w.cameraX;
      c.save(); c.globalAlpha = w.selected !== null && w.selected !== i ? .38 : 1;
      portal(c, x, floor, BIOMES[p.biome].color, w.time, w.selected === i ? 1.02 : .92);
      text(c, p.symbol, x, floor - 130, 25, BIOMES[p.biome].color); c.restore();
    });
  }
  const heroX = w.heroX - w.cameraX;
  const fading = w.phase === 'NEXT_ROOM' ? Math.max(0, 1 - (w.time - w.phaseAt) * 2) : 1;
  const moving = ['RUN_RIGHT', 'CLEAR', 'PORTAL_ENTER'].includes(w.phase);
  const followerY = [floor - 24 * actorScale, floor - 60 * actorScale];
  for (const i of [1, 0]) {
    const pose = w.followerHp[i] <= 0 ? 'death' : moving ? 'run' : w.followerPose[i];
    const age = Math.max(0, w.time - (w.followerUntil[i] - (pose === 'attack' ? .75 : pose === 'dodge' ? .45 : .4)));
    const target = w.enemies.find(e => e.id === w.followerTarget[i]);
    const travel = !i && pose === 'attack' && target ? Math.max(0, target.worldX - w.followerX[i] - 80) * Math.sin(Math.min(1, age / .75) * Math.PI) : 0;
    const x = w.followerX[i] - w.cameraX + travel;
    party(c, images, i + 1, pose, x, followerY[i], (i ? 118 : 132) * actorScale, w.time, fading, age);
    if (w.followerHp[i] > 0) {
      const barY = followerY[i] - (i ? 93 : 83) * actorScale;
      c.fillStyle = '#07121bcc'; c.fillRect(x - 19, barY, 38, 4);
      c.fillStyle = i ? '#a0ef7c' : '#6accff'; c.fillRect(x - 19, barY, 38 * w.followerHp[i] / (i ? 220 : 260), 4);
    }
    // The healer's projectile lands exactly when the scheduled damage is applied.
    if (i && target && w.followerImpact[i] > w.time) {
      const progress = Math.max(0, 1 - (w.followerImpact[i] - w.time) / .42);
      if (progress > 0) {
        const px = x + (target.worldX - w.cameraX - x) * progress, py = followerY[i] - 48 + (floor - 70 - (followerY[i] - 48)) * progress - Math.sin(progress * Math.PI) * 30;
        c.save(); c.shadowColor = '#9aff83'; c.shadowBlur = 12; c.fillStyle = '#e2ffbd';
        c.beginPath(); c.arc(px, py, 5, 0, 7); c.fill(); c.restore();
      }
    }
  }
  shadow(c, heroX, floor, 160);
  c.save(); c.globalAlpha = fading;
  drawHero(c, images, w.pose, Math.max(0, w.time - (w.pose === 'death' ? w.phaseAt : w.heroActionAt)), w.time, w.combo, heroX, floor, 220 * actorScale, reduced);
  c.restore();
  if (w.shieldUntil > w.time) {
    c.save(); c.strokeStyle = '#7bcfff'; c.lineWidth = 2; c.shadowColor = '#84ddff'; c.shadowBlur = 10;
    c.beginPath(); c.ellipse(heroX + 14, floor - 71, 61, 88, 0, 0, 7); c.stroke(); c.restore();
  }
  const atlas = images.get(ASSET_ROOT + 'cave-expedition/creatures.webp')!;
  for (const e of [...w.enemies].sort((a, b) => a.lane - b.lane)) {
    // The shell extends behind the boss's contact point. Ease that art anchor
    // inward as it approaches, keeping the full silhouette inside a narrow phone.
    const shellOffset = e.species === 'boss' ? 25 * Math.max(0, Math.min(1, (300 - (e.worldX - w.heroX)) / 130)) : 0;
    const x = e.worldX - w.cameraX - shellOffset, y = floor; const spec = CREATURES[e.species];
    const size = (e.species === 'boss' ? 212 : 133) * actorScale;
    if (e.species === 'boss' && e.hp > 0) {
      c.save(); c.strokeStyle = theme.color; c.globalAlpha = .2 + w.bossPhase * .08; c.lineWidth = 2;
      c.beginPath(); c.ellipse(x, y - 80, 70 + w.bossPhase * 8, 98, 0, 0, Math.PI * 2); c.stroke();
      for (let rune = 0; rune < w.bossPhase * 3; rune++) { const a = rune * 2.4 + (reduced ? 0 : w.time * .3); c.fillStyle = theme.color; c.fillRect(x + Math.cos(a) * 85, y - 85 + Math.sin(a) * 90, 4, 7); } c.restore();
    }
    const col = e.pose === 'run' ? 1 + Math.floor(w.time * 8) % 2 : e.pose === 'attack' ? 3 : e.pose === 'hit' ? 4 : e.pose === 'death' ? 5 : 0;
    shadow(c, x, y, size); c.save(); if (e.pose === 'attack') { const duration = e.species === 'boss' ? (e.heavy ? 1.45 : .95) : .5; const progress = Math.max(0, Math.min(1, 1 - (e.impact - w.time) / duration)); c.translate(e.impact > w.time ? 10 * Math.sin(progress * Math.PI) : -18 * Math.max(0, (e.poseUntil - w.time) / .3), 0); } if (!e.hp) c.globalAlpha = Math.max(0, 1 - (w.time - e.deathAt) / 1.4);
    sprite(c, atlas, col * atlas.width / 6, spec.row * atlas.height / 4, atlas.width / 6, atlas.height / 4, x, y, size, size * .94);
    c.restore();
    if (e.hp > 0 && e.species !== 'boss') { c.fillStyle = '#0a0e15'; c.fillRect(x - 26, y - size + 4, 52, 5); c.fillStyle = '#ee6f7a'; c.fillRect(x - 26, y - size + 4, 52 * e.hp / e.maxHp, 5); }
    if (e.species === 'boss' && e.hp > 0 && e.impact > w.time) {  c.fillStyle = '#f15d5d40'; c.fillRect(heroX - 40, floor - 8, 190, 12); }
  }
  for (const e of w.effects) {
    const age = w.time - e.born; const x = e.x - w.cameraX; const y = (e.lane < 0 ? followerY[-e.lane - 1] ?? floor : floor) - 102 + Math.max(0, e.lane) * 10;
    c.save(); c.globalAlpha = 1 - age;
    if (e.kind === 'impact') {
      const life = Math.min(1, age / .28); c.globalAlpha = 1 - life;
      c.strokeStyle = '#ffe8af'; c.lineWidth = 2;
      for (let ray = 0; ray < 7; ray++) { const a = ray * .9; c.beginPath(); c.moveTo(x + Math.cos(a) * 5, y + 38 + Math.sin(a) * 5); c.lineTo(x + Math.cos(a) * (12 + life * 24), y + 38 + Math.sin(a) * (12 + life * 24)); c.stroke(); }
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
    else text(c, e.text === 'dodge' ? (en ? 'EVADE' : 'УКЛОН') : e.text === 'ward' ? (en ? 'WARD' : 'ЩИТ') : e.text === 'block' ? (en ? 'BLOCK' : 'БЛОК') : e.text, x, y - age * 46, 16, e.kind === 'energy' ? '#9eeaff' : e.kind === 'block' ? '#8fdcff' : '#ffe9be');
    c.restore();
  }
  if (w.phase === 'ENTER' || w.phase === 'NEXT_ROOM') { c.fillStyle = `rgba(11,6,25,${w.phase === 'ENTER' ? Math.max(0, 1 - (w.time - w.phaseAt) / .65) : Math.min(1, (w.time - w.phaseAt) / .6)})`; c.fillRect(0, 0, 430, h); }
}
