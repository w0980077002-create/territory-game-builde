import type { ArenaWeeklyPlayer, ArenaWeeklyStatus } from './arenaWeekly';
import { kyivMidnightUtc, seasonWindow } from './seasonCalendar';

/**
 * Exactly 50 named virtual Arena contenders for the weekly scoreboard:
 * 25 distinct Cyrillic names and 25 distinct Latin names. Most existing PvP
 * arena names are preserved; additional Latin names are curated, never made by
 * appending number suffixes. Visual-only rivals are not player accounts:
 * no wallets, rewards, or changes to server-verified weekly victories.
 */
const RUSSIAN_ARENA_BOT_NAMES = [
  'Рагнар', 'Сигурд', 'Хельга', 'Бьорн', 'Ивар', 'Астрид', 'Торвальд', 'Фрейя',
  'Улаф', 'Лагерта', 'Хротгар', 'Эйрик', 'Сольвейг', 'Гуннар', 'Кнуд',
  'Ингрид', 'Харальд', 'Тюр', 'Вали', 'Сван', 'Тордис', 'Хаук',
  'Агнар', 'Ярослав', 'Мстислав',
] as const;

const ENGLISH_ARENA_BOT_NAMES = [
  'Skald', 'Valkyr', 'Drakkar', 'Fenrir', 'NordKing', 'Wolfhart', 'Grimnir',
  'Leif', 'Hakon', 'Halfdan', 'Arne', 'Sten', 'Finn', 'Sven',
  'Torsten', 'Einar', 'Roald', 'Sigmund', 'Asger', 'Arvid', 'Rollo',
  'Vidar', 'Sigrid', 'Brynhild', 'Freydis',
] as const;

const FEMALE_BOT_NAMES = new Set([
  'Хельга', 'Астрид', 'Фрейя', 'Лагерта', 'Сольвейг', 'Ингрид', 'Тордис',
  'Valkyr', 'Sigrid', 'Brynhild', 'Freydis',
]);

export type ArenaWeeklyDisplayPlayer = ArenaWeeklyPlayer & {
  /** Never treat visual bot scores as server-confirmed player victories. */
  arenaBot?: boolean;
};

export interface ArenaWeeklyDisplay {
  leaders: ArenaWeeklyDisplayPlayer[];
  displayRank: number | null;
  isDisplayRankVerified: boolean;
}

function stableHash(text: string): number {
  let result = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    result = Math.imul(result ^ text.charCodeAt(i), 16777619);
  }
  return result >>> 0;
}

/**
 * Real PvP bot names compete for ANY of the TOP-50 slots (ranks 1–50).
 * Bot-only preview scores follow 50 distinct weekly activity profiles.
 * Every bot has separately scheduled single-win events across each Kyiv day,
 * never a shared midnight jump or an instant award of 17–25 victories.
 * The schedule is deterministic across viewers, reloads, and DST changes.
 * No timers, accounts, database writes, payouts or real-user score edits.
 */
