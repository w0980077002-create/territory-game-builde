/** Deterministic, PvE-only combat tuning. Never rewrites saved player progress,
 * forge levels, currencies, PvP combat, rewards or stone purchases.
 *
 * Early onboarding is kept familiar, while post-100 content does not flatten.
 * Adjust coefficients here, with the PvE regression tests, rather than
 * spreading undocumented multipliers across campaign and trials.
 */
const ramp = (level: number, start: number, end: number) =>
  Math.min(1, Math.max(0, (level - start) / (end - start)));
const safeLevel = (raw: number) =>
  Number.isFinite(raw) ? Math.max(1, Math.min(100_000, Math.floor(raw))) : 1;
const lateGrowth = (level: number) => Math.pow(Math.max(0, level - 100) / 100, 0.9);

export interface EnemyMultipliers { hp: number; attack: number; defense: number }

/** Campaign: first three chapters retain their former 1x multipliers.
 * After chapter 100, the endless soft power-law ramp prevents 3000+ floors
 * from becoming flat linear damage sponges with negligible attack.
 */
export function chapterEnemyMultipliers(chapter: number): EnemyMultipliers {
  const level = safeLevel(chapter);
  const early = ramp(level, 3, 20);
  const mid = ramp(level, 20, 100);
  const late = lateGrowth(level);
  return {
    hp: (1 + 0.26 * early + 0.52 * mid) * (1 + 0.40 * late),
    attack: (1 + 0.20 * early + 0.36 * mid) * (1 + 0.24 * late),
    defense: (1 + 0.20 * early + 0.40 * mid) * (1 + 0.32 * late),
  };
}

/** Every 5th chapter is a tougher boss; 10th chapters are milestones.
 * Chapter one through four never receive an additional milestone modifier.
 */
export function bossEnemyMultipliers(chapter: number): EnemyMultipliers {
  const level = safeLevel(chapter);
  if (level >= 10 && level % 10 === 0) return { hp: 1.32, attack: 1.16, defense: 1.18 };
  if (level >= 5 && level % 5 === 0) return { hp: 1.15, attack: 1.08, defense: 1.08 };
  return { hp: 1, attack: 1, defense: 1 };
}

/** Trials remain harder than equivalent campaign chapters, including beyond 100. */
export function trialEnemyMultipliers(floor: number): EnemyMultipliers {
  const level = safeLevel(floor);
  const campaign = chapterEnemyMultipliers(level);
  const scale = ramp(level, 3, 60);
  return {
    hp: campaign.hp * (1 + 0.38 * scale),
    attack: campaign.attack * (1 + 0.27 * scale),
    defense: campaign.defense * (1 + 0.30 * scale),
  };
}

/** Combined hero+follower damage budget for a whole PvE round.
 * A strong hero can still progress faster, but cannot skip a boss or trial
 * with one enormous legacy, crit, forge or companion attack. Since the enemy
 * attacks between rounds, blocks and potions remain important.
 * Ordinary enemies start using the cap only after the tutorial chapters.
 */
export function eliteRoundDamageCap(enemyId: string, isBoss: boolean, maxHp: number): number | null {
  if (!Number.isFinite(maxHp) || maxHp < 1) return null;
  if (enemyId.startsWith('trial_')) return Math.max(1, Math.floor(maxHp * 0.34));
  if (isBoss) return Math.max(1, Math.floor(maxHp * 0.40));
  const match = /^ch([1-9]\d*)_enemy_\d+$/.exec(enemyId);
  if (!match) return null;
  const chapter = Number(match[1]);
  if (chapter < 15) return null;
  const fraction = chapter >= 300 ? 0.50 : chapter >= 100 ? 0.55 : chapter >= 50 ? 0.62 : 0.72;
  return Math.max(1, Math.floor(maxHp * fraction));
}

/** Guardian follower's survivability contribution: max 12% mitigation. */
export function followerGuardDamage(incoming: number, defense: number): number {
  if (!Number.isFinite(incoming) || incoming <= 0) return 0;
  const safeDefense = Number.isFinite(defense) && defense > 0 ? defense : 0;
  const reduction = Math.min(Math.ceil(incoming * 0.12), Math.floor(safeDefense * 0.6), Math.max(0, incoming - 1));
  return Math.max(1, incoming - reduction);
}
