import { BIOMES, CREATURES, PORTALS, type Biome, type Species } from './catalog';
export type Phase = 'LOBBY' | 'ENTER' | 'RUN_RIGHT' | 'WAVE_SPAWN' | 'APPROACH' | 'FIGHT' | 'CLEAR' | 'PORTAL_CHOICE' | 'PORTAL_ENTER' | 'NEXT_ROOM' | 'BOSS' | 'VICTORY' | 'DEFEAT';
export type Pose = 'idle' | 'run' | 'attack' | 'hit' | 'block' | 'dodge' | 'death';
export type Skill = 'cleave' | 'ward' | 'heal' | 'dodge';
export interface Enemy { id: number; species: Species; worldX: number; hp: number; maxHp: number; pose: Pose; poseUntil: number; ready: number; impact: number; deathAt: number; lane: number; attacks: number; heavy: boolean }
export interface Effect { x: number; lane: number; text: string; kind: 'hit' | 'block' | 'heal' | 'slash' | 'shock' | 'energy' | 'dodge' | 'impact'; born: number }
export interface World {
  honorBonus: number;
  wings: 'none' | 'astral' | 'ember';
  speed: 1 | 2; autoPotions: boolean; belt: number[]; beltUsed: number[];
  potionReady: number; furyUntil: number; maxHp: number; attackBonus: number; defenseBonus: number;
  phase: Phase; phaseAt: number; time: number; room: number; wave: number; biome: Biome; route: Biome[]; heroX: number; cameraX: number;
  hp: number; energy: number; pose: Pose; poseUntil: number; heroReady: number; heroImpact: number; target: number; shieldUntil: number;
  enemies: Enemy[]; effects: Effect[]; auto: boolean; paused: boolean; kills: number; nextId: number; selected: number | null; portalX: number;
  cooldown: Record<Skill, number>; followerReady: number[]; followerX: number[]; followerHp: number[]; followerPose: Pose[]; followerUntil: number[]; bossSpawned: boolean; bossPhase: number; blocks: number; casts: number; hitStop: number; runeCollected: boolean;
  heroActionAt: number; combo: number; dodgeUntil: number; dodges: number;
  cleaveImpact: number; cleaveTargets: number[]; followerImpact: number[]; followerTarget: number[];
  /** Travel: continuous velocity, room origin, current stop and total distance walked. */
  heroV: number; roomX: number; stopX: number; distance: number; followerV: number[]; followerStride: number[]; alertAt: number; shake: number;
}
/** World-space travel. One unit is one canvas pixel of the 430-wide stage. */
export const TRAVEL = { run: 138, accel: 300, brake: 260, firstLeg: 520, leg: 640, bossLeg: 700, portalLeg: 560, aggro: 250, bossAggro: 300, follow: 190, portalScreenX: 252, followerGap: [118, 184] };
/** Local demo tuning only. No relationship to live combat or the economy. */
export const BALANCE = { maxHp: 900, regen: 1.8, killEnergy: 3, openingRun: 2.4, betweenWaves: 1.2, basicDamage: 30, cleaveDamage: 105, healing: 280, wardSeconds: 2.1, bossHp: 1500 };
export const MAX_HP = BALANCE.maxHp;
export const SKILLS = { cleave: { cost: 32, cooldown: 6 }, ward: { cost: 22, cooldown: 5 }, heal: { cost: 35, cooldown: 12 }, dodge: { cost: 18, cooldown: 5 } };
export function createWorld(): World {
  return { honorBonus: 0, wings: 'none', speed: 1, autoPotions: false, belt: Array(7).fill(5), beltUsed: Array(7).fill(0), potionReady: 0, furyUntil: 0, maxHp: MAX_HP, attackBonus: 0, defenseBonus: 0,
    phase: 'LOBBY', phaseAt: 0, time: 0, room: 0, wave: 0, biome: 'crystal', route: ['crystal'], heroX: 175, cameraX: 0, hp: MAX_HP, energy: 65,
    pose: 'idle', poseUntil: 0, heroReady: 0, heroImpact: 0, target: -1, shieldUntil: 0, enemies: [], effects: [], auto: false, paused: false, kills: 0, nextId: 0,
    selected: null, portalX: 0, cooldown: { cleave: 0, ward: 0, heal: 0, dodge: 0 }, followerReady: [0, .6], followerX: [175 - TRAVEL.followerGap[0], 175 - TRAVEL.followerGap[1]], followerHp: [260, 220], followerPose: ['idle', 'idle'], followerUntil: [0, 0], bossSpawned: false, bossPhase: 1, blocks: 0, casts: 0, hitStop: 0, runeCollected: false,
    heroActionAt: 0, combo: 0, dodgeUntil: 0, dodges: 0, cleaveImpact: 0, cleaveTargets: [], followerImpact: [0, 0], followerTarget: [-1, -1],
    heroV: 0, roomX: 0, stopX: 0, distance: 0, followerV: [0, 0], followerStride: [0, 0], alertAt: -10, shake: 0 };
}
/** Dark gear raises both sides of a fight, so a stronger hero meets a deeper cave while upgrades still pay off. */
const might = (w: World) => (BALANCE.basicDamage + w.attackBonus) / BALANCE.basicDamage;
const vigor = (w: World) => w.maxHp / MAX_HP;
const depth = (ratio: number) => 1 + (ratio - 1) * .85;
function phase(w: World, value: Phase) { w.phase = value; w.phaseAt = w.time; }
export function start(w: World) { Object.assign(w, createWorld()); phase(w, 'ENTER'); }
export const POTIONS = [
  { id: 'small', ru: 'Малое лечение', en: 'Small heal', effectRu: '+120 HP', effectEn: '+120 HP', color: '#d35b55' },
  { id: 'large', ru: 'Большое лечение', en: 'Greater heal', effectRu: '+240 HP', effectEn: '+240 HP', color: '#f17b67' },
  { id: 'energy', ru: 'Энергия', en: 'Energy', effectRu: '+35 энергии', effectEn: '+35 energy', color: '#55c8ed' },
  { id: 'ward', ru: 'Каменная кожа', en: 'Stoneskin', effectRu: 'Защита на 3 сек', effectEn: 'Guard for 3 sec', color: '#c2a77a' },
  { id: 'fury', ru: 'Ярость', en: 'Fury', effectRu: '+10 к удару · 10 сек', effectEn: '+10 strike damage · 10 sec', color: '#ffab50' },
  { id: 'spring', ru: 'Настой отряда', en: 'Party tonic', effectRu: '+80 HP отряду', effectEn: '+80 party HP', color: '#a4d67b' },
  { id: 'focus', ru: 'Ясность', en: 'Clarity', effectRu: 'Откаты −3 сек', effectEn: 'Cooldowns −3 sec', color: '#b09bfa' },
] as const;
export function potionBlock(w: World, slot: number): string | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= 7) return 'slot';
  if (w.paused || !['APPROACH', 'FIGHT', 'BOSS'].includes(w.phase) || w.hp <= 0) return 'phase';
  if (w.belt[slot] <= 0 || w.beltUsed[slot] >= 5) return 'empty';
  if (w.time < w.potionReady) return 'cooldown';
  if ((slot === 0 || slot === 1) && w.hp >= w.maxHp) return 'full';
  if (slot === 2 && w.energy >= 100) return 'full';
  if (slot === 3 && w.shieldUntil > w.time) return 'active';
  if (slot === 4 && w.furyUntil > w.time) return 'active';
  if (slot === 5 && w.hp >= w.maxHp && w.followerHp.every((hp, i) => hp <= 0 || hp >= (i ? 220 : 260))) return 'full';
  if (slot === 6 && Object.values(w.cooldown).every(value => value <= w.time)) return 'full';
  return null;
}
export function drinkPotion(w: World, slot: number): boolean {
  if (potionBlock(w, slot)) return false;
  w.belt[slot]--; w.beltUsed[slot]++; w.potionReady = w.time + .7;
  if (slot === 0 || slot === 1 || slot === 5) {
    const amount = Math.min(w.maxHp - w.hp, Math.round((slot === 0 ? 120 : slot === 1 ? 240 : 80) * vigor(w)));
    w.hp += amount; fx(w, w.heroX, `+${amount}`, 'heal');
    if (slot === 5) w.followerHp = w.followerHp.map((hp, i) => hp > 0 ? Math.min(i ? 220 : 260, hp + 80) : 0);
  }
  if (slot === 2) { const gain = Math.min(35, 100 - w.energy); w.energy += gain; fx(w, w.heroX, `+${Math.floor(gain)} ✦`, 'energy'); }
  if (slot === 3) { w.shieldUntil = w.time + 3; fx(w, w.heroX, 'ward', 'block'); }
  if (slot === 4) { w.furyUntil = w.time + 10; fx(w, w.heroX, '+10', 'energy'); }
  if (slot === 6) { for (const key of Object.keys(SKILLS) as Skill[]) w.cooldown[key] = Math.max(w.time, w.cooldown[key] - 3); fx(w, w.heroX, '−3s', 'energy'); }
  return true;
}
/** Wall time is bounded and substepped. x2 remains x2 at 30/60/120 Hz. */
export function advanceRealtime(w: World, delta: number) {
  let remaining = Math.min(.1, Math.max(0, delta)) * w.speed;
  while (remaining > .000001) { const step = Math.min(.025, remaining); update(w, step); remaining -= step; }
}
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
  fx(w, enemy.worldX - 20, '', 'impact', enemy.lane);
  if (!enemy.hp) { enemy.deathAt = w.time; enemy.impact = 0; w.kills++; w.energy = Math.min(100, w.energy + BALANCE.killEnergy); }
}
export type SkillBlock = 'paused' | 'not-fighting' | 'cooldown' | 'energy' | 'no-target' | 'full-health';
/** Shared by input validation and the HUD so a lit button always means a usable skill. */
export function skillBlock(w: World, key: Skill): SkillBlock | null {
  const spec = SKILLS[key];
  if (w.paused) return 'paused';
  if (!['FIGHT', 'BOSS', 'APPROACH'].includes(w.phase) || w.hp <= 0) return 'not-fighting';
  if (w.cooldown[key] > w.time) return 'cooldown';
  if (w.energy < spec.cost) return 'energy';
  if (key === 'cleave' && !w.enemies.some(e => e.hp > 0 && e.worldX - w.heroX < 240)) return 'no-target';
  if (key === 'heal' && w.hp === w.maxHp && w.followerHp.every((hp, i) => hp <= 0 || hp === (i ? 220 : 260))) return 'full-health';
  return null;
}
export function skill(w: World, key: Skill) {
  if (skillBlock(w, key)) return false;
  const spec = SKILLS[key];
  const targets = w.enemies.filter(e => e.hp > 0 && e.worldX - w.heroX < 240);
  w.casts++; w.energy -= spec.cost; w.cooldown[key] = w.time + spec.cooldown;
  if (key === 'cleave') { w.heroImpact = 0; w.cleaveTargets = targets.map(e => e.id); w.cleaveImpact = w.time + .3; w.combo = 2; w.pose = 'attack'; w.heroReady = Math.max(w.heroReady, w.time + .7); }
  if (key === 'ward') { w.heroImpact = 0; w.followerPose = w.followerHp.map(hp => hp > 0 ? 'block' : 'death'); w.followerUntil = [w.time + .45, w.time + .45]; w.shieldUntil = w.time + BALANCE.wardSeconds; w.pose = 'block'; fx(w, w.heroX, 'ward', 'block'); }
  if (key === 'heal') {
    const restored = Math.min(Math.round(BALANCE.healing * vigor(w)), w.maxHp - w.hp); w.hp += restored;
    w.followerHp = w.followerHp.map((hp, i) => hp > 0 ? Math.min(i ? 220 : 260, hp + 65) : 0);
    if (w.followerHp[1] > 0) { w.followerPose[1] = 'attack'; w.followerUntil[1] = w.time + .75; }
    fx(w, w.heroX, `+${restored}`, 'heal'); return true;
  }
  if (key === 'dodge') { w.dodgeUntil = w.time + .65; w.pose = 'dodge'; w.heroImpact = 0; }
  w.heroActionAt = w.time; w.poseUntil = w.time + (key === 'cleave' ? .7 : key === 'dodge' ? .65 : .45); return true;
}
/** Enemies are placed ahead on the road and wait there; the hero has to physically reach them. */
function spawn(w: World, boss = false) {
  const species: Species[] = boss ? ['boss'] : BIOMES[w.biome].enemies;
  const leg = boss ? TRAVEL.bossLeg : w.wave === 0 ? TRAVEL.firstLeg : TRAVEL.leg;
  species.forEach((s, i) => { const spec = CREATURES[s]; w.enemies.push({ id: w.nextId++, species: s, hp: Math.round((boss ? BALANCE.bossHp : spec.hp) * depth(might(w))), maxHp: Math.round((boss ? BALANCE.bossHp : spec.hp) * depth(might(w))), worldX: w.heroX + leg + i * 85, pose: 'idle', poseUntil: 0, ready: 0, impact: 0, deathAt: 0, lane: i % 3, attacks: 0, heavy: false }); });
  w.stopX = w.heroX + leg; phase(w, 'RUN_RIGHT');
}
const toward = (value: number, target: number, amount: number) => value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
/** Semi-implicit acceleration with a stopping distance: continuous starts and braking, never past `limit`. */
function travel(w: World, dt: number, limit: number, top = TRAVEL.run) {
  const remaining = Math.max(0, limit - w.heroX);
  const desired = w.time < w.poseUntil ? 0 : Math.min(top, Math.sqrt(2 * TRAVEL.brake * remaining));
  w.heroV = toward(w.heroV, desired, (desired > w.heroV ? TRAVEL.accel : TRAVEL.brake * 1.6) * dt);
  const dx = Math.min(remaining, w.heroV * dt);
  w.heroX += dx; w.distance += dx;
  if (remaining < .05) w.heroV = 0;
  if (w.time >= w.poseUntil) w.pose = w.heroV > 9 ? 'run' : 'idle';
}
export function update(w: World, delta: number) {
  if (w.paused || ['LOBBY', 'VICTORY', 'DEFEAT'].includes(w.phase)) return;
  const dt = Math.min(.05, Math.max(0, delta));
  if (w.hitStop > 0) { w.hitStop = Math.max(0, w.hitStop - dt); return; }
  w.time += dt;
  w.effects = w.effects.filter(e => w.time - e.born < 1);
  w.energy = Math.min(100, w.energy + dt * BALANCE.regen);
  if (w.autoPotions && w.hp <= w.maxHp * .35) {
    if (!drinkPotion(w, 1)) drinkPotion(w, 0);
  }
  if (w.cleaveImpact && w.time >= w.cleaveImpact) {
    w.cleaveImpact = 0;
    w.enemies.filter(e => w.cleaveTargets.includes(e.id) && e.worldX - w.heroX < 260).forEach(e => hurt(w, e, Math.round(BALANCE.cleaveDamage * might(w))));
    fx(w, w.heroX + 70, '', 'slash'); w.cleaveTargets = [];
  }
  const age = w.time - w.phaseAt;
  w.shake = Math.max(0, w.shake - dt * 3.2);
  if (w.phase === 'ENTER' && age > .65) spawn(w);
  if (w.phase === 'RUN_RIGHT') {
    const lead = w.enemies.reduce<Enemy | undefined>((a, b) => b.hp > 0 && (!a || b.worldX < a.worldX) ? b : a, undefined);
    if (lead) {
      // The party is spotted: the road stops here until the pack is beaten.
      travel(w, dt, lead.worldX - 110);
      if (lead.worldX - w.heroX <= (lead.species === 'boss' ? TRAVEL.bossAggro : TRAVEL.aggro)) {
        w.alertAt = w.time; w.enemies.forEach((e, i) => { e.ready = w.time + 1 + i * .4; });
        fx(w, lead.worldX, '!', 'energy', lead.lane); phase(w, 'WAVE_SPAWN');
      }
    } else {
      travel(w, dt, w.stopX);
      if (w.heroX >= w.stopX - .05 && w.heroV === 0) { w.pose = 'idle'; phase(w, 'PORTAL_CHOICE'); }
    }
  }
  if (w.phase === 'WAVE_SPAWN') {
    const lead = w.enemies.find(e => e.hp > 0);
    if (lead) travel(w, dt, lead.worldX - 110);
    if (age > .25) phase(w, w.enemies.some(e => e.species === 'boss') ? 'BOSS' : 'APPROACH');
  }
  if (['APPROACH', 'FIGHT', 'BOSS'].includes(w.phase)) {
    const alive = w.enemies.filter(e => e.hp > 0);
    const boss = alive.find(e => e.species === 'boss');
    if (boss) w.bossPhase = boss.hp / boss.maxHp > .66 ? 1 : boss.hp / boss.maxHp > .33 ? 2 : 3;
    const nearest = alive.reduce<Enemy | undefined>((a, b) => !a || b.worldX < a.worldX ? b : a, undefined);
    if (nearest) travel(w, dt, nearest.worldX - (nearest.species === 'boss' ? 170 : 110));
    else { w.heroV = 0; if (w.time > w.poseUntil) w.pose = 'idle'; }
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
          const dodged = w.time < w.dodgeUntil;
          const blocked = !dodged && w.time < w.shieldUntil; const rawPower = Math.round((e.species === 'boss' ? (e.heavy ? 125 + w.bossPhase * 30 : 45 + w.bossPhase * 12) : spec.damage) * depth(vigor(w)));
          const power = Math.max(1, (rawPower - Math.floor(w.defenseBonus / 15)) / (1 + w.honorBonus)); const damage = dodged ? 0 : blocked ? Math.ceil(power * .15) : power;
          if (blocked) w.blocks++;
          if (dodged) w.dodges++;
          w.hp = Math.max(0, w.hp - damage); w.pose = dodged ? 'dodge' : blocked ? 'block' : 'hit'; w.poseUntil = Math.max(w.poseUntil, w.time + .28); w.heroActionAt = w.time;
          fx(w, w.heroX, dodged ? 'dodge' : blocked ? 'block' : `−${damage}`, dodged ? 'dodge' : blocked ? 'block' : 'hit');
          if (e.species === 'boss' || e.species === 'moth') {
            w.followerHp.forEach((hp, i) => {
              if (hp <= 0) return;
              if (!e.heavy && (e.attacks + i) % 3 === 0) { w.followerPose[i] = 'dodge'; w.followerUntil[i] = w.time + .45; fx(w, w.followerX[i], 'dodge', 'dodge', -i - 1); return; }
              const splash = blocked ? 2 : e.species === 'boss' ? 12 + w.bossPhase * 6 : 8;
              w.followerHp[i] = Math.max(0, hp - splash);
              w.followerPose[i] = w.followerHp[i] <= 0 ? 'death' : blocked ? 'block' : 'hit';
              w.followerUntil[i] = w.time + .4;
              fx(w, w.followerX[i], `−${splash}`, blocked ? 'block' : 'hit', -i - 1);
            });
          }
          if (e.species === 'boss') { fx(w, w.heroX + 45, '', 'shock', w.bossPhase); w.shake = Math.max(w.shake, e.heavy ? 1 : .55); }
          else if (!dodged && !blocked) w.shake = Math.max(w.shake, .22);
        }
      }
    }
    if (nearest && nearest.worldX - w.heroX <= (nearest.species === 'boss' ? 185 : 145) && w.time >= w.heroReady && w.time >= w.poseUntil) {
      w.target = nearest.id; w.combo = (w.combo + 1) % 3; w.heroReady = w.time + .95; w.heroImpact = w.time + .3; w.heroActionAt = w.time; w.pose = 'attack'; w.poseUntil = w.time + .7;
      if (w.phase === 'APPROACH') phase(w, 'FIGHT');
    }
    if (w.heroImpact && w.time >= w.heroImpact) {
      w.heroImpact = 0; const e = w.enemies.find(e => e.id === w.target);
      if (e && e.hp > 0 && e.worldX - w.heroX <= (e.species === 'boss' ? 195 : 158)) { hurt(w, e, BALANCE.basicDamage + w.attackBonus + (w.furyUntil > w.time ? Math.round(10 * might(w)) : 0)); fx(w, e.worldX - 25, '', 'slash', e.lane); }
    }
    for (let i = 0; i < 2; i++) {
      if (w.followerHp[i] <= 0) { w.followerPose[i] = 'death'; continue; }
      if (w.followerImpact[i] && w.time >= w.followerImpact[i]) {
        w.followerImpact[i] = 0;
        const target = w.enemies.find(e => e.id === w.followerTarget[i]);
        if (target && target.hp > 0) { hurt(w, target, Math.round((i ? 12 : 15) * might(w))); if (!i) fx(w, target.worldX - 25, '', 'slash', target.lane); }
      }
      if (['hit', 'dodge', 'block'].includes(w.followerPose[i]) && w.followerUntil[i] > w.time) continue;
      if (nearest && nearest.worldX - w.heroX < 210 && w.time >= w.followerReady[i]) {
        w.followerPose[i] = 'attack'; w.followerUntil[i] = w.time + .75; w.followerReady[i] = w.time + 1.6 + i * .2;
        w.followerTarget[i] = nearest.id; w.followerImpact[i] = w.time + (i ? .52 : .34);
      } else if (w.time >= w.followerUntil[i]) w.followerPose[i] = w.followerV[i] > 9 ? 'run' : 'idle';
    }
    if (w.auto) {
      // Reserve energy for readable boss counterplay; basic attacks remain automatic.
      if (alive.some(e => e.species === 'boss' && e.heavy && e.impact > w.time && e.impact - w.time < .6) && w.shieldUntil <= w.time && w.dodgeUntil <= w.time) {
        if (!skill(w, 'ward')) skill(w, 'dodge');
      }
      if (w.hp <= w.maxHp - BALANCE.healing * vigor(w)) skill(w, 'heal');
      if (alive.length >= 2 && w.energy >= SKILLS.cleave.cost + SKILLS.ward.cost) skill(w, 'cleave');
    }
    if (!w.hp) { w.pose = 'death'; w.followerHp = [0, 0]; w.followerPose = ['death', 'death']; w.heroImpact = 0; phase(w, 'DEFEAT'); return; }
    if (!w.enemies.some(e => e.hp > 0)) phase(w, 'CLEAR');
  }
  if (w.phase === 'CLEAR') {
    // A short breath after the fight, then the road continues from this exact spot.
    travel(w, dt, w.heroX);
    if (w.time - w.phaseAt > 1.1) {
      w.enemies = []; w.wave++;
      if (w.room === 2 && w.bossSpawned) { w.pose = 'idle'; phase(w, 'VICTORY'); }
      else if (w.room === 2) { w.bossSpawned = true; spawn(w, true); }
      else if (w.wave < 2) spawn(w);
      else { w.portalX = w.heroX + TRAVEL.portalLeg; w.stopX = w.portalX - 96; phase(w, 'RUN_RIGHT'); }
    }
  }
  if (w.phase === 'PORTAL_CHOICE') { w.heroV = 0; w.pose = 'idle'; w.followerPose = w.followerHp.map(hp => hp > 0 ? 'idle' : 'death'); }
  if (w.phase === 'PORTAL_ENTER') {
    const target = w.portalX + (w.selected === 1 ? 112 : 0);
    travel(w, dt, target, 150);
    if (w.heroX >= target - .05 && age > 1.2) phase(w, 'NEXT_ROOM');
  }
  if (w.phase === 'NEXT_ROOM' && age > .65) {
    // The arch opens on a new stretch of the same world: coordinates keep growing, nothing is rewound.
    w.biome = PORTALS[w.room][w.selected ?? 0].biome; w.route.push(w.biome); w.room++; w.wave = 0; w.runeCollected = false;
    w.roomX = Math.ceil((w.portalX + 900) / 100) * 100; w.heroX = w.roomX + 175; w.heroV = 0;
    w.followerX = w.followerHp.map((hp, i) => hp > 0 ? w.heroX - TRAVEL.followerGap[i] : -100000); w.followerV = [0, 0];
    w.cameraX = w.roomX; w.selected = null; w.enemies = []; phase(w, 'ENTER');
  }
  // Companions keep their own pace a few steps behind and never stand inside the hero.
  for (let i = 0; i < 2; i++) {
    if (w.followerHp[i] <= 0) { w.followerV[i] = 0; continue; }
    const goal = w.heroX - TRAVEL.followerGap[i], gap = goal - w.followerX[i];
    const move = Math.max(-(w.heroV + 70) * dt, Math.min((w.heroV + 70) * dt, gap * (1 - Math.exp(-6 * dt))));
    w.followerX[i] += move; w.followerV[i] = Math.abs(move) / Math.max(dt, 1e-6); w.followerStride[i] += Math.abs(move);
    if (!['APPROACH', 'FIGHT', 'BOSS'].includes(w.phase) && w.time >= w.followerUntil[i]) w.followerPose[i] = w.followerV[i] > 9 ? 'run' : 'idle';
  }
  // Exact exponential smoothing: frame-rate independent and never overshoots the hero.
  const lead = w.enemies.reduce<Enemy | undefined>((a, b) => b.hp > 0 && (!a || b.worldX < a.worldX) ? b : a, undefined);
  let desired = w.heroX - TRAVEL.follow;
  if (['APPROACH', 'FIGHT', 'BOSS', 'WAVE_SPAWN'].includes(w.phase) && lead) desired = Math.min(w.heroX - 128, Math.max(w.heroX - TRAVEL.follow, (w.heroX + lead.worldX) / 2 - 232));
  if (w.phase === 'RUN_RIGHT' && !lead && w.portalX > w.roomX) desired = Math.min(desired, w.portalX - TRAVEL.portalScreenX);
  if (['PORTAL_CHOICE', 'PORTAL_ENTER', 'NEXT_ROOM'].includes(w.phase)) desired = w.portalX - TRAVEL.portalScreenX;
  desired = Math.max(w.roomX, desired);
  w.cameraX += (desired - w.cameraX) * (1 - Math.exp(-4.5 * dt));
  if (Math.abs(desired - w.cameraX) < .02) w.cameraX = desired;
}
