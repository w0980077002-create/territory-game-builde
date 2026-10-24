/**
 * TERRITORY 2.0 battle-stone domain design — no player state mutations.
 *
 * Call of Odin's Chosen reference: battle stones were committed separately to
 * a timed Plunder Mining round, not spent once per ordinary auto-combat enemy.
 * TERRITORY intentionally does NOT reproduce its cryptocurrency lottery.
 *
 * Existing TERRITORY limit of 25 daily purchasable stones is a SHOP cap, not
 * a rule charging one stone per enemy or per skill cast.
 *
 * Server confirmation required before any spending in the real game. This
 * client module describes costs for UI and tests only, never awards resources.
 */
export type V2StoneUse =
  | 'campaign-auto-enemy'
  | 'campaign-auto-boss'
  | 'campaign-manual-enemy'
  | 'campaign-manual-boss'
  | 'arena-pvp'
  | 'trial'
  | 'special-raid-entry';

export type V2StoneQuote =
  | { readonly ok: true; readonly cost: number; readonly remaining: number; readonly requiresConfirmation: boolean }
  | { readonly ok: false; readonly reason: 'invalid-wallet' | 'invalid-amount' | 'insufficient-stones' | 'requires-server-rules' };

export const V2_STONE_DESIGN = Object.freeze({
  campaignEnemyCost: 0,
  campaignBossCost: 0,
  chargeStoneOnEveryAutoKill: false,
  chargeStoneOnEveryVisualHit: false,
  serverAuthoritative: true,
  confirmedExplicitPurchaseLimitDaily: 25,
  specialRaidAutomaticDeduction: false,
  // Not a promised implementation of any Web3 earnings product.
  cryptocurrencyRewards: false,
});

/** For previews only. Never substitute this for a secure Supabase transaction. */
export function quoteV2BattleStones(
  activity: V2StoneUse,
  wallet: number,
  requestedAmount?: number,
): V2StoneQuote {
  if (!Number.isSafeInteger(wallet) || wallet < 0) return { ok: false, reason: 'invalid-wallet' };

  // Story campaign and boss progression can run continuously without a
  // per-enemy stone debit. This does not itself grant gold, XP, or items.
  if (activity.startsWith('campaign-')) {
    return { ok: true, cost: 0, remaining: wallet, requiresConfirmation: false };
  }

  // Normal arena and trial entry prices are to be derived from the eventual
  // V2 economy, not guessed from an unrelated competitor game.
  if (activity === 'arena-pvp' || activity === 'trial') {
    return { ok: false, reason: 'requires-server-rules' };
  }

  // Optional special raid: an explicit *player-selected* stone amount for
  // an independent server-validated activity, not one stone per killed enemy.
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount === undefined || requestedAmount < 1) {
    return { ok: false, reason: 'invalid-amount' };
  }
  if (requestedAmount > wallet) return { ok: false, reason: 'insufficient-stones' };
  return { ok: true, cost: requestedAmount, remaining: wallet - requestedAmount, requiresConfirmation: true };
}
