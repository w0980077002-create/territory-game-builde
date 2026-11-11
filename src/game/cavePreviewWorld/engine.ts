import { BIOMES, CREATURES, PORTALS, type Biome, type Species } from './catalog';
export type Phase = 'LOBBY' | 'ENTER' | 'RUN_RIGHT' | 'WAVE_SPAWN' | 'APPROACH' | 'FIGHT' | 'CLEAR' | 'PORTAL_CHOICE' | 'PORTAL_ENTER' | 'NEXT_ROOM' | 'BOSS' | 'VICTORY' | 'DEFEAT';
export type Pose = 'idle' | 'run' | 'attack' | 'hit' | 'block' | 'death';
export type Skill = 'cleave' | 'ward' | 'heal';
export interface Enemy { id: number; species: Species; worldX: number; hp: number; maxHp: number; pose: Pose; poseUntil: number; ready: number; impact: number; deathAt: number; lane: number; attacks: number; heavy: boolean }
export interface Effect { x: number; lane: number; text: string; kind: 'hit' | 'block' | 'heal' | 'slash' | 'shock' | 'energy'; born: number }
export interface World {
  phase: Phase; phaseAt: number; time: number; room: number; wave: number; biome: Biome; route: Biome[]; heroX: number; cameraX: number;
  hp: number; energy: number; pose: Pose; poseUntil: number; heroReady: number; heroImpact: number; target: number; shieldUntil: number;
  enemies: Enemy[]; effects: Effect[]; auto: boolean; paused: boolean; kills: number; nextId: number; selected: number | null; portalX: number;
  cooldown: Record<Skill, number>; followerReady: number[]; followerX: number[]; followerHp: number[]; followerPose: Pose[]; followerUntil: number[]; bossSpawned: boolean; bossPhase: number; blocks: number; casts: number; hitStop: number; runeCollected: boolean;
}
/** Local demo tuning only. No relationship to live combat or the economy. */
export const BALANCE = { maxHp: 900, regen: 1.8, killEnergy: 3, openingRun: 2.4, betweenWaves: 1.2, basicDamage: 30, cleaveDamage: 105, healing: 280, wardSeconds: 2.1, bossHp: 1500 };
export const MAX_HP = BALANCE.maxHp;
export const SKILLS = { cleave: { cost: 32, cooldown: 6 }, ward: { cost: 22, cooldown: 5 }, heal: { cost: 35, cooldown: 12 } };
export function createWorld(): World {
  return { phase: 'LOBBY', phaseAt: 0, time: 0, room: 0, wave: 0, biome: 'crystal', route: ['crystal'], heroX: 175, cameraX: 0, hp: MAX_HP, energy: 65,
    pose: 'idle', poseUntil: 0, heroReady: 0, heroImpact: 0, target: -1, shieldUntil: 0, enemies: [], effects: [], auto: false, paused: false, kills: 0, nextId: 0,
    selected: null, portalX: 0, cooldown: { cleave: 0, ward: 0, heal: 0 }, followerReady: [0, .6], followerX: [93, 40], followerHp: [260, 220], followerPose: ['idle', 'idle'], followerUntil: [0, 0], bossSpawned: false, bossPhase: 1, blocks: 0, casts: 0, hitStop: 0, runeCollected: false };
}
function phase(w: World, value: Phase) { w.phase = value; w.phaseAt = w.time; }
export function start(w: World) { Object.assign(w, createWorld()); phase(w, 'ENTER'); }
export function choosePortal(w: World, index: number) {
  if (w.paused || w.phase !== 'PORTAL_CHOICE' || (index !== 0 && index !== 1)) return false;
  w.selected = index; phase(w, 'PORTAL_ENTER'); return true;
}
export function collectRune(w: World) {
  if (w.phase !== 'RUN_RIGHT' || w.paused || w.runeCollected) return false;
  w.runeCollected = true; w.energy = Math.min(100, w.energy + 10); fx(w, w.heroX, '+10 ✦', 'energy'); return true;
}
function fx(w: World, x: number, text: string, kind: Effect['kind'], lane = 0) { w.effects.push({ x, text, kind, born: w.time, lane }); }
function hurt(w: World, enemy: Enemy, damage: number) {
  if (enemy.hp <= 0) return;
  enemy.hp = Math.max(0, enemy.hp - damage);
  w.hitStop = .025;
  if (!enemy.hp || !enemy.impact) { enemy.pose = enemy.hp ? 'hit' : 'death'; enemy.poseUntil = w.time + .32; }
  enemy.worldX += enemy.species === 'boss' ? 2 : 9;
  fx(w, enemy.worldX, String(damage), 'hit', enemy.lane);
  if (!enemy.hp) { enemy.deathAt = w.time; enemy.impact = 0; w.kills++; w.energy = Math.min(100, w.energy + BALANCE.killEnergy); }
}
export function skill(w: World, key: Skill) {
  const spec = SKILLS[key];
  if (!['FIGHT', 'BOSS', 'APPROACH'].includes(w.phase) || w.hp <= 0 || w.paused || w.cooldown[key] > w.time || w.energy < spec.cost) return false;
  const targets = w.enemies.filter(e => e.hp > 0 && e.worldX - w.heroX < 240);
  if (key === 'cleave' && !targets.length) return false;
  if (key === 'heal' && w.hp === MAX_HP && w.followerHp.every((hp, i) => hp <= 0 || hp === (i ? 220 : 260))) return false;
  w.casts++; w.energy -= spec.cost; w.cooldown[key] = w.time + spec.cooldown;
  if (key === 'cleave') { targets.forEach(e => hurt(w, e, BALANCE.cleaveDamage)); w.pose = 'attack'; fx(w, w.heroX + 70, '', 'slash'); }
  if (key === 'ward') { w.followerPose = w.followerHp.map(hp => hp > 0 ? 'block' : 'death'); w.followerUntil = [w.time + .45, w.time + .45]; w.shieldUntil = w.time + BALANCE.wardSeconds; w.pose = 'block'; fx(w, w.heroX, 'ward', 'block'); }
  if (key === 'heal') { const restored = Math.min(BALANCE.healing, MAX_HP - w.hp); w.hp += restored; w.followerHp = w.followerHp.map((hp, i) => hp > 0 ? Math.min(i ? 220 : 260, hp + 65) : 0); fx(w, w.heroX, `+${restored}`, 'heal'); }
  w.poseUntil = w.time + .45; return true;
}
function spawn(w: World, boss = false) {
  const species: Species[] = boss ? ['boss'] : BIOMES[w.biome].enemies;
  species.forEach((s, i) => { const spec = CREATURES[s]; w.enemies.push({ id: w.nextId++, species: s, hp: boss ? BALANCE.bossHp : spec.hp, maxHp: boss ? BALANCE.bossHp : spec.hp, worldX: w.heroX + 430 + i * 85, pose: 'run', poseUntil: 0, ready: w.time + 1 + i * .4, impact: 0, deathAt: 0, lane: i % 3, attacks: 0, heavy: false }); });
  phase(w, boss ? 'BOSS' : 'WAVE_SPAWN');
}
export function update(w: World, delta: number) {
  if (w.paused || ['LOBBY', 'VICTORY', 'DEFEAT'].includes(w.phase)) return;
  const dt = Math.min(.05, Math.max(0, delta));
  if (w.hitStop > 0) { w.hitStop = Math.max(0, w.hitStop - dt); return; }
  w.time += dt;
  w.effects = w.effects.filter(e => w.time - e.born < 1);
  w.energy = Math.min(100, w.energy + dt * BALANCE.regen);
  const age = w.time - w.phaseAt;
  if (w.phase === 'ENTER' && age > .65) phase(w, 'RUN_RIGHT');
  if (w.phase === 'RUN_RIGHT') { w.heroX += dt * 95; w.pose = 'run'; if (age > (w.wave === 0 ? BALANCE.openingRun : BALANCE.betweenWaves)) spawn(w); }
  if (w.phase === 'WAVE_SPAWN' && age > .25) phase(w, 'APPROACH');
  if (['APPROACH', 'FIGHT', 'BOSS'].includes(w.phase)) {
    const alive = w.enemies.filter(e => e.hp > 0);
    const boss = alive.find(e => e.species === 'boss');
    if (boss) w.bossPhase = boss.hp / boss.maxHp > .66 ? 1 : boss.hp / boss.maxHp > .33 ? 2 : 3;
    const nearest = alive.reduce<Enemy | undefined>((a, b) => !a || b.worldX < a.worldX ? b : a, undefined);
    if (nearest && nearest.worldX - w.heroX > (nearest.species === 'boss' ? 170 : 110)) { w.heroX += dt * 52; w.pose = 'run'; }
    else if (w.time > w.poseUntil) w.pose = 'idle';
    for (const e of alive) {
      const spec = CREATURES[e.species]; const gap = e.worldX - w.heroX;
      const formationGap = Math.max(spec.range, 80 + alive.indexOf(e) * 56);
      if (gap > formationGap && w.time > e.poseUntil) { e.worldX -= dt * spec.speed; e.pose = 'run'; }
      else if (w.time > e.poseUntil) e.pose = 'idle';
      if (gap <= spec.range + 16 && w.time >= e.ready && e.pose !== 'hit' && !e.impact) {
        e.attacks++; e.heavy = e.species === 'boss' && e.attacks % 3 === 0;
        const windup = e.species === 'boss' ? (e.heavy ? 1.45 : .95) : .5;
        e.pose = 'attack'; e.poseUntil = w.time + windup + .3; e.impact = w.time + windup; e.ready = w.time + (e.species === 'boss' ? 3.6 - w.bossPhase * .15 : 2.4);
      }
      if (e.impact && w.time >= e.impact) {
        e.impact = 0;
        if (Math.abs(e.worldX - w.heroX) <= spec.range + 35) {
          const blocked = w.time < w.shieldUntil; const power = e.species === 'boss' ? (e.heavy ? 125 + w.bossPhase * 30 : 45 + w.bossPhase * 12) : spec.damage; const damage = blocked ? Math.ceil(power * .15) : power;
          if (blocked) w.blocks++;
          w.hp = Math.max(0, w.hp - damage); w.pose = blocked ? 'block' : 'hit'; w.poseUntil = w.time + .28;
          fx(w, w.heroX, blocked ? 'block' : `−${damage}`, blocked ? 'block' : 'hit');
          if (e.species === 'boss' || e.species === 'moth') {
            w.followerHp.forEach((hp, i) => {
              if (hp <= 0) return;
              const splash = blocked ? 2 : e.species === 'boss' ? 12 + w.bossPhase * 6 : 8;
              w.followerHp[i] = Math.max(0, hp - splash);
              w.followerPose[i] = w.followerHp[i] <= 0 ? 'death' : blocked ? 'block' : 'hit';
              w.followerUntil[i] = w.time + .4;
              fx(w, w.heroX - (i ? 135 : 82), `−${splash}`, blocked ? 'block' : 'hit', -i);
            });
          }
          if (e.species === 'boss') fx(w, w.heroX + 45, '', 'shock', w.bossPhase);
        }
      }
    }
    if (nearest && nearest.worldX - w.heroX <= (nearest.species === 'boss' ? 185 : 145) && w.time >= w.heroReady && w.pose !== 'hit') {
      w.target = nearest.id; w.heroReady = w.time + .95; w.heroImpact = w.time + .27; w.pose = 'attack'; w.poseUntil = w.time + .55;
      if (w.phase === 'APPROACH') phase(w, 'FIGHT');
    }
    if (w.heroImpact && w.time >= w.heroImpact) {
      w.heroImpact = 0; const e = w.enemies.find(e => e.id === w.target);
      if (e && e.hp > 0 && e.worldX - w.heroX <= (e.species === 'boss' ? 195 : 158)) { hurt(w, e, BALANCE.basicDamage); fx(w, e.worldX - 25, '', 'slash', e.lane); }
    }
    for (let i = 0; i < 2; i++) {
      if (w.followerHp[i] <= 0) { w.followerPose[i] = 'death'; continue; }
      if (w.followerPose[i] === 'hit' && w.followerUntil[i] > w.time) continue;
      if (nearest && nearest.worldX - w.heroX < 210 && w.time >= w.followerReady[i]) {
        w.followerPose[i] = 'attack'; w.followerUntil[i] = w.time + .5; w.followerReady[i] = w.time + 1.6 + i * .2;
        hurt(w, nearest, i ? 12 : 15);
      } else if (w.time >= w.followerUntil[i]) w.followerPose[i] = w.pose === 'run' ? 'run' : 'idle';
    }
    if (w.auto) {
      // Reserve energy for readable boss counterplay; basic attacks remain automatic.
      if (alive.some(e => e.species === 'boss' && e.heavy && e.impact > w.time && e.impact - w.time < .7) && w.shieldUntil <= w.time) skill(w, 'ward');
      if (w.hp <= MAX_HP - BALANCE.healing) skill(w, 'heal');
      if (alive.length >= 2 && w.energy >= SKILLS.cleave.cost + SKILLS.ward.cost) skill(w, 'cleave');
    }
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
      else { w.portalX = w.cameraX + 252; w.pose = 'idle'; phase(w, 'PORTAL_CHOICE'); }
    }
  }
  if (w.phase === 'PORTAL_CHOICE') w.pose = 'idle';
  if (w.phase === 'PORTAL_ENTER') {
    const target = w.portalX + (w.selected === 1 ? 112 : 0); w.pose = 'run';
    w.heroX = Math.min(target, w.heroX + dt * 120);
    if (w.heroX >= target && age > 1.2) phase(w, 'NEXT_ROOM');
  }
  if (w.phase === 'NEXT_ROOM' && age > .65) {
    w.biome = PORTALS[w.room][w.selected ?? 0].biome; w.route.push(w.biome); w.room++; w.wave = 0; w.runeCollected = false; w.heroX = 175; w.followerX = w.followerHp.map((hp, i) => hp > 0 ? 175 - (i ? 135 : 82) : -1000); w.cameraX = 0; w.selected = null; w.enemies = []; phase(w, 'ENTER');
  }
  w.followerX.forEach((_, i) => { if (w.followerHp[i] > 0) w.followerX[i] = w.heroX - (w.phase === 'BOSS' ? (i ? 110 : 65) : (i ? 135 : 82)); });
  // Fixed, world-aligned feet; only camera position affects projection.
  const desired = Math.max(0, w.heroX - (w.phase === 'BOSS' ? 145 : 175));
  if (!['PORTAL_CHOICE', 'PORTAL_ENTER', 'NEXT_ROOM'].includes(w.phase)) w.cameraX += (desired - w.cameraX) * Math.min(1, dt * 7);
}
