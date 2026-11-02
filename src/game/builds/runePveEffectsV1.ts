/** Staged only: a local-PvE projection of the server's 45-effect catalog.
 * It consumes ONLY a status already validated by parseRuneServerStatus and
 * never grants ownership, persists rewards or replaces server PvP calculation.
 * Values intentionally mirror territory_rune_effects_v1.sql.
 */
import catalog from '../config/territory-independent-rune-slots-v1.json';
import { runeSlotCatalog, validateRuneSlots, type RuneServerStatus } from './runeSlotsV1';

export type PveRuneTotals = Readonly<Record<string, number>>;
export const RUNE_PVE_CATALOG: Readonly<Record<string, { key: string; perLevelBp: number }>> = {
  shield_wall_r1: { key: 'guard_absorb_bp', perLevelBp: 120 },
  shield_wall_r2: { key: 'counter_damage_bp', perLevelBp: 120 },
  shield_wall_r3: { key: 'guard_duration_bp', perLevelBp: 150 },
  axe_storm_r1: { key: 'damage_bonus_bp', perLevelBp: 100 },
  axe_storm_r2: { key: 'bleed_chance_bp', perLevelBp: 120 },
  axe_storm_r3: { key: 'haste_bp', perLevelBp: 100 },
  hawk_shot_r1: { key: 'accuracy_bp', perLevelBp: 120 },
  hawk_shot_r2: { key: 'armor_pen_bp', perLevelBp: 110 },
  hawk_shot_r3: { key: 'crit_chance_bp', perLevelBp: 80 },
  frost_oath_r1: { key: 'slow_duration_bp', perLevelBp: 130 },
  frost_oath_r2: { key: 'damage_vs_slow_bp', perLevelBp: 120 },
  frost_oath_r3: { key: 'root_chance_bp', perLevelBp: 70 },
  battle_chant_r1: { key: 'buff_duration_bp', perLevelBp: 140 },
  battle_chant_r2: { key: 'next_attack_bp', perLevelBp: 150 },
  battle_chant_r3: { key: 'guard_absorb_bp', perLevelBp: 110 },
  runic_bolt_r1: { key: 'energy_gain_bp', perLevelBp: 90 },
  runic_bolt_r2: { key: 'chain_chance_bp', perLevelBp: 70 },
  runic_bolt_r3: { key: 'spell_damage_bp', perLevelBp: 120 },
  rune_snare_r1: { key: 'root_duration_bp', perLevelBp: 150 },
  rune_snare_r2: { key: 'area_radius_bp', perLevelBp: 100 },
  rune_snare_r3: { key: 'dispel_chance_bp', perLevelBp: 80 },
  quickstep_r1: { key: 'dodge_chance_bp', perLevelBp: 80 },
  quickstep_r2: { key: 'next_enemy_damage_reduction_bp', perLevelBp: 140 },
  quickstep_r3: { key: 'counter_damage_bp', perLevelBp: 110 },
  fire_net_r1: { key: 'root_duration_bp', perLevelBp: 120 },
  fire_net_r2: { key: 'burn_chance_bp', perLevelBp: 100 },
  fire_net_r3: { key: 'enemy_accuracy_reduction_bp', perLevelBp: 100 },
  ancestral_surge_r1: { key: 'buff_duration_bp', perLevelBp: 120 },
  ancestral_surge_r2: { key: 'guard_absorb_bp', perLevelBp: 130 },
  ancestral_surge_r3: { key: 'energy_gain_bp', perLevelBp: 100 },
  blood_rush_r1: { key: 'attack_chain_damage_bp', perLevelBp: 110 },
  blood_rush_r2: { key: 'rage_damage_reduction_bp', perLevelBp: 110 },
  blood_rush_r3: { key: 'crit_chance_bp', perLevelBp: 90 },
  forest_awakening_r1: { key: 'slow_chance_bp', perLevelBp: 90 },
  forest_awakening_r2: { key: 'regen_bp', perLevelBp: 120 },
  forest_awakening_r3: { key: 'dodge_chance_bp', perLevelBp: 90 },
  storm_judgement_r1: { key: 'single_target_damage_bp', perLevelBp: 120 },
  storm_judgement_r2: { key: 'dot_damage_bp', perLevelBp: 110 },
  storm_judgement_r3: { key: 'cooldown_reduction_bp', perLevelBp: 100 },
  winter_breaker_r1: { key: 'damage_vs_guard_bp', perLevelBp: 130 },
  winter_breaker_r2: { key: 'area_radius_bp', perLevelBp: 100 },
  winter_breaker_r3: { key: 'slow_duration_bp', perLevelBp: 120 },
  wolf_king_r1: { key: 'buff_duration_bp', perLevelBp: 120 },
  wolf_king_r2: { key: 'finisher_damage_bp', perLevelBp: 140 },
  wolf_king_r3: { key: 'control_resist_bp', perLevelBp: 110 },
};
/** Explicit shared-battle equivalents for mechanics that do not exist in
 * every game mode (e.g. a multi-target spell during a single-target duel).
 * The original effect remains unchanged; these are additional small bonuses.
 * Keep this mapping identical to territory_rune_effects_v1.sql.
 */
