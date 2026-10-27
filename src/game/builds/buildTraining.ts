import expansionCatalog from '../config/territory-expansion-v1.json';
import type { PlayerStats } from '../types';

/** Pure, reward-free battle laboratory. Never write its output to GameState. */
export type BuildTrainingLoadout = {
  buildId: string;
  runeIds: string[];
  setId: string | null;
  mainRole: string | null;
  supportRoles: string[];
};

export type TrainingEnemy = {
  id: string;
  nameRu: string;
  nameEn: string;
  maxHp: number;
  attack: number;
  defense: number;
  isBoss?: boolean;
};

export type TrainingRound = {
  round: number;
  phase: number;
  abilityId: string;
  damage: number;
  incoming: number;
  healed: number;
  critical: boolean;
  evaded: boolean;
  heroHp: number;
  enemyHp: number;
};

export type TrainingResult = {
  victor: 'hero' | 'enemy' | 'timeout';
  heroStats: PlayerStats;
  rounds: TrainingRound[];
  damageDealt: number;
  damageTaken: number;
  enemyMaxHp: number;
  remainingHeroHp: number;
  remainingEnemyHp: number;
  reachedPhase: number;
  earnedRewards: false;
};

type BattleModifiers = {
  attackPct: number;
  defensePct: number;
  hpPct: number;
  critFlat: number;
  critDamagePct: number;
  evadePct: number;
  mitigationPct: number;
  healPct: number;
  burnPct: number;
  enemyWeaknessPct: number;
  ultimateRate: number;
};

type TrainingContext = { stats: PlayerStats; modifiers: BattleModifiers; skills: typeof expansionCatalog.skills[number][] };

export const TRAINING_BUILDS = expansionCatalog.heroBuilds;
export const TRAINING_SKILLS = expansionCatalog.skills;
export const TRAINING_RUNES = expansionCatalog.runes;
export const TRAINING_SETS = expansionCatalog.equipmentSetIdeas;
export const TRAINING_ROLES = expansionCatalog.companionRoles;

export const TRAINING_ENEMIES: readonly TrainingEnemy[] = [
  { id: 'forest_bandit', nameRu: 'Налётчик с тракта', nameEn: 'Road Raider', maxHp: 260, attack: 18, defense: 7 },
  { id: 'ice_guardian', nameRu: 'Ледяной дозорный', nameEn: 'Frost Sentinel', maxHp: 430, attack: 26, defense: 13 },
  { id: 'stone_ancient', nameRu: 'Каменный исполин', nameEn: 'Stone Colossus', maxHp: 780, attack: 37, defense: 19, isBoss: true },
];

const MAX_RUNES = 2;
const MAX_SUPPORTS = 2;
const BASE_PHASES = [0.65, 0.30] as const;
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));

const TAG_EFFECTS: Partial<Record<string, Partial<BattleModifiers>>> = {
  block: { defensePct: 0.05, mitigationPct: 0.02 },
  survival: { hpPct: 0.06 },
  slow: { enemyWeaknessPct: 0.04 },
  resistance: { mitigationPct: 0.04 },
  area: { attackPct: 0.035 },
  physical: { attackPct: 0.04 },
  damage: { attackPct: 0.04 },
  team: { healPct: 0.008 },
  crit: { critFlat: 3 },
  defense: { defensePct: 0.06 },
  magic: { attackPct: 0.04 },
  control: { enemyWeaknessPct: 0.035 },
  energy: { ultimateRate: 1 },
  precision: { critFlat: 3 },
  dodge: { evadePct: 0.035 },
  speed: { evadePct: 0.025 },
  burn: { burnPct: 0.025 },
};

const SPECIALITIES: Record<string, Partial<BattleModifiers>> = {
  survival: { defensePct: 0.12, hpPct: 0.10 },
  burst: { attackPct: 0.12, critDamagePct: 0.10 },
  control: { attackPct: 0.05, enemyWeaknessPct: 0.08 },
  precision: { attackPct: 0.05, critFlat: 7 },
};

const ROLE_EFFECTS: Record<string, Partial<BattleModifiers>> = {
  guardian: { defensePct: 0.05, mitigationPct: 0.02 },
  warrior: { attackPct: 0.045 },
  healer: { healPct: 0.012 },
  hunter: { critFlat: 2 },
  mage: { burnPct: 0.015 },
};