export function arenaWeeklyWithBots(
  verified: ArenaWeeklyStatus,
  now: number = Date.now(),
): ArenaWeeklyDisplay {
  const humans = verified.leaders
    .filter((p) => p && !p.player_id.startsWith('arena-npc:'))
    .slice()
    .sort((a, b) => a.rank - b.rank || b.wins - a.wins);
  const start = Date.parse(verified.starts_at);
  const end = Date.parse(verified.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || now < start || now >= end) {
    return { leaders: humans, displayRank: verified.my_rank, isDisplayRankVerified: true };
  }

  const season = seasonWindow(now);
  if (season.startsAt !== start || season.endsAt !== end) {
    return { leaders: humans, displayRank: verified.my_rank, isDisplayRankVerified: true };
  }
  // Kyiv-local midnight, not the device's time zone and not UTC midnight.
  // Civil calendar day difference remains correct during daylight-saving changes.
  let dayParts: Intl.DateTimeFormatPart[];
  try {
    dayParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(now));
  } catch {
    dayParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Kiev', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(now));
  }
  const datePart = (type: string) => Number(dayParts.find((p) => p.type === type)?.value);
  const dayUtc = Date.UTC(datePart('year'), datePart('month') - 1, datePart('day'));
  const [startYear, startMonth, startDay] = season.weekKey.split('-').map(Number);
  const startDayUtc = Date.UTC(startYear, startMonth - 1, startDay);
  const currentDay = Math.min(6, Math.max(0, Math.round((dayUtc - startDayUtc) / 86_400_000)));
  const week = season.weekKey;

  // 25 Cyrillic + 25 Latin bot identities, no duplicated or numbered names.
  const botNames = [...RUSSIAN_ARENA_BOT_NAMES, ...ENGLISH_ARENA_BOT_NAMES];

  // Shuffle the 50 profiles each week (the same for every viewer).
  // Distinct nonlinear weekly goals span 1..175: casuals barely participate,
  // regulars progress steadily, leaders approach 25 wins/day.
  // The minimum 3-win gap between neighbouring weekly targets produces
  // distinct, widely spaced Friday/Saturday scores without changing any
  // real-player victories or granting bot wins in bulk.
  // Early on Sunday there can legitimately be score ties near zero.
  const skillOrder = [...botNames].sort((a, b) =>
    stableHash(week + ':' + a + ':skill') - stableHash(week + ':' + b + ':skill')
    || a.localeCompare(b));
  const skillIndex = new Map(skillOrder.map((name, index) => [name, index]));

  // The date is Kyiv-local; utc elapsed time is monotonic even when autumn
  // daylight-saving time repeats the local 03:00 hour.
  const today = [
    datePart('year'),
    String(datePart('month')).padStart(2, '0'),
    String(datePart('day')).padStart(2, '0'),
  ].join('-');
  const tomorrow = new Date(dayUtc + 86_400_000).toISOString().slice(0, 10);
  const midnight = kyivMidnightUtc(today);
  const nextMidnight = kyivMidnightUtc(tomorrow);
  const availableMinutes = (nextMidnight - midnight) / 60_000;
  const elapsedMinutes = Math.max(0, Math.min(availableMinutes, (now - midnight) / 60_000));

  const bots: ArenaWeeklyDisplayPlayer[] = botNames.map((name) => {
    const seed = stableHash(week + ':' + name);
    const index = skillIndex.get(name)!;
    // Broad, strictly distinct WEEKLY goals rather than near-equal scores:
    // bottom 1, middle roughly 80, top 175. No bot exceeds 25/day.
    // Names exchange activity tiers every Sunday via skillOrder.
    const strength = 49 - index;
    const weeklyGoal = 1 + strength * 3
      + Math.round(27 * (strength / 49) ** 2);
    const winsBeforeToday = Math.floor(weeklyGoal * currentDay / 7);
    const winsAtDayEnd = Math.floor(weeklyGoal * (currentDay + 1) / 7);
    const todayWins = winsAtDayEnd - winsBeforeToday;
    let victories = winsBeforeToday;

    // Divide the daylight-saving-aware day into personal win slots. Each
    // event is at a distinct pseudo-random minute, with 15-minute quiet
    // margins around midnight. No lump-sum wins or app-side interval jobs.
    for (let event = 0; event < todayWins; event += 1) {
      const slotHash = stableHash(week + ':' + name + ':' + currentDay + ':' + event + ':time');
      const jitter = slotHash / 4_294_967_296;
      const eventMinute = 15 + (event + jitter) * (availableMinutes - 30) / todayWins;
      if (elapsedMinutes >= eventMinute) victories += 1;
    }
    const female = FEMALE_BOT_NAMES.has(name);
    return {
      player_id: 'arena-npc:' + name,
      display_name: name,
      level: 15 + (seed % 46),
      appearance: female ? (seed % 2 ? 'f1' : 'f2') : (seed % 2 ? 'm1' : 'm2'),
      wins: victories,
      rank: 0,
      arenaBot: true,
    };
  });

  // One shared scoreboard. There are no player-only protected positions and
  // bots are not restricted to places 10–50. The most victories always lead.
  // Verified players take equal-win ties ahead of simulated opponents.
  const candidates: ArenaWeeklyDisplayPlayer[] = [
    ...humans.map((p) => ({ ...p, arenaBot: false })),
    ...bots,
  ];
  candidates.sort((a, b) => b.wins - a.wins
    || Number(Boolean(a.arenaBot)) - Number(Boolean(b.arenaBot))
    || (!a.arenaBot && !b.arenaBot ? a.rank - b.rank : 0)
    || stableHash(week + ':' + a.player_id) - stableHash(week + ':' + b.player_id)
    || a.player_id.localeCompare(b.player_id));

  const leaders = candidates.slice(0, 50).map((player, index) => ({
    ...player,
    rank: index + 1,
  }));
  const myPlayer = verified.my_rank == null ? null : humans.find((p) => p.rank === verified.my_rank);
  const displayedMe = myPlayer && leaders.find((p) => p.player_id === myPlayer.player_id);
  return {
    leaders,
    displayRank: displayedMe?.rank ?? null,
    isDisplayRankVerified: !!displayedMe && !displayedMe.arenaBot,
  };
}
