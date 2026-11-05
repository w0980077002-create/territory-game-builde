import type { GameState } from './types';
import { beltContext, refillBeltFromInventory } from './belt';

type VerifiedVipView = {
  permanentVip: number;
  vip: number;
  vipRemaining: number;
  vipCheckedAt: number;
};

/** The only safe legacy Campaign/Trials VIP refill is one saved in the very
 * same crash-recoverable terminal snapshot as the last fight. Never run a
 * separate, unsaved mutation when the player taps Next/Back.
 *
 * This is inventory convenience, NOT a reward calculation or proof of VIP
 * payment. The server remains authoritative for claimed rewards.
 */
export function prepareClassicPveBeltSnapshot(
  state: GameState,
  account: VerifiedVipView,
  arenaWins: number,
  now = performance.now(),
): GameState {
  if (!state.autoRefillBelt) return state;
  if (!Number.isInteger(account.permanentVip) || !Number.isInteger(account.vip)
    || account.permanentVip < 0 || account.permanentVip > 10
    || account.vip < 0 || account.vip > 10) return state;

  const temporary = Number.isFinite(account.vipRemaining)
    && Number.isFinite(account.vipCheckedAt)
    && account.vipRemaining > 0
    && now - account.vipCheckedAt < account.vipRemaining
    ? account.vip : 0;
  if (Math.max(account.permanentVip, temporary) < 3) return state;
  // Null/broken Arena wins must never unlock more belt slots.
  if (!Number.isSafeInteger(arenaWins) || arenaWins < 0) return state;

  return refillBeltFromInventory(state, beltContext(state, arenaWins));
}