const SET_EFFECTS: Record<string, Partial<BattleModifiers>> = {
  block: { defensePct: 0.09, mitigationPct: 0.035 },
  crit: { critFlat: 6, critDamagePct: 0.10 },
  energy: { ultimateRate: 1, attackPct: 0.03 },
};

export function defaultTrainingLoadout(buildId = TRAINING_BUILDS[0].id): BuildTrainingLoadout {
  return { buildId, runeIds: [], setId: null, mainRole: null, supportRoles: [] };
}

export function validateTrainingLoadout(value: BuildTrainingLoadout): boolean {
  if (!value || !TRAINING_BUILDS.some(build => build.id === value.buildId)) return false;
  if (!Array.isArray(value.runeIds) || value.runeIds.length > MAX_RUNES || new Set(value.runeIds).size !== value.runeIds.length) return false;
  if (!value.runeIds.every(id => TRAINING_RUNES.some(r => r.id === id))) return false;
  if (!(value.setId === null || TRAINING_SETS.some(s => s.id === value.setId))) return false;
  if (!(value.mainRole === null || TRAINING_ROLES.some(role => role.id === value.mainRole))) return false;
  if (!Array.isArray(value.supportRoles) || value.supportRoles.length > MAX_SUPPORTS || new Set(value.supportRoles).size !== value.supportRoles.length) return false;
  if (value.mainRole && value.supportRoles.includes(value.mainRole)) return false;
  return value.supportRoles.every(id => TRAINING_ROLES.some(role => role.id === id));
}

function addEffect(target: BattleModifiers, effect: Partial<BattleModifiers> | undefined) {
  if (!effect) return;
  for (const key of Object.keys(effect) as (keyof BattleModifiers)[]) {
    const value = effect[key];
    if (typeof value === 'number' && Number.isFinite(value)) target[key] += value;
  }
}

function getContext(base: PlayerStats, loadout: BuildTrainingLoadout): TrainingContext | null {
  if (!validateTrainingLoadout(loadout)) return null;
  if (![base.maxHp, base.attack, base.defense, base.critChance, base.critDamage].every(v => Number.isFinite(v) && v >= 0 && v <= 1_000_000)) return null;
  if (base.maxHp < 1 || base.attack < 1) return null;
  const build = TRAINING_BUILDS.find(b => b.id === loadout.buildId)!;
  const skills = build.skillIds.map(id => TRAINING_SKILLS.find(s => s.id === id)!);
  const mods: BattleModifiers = { attackPct: 0, defensePct: 0, hpPct: 0, critFlat: 0, critDamagePct: 0, evadePct: 0,
    mitigationPct: 0, healPct: 0, burnPct: 0, enemyWeaknessPct: 0, ultimateRate: 0 };
  addEffect(mods, SPECIALITIES[build.speciality]);
  for (const skill of skills.filter(s => s.slot === 'passive')) for (const tag of skill.tags) addEffect(mods, TAG_EFFECTS[tag]);
  for (const id of loadout.runeIds) {
    const rune = TRAINING_RUNES.find(r => r.id === id)!;
    for (const tag of rune.tags) addEffect(mods, TAG_EFFECTS[tag]);
    if (rune.tags.some(tag => skills.some(s => s.tags.includes(tag)))) mods.attackPct += 0.015;
  }
  if (loadout.setId) addEffect(mods, SET_EFFECTS[TRAINING_SETS.find(s => s.id === loadout.setId)!.synergy]);
  // Support companions contribute a *smaller* aura in training than the main.
  if (loadout.mainRole) addEffect(mods, ROLE_EFFECTS[loadout.mainRole]);
  for (const role of loadout.supportRoles) {
    const bonus = ROLE_EFFECTS[role];
    if (bonus) addEffect(mods, Object.fromEntries(Object.entries(bonus).map(([key, v]) => [key, (v as number) * 0.5])) as Partial<BattleModifiers>);
  }
  mods.attackPct = clamp(mods.attackPct, 0, 0.45);
  mods.defensePct = clamp(mods.defensePct, 0, 0.45);
  mods.hpPct = clamp(mods.hpPct, 0, 0.4);
  mods.critFlat = clamp(mods.critFlat, 0, 25);
  mods.critDamagePct = clamp(mods.critDamagePct, 0, 0.3);
  mods.evadePct = clamp(mods.evadePct, 0, 0.15);
  mods.mitigationPct = clamp(mods.mitigationPct, 0, 0.2);
  mods.healPct = clamp(mods.healPct, 0, 0.04);
  mods.burnPct = clamp(mods.burnPct, 0, 0.08);
  mods.enemyWeaknessPct = clamp(mods.enemyWeaknessPct, 0, 0.25);
  mods.ultimateRate = clamp(mods.ultimateRate, 0, 2);
  const maxHp = Math.max(1, Math.round(base.maxHp * (1 + mods.hpPct)));
  return { stats: { hp: maxHp, maxHp, attack: Math.max(1, Math.round(base.attack * (1 + mods.attackPct))),
    defense: Math.max(0, Math.round(base.defense * (1 + mods.defensePct))),
    critChance: clamp(base.critChance + mods.critFlat, 0, 70),
    critDamage: clamp(base.critDamage * (1 + mods.critDamagePct), 0, 200) }, modifiers: mods, skills };
}

