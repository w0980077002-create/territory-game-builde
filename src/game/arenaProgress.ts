import type { ArenaWeeklyDisplayPlayer } from './arenaWeeklyBots';

/**
 * Display-only target based on the standings visible right now.
 * Never reads/writes wallets, win counters or matchmaking state.
 */
export interface ArenaNextGoal {
  nextRank: number;
  targetWins: number;
  winsNeeded: number;
  progressPercent: number;
  opponentName: string;
}

/**
 * A real player must EXCEED another real player's victories (tie breakers use
 * rating on the server). Equal victories suffice to pass a simulated rival
 * because server-verified players win bot ties in the display ranking.
 * These values are moving targets; not guaranteed future positions.
 */
export function arenaNextGoal(
  leaders: ReadonlyArray<ArenaWeeklyDisplayPlayer>,
  myDisplayRank: number | null,
  myWins: number,
): ArenaNextGoal | null {
  if (!leaders.length || myDisplayRank === 1) return null;
  const nextRank = myDisplayRank != null && myDisplayRank > 1
    ? myDisplayRank - 1
    : 50;
  const opponent = leaders.find((entry) => entry.rank === nextRank);
  if (!opponent) return null;

  const normalizedWins = Number.isFinite(myWins) ? Math.max(0, Math.floor(myWins)) : 0;
  const targetWins = opponent.wins + (opponent.arenaBot ? 0 : 1);
  const winsNeeded = Math.max(1, targetWins - normalizedWins);
  const progressPercent = Math.max(2, Math.min(98, Math.round(normalizedWins / Math.max(1, targetWins) * 100)));
  return {
    nextRank,
    targetWins,
    winsNeeded,
    progressPercent,
    opponentName: opponent.display_name,
  };
}
