import { supabase } from './supabase';

export interface ArenaWeeklyPlayer {
  player_id: string;
  display_name: string;
  level: number;
  appearance: string;
  wins: number;
  rank: number;
}

export interface ArenaWeeklyStatus {
  starts_at: string;
  ends_at: string;
  my_wins: number;
  my_rank: number | null;
  leaders: ArenaWeeklyPlayer[];
}

/** Results are recorded only when the server finishes an arena room.
 * No local win counters or user-writable leaderboard data are trusted. */
export async function getArenaWeeklyStatus(): Promise<ArenaWeeklyStatus> {
  const { data, error } = await supabase.rpc('arena_weekly_top50_v1');
  if (error) throw new Error('weekly_arena_unavailable');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('weekly_arena_invalid');
  const value = data as Record<string, unknown>;
  if (typeof value.ends_at !== 'string' || typeof value.starts_at !== 'string' || !Array.isArray(value.leaders)) {
    throw new Error('weekly_arena_invalid');
  }
  const leaders = value.leaders.filter((item): item is ArenaWeeklyPlayer => {
    if (!item || typeof item !== 'object') return false;
    const p = item as Record<string, unknown>;
    return typeof p.player_id === 'string'
      && typeof p.display_name === 'string'
      && typeof p.appearance === 'string'
      && Number.isSafeInteger(p.level) && (p.level as number) >= 1
      && Number.isSafeInteger(p.wins) && (p.wins as number) >= 1
      && Number.isSafeInteger(p.rank) && (p.rank as number) >= 1;
  }).slice(0, 50);
  return {
    starts_at: value.starts_at,
    ends_at: value.ends_at,
    my_wins: Number.isSafeInteger(value.my_wins) ? Math.max(0, value.my_wins as number) : 0,
    my_rank: Number.isSafeInteger(value.my_rank) && (value.my_rank as number) > 0 ? value.my_rank as number : null,
    leaders,
  };
}
