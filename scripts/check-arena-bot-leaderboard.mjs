import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the shipped TypeScript module itself, not a hand-copied scoring
// algorithm, with only the date helper mocked. This test never hits Supabase.
const source = readFileSync('src/game/arenaWeeklyBots.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const firstStart = Date.parse('2026-10-17T21:00:00Z'); // Sunday 00:00 Kyiv
const secondStart = Date.parse('2026-10-24T21:00:00Z'); // following Sunday, DST change
const thirdStart = Date.parse('2026-10-31T22:00:00Z');
function seasonWindow(now) {
  return now >= secondStart ? {
    startsAt: secondStart, endsAt: thirdStart, weekKey: '2026-10-25',
  } : {
    startsAt: firstStart, endsAt: secondStart, weekKey: '2026-10-18',
  };
}
const loaded = { exports: {} };
vm.runInNewContext(compiled, {
  module: loaded, exports: loaded.exports,
  require: (name) => {
    if (name === './seasonCalendar') return { seasonWindow };
    throw Error('Unexpected runtime dependency: ' + name);
  },
  Date, Intl, Math, Number, Object, Set,
}, { filename: 'arenaWeeklyBots.transpiled.js', timeout: 5000 });
const { arenaWeeklyWithBots } = loaded.exports;
assert.equal(typeof arenaWeeklyWithBots, 'function');
function readBotNames(constName) {
  const start = source.indexOf('const ' + constName + ' = [');
  assert(start >= 0, 'Missing curated bot names: ' + constName);
  const end = source.indexOf('] as const;', start);
  assert(end > start, 'Unterminated bot name list: ' + constName);
  return [...source.slice(start, end).matchAll(/'([^']+)'/g)].map(x => x[1]);
}
const ruNames = readBotNames('RUSSIAN_ARENA_BOT_NAMES');
const enNames = readBotNames('ENGLISH_ARENA_BOT_NAMES');
assert.equal(ruNames.length, 25, 'Exactly 25 Cyrillic bot names required');
assert.equal(enNames.length, 25, 'Exactly 25 Latin bot names required');
assert(ruNames.every(name => /^[А-Яа-яЁё]+$/.test(name)), 'Russian names may not contain numbers or suffixes');
assert(enNames.every(name => /^[A-Za-z]+$/.test(name)), 'English names may not contain numbers or suffixes');
assert.equal(new Set([...ruNames, ...enNames].map(name => name.toLowerCase())).size, 50,
  'Each Arena bot must have a unique, non-repeated readable name');
assert.doesNotMatch(source, /name \+ '_' \+|ARENA_PVP_BOT_NAMES\.slice/, 'Never generate numeric bot aliases');

const players = Array.from({ length: 12 }, (_, idx) => ({
  player_id: 'real-' + idx, display_name: 'Игрок' + idx,
  level: 25, appearance: 'm2', wins: idx < 9 ? 150 - idx : 12 - idx,
  rank: idx + 1,
}));
function state(startsAt, endsAt, leaders = players) {
  return {
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    my_rank: 11, my_wins: 2, leaders,
  };
}
const verified = state(firstStart, secondStart);
const first = arenaWeeklyWithBots(verified, Date.parse('2026-10-18T12:00:00Z'));
const initialNpc = first.leaders.filter(x => x.arenaBot);
assert.equal(first.leaders.length, 50);
assert.equal(initialNpc.length, 41, 'Low-scoring real players must not be protected by fixed rank slots');
assert(first.leaders.slice(0, 9).every((x, idx) => x.player_id === players[idx].player_id));
assert(initialNpc.every(x => x.wins >= 17 && x.wins <= 25));
assert(first.leaders.every((x, idx) => x.rank === idx + 1), 'Ranking must always be sequential 1–50');
assert(first.leaders.every((x, idx) => idx === 0 || first.leaders[idx - 1].wins >= x.wins),
  'All displayed victories must be sorted descending, with no bot-only section');

const botOnly = arenaWeeklyWithBots(
  state(firstStart, secondStart, []), Date.parse('2026-10-18T12:00:00Z'),
);
assert.equal(botOnly.leaders.length, 50, 'The curated 25 Russian + 25 English bot names must fill all 50 ranks');
assert(botOnly.leaders.every(x => x.arenaBot), 'All 50 places must be open to bots');
assert.equal(new Set(botOnly.leaders.map(x => x.player_id)).size, 50, 'Bot identities must not repeat');
assert.equal(botOnly.leaders.filter(x => /^[А-Яа-яЁё]+$/.test(x.display_name)).length, 25);
assert.equal(botOnly.leaders.filter(x => /^[A-Za-z]+$/.test(x.display_name)).length, 25);
assert(botOnly.leaders.every(x => !/[0-9_]/.test(x.display_name)), 'No digits or suffixes in the visible ranking');
assert.equal(botOnly.leaders[0].rank, 1, 'Bots must be allowed to lead the ranking');

const lowHumans = Array.from({ length: 50 }, (_, idx) => ({
  ...players[0], player_id: 'low-real-' + idx, rank: idx + 1, wins: 2,
}));
const botsBeatHumans = arenaWeeklyWithBots(
  state(firstStart, secondStart, lowHumans), Date.parse('2026-10-18T12:00:00Z'),
);
assert(botsBeatHumans.leaders[0].arenaBot, 'A bot with more wins must outrank real players');
assert(botsBeatHumans.leaders.every(x => x.arenaBot),
  'Bots should not be excluded when 50 humans have fewer wins');

const firstAgain = arenaWeeklyWithBots(verified, Date.parse('2026-10-18T20:59:00Z'));
assert.deepEqual(
  JSON.parse(JSON.stringify(first.leaders)),
  JSON.parse(JSON.stringify(firstAgain.leaders)),
  'Reopening on the same Kyiv day must not reroll scores or positions',
);
const second = arenaWeeklyWithBots(verified, Date.parse('2026-10-18T21:01:00Z'));
const firstScores = new Map(initialNpc.map(x => [x.player_id, x.wins]));
for (const npc of second.leaders.filter(x => x.arenaBot)) {
  if (!firstScores.has(npc.player_id)) continue;
  const gained = npc.wins - firstScores.get(npc.player_id);
  assert(gained >= 17 && gained <= 25, 'Every retained bot must gain 17–25 at midnight Kyiv');
}
let previous = new Map(second.leaders.filter(x => x.arenaBot).map(x => [x.player_id, x.wins]));
const increments = new Set();
for (let day = 2; day <= 6; day++) {
  const current = arenaWeeklyWithBots(verified, firstStart + day * 86400000 + 15 * 3600000);
  for (const npc of current.leaders.filter(x => x.arenaBot)) {
    if (!previous.has(npc.player_id)) continue;
    const delta = npc.wins - previous.get(npc.player_id);
    assert(delta >= 17 && delta <= 25, 'Daily NPC increment must stay in 17–25');
    increments.add(delta);
  }
  previous = new Map(current.leaders.filter(x => x.arenaBot).map(x => [x.player_id, x.wins]));
}
assert(increments.size >= 8, 'Different bot/day increments should cover nearly all of 17–25');

const newWeek = arenaWeeklyWithBots(
  state(secondStart, thirdStart),
  Date.parse('2026-10-25T12:00:00Z'),
);
assert(newWeek.leaders.filter(x => x.arenaBot).every(x => x.wins >= 17 && x.wins <= 25),
  'Sunday in Kyiv must restart the virtual NPC week');
const fullHumans = Array.from({ length: 50 }, (_, idx) => ({
  ...players[0], player_id: 'full-real-' + idx, rank: idx + 1, wins: 100 - idx,
}));
const full = arenaWeeklyWithBots(
  state(firstStart, secondStart, fullHumans),
  Date.parse('2026-10-19T12:00:00Z'),
);
assert.equal(full.leaders.length, 50);
assert.equal(full.leaders.filter(x => x.arenaBot).length, 0,
  'All 50 higher-scoring real players must outrank lower-scoring bots');
assert(!source.includes('supabase.rpc(') && !source.includes('supabase.from('),
  'NPC scores may not write to the actual PvP database');
console.log('Arena TOP-50: 25 unique Russian + 25 unique English NPC names, no digits, ranked with humans by wins; daily growth and Sunday reset: PASS');
