/**
 * Previously agreed weekly Arena TOP-50 prize PLAN, displayed for information.
 * This file does not grant prizes and must never be used to authorize payouts.
 * A separate server-reviewed reward flow is required before any grants go live.
 */
export interface ArenaPrizePreviewTier {
  from: number;
  to: number;
  blueGems: number;
  redGems: number;
  stones: number;
  elixirs: number;
}

export const ARENA_PRIZE_PREVIEW: readonly ArenaPrizePreviewTier[] = [
  { from: 1, to: 1, blueGems: 120, redGems: 3, stones: 25, elixirs: 20 },
  { from: 2, to: 2, blueGems: 80, redGems: 2, stones: 20, elixirs: 15 },
  { from: 3, to: 3, blueGems: 50, redGems: 1, stones: 15, elixirs: 12 },
  { from: 4, to: 4, blueGems: 30, redGems: 0, stones: 12, elixirs: 10 },
  { from: 5, to: 5, blueGems: 30, redGems: 0, stones: 10, elixirs: 8 },
  { from: 6, to: 50, blueGems: 15, redGems: 0, stones: 5, elixirs: 5 },
];

export function arenaPrizePreviewForRank(rank: number | null): ArenaPrizePreviewTier | null {
  if (rank === null || !Number.isSafeInteger(rank) || rank < 1 || rank > 50) return null;
  return ARENA_PRIZE_PREVIEW.find((tier) => rank >= tier.from && rank <= tier.to) ?? null;
}
