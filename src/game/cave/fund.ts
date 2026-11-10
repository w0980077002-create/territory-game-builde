/**
 * Dark Energy Fund — progress from the MAXIMUM cleared cave floor.
 * Free track only. The premium track, payments and exact live rewards are
 * not approved and are not modelled as claimable anywhere.
 * Reward amounts are test-sandbox values.
 */
import { GEM_TYPES, type GemTypeId } from './gems';

export const FUND_THRESHOLDS: readonly number[] = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
export type FundReward = Readonly<{ essence: number; gem: { type: GemTypeId; level: number } | null; item: boolean }>;

export function fundReward(threshold: number): FundReward {
  const step = threshold / 5;
  return {
    essence: 15 + threshold,
    gem: threshold % 10 === 0
      ? { type: GEM_TYPES[(threshold / 10 - 1) % GEM_TYPES.length].id, level: threshold <= 30 ? 1 : threshold <= 70 ? 2 : 3 }
      : null,
    item: step % 5 === 0,
  };
}

/** Exactly one claim per threshold, only for a depth the player really reached. */
export function planFundClaim(claimed: readonly number[], threshold: number, maxClearedFloor: number):
  { ok: true } | { ok: false; reason: 'invalid_threshold' | 'not_reached' | 'already_claimed' } {
  if (!FUND_THRESHOLDS.includes(threshold)) return { ok: false, reason: 'invalid_threshold' };
  if (!Number.isInteger(maxClearedFloor) || maxClearedFloor < threshold) return { ok: false, reason: 'not_reached' };
  if (claimed.includes(threshold)) return { ok: false, reason: 'already_claimed' };
  return { ok: true };
}
