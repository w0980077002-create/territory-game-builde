import { ZONES, type Zone } from './arenaApi';
import type { Enemy, GameState, InventoryItem } from './types';
import { getComputedStats } from './engine';
import { eliteRoundDamageCap, followerGuardDamage } from './pveBalance';
import { followerCombat, selectedFollower } from './followers';
import { forgeSetBonus } from './forge';

export interface PveSide {
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  critChance: number;
  critDamage: number;
  /** PvE-only enemy metadata; optional on hero and existing test fixtures. */
  enemyId?: string;
  isBoss?: boolean;
}

export interface PveHit {
  attacker: string;
  target: string;
  targetSide: 'hero' | 'enemy';
  zone: Zone;
  tone: 'hit' | 'crit' | 'block' | 'dodge';
  amount: number;
}

const DODGE_CHANCE = 6;
const zoneOf = (z: Zone) => ZONES.find((x) => x.id === z)!;
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export function randomZones(): { attack: Zone; blocks: Zone[] } {
  // Fisher-Yates: sort(() => Math.random() - 0.5) biases probabilities.
  const ids = ZONES.map((z) => z.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return { attack: pick(ZONES).id, blocks: ids.slice(0, 2) };
}

export function heroSide(state: GameState): PveSide {
  const s = getComputedStats(state);
  const forge = forgeSetBonus(state.player.equipped);
  const follower = followerCombat(selectedFollower(state));
  const hp = Math.max(1, Math.round(s.maxHp * (1 + forge.hp)));
  return { name: state.player.name, hp, maxHp: hp, attack: Math.round(s.attack * (1 + forge.attack)), defense: Math.round(s.defense * (1 + forge.defense)), critChance: Math.min(95, s.critChance + follower.crit), critDamage: s.critDamage };
}

export function enemySide(e: Enemy): PveSide {
  return { name: e.name, hp: e.maxHp, maxHp: e.maxHp, attack: e.attack, defense: e.defense, critChance: e.isBoss ? 8 : 4, critDamage: 50, enemyId: e.id, isBoss: e.isBoss };
}

function strike(from: PveSide, to: PveSide, targetSide: PveHit['targetSide'], zone: Zone, blocked: Zone[]): PveHit {
  const base = { attacker: from.name, target: to.name, targetSide, zone };
  if (Math.random() * 100 < DODGE_CHANCE) return { ...base, tone: 'dodge', amount: 0 };
  const crit = Math.random() * 100 < from.critChance;
  const isBlocked = blocked.includes(zone);
  if (isBlocked && !crit) return { ...base, tone: 'block', amount: 0 };
  const spread = 0.9 + Math.random() * 0.2;
  let dmg = Math.max(1, (from.attack - to.defense / 2) * zoneOf(zone).mult * spread);
  if (crit) dmg *= 1 + from.critDamage / 100;
  if (crit && isBlocked) dmg *= 0.5;
  return { ...base, tone: crit ? 'crit' : 'hit', amount: Math.round(dmg) };
}

export interface RoundResult {
  hits: PveHit[];
  hero: PveSide;
  enemy: PveSide;
  healAmount: number;
}

export function playRound(hero: PveSide, enemy: PveSide, attack: Zone, blocks: Zone[], followerAttack: number, followerName: string, followerDefense = 0, bonus: ReturnType<typeof followerCombat> | null = null): RoundResult {
  const ai = randomZones();
  const hits: PveHit[] = [];
  const cap = eliteRoundDamageCap(enemy.enemyId ?? '', !!enemy.isBoss, enemy.maxHp);
  let damageBudget = cap ?? Number.POSITIVE_INFINITY;
  const piercedEnemy = bonus?.pierce ? { ...enemy, defense: Math.max(0, Math.floor(enemy.defense * (1 - bonus.pierce))) } : enemy;
  const rawHit = strike(hero, piercedEnemy, 'enemy', attack, ai.blocks.slice(0, 1));
  const firstDamage = Math.min(rawHit.amount, damageBudget, enemy.hp);
  const h1 = { ...rawHit, amount: firstDamage };
  hits.push(h1);
  damageBudget -= firstDamage;
  let enemyHp = Math.max(0, enemy.hp - firstDamage);
  if (enemyHp > 0 && followerAttack > 0 && damageBudget > 0) {
    const companionDamage = Math.min(Math.max(0, Math.floor(followerAttack)), damageBudget, enemyHp);
    if (companionDamage > 0) {
      const f: PveHit = { attacker: followerName, target: enemy.name, targetSide: 'enemy', zone: pick(ZONES).id, tone: 'hit', amount: companionDamage };
      hits.push(f);
      enemyHp = Math.max(0, enemyHp - companionDamage);
    }
  }
  let heroHp = hero.hp;
  if (enemyHp > 0) {
    const rawEnemyHit = strike(enemy, hero, 'hero', ai.attack, blocks);
    const mitigated = rawEnemyHit.amount > 0 ? followerGuardDamage(rawEnemyHit.amount, followerDefense) : 0;
    const h2 = { ...rawEnemyHit, amount: mitigated };
    hits.push(h2);
    heroHp = Math.max(0, heroHp - h2.amount);
  }
  const healAmount = heroHp > 0 && enemyHp > 0 && bonus?.heal ? Math.min(Math.max(0, hero.maxHp - heroHp), bonus.heal) : 0;
  return { hits, hero: { ...hero, hp: heroHp + healAmount }, enemy: { ...enemy, hp: enemyHp }, healAmount };
}

export type PotionUse =
  | { ok: true; hero: PveSide; text: string }
  | { ok: false; text: string };

export function applyPotion(hero: PveSide, item: InventoryItem): PotionUse {
  if (item.arenaEffect) return { ok: false, text: `${item.name} действует только на арене` };
  const e = item.effect;
  if (!e || !Number.isFinite(e.value) || e.value <= 0 || e.value > 1000000) return { ok: false, text: 'Этот предмет нельзя выпить в бою' };
  if (e.stat === 'hp') {
    if (hero.hp >= hero.maxHp) return { ok: false, text: 'Здоровье уже полное' };
    const hp = Math.min(hero.maxHp, hero.hp + e.value);
    return { ok: true, hero: { ...hero, hp }, text: `+${hp - hero.hp} HP` };
  }
  if (e.stat === 'attack') return { ok: true, hero: { ...hero, attack: hero.attack + e.value }, text: `+${e.value} к атаке до конца боя` };
  if (e.stat === 'defense') return { ok: true, hero: { ...hero, defense: hero.defense + e.value }, text: `+${e.value} к защите до конца боя` };
  if (e.stat === 'critChance') return { ok: true, hero: { ...hero, critChance: hero.critChance + e.value }, text: `+${e.value}% к криту до конца боя` };
  return { ok: false, text: 'Этот предмет нельзя выпить в бою' };
}

export function describeHit(h: PveHit): string {
  const zone = zoneOf(h.zone).label.toLowerCase();
  if (h.tone === 'dodge') return `${h.target} уклоняется от удара ${h.attacker}`;
  if (h.tone === 'block') return `${h.target} блокирует удар в ${zone}`;
  if (h.tone === 'crit') return `${h.attacker} — КРИТ в ${zone}: −${h.amount}`;
  return `${h.attacker} бьёт в ${zone}: −${h.amount}`;
}
