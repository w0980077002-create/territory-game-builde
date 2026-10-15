/** Optimistic-write version for the existing legacy `players.updated_at` column.
 * Only prevents accidental stale full-snapshot overwrites across game windows.
 * NOT an anti-cheat boundary; browsers can still forge columns via the API.
 */
export function validSaveToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && Number.isFinite(Date.parse(value));
}

export function nextSaveTimestamp(previous: string, now = Date.now()): string {
  const prior = Date.parse(previous);
  if (!Number.isFinite(prior) || !Number.isFinite(now)) throw new Error('invalid_save_token');
  // Always change the token, including when two saves complete in one ms.
  return new Date(Math.max(now, prior + 1)).toISOString();
}
