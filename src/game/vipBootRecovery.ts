import type { GameState } from './types';
import { useGame } from './actions';
import { saveBlocked } from './cloud';
import { recoverVipDaily } from './vipDaily';
import { recoverVipWeekly } from './vipWeekly';

/** Resolve durable reward operations before gameplay or autosaving starts.
 * The marker is intentionally honored even if a feature flag is now off.
 */
function pendingVipClaims(userId:string) {
  return {
    daily: window.localStorage.getItem(`territory.vip.daily.pending.v1:${userId}`) !== null,
    weekly: window.localStorage.getItem(`territory.vip.weekly.pending.v1:${userId}`) !== null,
  };
}
export function hasPendingVipClaims(userId:string):boolean {
  const {daily,weekly}=pendingVipClaims(userId);
  return daily || weekly;
}
export async function recoverVipClaimsOnBoot(userId:string, state:GameState):Promise<GameState> {
  const {daily,weekly}=pendingVipClaims(userId);
  if (!daily && !weekly) return state;
  // Another durable operation already owns the save fence. A VIP receipt must
  // not release it or replace its pending state.
  if (saveBlocked.has(userId)) throw new Error('vip_boot_other_recovery_pending');
  useGame.set(state);
  if (daily) await recoverVipDaily(userId);
  if (weekly) await recoverVipWeekly(userId);
  return useGame.get();
}