export const RUNE_TACTICAL_FAMILIES: Readonly<Record<string,string>> = {
  counter_damage_bp: 'rune_combat_damage_bp',
  bleed_chance_bp: 'rune_combat_damage_bp',
  haste_bp: 'rune_combat_damage_bp',
  damage_vs_slow_bp: 'rune_combat_damage_bp',
  next_attack_bp: 'rune_combat_damage_bp',
  energy_gain_bp: 'rune_combat_damage_bp',
  chain_chance_bp: 'rune_combat_damage_bp',
  spell_damage_bp: 'rune_combat_damage_bp',
  area_radius_bp: 'rune_combat_damage_bp',
  burn_chance_bp: 'rune_combat_damage_bp',
  attack_chain_damage_bp: 'rune_combat_damage_bp',
  single_target_damage_bp: 'rune_combat_damage_bp',
  dot_damage_bp: 'rune_combat_damage_bp',
  cooldown_reduction_bp: 'rune_combat_damage_bp',
  finisher_damage_bp: 'rune_combat_damage_bp',
  guard_duration_bp: 'rune_combat_guard_bp',
  buff_duration_bp: 'rune_combat_guard_bp',
  next_enemy_damage_reduction_bp: 'rune_combat_guard_bp',
  rage_damage_reduction_bp: 'rune_combat_guard_bp',
  regen_bp: 'rune_combat_guard_bp',
  control_resist_bp: 'rune_combat_guard_bp',
  root_duration_bp: 'rune_combat_guard_bp',
  dispel_chance_bp: 'rune_combat_crit_bp',
  root_chance_bp: 'rune_combat_dodge_bp',
  slow_chance_bp: 'rune_combat_dodge_bp',
  enemy_accuracy_reduction_bp: 'rune_combat_dodge_bp',
  armor_pen_bp: 'rune_combat_accuracy_bp',
  slow_duration_bp: 'rune_combat_accuracy_bp',
};
export function runeTacticalEquivalent(runeId: string, level: number): { key:string; bp:number } | null {
  const definition = RUNE_PVE_CATALOG[runeId];
  const key = definition && RUNE_TACTICAL_FAMILIES[definition.key];
  if (!key || !Number.isSafeInteger(level) || level < 1 || level > 3) return null;
  return { key, bp: Math.max(1, Math.floor(definition.perLevelBp * level / 2)) };
}
const definitions = runeSlotCatalog(catalog);

/** Freeze the selected rune ranks and their effects at fight entry, not on each strike.
 * All totals are basis points and each separate effect is capped at 25%.
 * This is a battle-calculation adapter, NOT an authorization boundary:
 * the calling screen MUST have received a verified server RPC status.
 */
export function localPveRuneTotals(status: RuneServerStatus): PveRuneTotals {
  const checked = validateRuneSlots(status, definitions, status.owned, status.revision);
  const totals: Record<string, number> = {};
  for (const slot of checked.slots) {
    if (slot.runeId === null) continue;
    const effect = RUNE_PVE_CATALOG[slot.runeId];
    const level = status.owned[slot.runeId];
    if (!effect || !Number.isSafeInteger(level) || level < 1 || level > 3) {
      throw Error('rune_pve_invalid_ownership');
    }
    totals[effect.key] = Math.min(2500, (totals[effect.key] ?? 0) + effect.perLevelBp * level);
    const equivalent = runeTacticalEquivalent(slot.runeId, level);
    if (equivalent) totals[equivalent.key] = Math.min(2500,
      (totals[equivalent.key] ?? 0) + equivalent.bp);
  }
  return Object.freeze(totals);
}
