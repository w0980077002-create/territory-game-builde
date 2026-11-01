import { supabase } from './supabase';
import type { GameState } from './types';
import { HALLOWEEN_COMPANION_ID, HALLOWEEN_COMPANION_LEVEL, PUMPKIN_WITCH_TEMPLATE } from './followers';
export {
  HALLOWEEN_COMPANION_ID, HALLOWEEN_COMPANION_LEVEL, HALLOWEEN_COMPANION_ADVANTAGE,
  PUMPKIN_WITCH_BASELINE, PUMPKIN_WITCH_COMBAT, PUMPKIN_WITCH_TEMPLATE,
} from './followers';

/** Only the server may establish eligibility, from the signed-in user's
 * actual boss hits after 2026-11-03T00:00Z. Never infer entitlement from
 * the visible leaderboard or a client-supplied saved companion.
 */
export async function claimPumpkinWitchEntitlement(): Promise<boolean> {
  const { data, error } = await supabase.rpc('territory_halloween_companion_claim_v1');
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('halloween_companion_bad_receipt');
  const value = data as Record<string, unknown>;
  if (value.eligible === false) return false;
  if (value.eligible !== true
    || value.rewardId !== HALLOWEEN_COMPANION_ID
    || value.level !== HALLOWEEN_COMPANION_LEVEL
    || typeof value.claimedAt !== 'string'
    || !Number.isFinite(Date.parse(value.claimedAt))) {
    throw new Error('halloween_companion_bad_receipt');
  }
  return true;
}

/** Uses the existing one-active-companion PvE model; changes no wallets,
 * inventory, Battle Cow, prior companion training or old user statistics.
 * This local representation is rehydrated from the permanent server ledger on
 * login and is NEVER authoritative evidence of reward ownership.
 */
export function installVerifiedPumpkinWitch(state: GameState): GameState {
  const existing = state.followers.filter(f => f.id !== HALLOWEEN_COMPANION_ID);
  return {
    ...state,
    halloweenCompanionVerified: true,
    followers: [...existing, { ...PUMPKIN_WITCH_TEMPLATE }],
  };
}
