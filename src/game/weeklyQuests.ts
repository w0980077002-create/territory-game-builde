/** The shared game calendar always uses UTC, independent of device locale. */
export function calendarDayKey(now: number = Date.now()): string {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid date');
  return date.toISOString().slice(0, 10);
}

export function previousCalendarDayKey(now: number = Date.now()): string {
  const today = calendarDayKey(now);
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * Weekly quests use Monday 00:00 UTC through the next Monday 00:00 UTC,
 * matching the weekly season. Only the server may authorize rewards.
 */
export function weeklyQuestKey(now: number = Date.now()): string {
  const today = calendarDayKey(now);
  const [year, month, day] = today.split('-').map(Number);
  const monday = new Date(Date.UTC(year, month - 1, day));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}