export function trainingBuildPreview(base: PlayerStats, loadout: BuildTrainingLoadout): PlayerStats | null {
  return getContext(base, loadout)?.stats ?? null;
}

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function simulateTrainingBattle(base: PlayerStats, loadout: BuildTrainingLoadout, enemy: TrainingEnemy,
  seed = 1, turnCap = 16): TrainingResult | null {
  const context = getContext(base, loadout);
  if (!context || !enemy || !Number.isInteger(seed) || !Number.isSafeInteger(turnCap) || turnCap < 1 || turnCap > 40) return null;
  if (![enemy.maxHp, enemy.attack, enemy.defense].every(v => Number.isFinite(v) && v >= 0 && v <= 1_000_000) || enemy.maxHp < 1) return null;
  const rand = seeded(seed);
  const { stats, modifiers, skills } = context;
  const active = skills.find(s => s.slot === 'active')!;
  const ultimate = skills.find(s => s.slot === 'ultimate')!;
  const ultInterval = Math.max(2, 5 - modifiers.ultimateRate);
  const rounds: TrainingRound[] = [];
  let heroHp = stats.maxHp, enemyHp = enemy.maxHp, dealt = 0, received = 0;
  let reachedPhase = 1;
  for (let turn = 1; turn <= turnCap && heroHp > 0 && enemyHp > 0; turn++) {
    const ultimateCast = turn % ultInterval === 0;
    const ability = ultimateCast ? ultimate : active;
    const skillPower = ultimateCast ? 1.48 : 1.12;
    const crit = rand() < stats.critChance / 100;
    const spread = 0.95 + rand() * 0.10;
    const rawDamage = Math.max(1, stats.attack * skillPower - enemy.defense * 0.45);
    const damage = Math.min(enemyHp, Math.max(1, Math.round(rawDamage * (crit ? 1 + stats.critDamage / 100 : 1) * spread * (1 + modifiers.burnPct))));
    enemyHp = Math.max(0, enemyHp - damage);
    dealt += damage;
    const hpRatio = enemyHp / enemy.maxHp;
    const phase = enemy.isBoss ? 1 + BASE_PHASES.filter(threshold => hpRatio <= threshold).length : 1;
    reachedPhase = Math.max(phase, reachedPhase);
    const evaded = enemyHp > 0 && rand() < modifiers.evadePct;
    const phaseBonus = enemy.isBoss ? [1, 1.20, 1.45][phase - 1] : 1;
    const incoming = enemyHp === 0 || evaded ? 0 : Math.min(heroHp, Math.max(1, Math.round(
      Math.max(1, enemy.attack * phaseBonus - stats.defense * 0.4) * (1 - modifiers.enemyWeaknessPct) * (1 - modifiers.mitigationPct))));
    heroHp = Math.max(0, heroHp - incoming);
    received += incoming;
    const healed = heroHp > 0 && enemyHp > 0 ? Math.min(stats.maxHp - heroHp, Math.round(stats.maxHp * modifiers.healPct)) : 0;
    heroHp += healed;
    rounds.push({ round: turn, phase, abilityId: ability.id, damage, incoming, healed, critical: crit, evaded, heroHp, enemyHp });
  }
  return { victor: enemyHp === 0 ? 'hero' : heroHp === 0 ? 'enemy' : 'timeout', heroStats: stats, rounds,
    damageDealt: dealt, damageTaken: received, enemyMaxHp: enemy.maxHp,
    remainingHeroHp: heroHp, remainingEnemyHp: enemyHp, reachedPhase, earnedRewards: false };
}
