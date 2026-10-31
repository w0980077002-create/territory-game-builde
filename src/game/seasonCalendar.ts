import { weeklyQuestKey } from './weeklyQuests';

/** Calendar dates are UTC. This is a preview clock, never an award authority. */
export interface SeasonWindow {
  weekKey: string;
  startsAt: number;
  endsAt: number;
  remainingMs: number;
}

/** Convert a YYYY-MM-DD UTC day into its exact midnight epoch. */
export function utcMidnight(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('Invalid UTC calendar day');
  const [year, month, date] = day.split('-').map(Number);
  const midnight = Date.UTC(year, month - 1, date);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) throw new RangeError('Invalid calendar date');
  return midnight;
}

export function seasonWindow(now: number = Date.now()): SeasonWindow {
  const weekKey = weeklyQuestKey(now);
  const [year, month, day] = weekKey.split('-').map(Number);
  const nextMonday = new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  const startsAt = utcMidnight(weekKey);
  const endsAt = utcMidnight(nextMonday);
  if (!(startsAt <= now && now < endsAt)) throw new RangeError('Season window mismatch');
  return { weekKey, startsAt, endsAt, remainingMs: endsAt - now };
}

/** Arena TOP-50 only: the approved PvP week is Sunday-to-Sunday, 00:00 UTC.
 * Keep the quest/event calendar separate; changing its week would also affect
 * unrelated rewards. The server RPC remains the authority for recorded wins.
 */
export function arenaSeasonWindow(now: number = Date.now()): SeasonWindow {
  if (!Number.isFinite(now)) throw new RangeError('Invalid Arena clock');
  const date = new Date(now);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const startsAt = midnight - date.getUTCDay() * 86_400_000;
  const endsAt = startsAt + 7 * 86_400_000;
  if (!(startsAt <= now && now < endsAt)) throw new RangeError('Arena week mismatch');
  return {
    weekKey: new Date(startsAt).toISOString().slice(0, 10),
    startsAt,
    endsAt,
    remainingMs: endsAt - now,
  };
}

export function seasonCountdown(ms: number, language: 'ru' | 'en' = 'ru') {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return language === 'en' ? `${days}d ${hours}h ${mins}m` : `${days}д ${hours}ч ${mins}м`;
}

/** The server championship starts Sunday 00:00 Europe/Kyiv (DST aware).
 * This differs from both Monday UTC quests and Sunday UTC Arena TOP-50. */
export function kyivSeasonWeekKey(now: number = Date.now()): string {
  if (!Number.isFinite(now)) throw new RangeError('Invalid championship clock');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));
  const number = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const day = Date.UTC(number('year'), number('month') - 1, number('day'));
  return new Date(day - new Date(day).getUTCDay() * 86_400_000).toISOString().slice(0, 10);
}
