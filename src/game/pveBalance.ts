/** Combat difficulty, deliberately scoped to PvE enemy generation only.
 * Chapter 1-3 are unchanged for onboarding. Strength ramps gently from 4-20,
 * and reaches a 40% health / 30% attack adjustment near chapter 100.
 * No player gear, currency, XP, or current floor is edited.
 */
const ramp = (level: number, start: number, end: number) =>
  Math.min(1, Math.max(0, (level - start) / (end - start)));

export interface EnemyMultipliers { hp: number; attack: number; defense: number }

export function chapterEnemyMultipliers(chapter: number): EnemyMultipliers {
  const a = ramp(chapter, 3, 20);
  const b = ramp(chapter, 20, 100);
  return { hp: 1 + 0.18 * a + 0.22 * b, attack: 1 + 0.12 * a + 0.18 * b, defense: 1 + 0.12 * a + 0.22 * b };
}

export function trialEnemyMultipliers(floor: number): EnemyMultipliers {
  const c = chapterEnemyMultipliers(floor);
  const scale = ramp(floor, 3, 60);
  return { hp: c.hp * (1 + 0.24 * scale), attack: c.attack * (1 + 0.15 * scale), defense: c.defense * (1 + 0.15 * scale) };
}

/** Elites cannot be killed by a single extremely powerful attack.
 * Cap the combined hero+follower damage *per round*, not each individual hit.
 * Trials 40%, bosses 48%. Ordinary enemies are unaffected.
 */
export function eliteRoundDamageCap(enemyId: string, isBoss: boolean, maxHp: number): number | null {
  if (!Number.isFinite(maxHp) || maxHp < 1) return null;
  if (enemyId.startsWith('trial_')) return Math.max(1, Math.floor(maxHp * 0.4));
  if (isBoss) return Math.max(1, Math.floor(maxHp * 0.48));
  return null;
}

/** Guardian follower's contribution to survivability: max 12% mitigation. */
export function followerGuardDamage(incoming: number, defense: number): number {
  if (!Number.isFinite(incoming) || incoming <= 0) return 0;
  const safeDefense = Number.isFinite(defense) && defense > 0 ? defense : 0;
  const reduction = Math.min(Math.ceil(incoming * 0.12), Math.floor(safeDefense * 0.6), Math.max(0, incoming - 1));
  return Math.max(1, incoming - reduction);
}
