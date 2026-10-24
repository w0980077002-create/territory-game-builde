/**
 * TERRITORY 2.0 — deterministic PREVIEW combat core.
 *
 * The browser may use this to render a lively, responsive side-scrolling fight.
 * It is NOT authority for rewards, spending, PvP matchmaking or wallet changes.
 * Those require server-authoritative operations in an isolated staging project.
 */
export type HeroClass = 'berserker' | 'runemage' | 'ranger';
export type RuneKind = 'flame' | 'frost' | 'thunder' | 'guardian';
export type CompanionKind = 'guardian' | 'warrior' | 'healer' | 'hunter' | 'mage';
export type CombatEventKind = 'attack' | 'crit' | 'block' | 'dodge' | 'burn' | 'stun' | 'heal' | 'shield' | 'follower' | 'defeat' | 'victory';
export type CombatTarget = 'hero' | 'enemy';

export interface CombatStats {
  readonly level: number;
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly critChance: number;
  readonly dodgeChance: number;
}

export interface CombatConfig {
  readonly heroClass: HeroClass;
  readonly hero: CombatStats;
  readonly enemy: CombatStats;
  readonly enemyName: string;
  readonly boss: boolean;
  readonly rune: RuneKind;
  readonly companion: CompanionKind;
  readonly speed: 1 | 2;
}

export interface BattleEffect {
  kind: CombatEventKind;
  target: CombatTarget;
  amount: number;
  caption: string;
}

export interface PreviewCombatState {
  config: CombatConfig;
  tick: number;
  heroHp: number;
  enemyHp: number;
  mana: number;
  maxMana: number;
  heroShield: number;
  enemyBurnTicks: number;
  enemyStunnedTicks: number;
  heroCharge: number;
  finished: 'victory' | 'defeat' | null;
  events: readonly BattleEffect[];
  /**
   * Deliberately always zero. Ordinary auto-combat never spends a stone.
   * This state has no awardXp, grantGold or awardEquipment function.
   */
  stonesSpent: 0;
}

const cap = (value: number, lo: number, hi: number): number =>
  Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : lo;
const round = (value: number): number => Math.round(value);
const randomUnit = (random: number): number => cap(random, 0, 0.999999);

export const V2_PREVIEW_BIOMES = [
  'Зелёные земли', 'Северный лес', 'Ледяные горы',
  'Огненные руины', 'Сумрачные пещеры', 'Чертоги великанов',
] as const;

export function encounterForChapter(chapter: number, wave: number, heroClass: HeroClass = 'berserker'): CombatConfig {
  const ch = round(cap(chapter, 1, 1000));
  const w = round(cap(wave, 1, 5));
  const boss = w === 5;
  const level = ch * 2 + Math.floor(w / 2);
  return {
    heroClass,
    hero: {
      level: Math.max(1, level),
      hp: 500 + level * 55,
      attack: 36 + level * 9,
      defense: 10 + level * 4,
      critChance: 0.12,
      dodgeChance: 0.06,
    },
    enemy: {
      level,
      hp: round((300 + level * 39) * (boss ? 3.8 : 1)),
      attack: round((19 + level * 6) * (boss ? 1.27 : 1)),
      defense: 8 + level * 3,
      critChance: boss ? 0.10 : 0.06,
      dodgeChance: boss ? 0.04 : 0.08,
    },
    enemyName: boss ? 'Каменный великан' : ['Волк', 'Гоблин', 'Разбойник', 'Тролль'][w - 1] ?? 'Враг',
    boss, rune: 'flame', companion: 'guardian', speed: 1,
  };
}

export function startPreviewEncounter(config: CombatConfig): PreviewCombatState {
  const heroMaxHp = round(cap(config.hero.hp, 1, 1e9));
  const enemyMaxHp = round(cap(config.enemy.hp, 1, 1e9));
  return {
    config,
    tick: 0,
    heroHp: heroMaxHp,
    enemyHp: enemyMaxHp,
    mana: 100,
    maxMana: 100,
    heroShield: 0,
    enemyBurnTicks: 0,
    enemyStunnedTicks: 0,
    heroCharge: 0,
    finished: null,
    events: [],
    stonesSpent: 0,
  };
}

function incomingDamage(attack: number, defense: number, multiplier = 1): number {
  const raw = cap(attack, 1, 1e9) * multiplier - cap(defense, 0, 1e9) * 0.35;
  return round(cap(raw, 1, 99999999));
}

/**
 * Advance exactly one battle tick. Randomness is injected for deterministic
 * tests and reproducible animations. The client cannot mint server rewards.
 */
