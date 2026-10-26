import { kyivMidnightUtc, seasonWindow } from './seasonCalendar';
import { calendarDayKey } from './weeklyQuests';
import type { Quest } from './types';

/** Local countdowns only. Server RPCs still decide whether rewards are ready. */
export function eventCalendar(now = Date.now()) {
  const today = calendarDayKey(now);
  const [year, month, day] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  const dailyResetAt = kyivMidnightUtc(tomorrow);
  const weeklyResetAt = seasonWindow(now).endsAt;
  return { today, dailyResetAt, weeklyResetAt, dailyRemaining: dailyResetAt - now, weeklyRemaining: weeklyResetAt - now };
}

/** Routes for already existing quests; no extra rewards or client-side completion. */
export function questAction(quest: Pick<Quest, 'id' | 'type'>, en = false) {
  const destinations: Record<string, { destination: 'battle' | 'shop' | 'arena'; ru: string; en: string }> = {
    q_daily_1: { destination: 'battle', ru: 'В поход', en: 'To campaign' },
    q_daily_2: { destination: 'shop', ru: 'В лавку', en: 'To shop' },
    q_daily_3: { destination: 'arena', ru: 'На арену', en: 'To arena' },
    q_weekly_1: { destination: 'battle', ru: 'К боссу', en: 'To boss' },
    q_story_1: { destination: 'battle', ru: 'Продолжить поход', en: 'Continue campaign' },
  };
  const action = destinations[quest.id];
  return action ? { destination: action.destination, label: en ? action.en : action.ru } : null;
}

export function readyQuestCount(quests: readonly Pick<Quest, 'current' | 'target' | 'claimed' | 'type'>[], type?: Quest['type']) {
  return quests.filter(q => (!type || q.type === type) && !q.claimed && q.current >= q.target).length;
}

/** A stalled optional status RPC must not keep the Event screen's refresh locked. */
export function withEventStatusTimeout<T>(request: Promise<T>, timeoutMs = 8_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('event_status_timeout')), timeoutMs);
    request.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
