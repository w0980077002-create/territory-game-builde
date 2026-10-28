/** Preview-only bridge: original Viking skill content -> deterministic combat API.
 * These values are laboratory balance, not live Arena stats or reward rules. */
import type { IdleCatalog, IdleCombatInput, IdleEffect, IdleLoadout } from '@/game/idleEngine';
import { IDLE_PASSIVES, IDLE_RUNES, IDLE_SKILLS, type SkillBranch } from './catalog';
import { buildPreviewCampaign } from './campaign';
import { COMPANION_ROSTER, DEFAULT_COMPANIONS } from './companions';

const second = (value: number) => Math.round(value * 1000);

const effect = (type: IdleEffect['type'], strength: number, durationMs = 0): IdleEffect => {
  if (type === 'magic' || type === 'energy' || type === 'heal') return { type, strength };
  if (type === 'burn') return { type, strength, durationMs, tickMs: 600 };
  return { type, strength, durationMs };
};

const skillEffects: Record<string, IdleEffect[]> = {
  double_cleave: [], hunter_lunge: [effect('precision', 0.12, 1900)], axe_circle: [],
  forge_heat: [effect('burn', 12, 1800)], storm_spark: [effect('magic', 34)], warband_roar: [effect('energy', 20)],
  ice_shackles: [effect('slow', 0.3, 2300)], ancestral_shield: [effect('mitigation', 0.3, 2500)],
  wolf_charge: [effect('slow', 0.15, 1700)], berserker_fury: [effect('crit', 0.22, 2800)],
  jarl_resolve: [effect('mitigation', 0.38, 3200)], valkyrie_song: [effect('heal', 95), effect('energy', 15)],
  thunder_wrath: [effect('magic', 82)], northern_blizzard: [effect('slow', 0.45, 3500)],
  burning_axe: [effect('burn', 28, 3000)],
};

const runeEffects: Record<string, IdleEffect[]> = {
  fire_ember: [effect('burn', 11, 1800)], glacial_edge: [effect('slow', 0.28, 2100)],
  storm_core: [effect('magic', 38), effect('energy', 9)], wolf_fang: [effect('crit', 0.25, 1700)],
  oak_bark: [effect('mitigation', 0.26, 2400)], seers_mark: [effect('precision', 0.28, 2100)],
};

const passiveBonuses = {
  northern_stamina: { maxHp: 250, defense: 5 },
  rune_sense: { maxEnergy: 20, energyRegenPerSecond: 5 },
  battle_memory: { attack: 9, critChance: 0.08 },
};

export function createPreviewCatalog(): IdleCatalog {
  return {
    skills: IDLE_SKILLS.map((skill) => ({
      id: skill.id, category: skill.branch, cooldownMs: second(skill.cooldownSeconds),
      energyCost: skill.energyCost, priority: 6 - ['base', 'core', 'control', 'awakening', 'final'].indexOf(skill.branch),
      multiplier: skill.branch === 'final' ? 2.2 : skill.branch === 'awakening' ? 1.7 : skill.branch === 'base' ? 1.35 : 0.9,
      windupMs: skill.branch === 'final' ? 400 : 230, hitCount: skill.hits, hitGapMs: skill.hitGapMs,
      effects: skillEffects[skill.id], vfxKey: skill.vfx,
    })),
    runes: IDLE_RUNES.map((rune) => ({
      id: rune.id, categories: [...rune.compatible], chance: 0.7, cooldownMs: 3000,
      effects: runeEffects[rune.id], vfxKey: rune.vfx,
    })),
    passives: IDLE_PASSIVES.map((passive) => ({ id: passive.id, modifiers: passiveBonuses[passive.id as keyof typeof passiveBonuses] })),
  };
}

export function createPreviewLoadout(selected: Readonly<Record<SkillBranch, string>>, runeSlots: Readonly<Record<string, string[]>>): IdleLoadout {
  return { active: Object.values(selected).map((skillId) => ({ skillId, runeIds: [...(runeSlots[skillId] ?? [])] })),
    passiveIds: IDLE_PASSIVES.map((passive) => passive.id) };
}

export function createPreviewInput(catalog: IdleCatalog, loadout: IdleLoadout,
  companionIds: readonly string[] = DEFAULT_COMPANIONS, startAtStage = 1): IdleCombatInput {
  const campaign = buildPreviewCampaign().slice(Math.max(0, Math.min(99, Math.floor(startAtStage) - 1)));
  return {
    seed: 128903 + campaign[0].index, stage: campaign[0].index, catalog, loadout, hero: {
      // Preview-only scaling permits replaying later chapters without real progression/rewards.
      maxHp: 2700 + (campaign[0].index - 1) * 35,
      attack: 90 + (campaign[0].index - 1) * 3,
      defense: 12 + Math.floor((campaign[0].index - 1) / 4), attackIntervalMs: 930, windupMs: 220,
      maxEnergy: 100, energy: 80, energyRegenPerSecond: 15, critChance: 0.12,
      criticalMultiplier: 1.7, blockChance: 0.16, blockReduction: 0.5, dodgeChance: 0.09,
    }, enemy: campaign[0].stats,
    enemyAbility: campaign[0].ability ?? null,
    nextEnemies: campaign.slice(1).map(stage => stage.stats),
    nextEnemyAbilities: campaign.slice(1).map(stage => stage.ability ?? null),
    companions: COMPANION_ROSTER.filter(companion => companionIds.includes(companion.id))
      .map(({ id, attack, intervalMs, windupMs, effects, vfxKey }) => ({ id, attack, intervalMs, windupMs, effects, vfxKey })),
    approachMs: 440, stageTransitionMs: 700, maxDurationMs: 600000,
  };
}
