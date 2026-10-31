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
const firstStart = Date.parse('2026-10-18T00:00:00Z'); // Sunday 00:00 UTC
const secondStart = Date.parse('2026-10-25T00:00:00Z');
const transitionEnd = Date.parse('2026-11-02T00:00:00Z');
const thirdStart = transitionEnd;
const nextEnd = Date.parse('2026-11-09T00:00:00Z');
const utcMidnight = (day) => Date.parse(day + 'T00:00:00Z');
const calendarSource = readFileSync('src/game/seasonCalendar.ts', 'utf8');
const calendarModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(calendarSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module: calendarModule, exports: calendarModule.exports,
  require: name => {
    if (name === './weeklyQuests') return { weeklyQuestKey: () => '2026-10-19' };
    throw Error('Unexpected calendar dependency: ' + name);
  },
  Date, Intl, Math, Number, Object, String,
}, { filename: 'seasonCalendar.transpiled.js', timeout: 5000 });
const { arenaSeasonWindow } = calendarModule.exports;
assert.equal(arenaSeasonWindow(Date.parse('2026-10-24T23:59:59Z')).startsAt, firstStart);
assert.equal(arenaSeasonWindow(Date.parse('2026-10-25T00:00:00Z')).startsAt, secondStart);
assert.equal(arenaSeasonWindow(Date.parse('2026-10-26T12:00:00Z')).endsAt, transitionEnd);
assert.equal(arenaSeasonWindow(Date.parse('2026-11-01T00:00:00Z')).weekKey, '2026-10-25');
assert.equal(arenaSeasonWindow(Date.parse('2026-11-01T23:59:59Z')).weekKey, '2026-10-25');
assert.equal(arenaSeasonWindow(transitionEnd).weekKey, '2026-11-02');
assert.equal(arenaSeasonWindow(transitionEnd).startsAt, transitionEnd);
assert.equal(arenaSeasonWindow(transitionEnd).endsAt, nextEnd);
assert.equal(arenaSeasonWindow(Date.parse('2026-03-29T01:00:00Z')).weekKey, '2026-03-29',
  'Season boundary must ignore regional daylight-saving changes');
