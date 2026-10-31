/** Read-only view of an already server-ordered TOP-50 result.
 * Never assign a global rank to a player outside the returned rows.
 */
export interface ArenaRankRow {
  player_id: string;
  arena_rating: number;
  arena_wins: number;
}

export function arenaRankView<T extends ArenaRankRow>(
  rows: readonly T[], playerId: string, metric: 'arena_rating' | 'arena_wins',
) {
  const mine = rows.findIndex(row => row.player_id === playerId);
  const myRow = mine >= 0 ? rows[mine] : null;
  const nextRival = mine > 0 ? rows[mine - 1] : null;
  const leader = rows[0] ?? null;
  const gap = myRow && nextRival
    ? Math.max(0, nextRival[metric] - myRow[metric])
    : null;
  return { mine, myRow, nextRival, leader, gap };
}
