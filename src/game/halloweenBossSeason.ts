// Pure seasonal gate: keep City startup and isolated preview fixtures free
// of Supabase requests and optional event code.
export const HALLOWEEN_BOSS_END = Date.parse('2026-11-03T00:00:00Z');
export const HALLOWEEN_BOSS_START = Date.parse('2026-10-31T00:00:00Z');

export function halloweenBossInSeason(): boolean {
  const now = Date.now();
  return now >= HALLOWEEN_BOSS_START && now < HALLOWEEN_BOSS_END;
}