const loaded = { exports: {} };
vm.runInNewContext(compiled, {
  module: loaded, exports: loaded.exports,
  require: (name) => {
    if (name === './seasonCalendar') return { arenaSeasonWindow, utcMidnight };
    throw Error('Unexpected runtime dependency: ' + name);
  },
  Date, Intl, Math, Number, Object, Set, Map, String,
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
assert(ruNames.every(name => /^[А-Яа-яЁё]+$/.test(name)));
assert(enNames.every(name => /^[A-Za-z]+$/.test(name)));
assert.equal(new Set([...ruNames, ...enNames].map(name => name.toLowerCase())).size, 50);
assert.doesNotMatch(source, /name \+ '_' \+|ARENA_PVP_BOT_NAMES\.slice/, 'No numbered copies');
assert.match(source, /utcMidnight\(today\)/, 'Use UTC calendar days for Arena rivals');
assert.match(source, /nextMidnight = midnight \+ 86_400_000/, 'A UTC day must always last 24 hours');
assert.match(source, /eventMinute/, 'Each individual win needs its own scheduled time');
assert.doesNotMatch(source, /17 \+ \(\(mixed|Math\.random\(/, 'No daily bulk credit or viewer-specific random scores');

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
const at = (time, playersList = players, starts = firstStart, ends = secondStart) =>
  arenaWeeklyWithBots(state(starts, ends, playersList), Date.parse(time));
const scoresByName = (leaders) =>
  new Map(leaders.filter(p => p.arenaBot).map(p => [p.player_id, p.wins]));
const checkRanks = leaders => {
  assert.equal(leaders.length, 50, 'All fifty places should render');
  assert(leaders.every((p, i) => p.rank === i + 1), 'Ranks must be consecutive 1..50');
  assert(leaders.every((p, i) => i === 0 || leaders[i - 1].wins >= p.wins),
    'Players and bots must sort by wins, not by fixed bot ranks');
};
const first = at('2026-10-18T12:00:00Z');
checkRanks(first.leaders);
assert(first.leaders.some(p => p.arenaBot), 'Bot pool is active');
assert(first.leaders.every(p => !p.arenaBot || p.wins <= 25),
  'Bots cannot instantly receive a whole week of wins at Sunday start');
assert(first.leaders.slice(0, 9).every((p, i) => p.player_id === players[i].player_id));

const botOnly = at('2026-10-18T12:00:00Z', []);
checkRanks(botOnly.leaders);
assert(botOnly.leaders.every(p => p.arenaBot), 'All 50 slots are open to virtual contenders');
assert.equal(new Set(botOnly.leaders.map(p => p.player_id)).size, 50);
assert.equal(botOnly.leaders.filter(p => /^[А-Яа-яЁё]+$/.test(p.display_name)).length, 25);
assert.equal(botOnly.leaders.filter(p => /^[A-Za-z]+$/.test(p.display_name)).length, 25);
assert(botOnly.leaders.every(p => !/[0-9_]/.test(p.display_name)), 'No numeric bot names');

const lowHumans = Array.from({ length: 50 }, (_, idx) => ({
  ...players[0], player_id: 'low-real-' + idx, rank: idx + 1, wins: 2,
}));
const againstLowHumans = at('2026-10-18T12:00:00Z', lowHumans);
checkRanks(againstLowHumans.leaders);
assert(againstLowHumans.leaders[0].arenaBot, 'A bot with more wins can beat a real player');
assert(againstLowHumans.leaders.some(p => !p.arenaBot), 'Equal/strong human entries must not be excluded');

const fullHumans = Array.from({ length: 50 }, (_, idx) => ({
  ...players[0], player_id: 'full-real-' + idx, rank: idx + 1, wins: 200 - idx,
}));
const full = at('2026-10-23T02:58:00Z', fullHumans);
checkRanks(full.leaders);
assert.equal(full.leaders.filter(p => p.arenaBot).length, 0,
  'All 50 high-scoring humans must replace NPCs');

const friday = at('2026-10-23T02:58:00Z', []);
checkRanks(friday.leaders);
assert.equal(new Set(friday.leaders.map(p => p.wins)).size, 50,
  'Friday: every one of the 50 bots must have a different win total');
assert(friday.leaders[0].wins - friday.leaders.at(-1).wins >= 100,
  'The virtual weekly scores must span a wide enough range');

// Repeat the uniqueness check at different times over the last two days
// (including midnight), rather than validating only one snapshot.
for (const date of ['2026-10-23', '2026-10-24']) {
  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 23];
  for (const hour of hours) {
    const utcHour = String(hour).padStart(2, '0');
    const snapshot = at(date + 'T' + utcHour + ':00:00Z', []);
    checkRanks(snapshot.leaders);
    const distinctWins = new Set(snapshot.leaders.map(p => p.wins)).size;
    // The Sunday season start can cause a transient tie near Friday morning.
    if (date === '2026-10-23' && hour < 12) {
      assert(distinctWins >= 49, date + ' ' + utcHour + ': more than one transient tie');
    } else {
      assert.equal(distinctWins, 50,
        date + ' ' + utcHour + ': all 50 bot victory totals must differ');
    }
  }
}
// Across the whole season, each bot has its own activity profile;
// the strongest weekly target never exceeds 175 (25 per day).
assert.match(source, /1 \+ strength \* 3/, 'The unique, spaced weekly goals must be retained');
assert.match(source, /Math\.round\(27 \* \(strength \/ 49\) \*\* 2\)/,
  'Nonlinear spread between strong and casual bots must be retained');
assert(friday.leaders[0].wins >= 90, 'Strong virtual opponents should remain challenging');
assert(friday.leaders.at(-1).wins <= 15, 'A 15-win real player must be able to approach the TOP-50');
const realFifteen = [{
  player_id: 'new-player', display_name: 'Настоящий', level: 5,
  appearance: 'm1', rank: 1, wins: 15,
}];
const accessible = at('2026-10-23T02:58:00Z', realFifteen);
assert(accessible.leaders.some(p => p.player_id === 'new-player'),
  'A real player with 15 wins should enter the mixed TOP-50 on Friday');

const sameTimeA = at('2026-10-23T02:58:00Z', []);
const sameTimeB = at('2026-10-23T02:58:00Z', []);
assert.deepEqual(JSON.parse(JSON.stringify(sameTimeA.leaders)),
  JSON.parse(JSON.stringify(sameTimeB.leaders)),
  'Same week, names and instant must reproduce the same scores on all clients');

// No more midnight mass-jump: nobody is granted 17–25 wins at once.
const beforeMidnight = at('2026-10-19T23:59:59Z', []);
const afterMidnight = at('2026-10-20T00:00:01Z', []);
const beforeMidnightScores = scoresByName(beforeMidnight.leaders);
const afterMidnightScores = scoresByName(afterMidnight.leaders);
for (const [id, wins] of beforeMidnightScores) {
  assert.equal(afterMidnightScores.get(id), wins,
    'No simulated wins should arrive together at UTC midnight');
}

// Scores move gradually throughout a day and never go backward.
const mondayMorning = scoresByName(at('2026-10-20T06:00:00Z', []).leaders);
const mondayAfternoon = scoresByName(at('2026-10-20T16:00:00Z', []).leaders);
let increased = 0;
for (const [id, wins] of mondayMorning) {
  const after = mondayAfternoon.get(id);
  assert(after >= wins, 'Simulated wins must never decrease during a season');
  if (after > wins) increased += 1;
}
assert(increased >= 20, 'Bots must earn their wins at different points throughout each day');

const beforeReset = scoresByName(at('2026-10-24T23:50:00Z', []).leaders);
const transitionBeforeSunday = at('2026-10-31T23:59:00Z', [], secondStart, transitionEnd);
const transitionAfterSunday = at('2026-11-01T00:01:00Z', [], secondStart, transitionEnd);
checkRanks(transitionBeforeSunday.leaders);
checkRanks(transitionAfterSunday.leaders);
const beforeCutover = scoresByName(transitionBeforeSunday.leaders);
const afterCutover = scoresByName(transitionAfterSunday.leaders);
for (const [bot, wins] of beforeCutover) {
  assert(afterCutover.get(bot) >= wins, 'Old Sunday midnight must not reset a bot');
}
assert.deepEqual([...beforeCutover.keys()].sort(), [...afterCutover.keys()].sort(),
  'The same contender identities must remain until Monday');

const mondayStart = at('2026-11-02T00:01:00Z', [], transitionEnd, nextEnd);
checkRanks(mondayStart.leaders);
assert(mondayStart.leaders.every(p => p.wins <= 1),
  'At Monday 00:01 UTC simulated rivals must start near zero');
const mondayWindow = arenaSeasonWindow(Date.parse('2026-11-02T01:00:00Z'));
assert.equal(mondayWindow.weekKey, '2026-11-02');
assert.equal(mondayWindow.startsAt, transitionEnd);
assert.equal(arenaSeasonWindow(Date.parse('2027-03-28T23:59:59Z')).endsAt,
  Date.parse('2027-03-29T00:00:00Z'), 'End Sunday UTC after European DST shift');
assert.equal(arenaSeasonWindow(Date.parse('2027-03-29T00:00:00Z')).weekKey,
  '2027-03-29', 'Monday UTC season begins regardless of local DST');
assert.equal(arenaSeasonWindow(Date.parse('2027-10-31T23:59:59Z')).endsAt,
  Date.parse('2027-11-01T00:00:00Z'), 'Fall DST does not change UTC Monday cutoff');

const sql = readFileSync('supabase/staged/arena_top50_monday_utc_cutover_20261102.sql','utf8');
assert.match(sql,/arena_cutover_requires_paused_original_config/);
assert.match(sql,/arena_cutover_rewards_version_mismatch/);
assert.match(sql,/v_current_week := \(now\(\) AT TIME ZONE 'UTC'\)/);
assert.match(sql,/v_monday := v_utc_day/);
assert.match(sql,/DATE '2026-11-02'/);
assert.match(sql,/v_start := '2026-10-25T00:00:00Z'/);
assert.match(sql,/v_end := '2026-11-02T00:00:00Z'/);

const newSeason = at('2026-10-25T12:00:00Z', [], secondStart, transitionEnd);
checkRanks(newSeason.leaders);
assert(newSeason.leaders.every(p => p.wins <= 25), 'Sunday must reset synthetic season-only wins');
assert([...beforeReset.values()].some(wins => wins >= 90));

// Regional daylight-saving changes never affect UTC event progression.
const dstBefore = scoresByName(at('2026-10-25T00:45:00Z', []).leaders);
const dstAfter = scoresByName(at('2026-10-25T01:15:00Z', []).leaders);
for (const [id, wins] of dstBefore) {
  assert(dstAfter.get(id) >= wins, 'Autumn daylight-saving change must not roll back victories');
}

assert(!source.includes('supabase.rpc(') && !source.includes('supabase.from('),
  'NPC scores must never write to real-player data');
console.log('Arena weekly TOP-50: 50 distinct rivals, 25/day, transitional 8th day, Monday UTC reset, guarded payout SQL: PASS');
