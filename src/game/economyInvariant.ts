import type { GameState } from './types';

/** Mirror the production SQL guard before a network save.
 * This protects honest clients from corrupting their profile. It does NOT
 * authorize rewards: all client-side checks can be skipped by an attacker.
 */
export function validEconomySnapshot(state: GameState): boolean {
  const bounded = (n: unknown, low: number, high = 2147483647) =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= low && n <= high;
  if (!state || typeof state !== 'object' || !state.player) return false;
  if (!bounded(state.player.gold, 0) || !bounded(state.player.gems, 0)
    || !bounded(state.player.level, 1) || !bounded(state.battleStones, 0)) return false;
  // Existing legacy states without the daily counter can still be migrated.
  if (state.dailyStonesBought !== undefined && !bounded(state.dailyStonesBought, 0, 25)) return false;
  return true;
}
