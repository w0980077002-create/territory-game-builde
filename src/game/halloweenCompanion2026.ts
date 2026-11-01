import { supabase } from './supabase';
import type { Follower, GameState } from './types';

/** Distinct from follower_6 (Battle Cow). Never award this from level progression. */
export const HALLOWEEN_COMPANION_ID = 'follower_pumpkin_witch_2026';
export const HALLOWEEN_COMPANION_LEVEL = 100;
export const HALLOWEEN_COMPANION_ADVANTAGE = 1.05;

/** Baseline: a fully trained level-60 Forest Healer has 62 attack and 15 heal.
 * The seasonal level-100 reward has 5% more of each, rounded to whole combat
 * numbers at the presentation boundary (65 attack, 16 heal). This does not
 * grant 5% to the HERO's global stats, PvP, item economy or premium resources.
 */
export const PUMPKIN_WITCH_BASELINE = { attack: 62, heal: 15 };
export const PUMPKIN_WITCH_COMBAT = {
  attack: Math.round(PUMPKIN_WITCH_BASELINE.attack * HALLOWEEN_COMPANION_ADVANTAGE),
  defense: 0,
  heal: Math.round(PUMPKIN_WITCH_BASELINE.heal * HALLOWEEN_COMPANION_ADVANTAGE),
  crit: 0,
  pierce: 0,
};

export const PUMPKIN_WITCH_TEMPLATE: Follower = {
  id: HALLOWEEN_COMPANION_ID,
  name: 'Тыквенная ведьма',
  icon: '🎃',
  level: HALLOWEEN_COMPANION_LEVEL,
  attack: PUMPKIN_WITCH_COMBAT.attack,
  defense: 1,
  unlocked: true,
  role: 'pumpkin',
  description: 'Эксклюзивный дар участнику Хэллоуинского рейда 2026. Уровень 100. Помогает герою в PvE.',
};

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
