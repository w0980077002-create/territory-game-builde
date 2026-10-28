/** All chances/fractions are 0..1; all time values are milliseconds. */
export type IdleActor = 'hero' | 'enemy';
export type IdleSkillCategory = 'base' | 'core' | 'control' | 'awakening' | 'final';
export interface IdleStats {
  maxHp: number;
  attack: number;
  defense?: number;
  attackIntervalMs?: number;
  windupMs?: number;
  critChance?: number;
  criticalMultiplier?: number;
  blockChance?: number;
  blockReduction?: number;
  dodgeChance?: number;
  precision?: number;
  maxEnergy?: number;
  energy?: number;
  energyRegenPerSecond?: number;
}
export type IdleEffect =
  | { type: 'burn'; strength: number; durationMs: number; tickMs: number; target?: 'self' | 'opponent'; vfxKey?: string }
  | { type: 'slow' | 'mitigation' | 'crit' | 'precision'; strength: number; durationMs: number; target?: 'self' | 'opponent'; vfxKey?: string }
  | { type: 'magic'; strength: number; target?: 'self' | 'opponent'; vfxKey?: string }
  | { type: 'energy'; strength: number; target?: 'self' | 'opponent'; vfxKey?: string };
export interface IdleSkill {
  id: string;
  category: IdleSkillCategory;
  cooldownMs: number;
  energyCost: number;
  priority?: number;
  condition?: { selfHpBelow?: number; enemyHpBelow?: number; energyAtLeast?: number };
  /** Omit for an effects-only skill. Basic attacks always use multiplier 1. */
  multiplier?: number;
  windupMs?: number;
  /** Real physical contacts per cast; 1..3, each with its own impact and dodge/block roll. */
  hitCount?: number;
  /** Milliseconds between consecutive contacts. A cast spends energy/cooldown once. */
  hitGapMs?: number;
  effects?: IdleEffect[];
  vfxKey?: string;
}
export interface IdleRune {
  id: string;
  /** At least one compatibility list is required; if both exist, both must match. */
  skillIds?: string[];
  categories?: IdleSkillCategory[];
  chance: number;
  cooldownMs: number;
  effects: IdleEffect[];
  vfxKey?: string;
}
export interface IdlePassive {
  id: string;
  /** Additive stat bonuses, applied once when combat is created. */
  modifiers: Partial<IdleStats>;
}
export interface IdleCatalog { skills: IdleSkill[]; runes: IdleRune[]; passives: IdlePassive[] }
export interface IdleLoadout {
  active: { skillId: string; runeIds?: string[] }[];
  passiveIds: string[];
}
export interface IdleCombatInput {
  seed: number;
  hero: IdleStats;
  enemy: IdleStats;
  stage: number;
  catalog: IdleCatalog;
  loadout: IdleLoadout;
  /** Optional finite sequence, used only inside this simulation; no rewards. */
  nextEnemies?: IdleStats[];
  approachMs?: number;
  stageTransitionMs?: number;
  /** Safety horizon, rounded up to a fixed step and limited to 10 minutes. */
  maxDurationMs?: number;
}
export type IdleEventType = 'spawn' | 'approach' | 'attack_start' | 'impact' | 'critical' | 'block' | 'dodge'
  | 'status_apply' | 'status_expire' | 'rune_proc' | 'death' | 'stage_clear' | 'loot_visual';
export interface IdleCombatEvent {
  id: string;
  atMs: number;
  stage: number;
  actor: IdleActor;
  type: IdleEventType;
  skillId?: string;
  runeId?: string;
  value?: number;
  target?: IdleActor;
  vfxKey?: string;
  /** Only impact changes HP; value is actual HP lost, hpAfter is authoritative. */
  hpAfter?: number;
  source?: 'attack' | IdleEffect['type'];
  statusId?: string;
  contactId?: string;
  hitIndex?: number;
  hitCount?: number;
}
export interface IdleFighter {
  stats: Required<IdleStats>;
  hp: number;
  energy: number;
  readyAtMs: number;
  pendingAttack?: { atMs: number; skillId?: string; contactId: string;
    hitIndex?: number; hitCount?: number; hitGapMs?: number };
  cooldowns: Record<string, number>;
  runeCooldowns: Record<string, number>;
}
export interface IdleStatus {
  id: string;
  actor: IdleActor;
  target: IdleActor;
  skillId?: string;
  runeId?: string;
  type: 'burn' | 'slow' | 'mitigation' | 'crit' | 'precision';
  strength: number;
  expiresAtMs: number;
  tickMs?: number;
  nextTickMs?: number;
  vfxKey?: string;
}
/** Plain serializable snapshot. Advance returns a fresh snapshot without mutating this one. */
export interface IdleCombatState {
  version: 1;
  phase: 'approach' | 'combat' | 'transition' | 'victory' | 'defeat' | 'timeout' | 'invalid';
  timeMs: number;
  remainderMs: number;
  maxDurationMs: number;
  stage: number;
  rng: number;
  sequence: number;
  hero: IdleFighter;
  enemy: IdleFighter;
  catalog: IdleCatalog;
  loadout: IdleLoadout;
  statuses: IdleStatus[];
  nextEnemies: IdleStats[];
  approachMs: number;
  stageTransitionMs: number;
  phaseEndsAtMs: number;
  pendingEvents: IdleCombatEvent[];
  validationErrors: string[];
}
