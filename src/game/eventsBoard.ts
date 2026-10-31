import { utcMidnight, seasonWindow } from './seasonCalendar';
import { calendarDayKey } from './weeklyQuests';
import type { Quest } from './types';

/** Local countdowns only. Server RPCs still decide whether rewards are ready. */
export function eventCalendar(now = Date.now()) {
  const today = calendarDayKey(now);
  const [year, month, day] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  const dailyResetAt = utcMidnight(tomorrow);
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


/** One honest next step across existing daily systems.
 * A missing live RPC cannot be treated as an available reward.
 * This function never grants resources, opens transactions or changes state.
 */
export type DailyHeroGoalKey = 'recover' | 'daily' | 'quests' | 'hall' | 'gather' | 'mail' | 'blessing' | 'explore';
export type DailyHeroGoal = {
  key: DailyHeroGoalKey;
  action: 'daily' | 'games' | 'quests' | 'map' | 'messages' | 'city';
  art: string;
  ru: string;
  en: string;
  ruHint: string;
  enHint: string;
  ruAction: string;
  enAction: string;
};
export function dailyHeroGoal(input: {
  pendingGold: number | null;
  dailyReady: boolean;
  readyQuests: number;
  hallTicketsReady: boolean;
  gatherReady: boolean;
  unreadMail: number;
  blessingReady: boolean;
}): DailyHeroGoal {
  if (input.pendingGold !== null && input.pendingGold > 0) return {
    key: 'recover', action: 'games', art: 'gold-coin.webp',
    ru: 'Золото ждёт зачисления', en: 'Your gold is awaiting credit',
    ruHint: 'Проверь сохранённый сервером выигрыш в игровом зале.',
    enHint: 'Review your server-saved winnings in the Game Hall.',
    ruAction: 'В игровой зал', enAction: 'Open Game Hall',
  };
  if (input.dailyReady) return {
    key: 'daily', action: 'daily', art: 'ic-daily.webp',
    ru: 'Забери награду дня', en: 'Claim today’s reward',
    ruHint: 'Настоящий подарок из твоего семидневного календаря.',
    enHint: 'The real gift from your seven-day reward calendar.',
    ruAction: 'Открыть календарь', enAction: 'Open calendar',
  };
  if (input.readyQuests > 0) return {
    key: 'quests', action: 'quests', art: 'ic-quests.webp',
    ru: 'Задание уже выполнено', en: 'A quest is completed',
    ruHint: 'Тебя ждёт награда за выполненную задачу.',
    enHint: 'A completed task is ready for its existing reward.',
    ruAction: 'Забрать в заданиях', enAction: 'Open quests',
  };
  if (input.hallTicketsReady) return {
    key: 'hall', action: 'games', art: 'hall-art/dice-mobile.webp',
    ru: 'Бесплатные билеты готовы', en: 'Free tickets are ready',
    ruHint: 'Зайди в игровой зал за сегодняшними билетами.',
    enHint: 'Visit the Game Hall for today’s tickets.',
    ruAction: 'Получить билеты', enAction: 'Collect tickets',
  };
  if (input.gatherReady) return {
    key: 'gather', action: 'map', art: 'nav-map-parchment.webp',
    ru: 'Добыча завершилась', en: 'Gathering is complete',
    ruHint: 'На карте тебя ждёт добытый ресурс.',
    enHint: 'Your collected resource is ready on the map.',
    ruAction: 'Открыть карту', enAction: 'Open map',
  };
  if (input.unreadMail > 0) return {
    key: 'mail', action: 'messages', art: 'ic-mail.webp',
    ru: 'Тебя ждут письма', en: 'You have unopened letters',
    ruHint: 'Проверь имеющиеся подарки и письма.',
    enHint: 'Review available messages and gifts.',
    ruAction: 'Открыть почту', enAction: 'Open inbox',
  };
  if (input.blessingReady) return {
    key: 'blessing', action: 'city', art: 'ic-blessing.webp',
    ru: 'Подготовь благословение', en: 'Prepare your blessing',
    ruHint: 'Вернись в город к существующему разделу благословения.',
    enHint: 'Return to the existing blessing in the city.',
    ruAction: 'Вернуться в город', enAction: 'Go to city',
  };
  return {
    key: 'explore', action: 'quests', art: 'ic-quests.webp',
    ru: 'Выбери следующую цель', en: 'Choose your next goal',
    ruHint: 'В заданиях виден реальный прогресс героя.',
    enHint: 'Your quest journal shows genuine hero progress.',
    ruAction: 'Посмотреть задания', enAction: 'Open quests',
  };
}
