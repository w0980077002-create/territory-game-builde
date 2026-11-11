import { BIOMES, CREATURES, PORTALS } from '../../../game/cavePreviewWorld/catalog';
import type { World, Pose } from '../../../game/cavePreviewWorld/engine';
export const ASSET_ROOT = 'assets/territory/';
export const PARTY = ['heroes/male_viking', 'followers/northern_warrior', 'followers/forest_healer'];
export const POSES = ['idle', 'attack', 'hit', 'block', 'death'] as const;
export function assetPaths() {
  return ['cave-expedition/creatures.webp', 'cave-expedition/biomes.webp', 'cave-expedition/party-run.webp', 'ui/wooden-plaque.webp',
    ...PARTY.flatMap(p => POSES.map(s => `characters/${p}/${s}.webp`)),
    ...['01-shadow-amulet', '02-void-axe', '04-azure-crystal'].map(p => `cave-loot/2026-11-06/${p}.webp`)].map(p => ASSET_ROOT + p);
}
export type Images = Map<string, HTMLImageElement>;
export async function loadImages(resolve: (s: string) => string): Promise<Images> {
  const images: Images = new Map();
  await Promise.all(assetPaths().map(path => new Promise<void>((ok, fail) => {
    const img = new Image(); img.onload = () => { images.set(path, img); ok(); }; img.onerror = () => fail(new Error(`Не удалось загрузить ${path}`)); img.src = resolve(path);
  }))); return images;
}
function text(c: CanvasRenderingContext2D, value: string, x: number, y: number, size = 16, color = '#fff2c6') {
  c.fillStyle = color; c.font = `bold ${size}px system-ui`; c.textAlign = 'center'; c.shadowColor = '#050a12'; c.shadowBlur = 4; c.fillText(value, x, y); c.shadowBlur = 0;
}
/** Mirror adjoining panorama segments: shared endpoints match exactly at every seam. */
function tiles(c: CanvasRenderingContext2D, img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, camera: number, factor: number, width: number, y: number, height: number) {
  const offset = camera * factor; const first = Math.floor(offset / width);
  for (let i = first; i <= first + Math.ceil(430 / width) + 1; i++) {
    const x = i * width - offset;
    c.save(); c.translate(x, y); if (i % 2) { c.translate(width, 0); c.scale(-1, 1); }
    c.drawImage(img, sx, sy, sw, sh, -.5, 0, width + 1, height); c.restore();
  }
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
function party(c: CanvasRenderingContext2D, images: Images, index: number, pose: Pose, x: number, y: number, size: number, time: number, fade = 1) {
  c.save(); c.globalAlpha = fade;
  if (pose === 'run') {
    const img = images.get(ASSET_ROOT + 'cave-expedition/party-run.webp')!;
    const col = Math.floor(time * 9 + index) % 4;
    c.drawImage(img, col * img.width / 4, index * img.height / 3, img.width / 4, img.height / 3, x - size / 2, y - size, size, size);
  } else {
    const img = images.get(ASSET_ROOT + `characters/${PARTY[index]}/${pose}.webp`)!;
    c.drawImage(img, x - size / 2, y - size, size, size);
  }
  c.restore();
}
export function render(c: CanvasRenderingContext2D, w: World, images: Images, height: number) {
  const h = height; const floor = h * .76; const theme = BIOMES[w.biome];
  c.clearRect(0, 0, 430, h); c.fillStyle = theme.sky; c.fillRect(0, 0, 430, h);
  const bg = images.get(ASSET_ROOT + 'cave-expedition/biomes.webp')!;
  const bw = bg.width / 2, bh = bg.height / 2, sx = theme.art % 2 * bw, sy = Math.floor(theme.art / 2) * bh;
  tiles(c, bg, sx, sy, bw, bh, w.cameraX, .23, Math.max(560, h * bw / bh), 0, h);
  // Separate near rock silhouettes and particles travel independently from the painted distance.
  for (let i = -1; i < 7; i++) {
    const x = i * 120 - (w.cameraX * .56 % 120);
    c.fillStyle = '#06131d90'; c.beginPath(); c.moveTo(x - 40, 0); c.lineTo(x + 20, 45 + (i % 3 + 3) * 15); c.lineTo(x + 38, 0); c.fill();
  }
  const mist = c.createLinearGradient(0, floor - 50, 0, h); mist.addColorStop(0, '#07121a00'); mist.addColorStop(.55, theme.sky); mist.addColorStop(1, '#070d14'); c.fillStyle = mist; c.fillRect(0, floor - 50, 430, h);
  tiles(c, bg, sx, sy + bh * .75, bw * .65, bh * .25, w.cameraX, 1, 360, floor + 6, 360 * bh * .25 / (bw * .65));
  c.fillStyle = '#111d25'; c.fillRect(0, floor + 3, 430, 5);
  for (let i = 0; i < 25; i++) {
    const x = ((i * 67.3 - w.cameraX * .4 + Math.sin(w.time * .4 + i) * 15) % 460 + 460) % 460;
    c.globalAlpha = .15 + (Math.sin(w.time * 2 + i) + 1) * .17; c.fillStyle = theme.color;
    c.beginPath(); c.arc(x, 50 + (i * 43.1) % Math.max(60, floor - 60), i % 3 === 0 ? 2 : 1, 0, 7); c.fill();
  } c.globalAlpha = 1;
  const isPortal = ['PORTAL_CHOICE', 'PORTAL_ENTER', 'NEXT_ROOM'].includes(w.phase);
  if (w.phase === 'LOBBY') { portal(c, 275, floor - 10, '#a485ff', performance.now() / 1000, 1.7); text(c, 'ТЁМНАЯ ПЕЩЕРА', 215, 47, 23); text(c, 'Один путь. Две развилки. Три комнаты.', 215, 73, 13); }
  if (isPortal) {
    PORTALS[Math.min(w.room, 1)].forEach((p, i) => {
      const x = w.portalX + i * 108 - w.cameraX;
      portal(c, x, floor, BIOMES[p.biome].color, w.time, .92);
      text(c, p.symbol, x, floor - 130, 25, BIOMES[p.biome].color);
    });
  }
  const heroX = w.heroX - w.cameraX;
  const fading = w.phase === 'NEXT_ROOM' ? Math.max(0, 1 - (w.time - w.phaseAt) * 2) : 1;
  const moving = ['RUN_RIGHT', 'CLEAR', 'PORTAL_ENTER'].includes(w.phase);
  party(c, images, 2, w.followerHp[1] <= 0 ? 'death' : moving ? 'run' : w.followerPose[1], w.followerX[1] - w.cameraX, floor - 42, 72, w.time, fading);
  party(c, images, 1, w.followerHp[0] <= 0 ? 'death' : moving ? 'run' : w.followerPose[0], w.followerX[0] - w.cameraX, floor - 3, 82, w.time, fading);
  c.fillStyle = '#02070b55'; c.beginPath(); c.ellipse(heroX, floor + 1, 40, 6, 0, 0, 7); c.fill();
  party(c, images, 0, w.pose, heroX, floor + 8, 126, w.time, fading);
  if (w.shieldUntil > w.time) { c.strokeStyle = '#7bcfff'; c.lineWidth = 3; c.shadowColor = '#84ddff'; c.shadowBlur = 14; c.beginPath(); c.ellipse(heroX, floor - 53, 53, 76, 0, 0, 7); c.stroke(); c.shadowBlur = 0; }
  const atlas = images.get(ASSET_ROOT + 'cave-expedition/creatures.webp')!;
  for (const e of [...w.enemies].sort((a, b) => a.lane - b.lane)) {
    const x = e.worldX - w.cameraX, y = floor + e.lane * 10; const spec = CREATURES[e.species];
    const size = e.species === 'boss' ? 210 : 103;
    const col = e.pose === 'run' ? 1 + Math.floor(w.time * 8) % 2 : e.pose === 'attack' ? 3 : e.pose === 'hit' ? 4 : e.pose === 'death' ? 5 : 0;
    c.save(); if (!e.hp) c.globalAlpha = Math.max(0, 1 - (w.time - e.deathAt) / 1.4);
    c.drawImage(atlas, col * atlas.width / 6, spec.row * atlas.height / 4, atlas.width / 6, atlas.height / 4, x - size / 2, y - size, size, size);
    c.restore();
    if (e.hp > 0 && e.species !== 'boss') { c.fillStyle = '#0a0e15'; c.fillRect(x - 26, y - size + 4, 52, 5); c.fillStyle = '#ee6f7a'; c.fillRect(x - 26, y - size + 4, 52 * e.hp / e.maxHp, 5); }
    if (e.species === 'boss' && e.hp > 0 && e.pose === 'attack') { text(c, '⚠ РАЗЛОМ · ЗАЩИЩАЙТЕСЬ', 215, floor - 235, 13, '#ffb16d'); c.fillStyle = '#f15d5d40'; c.fillRect(heroX - 40, floor - 8, 190, 12); }
  }
  for (const e of w.effects) {
    const age = w.time - e.born; const x = e.x - w.cameraX; const y = floor - 83 + e.lane * 10;
    c.save(); c.globalAlpha = 1 - age;
    if (e.kind === 'slash') { c.translate(x, y + 25); c.rotate(-.8 + age * 3); c.strokeStyle = '#fff0ad'; c.lineWidth = 7 * (1 - age); c.shadowColor = '#f9b658'; c.shadowBlur = 16; c.beginPath(); c.arc(0, 0, 40 + age * 25, -.8, 1.4); c.stroke(); }
    else if (e.kind === 'shock') { c.strokeStyle = '#f2a0ff'; c.lineWidth = 8 * (1 - age); c.beginPath(); c.ellipse(x, floor, age * 220, age * 38, 0, 0, 7); c.stroke(); }
    else text(c, e.text, x, y - age * 46, 21, e.kind === 'heal' ? '#9cffb0' : e.kind === 'block' ? '#8fdcff' : '#ffe9be');
    c.restore();
  }
  if (w.phase === 'ENTER' || w.phase === 'NEXT_ROOM') { c.fillStyle = `rgba(11,6,25,${w.phase === 'ENTER' ? Math.max(0, 1 - (w.time - w.phaseAt) / .65) : Math.min(1, (w.time - w.phaseAt) / .6)})`; c.fillRect(0, 0, 430, h); }
}
