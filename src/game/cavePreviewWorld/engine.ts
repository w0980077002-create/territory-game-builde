import { BIOMES, CREATURES, PORTALS, type Biome, type Species } from './catalog';
export type Phase = 'LOBBY' | 'ENTER' | 'RUN_RIGHT' | 'WAVE_SPAWN' | 'APPROACH' | 'FIGHT' | 'CLEAR' | 'PORTAL_CHOICE' | 'PORTAL_ENTER' | 'NEXT_ROOM' | 'BOSS' | 'VICTORY' | 'DEFEAT';
export type Pose = 'idle' | 'run' | 'attack' | 'hit' | 'block' | 'death';
export type Skill = 'cleave' | 'ward' | 'heal';
export interface Enemy { id: number; species: Species; worldX: number; hp: number; maxHp: number; pose: Pose; poseUntil: number; ready: number; impact: number; deathAt: number; lane: number }
export interface Effect { x: number; lane: number; text: string; kind: 'hit' | 'block' | 'heal' | 'slash' | 'shock'; born: number }
export interface World {
  phase: Phase; phaseAt: number; time: number; room: number; wave: number; biome: Biome; route: Biome[]; heroX: number; cameraX: number;
  hp: number; energy: number; pose: Pose; poseUntil: number; heroReady: number; heroImpact: number; target: number; shieldUntil: number;
  enemies: Enemy[]; effects: Effect[]; auto: boolean; paused: boolean; kills: number; nextId: number; selected: number | null; portalX: number;
  cooldown: Record<Skill, number>; followerReady: number[]; followerX: number[]; followerHp: number[]; followerPose: Pose[]; followerUntil: number[]; bossSpawned: boolean;
}
export const MAX_HP = 900;
export const SKILLS = { cleave: { cost: 35, cooldown: 5 }, ward: { cost: 20, cooldown: 7 }, heal: { cost: 40, cooldown: 11 } };
export function createWorld(): World {
  return { phase: 'LOBBY', phaseAt: 0, time: 0, room: 0, wave: 0, biome: 'crystal', route: ['crystal'], heroX: 153, cameraX: 0, hp: MAX_HP, energy: 65,
    pose: 'idle', poseUntil: 0, heroReady: 0, heroImpact: 0, target: -1, shieldUntil: 0, enemies: [], effects: [], auto: false, paused: false, kills: 0, nextId: 0,
    selected: null, portalX: 0, cooldown: { cleave: 0, ward: 0, heal: 0 }, followerReady: [0, .6], followerX: [67, 33], followerHp: [260, 220], followerPose: ['idle', 'idle'], followerUntil: [0, 0], bossSpawned: false };
}
function phase(w: World, value: Phase) { w.phase = value; w.phaseAt = w.time; }
export function start(w: World) { Object.assign(w, createWorld()); phase(w, 'ENTER'); }
export function choosePortal(w: World, index: number) {
  if (w.phase !== 'PORTAL_CHOICE' || (index !== 0 && index !== 1)) return false;
  w.selected = index; phase(w, 'PORTAL_ENTER'); return true;
}
function fx(w: World, x: number, text: string, kind: Effect['kind'], lane = 0) { w.effects.push({ x, text, kind, born: w.time, lane }); }
function hurt(w: World, enemy: Enemy, damage: number) {
  if (enemy.hp <= 0) return;
  enemy.hp = Math.max(0, enemy.hp - damage);
  enemy.pose = enemy.hp ? 'hit' : 'death'; enemy.poseUntil = w.time + .32;
  enemy.worldX += enemy.species === 'boss' ? 2 : 9;
  fx(w, enemy.worldX, String(damage), 'hit', enemy.lane);
  if (!enemy.hp) { enemy.deathAt = w.time; enemy.impact = 0; w.kills++; w.energy = Math.min(100, w.energy + 7); }
}
export function skill(w: World, key: Skill) {
  const spec = SKILLS[key];
  if (!['FIGHT', 'BOSS', 'APPROACH'].includes(w.phase) || w.hp <= 0 || w.paused || w.cooldown[key] > w.time || w.energy < spec.cost) return false;
  const targets = w.enemies.filter(e => e.hp > 0 && e.worldX - w.heroX < 240);
  if (key === 'cleave' && !targets.length) return false;
  w.energy -= spec.cost; w.cooldown[key] = w.time + spec.cooldown;
  if (key === 'cleave') { targets.forEach(e => hurt(w, e, 95)); w.pose = 'attack'; fx(w, w.heroX + 70, '', 'slash'); }
  if (key === 'ward') { w.followerPose = w.followerHp.map(hp => hp > 0 ? 'block' : 'death'); w.followerUntil = [w.time + .45, w.time + .45]; w.shieldUntil = w.time + 3.5; w.pose = 'block'; fx(w, w.heroX, 'ЩИТ', 'block'); }
  if (key === 'heal') { w.hp = Math.min(MAX_HP, w.hp + 230); fx(w, w.heroX, '+230', 'heal'); }
  w.poseUntil = w.time + .45; return true;
}
function spawn(w: World, boss = false) {
  const species: Species[] = boss ? ['boss'] : BIOMES[w.biome].enemies;
  species.forEach((s, i) => { const spec = CREATURES[s]; w.enemies.push({ id: w.nextId++, species: s, hp: spec.hp, maxHp: spec.hp, worldX: w.heroX + 430 + i * 85, pose: 'run', poseUntil: 0, ready: w.time + 1 + i * .4, impact: 0, deathAt: 0, lane: i % 3 }); });
  phase(w, boss ? 'BOSS' : 'WAVE_SPAWN');
}
export function update(w: World, delta: number) {
  if (w.paused || ['LOBBY', 'VICTORY', 'DEFEAT'].includes(w.phase)) return;
  const dt = Math.min(.05, Math.max(0, delta)); w.time += dt;
  w.effects = w.effects.filter(e => w.time - e.born < 1);
  w.energy = Math.min(100, w.energy + dt * 3.2);
  const age = w.time - w.phaseAt;
  if (w.phase === 'ENTER' && age > .65) phase(w, 'RUN_RIGHT');
  if (w.phase === 'RUN_RIGHT') { w.heroX += dt * 95; w.pose = 'run'; if (age > (w.wave === 0 ? 11 : 3)) spawn(w); }
  if (w.phase === 'WAVE_SPAWN' && age > .25) phase(w, 'APPROACH');
  if (['APPROACH', 'FIGHT', 'BOSS'].includes(w.phase)) {
    const alive = w.enemies.filter(e => e.hp > 0);
    const nearest = alive.reduce<Enemy | undefined>((a, b) => !a || b.worldX < a.worldX ? b : a, undefined);
    if (nearest && nearest.worldX - w.heroX > 100) { w.heroX += dt * 52; w.pose = 'run'; }
    else if (w.time > w.poseUntil) w.pose = 'idle';
    for (const e of alive) {
      const spec = CREATURES[e.species]; const gap = e.worldX - w.heroX;
      const formationGap = Math.max(spec.range, 80 + alive.indexOf(e) * 56);
      if (gap > formationGap && w.time > e.poseUntil) { e.worldX -= dt * spec.speed; e.pose = 'run'; }
      else if (w.time > e.poseUntil) e.pose = 'idle';
      if (gap <= spec.range + 16 && w.time >= e.ready && e.pose !== 'hit') {
        e.pose = 'attack'; e.poseUntil = w.time + .72; e.impact = w.time + .44; e.ready = w.time + (e.species === 'boss' ? 2.7 : 2.2);
      }
      if (e.impact && w.time >= e.impact) {
        e.impact = 0;
        if (Math.abs(e.worldX - w.heroX) <= spec.range + 35) {
          const blocked = w.time < w.shieldUntil; const damage = blocked ? Math.ceil(spec.damage * .15) : spec.damage;
          w.hp = Math.max(0, w.hp - damage); w.pose = blocked ? 'block' : 'hit'; w.poseUntil = w.time + .28;
          fx(w, w.heroX, blocked ? 'БЛОК' : `−${damage}`, blocked ? 'block' : 'hit');
          if (e.species === 'boss' || e.species === 'moth') {
            w.followerHp.forEach((hp, i) => {
              if (hp <= 0) return;
              const splash = blocked ? 2 : e.species === 'boss' ? 20 : 8;
              w.followerHp[i] = Math.max(0, hp - splash);
              w.followerPose[i] = w.followerHp[i] <= 0 ? 'death' : blocked ? 'block' : 'hit';
              w.followerUntil[i] = w.time + .4;
              fx(w, w.heroX - (i ? 120 : 86), `−${splash}`, blocked ? 'block' : 'hit', -i);
            });
          }
          if (e.species === 'boss') fx(w, w.heroX + 45, '', 'shock');
        }
      }
    }
    if (nearest && nearest.worldX - w.heroX <= 145 && w.time >= w.heroReady && w.pose !== 'hit') {
      w.target = nearest.id; w.heroReady = w.time + .95; w.heroImpact = w.time + .27; w.pose = 'attack'; w.poseUntil = w.time + .55;
      if (w.phase === 'APPROACH') phase(w, 'FIGHT');
    }
    if (w.heroImpact && w.time >= w.heroImpact) {
      w.heroImpact = 0; const e = w.enemies.find(e => e.id === w.target);
      if (e && e.hp > 0 && e.worldX - w.heroX <= 158) { hurt(w, e, 34); fx(w, e.worldX - 25, '', 'slash', e.lane); }
    }
    for (let i = 0; i < 2; i++) {
      if (w.followerHp[i] <= 0) { w.followerPose[i] = 'death'; continue; }
      if (w.followerPose[i] === 'hit' && w.followerUntil[i] > w.time) continue;
      if (nearest && nearest.worldX - w.heroX < 210 && w.time >= w.followerReady[i]) {
        w.followerPose[i] = 'attack'; w.followerUntil[i] = w.time + .5; w.followerReady[i] = w.time + 1.6 + i * .2;
        hurt(w, nearest, i ? 12 : 15);
      } else if (w.time >= w.followerUntil[i]) w.followerPose[i] = w.pose === 'run' ? 'run' : 'idle';
    }
    if (w.auto) { if (w.hp < 600) skill(w, 'heal'); if (alive.some(e => e.pose === 'attack')) skill(w, 'ward'); skill(w, 'cleave'); }
    if (!w.hp) { w.pose = 'death'; w.followerHp = [0, 0]; w.followerPose = ['death', 'death']; w.heroImpact = 0; phase(w, 'DEFEAT'); return; }
    if (!w.enemies.some(e => e.hp > 0)) phase(w, 'CLEAR');
  }
  if (w.phase === 'CLEAR') {
    w.pose = 'run'; w.heroX += dt * 70;
    if (w.time - w.phaseAt > 1.3) {
      w.enemies = []; w.wave++;
      if (w.room === 2 && w.bossSpawned) { w.pose = 'idle'; phase(w, 'VICTORY'); }
      else if (w.room === 2) { w.bossSpawned = true; spawn(w, true); }
      else if (w.wave < 2) phase(w, 'RUN_RIGHT');
      else { w.portalX = w.heroX + 112; w.pose = 'idle'; phase(w, 'PORTAL_CHOICE'); }
    }
  }
  if (w.phase === 'PORTAL_CHOICE') w.pose = 'idle';
  if (w.phase === 'PORTAL_ENTER') {
    const target = w.portalX + (w.selected === 1 ? 108 : 0); w.pose = 'run';
    w.heroX = Math.min(target, w.heroX + dt * 120);
    if (w.heroX >= target && age > 1) phase(w, 'NEXT_ROOM');
  }
  if (w.phase === 'NEXT_ROOM' && age > .65) {
    w.biome = PORTALS[w.room][w.selected ?? 0].biome; w.route.push(w.biome); w.room++; w.wave = 0; w.heroX = 153; w.followerX = w.followerHp.map((hp, i) => hp > 0 ? 153 - (i ? 120 : 86) : -1000); w.cameraX = 0; w.selected = null; w.enemies = []; phase(w, 'ENTER');
  }
  w.followerX.forEach((_, i) => { if (w.followerHp[i] > 0) w.followerX[i] = w.heroX - (i ? 120 : 86); });
  // Fixed, world-aligned feet; only camera position affects projection.
  const desired = Math.max(0, w.heroX - 153);
  if (!['PORTAL_CHOICE', 'PORTAL_ENTER', 'NEXT_ROOM'].includes(w.phase)) w.cameraX += (desired - w.cameraX) * Math.min(1, dt * 7);
}
