import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['src/game/seasonCalendar.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { kyivSeasonWeekKey } = await import('data:text/javascript;base64,' +
  Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const cases = [
  ['2026-10-24T20:59:59Z', '2026-10-18'],
  ['2026-10-24T21:00:00Z', '2026-10-25'],
  ['2026-10-31T21:59:59Z', '2026-10-25'],
  ['2026-10-31T22:00:00Z', '2026-11-01'],
  ['2026-03-28T21:59:59Z', '2026-03-22'],
  ['2026-03-28T22:00:00Z', '2026-03-29'],
];
for (const [at, week] of cases) assert.equal(kyivSeasonWeekKey(Date.parse(at)), week);
assert.throws(() => kyivSeasonWeekKey(Number.NaN), RangeError);

const read = path => readFileSync(path, 'utf8');
const app = read('src/App.tsx');
const events = read('src/components/EventsScreen.tsx');
const arena = read('src/components/ArenaScreen.tsx');
const lobby = read('src/components/arena/ArenaLobby.tsx');
const board = read('src/components/LeaderboardScreen.tsx');
const season = read('src/components/SeasonScreen.tsx');
const seasonApi = read('src/game/seasonApi.ts');
const weekly = read('src/components/arena/ArenaWeeklyBoard.tsx');
const bots = read('src/game/arenaWeeklyBots.ts');
const css = read('src/components/seasonJourney.css');
const seasonAdmin = read('src/admin/tabs/SeasonAdminTab.tsx');

assert(season.includes("import { ArenaWeeklyBoard } from './arena/ArenaWeeklyBoard'"));
assert(season.includes('data-testid="season-arena-top50"'));
assert(season.includes('<ArenaWeeklyBoard />'));
assert(season.includes("Открыть Арену"));
assert(season.includes('data-testid="season-open-top50"'));
assert(season.includes('onClick={onRankings}'));
assert(season.includes('onClick={onArena}'));
assert(season.includes('onClick={onEvents}'));
assert(season.includes('onClick={onMessages}'));
assert(season.includes('viking-screen--season'));
for (const forbidden of [
  'season-official-server', 'Официальные места', 'Official standings',
  'ТВОЁ МЕСТО', 'YOUR PLACE', 'ТВОИ ОЧКИ', 'YOUR POINTS',
  'season-journey__board', 'season-prize-rules', 'season-winners-history',
  'status.my_rank', 'status.leaders', 'fetchSeasonStatus', 'kyivSeasonWeekKey',
  'virtual contenders', 'по Киеву',
]) {
  assert(!season.includes(forbidden), 'Second standings or private season details leaked into player UI: ' + forbidden);
}
assert(!board.includes('Серверный ТОП-50'), 'Top Players must not show a second player-only leaderboard');
assert(board.includes('<ArenaWeeklyBoard />'), 'Top Players must share Arena board');
assert(weekly.includes('arenaWeeklyWithBots(status, now)'));
assert(weekly.includes('getArenaWeeklyStatus()'));
assert(bots.includes('...humans.map'));
assert(bots.includes('...bots'));
assert(!weekly.includes('{player.level}'), 'Do not reveal hero levels in TOP-50');
assert(events.includes('actionId="weekly-championship" onClick={onSeason}'));
assert(events.includes('kyivSeasonWeekKey(clock)'), 'Preserve live seasonal checks, not season payouts changes');
assert(seasonApi.includes('territory_season_status_v1'), 'Keep server championship ledger for admin/rewards');
assert(app.includes("setLeaderboardInitialTab('season')"), 'Events championship must still open');
assert(arena.includes('onSeason={onSeason}'));
assert(lobby.includes('data-testid="arena-season-journey"'));
assert(!seasonAdmin.includes('по Киеву'));
assert(!/useGame\.set|supabase\.(?:rpc|from)|admin_grants|claimReward|saveCloudSave/.test(season));
assert.ok(existsSync('public/ic-trophy.webp'));
assert(css.includes('min-height:44px'));
assert(css.includes('@media(max-width:350px)'));
assert(css.includes('prefers-reduced-motion'));
console.log('Championship PASS: single Arena player-and-bot TOP-50, no conflicting place/points, unchanged season API, routes, bilingual UI.');