export function nextPreviewTick(state: PreviewCombatState, random: number): PreviewCombatState {
  if (state.finished) return state;
  const { hero, enemy, heroClass, companion, rune, boss } = state.config;
  const r = randomUnit(random);
  const tick = state.tick + 1;
  const effects: BattleEffect[] = [];
  let hp = state.heroHp;
  let enemyHp = state.enemyHp;
  let mana = Math.min(100, state.mana + 6);
  let shield = state.heroShield;
  let burn = state.enemyBurnTicks;
  let stun = state.enemyStunnedTicks;
  let charge = state.heroCharge;

  if (burn > 0) {
    const periodic = Math.max(1, round(hero.attack * 0.12));
    const actual = Math.min(periodic, enemyHp);
    enemyHp -= actual;
    burn -= 1;
    effects.push({ kind: 'burn', target: 'enemy', amount: actual, caption: 'Горение' });
  }

  // Hero skill every fourth tick. Different classes interact with different
  // runes; keep cooldown deterministic so players understand the battle.
  const skillReady = tick % 4 === 0 && mana >= 25;
  let multiplier = 1;
  if (skillReady && enemyHp > 0) {
    mana -= 25;
    if (heroClass === 'berserker') multiplier = 1.8;
    if (heroClass === 'runemage') multiplier = 1.48;
    if (heroClass === 'ranger') multiplier = 1.58;
    if (rune === 'flame') burn = 3;
    if (rune === 'frost') stun = Math.max(stun, 1);
    if (rune === 'thunder') charge = Math.min(3, charge + 1);
    if (rune === 'guardian') {
      shield += round(hero.hp * 0.07);
      effects.push({ kind: 'shield', target: 'hero', amount: shield, caption: 'Рунный щит' });
    }
  }

  if (enemyHp > 0 && r >= enemy.dodgeChance) {
    const critical = r > 1 - hero.critChance;
    const chargeBoost = charge > 0 ? 1 + charge * 0.18 : 1;
    const raw = incomingDamage(hero.attack, enemy.defense, multiplier * chargeBoost * (critical ? 1.45 : 1));
    const actual = Math.min(enemyHp, raw);
    enemyHp -= actual;
    effects.push({ kind: critical ? 'crit' : 'attack', target: 'enemy', amount: actual, caption: skillReady ? 'Навык' : 'Удар' });
    charge = 0;
  } else if (enemyHp > 0) {
    effects.push({ kind: 'dodge', target: 'enemy', amount: 0, caption: 'Уклонение' });
  }

  // Only one ACTIVE follower. Auras and extra support slots must be designed
  // independently and capped before joining a real PvP ruleset.
  if (enemyHp > 0) {
    if (companion === 'warrior' || companion === 'hunter' || companion === 'mage') {
      const portion = companion === 'warrior' ? 0.28 : companion === 'hunter' ? 0.2 : 0.22;
      const actual = Math.min(enemyHp, Math.max(1, round(hero.attack * portion)));
      enemyHp -= actual;
      effects.push({ kind: 'follower', target: 'enemy', amount: actual, caption: 'Спутник' });
    }
  }

  if (companion === 'healer' && tick % 5 === 0 && hp > 0 && hp < hero.hp) {
    const heal = Math.min(hero.hp - hp, round(hero.hp * 0.08));
    hp += heal;
    effects.push({ kind: 'heal', target: 'hero', amount: heal, caption: 'Исцеление' });
  }

  if (enemyHp > 0 && tick % 2 === 0) {
    if (stun > 0) {
      stun -= 1;
      effects.push({ kind: 'stun', target: 'enemy', amount: 0, caption: 'Оглушён' });
    } else if (r >= hero.dodgeChance) {
      const resist = companion === 'guardian' ? 0.77 : 1;
      const bossPhase = boss && enemyHp < enemy.hp / 2 ? 1.15 : 1;
      let damage = incomingDamage(enemy.attack, hero.defense, resist * bossPhase);
      const absorbed = Math.min(shield, damage);
      shield -= absorbed;
      damage -= absorbed;
      const actual = Math.min(hp, damage);
      hp -= actual;
      effects.push({ kind: absorbed > 0 && actual === 0 ? 'block' : 'attack', target: 'hero', amount: actual, caption: 'Ответный удар' });
    } else {
      effects.push({ kind: 'dodge', target: 'hero', amount: 0, caption: 'Уклонение' });
    }
  }

  const finished = enemyHp <= 0 ? 'victory' : hp <= 0 ? 'defeat' : null;
  if (finished) {
    effects.push({ kind: finished, target: finished === 'victory' ? 'enemy' : 'hero', amount: 0, caption: finished === 'victory' ? 'Победа!' : 'Поражение' });
  }

  return {
    ...state,
    tick,
    heroHp: Math.max(0, round(hp)),
    enemyHp: Math.max(0, round(enemyHp)),
    mana,
    heroShield: Math.max(0, round(shield)),
    enemyBurnTicks: burn,
    enemyStunnedTicks: stun,
    heroCharge: charge,
    finished,
    stonesSpent: 0,
    events: effects,
  };
}

export function previewTimeline(config: CombatConfig, seed = 12345, maxTicks = 300): PreviewCombatState {
  let state = startPreviewEncounter(config);
  let rng = Math.floor(cap(seed, 0, 2147483647));
  for (let i = 0; i < Math.floor(cap(maxTicks, 0, 10000)) && !state.finished; i += 1) {
    rng = (1664525 * rng + 1013904223) >>> 0;
    state = nextPreviewTick(state, rng / 4294967296);
  }
  return state;
}
