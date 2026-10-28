/** Pure, serializable combat contract. All balance values are supplied by the server catalog. */
export type IdleCategory = 'base' | 'core' | 'control' | 'awakening' | 'final';
export type IdleActor = 'hero' | 'enemy';
export type IdleMode = 'pve' | 'boss' | 'pvp';
export type IdleEffectType = 'burn' | 'slow' | 'mitigation' | 'crit' | 'magic' | 'energy' | 'precision'
  | 'heal' | 'interrupt' | 'attack' | 'defense';
export interface IdleEffect {
  type: IdleEffectType;
  target: 'self' | 'opponent';
  /** attack/defense: additive self-buff ratio. heal: flat HP. interrupt: zero (no damage). */
  value: number;
  /** For interrupt, explicit immunity window after cancellation; never an invented stun timer. */
  durationMs: number;
  tickMs?: number;
  vfxKey?: string;
}
export interface IdleSkillLevel {
  multiplier: number;
  energyCost: number;
  cooldownMs: number;
  windupMs: number;
  effects: IdleEffect[];
}
export interface IdleSkill {
  id: string;
  category: IdleCategory;
  unlockLevel: number;
  priority: number;
  /** Optional emergency condition, as remaining HP / maximum HP. */
  hpBelow?: number;
  levels: IdleSkillLevel[];
  vfxKey?: string;
}
export interface IdleRuneLevel {
  chance: number;
  cooldownMs: number;
  effects: IdleEffect[];
}
export interface IdleRune {
  id: string;
  unlockLevel: number;
  compatibleSkillIds: string[];
  levels: IdleRuneLevel[];
  vfxKey?: string;
}
export interface IdlePassive {
  id: string;
  unlockLevel: number;
  /** Permanent self modifiers only: crit, precision, mitigation, attack, defense. */
  levels: { effects: IdleEffect[] }[];
}
export interface IdleCatalog { skills: IdleSkill[]; runes: IdleRune[]; passives: IdlePassive[] }
export interface IdleLoadout {
  skills: { skillId: string; level: number; runes: { runeId: string; level: number }[] }[];
  passives: { passiveId: string; level: number }[];
}
/** Always construct from authoritative account data on the server. */
export interface IdleOwnership {
  heroLevel: number;
  skills: Record<string, number>;
  runes: Record<string, number>;
  passives: Record<string, number>;
}
export interface IdleStats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  critChance: number;
  /** Per-fighter critical multiplier, e.g. 1 + existing critDamage / 100. */
  critMultiplier?: number;
  dodgeChance: number;
  blockChance: number;
}
export interface IdlePhase {
  id: string;
  hpBelow: number;
  attackMultiplier: number;
  defenseMultiplier: number;
  resistances: Partial<Record<IdleEffectType, number>>;
}
export interface IdleFighterInput {
  stats: IdleStats;
  loadout: IdleLoadout;
  ownership?: IdleOwnership;
  resistances?: Partial<Record<IdleEffectType, number>>;
  phases?: IdlePhase[];
}
export interface IdleCombatRules {
  stepMs: number;
  maxDurationMs: number;
  approachMs: number;
  attackIntervalMs: number;
  basicWindupMs: number;
  basicMultiplier: number;
  defenseFactor: number;
  magicDefenseFactor: number;
  minimumDamage: number;
  critMultiplier: number;
  blockMultiplier: number;
  maxEnergy: number;
  initialEnergy: number;
  energyPerSecond: number;
  /** Explicit independent tuning per PvE / boss / PvP. */
  modeDamageMultiplier: Record<IdleMode, number>;
}
export interface IdleCombatInput {
  seed: number;
  stage: number;
  mode: IdleMode;
  control: 'auto' | 'manual';
  hero: IdleFighterInput;
  enemy: IdleFighterInput;
  catalog: IdleCatalog;
  rules: IdleCombatRules;
}
export interface IdleCombatEvent {
  id: string;
  atMs: number;
  actor: IdleActor;
  type: 'spawn' | 'approach' | 'attack_start' | 'impact' | 'critical' | 'block' | 'dodge'
    | 'status_apply' | 'status_expire' | 'rune_proc' | 'death' | 'stage_clear' | 'loot_visual'
    | 'phase_change' | 'timeout' | 'heal';
  target?: IdleActor;
  skillId?: string;
  runeId?: string;
  effectId?: string;
  phaseId?: string;
  value?: number;
  vfxKey?: string;
}
export interface IdleStatus {
  id: string;
  source: IdleActor;
  effect: IdleEffect;
  skillId?: string;
  runeId?: string;
  expiresAtMs: number;
  nextTickAtMs: number;
}
export interface IdleFighterState extends IdleFighterInput {
  energy: number;
  nextAttackAtMs: number;
  cooldowns: Record<string, number>;
  runeCooldowns: Record<string, number>;
  statuses: IdleStatus[];
  pending: { atMs: number; skillId?: string } | null;
  phase: number;
}
export interface IdleCombatState {
  version: 1;
  input: IdleCombatInput;
  actors: Record<IdleActor, IdleFighterState>;
  atMs: number;
  remainderMs: number;
  rng: number;
  nextEventId: number;
  status: 'fighting' | 'hero_won' | 'enemy_won' | 'draw';
  manualQueue: { atMs: number; actor: IdleActor; skillId: string }[];
  bufferedEvents: IdleCombatEvent[];
}
