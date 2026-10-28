import { forgeCost, forgeSuccessRate } from './forge';

export interface ForgeForecast {
  fromLevel: number;
  toLevel: number;
  levels: number;
  firstSuccessChance: number;
  nextCost: { gold: number; materials: number };
  /** Statistical expectations for repeated independent attempts, not guarantees. */
  expectedAttempts: number;
  expectedGold: number;
  expectedMaterials: number;
}

/**
 * Read-only preview, derived from the EXISTING forge rules.
 *
 * The character's permitted level bounds the forecast; this function cannot
 * forge an item, buy resources or change a save. Each step is geometric:
 * E[attempts at level L] = 1 / successChance(L). The costs are paid on every
 * try (including failures), exactly as in forgeAttempt.
 */
export function forecastForgeUpgrade(itemLevel: number, heroLevel: number, requestedLevels = 1): ForgeForecast | null {
  if (!Number.isSafeInteger(itemLevel) || itemLevel < 1 || !Number.isSafeInteger(heroLevel) || heroLevel <= itemLevel ||
      !Number.isSafeInteger(requestedLevels) || requestedLevels < 1 || requestedLevels > 3) return null;

  const count = Math.min(requestedLevels, heroLevel - itemLevel);
  const firstChance = forgeSuccessRate(itemLevel);
  const nextCost = forgeCost(itemLevel);
  let expectedAttempts = 0;
  let expectedGold = 0;
  let expectedMaterials = 0;
  for (let i = 0; i < count; i++) {
    const level = itemLevel + i;
    const chance = forgeSuccessRate(level);
    const cost = forgeCost(level);
    // Keep output finite when a malformed future configuration is introduced.
    if (!Number.isFinite(chance) || chance <= 0 || chance > 1 ||
        !Number.isSafeInteger(cost.gold) || cost.gold < 0 ||
        !Number.isSafeInteger(cost.materials) || cost.materials < 0) return null;
    const attempts = 1 / chance;
    expectedAttempts += attempts;
    expectedGold += cost.gold * attempts;
    expectedMaterials += cost.materials * attempts;
  }
  if (![expectedAttempts, expectedGold, expectedMaterials].every(Number.isFinite)) return null;
  return {
    fromLevel: itemLevel,
    toLevel: itemLevel + count,
    levels: count,
    firstSuccessChance: firstChance,
    nextCost,
    expectedAttempts,
    expectedGold,
    expectedMaterials,
  };
}
