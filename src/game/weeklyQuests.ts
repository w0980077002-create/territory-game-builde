/**
 * Weekly quests change on Sunday at 00:00 Europe/Kyiv, the same week boundary
 * planned for Territory seasons. Intl handles daylight-saving transitions.
 * This is client-side UX only, not an authoritative reward-security boundary.
 */
export function weeklyQuestKey(now: number = Date.now()): string {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid date');
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
  // Older Android ICU builds still use the legacy alias 'Europe/Kiev'.
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'Europe/Kyiv' }); }
  catch { formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'Europe/Kiev' }); }
  const pieces = formatter.formatToParts(date);
  const read = (type: string) => Number(pieces.find((part) => part.type === type)?.value ?? NaN);
  const year = read('year');
  const month = read('month');
  const day = read('day');
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) throw new RangeError('Invalid Kyiv date');
  // Date.UTC represents a calendar day; no local offset is added twice.
  const current = new Date(Date.UTC(year, month - 1, day));
  current.setUTCDate(current.getUTCDate() - current.getUTCDay());
  return current.toISOString().slice(0, 10);
}
