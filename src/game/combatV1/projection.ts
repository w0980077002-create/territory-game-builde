import type { PlayerStats } from '../types';
import type { IdleStats } from '../idleEngine/types';

/** Server projection boundary, not a proof of provenance. Call only after the
 * existing gear/stat ledger has been verified. A browser save is not authority.
 * Existing stats express critical chance/damage in percent; engine uses ratios. */
export function projectTerritoryCombatStats(verified: PlayerStats,
  chances: { dodgeChance: number; blockChance: number }): IdleStats {
  if (!verified || ![verified.hp, verified.maxHp, verified.attack, verified.defense]
    .every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000)
    || verified.maxHp < 1 || verified.hp > verified.maxHp
    || !Number.isFinite(verified.critChance) || verified.critChance < 0 || verified.critChance > 100
    || !Number.isFinite(verified.critDamage) || verified.critDamage < 0 || verified.critDamage > 99_900
    || !chances || ![chances.dodgeChance, chances.blockChance].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
    throw new Error('combat_invalid_verified_projection');
  }
  return { hp: verified.hp, maxHp: verified.maxHp, attack: verified.attack, defense: verified.defense,
    critChance: verified.critChance / 100, critMultiplier: 1 + verified.critDamage / 100,
    dodgeChance: chances.dodgeChance, blockChance: chances.blockChance };
}
