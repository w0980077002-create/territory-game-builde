import type { ArenaWeeklyPlayer, ArenaWeeklyStatus } from './arenaWeekly';
import { seasonWindow } from './seasonCalendar';

/**
 * Arena's existing SQL bot-name pool (arena_start_room, production database).
 * These are the SAME names as the PvP filler opponents, not invented fake users.
 * Non-player entries are visual tournament rivals only: no account, no wallet,
 * no claimable rewards and no modification to server-verified weekly wins.
 */
const ARENA_PVP_BOT_NAMES = [
  'Рагнар', 'Сигурд', 'Хельга', 'Бьорн', 'Ивар', 'Астрид', 'Торвальд', 'Фрейя',
  'Улаф', 'Лагерта', 'Хротгар', 'Эйрик', 'Сольвейг', 'Гуннар', 'Кнуд',
  'Ингрид', 'Харальд', 'Тюр', 'Вали', 'Сван', 'ВолкСевера', 'Берсерк',
  'ТёмныйЯрл', 'Ледоруб', 'Медведь', 'Skald', 'Valkyr', 'Drakkar',
  'Fenrir', 'NordKing', 'Wolfhart', 'Grimnir', 'Тордис', 'Хаук',
  'Агнар', 'Ярослав', 'Мстислав', 'Дружинник', 'СтальнойКулак', 'Варяг',
  // SQL also generates numbered variants (10–99) from these base names.
] as const;

const FEMALE_BOT_NAMES = new Set([
  'Хельга', 'Астрид', 'Фрейя', 'Лагерта', 'Сольвейг', 'Ингрид', 'Valkyr', 'Тордис',
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
 * Display-only wins accumulate 17–25 each Kyiv calendar day (Sunday included).
 * All viewers see exactly the same per-bot totals throughout a day; the
 * Sunday reset is computed from the authoritative weekly start/end.
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

  // PvP SQL picks 40 canonical bot names and may append _10…_99.
  // Use the very same supported naming pattern to allow a full 50-bot ranking.
  const botNames = [
    ...ARENA_PVP_BOT_NAMES,
    ...ARENA_PVP_BOT_NAMES.map((name) => name + '_' + (10 + stableHash(name + ':arena-variant') % 90)),
  ];
  const bots: ArenaWeeklyDisplayPlayer[] = botNames.map((name) => {
    const seed = stableHash(week + ':' + name);
    // Different for each bot and each day, stable on reload and across devices.
    let victories = 0;
    for (let day = 0; day <= currentDay; day += 1) {
      // Mix the hash bits so daily growth varies rather than stepping
      // through an accidental +1 sequence for some Cyrillic bot names.
      const hash = stableHash(week + ':' + name + ':' + day + ':arena');
      const mixed = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
      victories += 17 + ((mixed ^ (mixed >>> 15)) >>> 0) % 9;
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
