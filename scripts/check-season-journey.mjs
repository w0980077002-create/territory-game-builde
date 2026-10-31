import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
const compiled = await build({ entryPoints:['src/game/seasonCalendar.ts'], bundle:true, write:false, platform:'node', format:'esm' });
const { kyivSeasonWeekKey } = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const cases = [
  ['2026-10-24T20:59:59Z','2026-10-18'],
  ['2026-10-24T21:00:00Z','2026-10-25'],
  ['2026-10-31T21:59:59Z','2026-10-25'],
  ['2026-10-31T22:00:00Z','2026-11-01'],
  ['2026-03-28T21:59:59Z','2026-03-22'],
  ['2026-03-28T22:00:00Z','2026-03-29'],
];
for (const [at,week] of cases) assert.equal(kyivSeasonWeekKey(Date.parse(at)),week,'Kyiv Sunday boundary '+at);
assert.throws(()=>kyivSeasonWeekKey(Number.NaN),RangeError);
const read = p => readFileSync(p,'utf8');
const app=read('src/App.tsx'),events=read('src/components/EventsScreen.tsx');
const arena=read('src/components/ArenaScreen.tsx'),lobby=read('src/components/arena/ArenaLobby.tsx');
const board=read('src/components/LeaderboardScreen.tsx'),season=read('src/components/SeasonScreen.tsx');
const css=read('src/components/seasonJourney.css');
assert.match(events,/actionId="weekly-championship" onClick=\{onSeason\}/);
assert.match(events,/season\.week === kyivSeasonWeekKey\(clock\)/);
assert.match(app,/onSeason=\{\(\) => \{ setLeaderboardInitialTab\('season'\); setScreen\('leaderboard'\); \}\}/);
assert.match(arena,/onSeason=\{onSeason\}/);
assert.match(lobby,/data-testid="arena-season-journey"/);
assert.match(lobby,/disabled=\{!!joining \|\| recovering \|\| backDisabled\}/,'Never navigate away during an in-flight Arena join');
assert.match(board,/<SeasonScreen user=\{user\} onArena=\{onArena\} onEvents=\{onEvents\} onMessages=\{onMessages\}/);
assert.match(app,/onArena=\{\(\) => setScreen\('arena'\)\} onEvents=\{\(\) => setScreen\('events'\)\} onMessages=\{\(\) => setScreen\('messages'\)\}/);
assert.match(season,/fetchSeasonStatus\(\)/,'Only the existing read-only RPC may provide season data');
assert.match(season,/status\?\.week === kyivSeasonWeekKey\(serverClock\)/,'Do not display stale season as live');
assert.match(season,/status\.leaders\.map\(/,'Standings come from server');
assert.match(season,/status\.history\.map\(/,'History comes from server');
assert.match(season,/status\.prizes\.map\(/,'Prizes come from server');
assert.match(season,/data-testid="season-prize-rules"/,'Players can expand genuine rules and prize list');
assert.match(season,/data-testid="season-winners-history"/,'Players can inspect genuine winner history');
assert.match(season,/onClick=\{onArena\}/);
assert.match(season,/onClick=\{onEvents\}/);
assert.match(season,/onClick=\{onMessages\}/);
assert.match(season,/role="alert"/,'Failed read must be visible and recoverable');
assert.doesNotMatch(season,/useGame\.set|supabase\.(?:rpc|from)|admin_grants|claimReward|saveCloudSave/,'Read-only journey must never grant or mutate');
assert.ok(existsSync('public/ic-trophy.webp'),'Reuse approved trophy art, no fake placeholder');
assert.match(css,/min-height:44px/,'Touch targets must be reachable on narrow screens');
assert.match(css,/@media\(max-width:350px\)/,'320px layout must be accounted for');
assert.match(css,/prefers-reduced-motion/);
console.log('Championship journey PASS: Kyiv DST boundaries, server-only results, real Events/Arena/Mail routes, local rules/history, retry, mobile controls.');
