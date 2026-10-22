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
assert.equal(initialNpc.length, 38, 'Only unused slots, from 10 to 50, get bots');
assert(initialNpc.every(x => x.rank >= 10 && x.rank <= 50));
assert(first.leaders.slice(0, 9).every((x, idx) => x.player_id === players[idx].player_id));
assert(initialNpc.every(x => x.wins >= 17 && x.wins <= 25));

const firstAgain = arenaWeeklyWithBots(verified, Date.parse('2026-10-18T20:59:00Z'));
assert.deepEqual(
  JSON.parse(JSON.stringify(first.leaders)),
  JSON.parse(JSON.stringify(firstAgain.leaders)),
  'Reopening on the same Kyiv day must not reroll scores or positions',
);
const second = arenaWeeklyWithBots(verified, Date.parse('2026-10-18T21:01:00Z'));
const firstScores = new Map(initialNpc.map(x => [x.player_id, x.wins]));
for (const npc of second.leaders.filter(x => x.arenaBot)) {
  const gained = npc.wins - firstScores.get(npc.player_id);
  assert(gained >= 17 && gained <= 25, 'Every bot must gain 17–25 at midnight Kyiv');
}
let previous = new Map(second.leaders.filter(x => x.arenaBot).map(x => [x.player_id, x.wins]));
const increments = new Set();
for (let day = 2; day <= 6; day++) {
  const current = arenaWeeklyWithBots(verified, firstStart + day * 86400000 + 3600000);
  for (const npc of current.leaders.filter(x => x.arenaBot)) {
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
assert.equal(full.leaders.filter(x => x.arenaBot).length, 0, 'All 50 real players must evict bot fillers');
assert(!source.includes('supabase.rpc(') && !source.includes('supabase.from('),
  'NPC scores may not write to the actual PvP database');
console.log('Arena TOP-50: real top nine, existing NPC fillers, random 17-25 each Kyiv day, Sunday reset, no real-player displacement when full: PASS');
