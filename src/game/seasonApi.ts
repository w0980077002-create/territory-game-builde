import { supabase } from './supabase';

/** Server-owned season results only. Never derive points from a client save. */
export interface SeasonRow {
  player_id: string;
  display_name: string;
  points: number;
  rank: number;
}
export interface SeasonStatus {
  enabled: boolean;
  week: string;
  ends_at: string;
  my_points: number;
  my_rank: number | null;
  leaders: SeasonRow[];
}

export async function fetchSeasonStatus(): Promise<SeasonStatus | null> {
  const { data, error } = await supabase.rpc('territory_season_status_v1');
  // Missing read-only RPC is expected before the staged season release.
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(error.message)) return null;
    throw new Error('Season status unavailable');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const status = data as Record<string, unknown>;
  if (typeof status.week !== 'string' || typeof status.enabled !== 'boolean') return null;
  const leaders: SeasonRow[] = Array.isArray(status.leaders)
    ? status.leaders.filter((row): row is SeasonRow =>
      !!row && typeof row === 'object' && typeof row.player_id === 'string'
      && typeof row.display_name === 'string' && Number.isSafeInteger(row.points) && row.points >= 0
      && Number.isSafeInteger(row.rank) && row.rank >= 1)
    : [];
  return {
    enabled: status.enabled,
    week: status.week,
    ends_at: typeof status.ends_at === 'string' ? status.ends_at : '',
    my_points: Number.isSafeInteger(status.my_points) && (status.my_points as number) >= 0 ? status.my_points as number : 0,
    my_rank: Number.isSafeInteger(status.my_rank) && (status.my_rank as number) > 0 ? status.my_rank as number : null,
    leaders,
  };
}
