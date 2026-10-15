import { weeklyQuestKey } from './weeklyQuests';

/** Calendar dates are Kyiv-local. This is a preview clock, never an award authority. */
export interface SeasonWindow {
  weekKey: string;
  startsAt: number;
  endsAt: number;
  remainingMs: number;
}

function dateParts(at: number) {
  if (!Number.isFinite(at)) throw new RangeError('Invalid season date');
  let formatter: Intl.DateTimeFormat;
  const opt: Intl.DateTimeFormatOptions = {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  };
  try { formatter = new Intl.DateTimeFormat('en-GB', opt); }
  catch { formatter = new Intl.DateTimeFormat('en-GB', { ...opt, timeZone: 'Europe/Kiev' }); }
  const parts = formatter.formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Convert a Kyiv civil midnight to its true UTC instant, including DST changes. */
export function kyivMidnightUtc(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('Invalid Kyiv calendar day');
  const [year, month, date] = day.split('-').map(Number);
  const midnight = Date.UTC(year, month - 1, date);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) throw new RangeError('Invalid calendar date');
  // At UTC midnight Europe/Kyiv is within +02:00/+03:00; iterate the
  // conversion rather than using the browser's (possibly non-Kyiv) time zone.
  let guess = midnight;
  for (let i = 0; i < 3; i += 1) {
    const local = dateParts(guess);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    guess += midnight - localAsUtc;
  }
  const verified = dateParts(guess);
  if (verified.year !== year || verified.month !== month || verified.day !== date || verified.hour !== 0 || verified.minute !== 0) {
    throw new RangeError('Cannot resolve Kyiv midnight');
  }
  return guess;
}

export function seasonWindow(now: number = Date.now()): SeasonWindow {
  const weekKey = weeklyQuestKey(now);
  const [year, month, day] = weekKey.split('-').map(Number);
  const nextSunday = new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  const startsAt = kyivMidnightUtc(weekKey);
  const endsAt = kyivMidnightUtc(nextSunday);
  if (!(startsAt <= now && now < endsAt)) throw new RangeError('Season window mismatch');
  return { weekKey, startsAt, endsAt, remainingMs: endsAt - now };
}

export function seasonCountdown(ms: number, language: 'ru' | 'en' = 'ru') {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return language === 'en' ? `${days}d ${hours}h ${mins}m` : `${days}д ${hours}ч ${mins}м`;
}
