import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['src/game/arenaRankView.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { arenaRankView } = await import('data:text/javascript;base64,' +
  Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const rows = [
  { player_id: 'a', arena_rating: 100, arena_wins: 30 },
  { player_id: 'b', arena_rating: 90, arena_wins: 20 },
  { player_id: 'c', arena_rating: 80, arena_wins: 20 },
];
assert.deepEqual(arenaRankView(rows, 'b', 'arena_rating'), {
  mine: 1, myRow: rows[1], nextRival: rows[0], leader: rows[0], gap: 10,
});
assert.equal(arenaRankView(rows, 'c', 'arena_wins').gap, 0, 'Server tie is not a fabricated gap');
assert.equal(arenaRankView(rows, 'a', 'arena_rating').nextRival, null);
assert.equal(arenaRankView(rows, 'missing', 'arena_rating').mine, -1);
assert.equal(arenaRankView(rows, 'missing', 'arena_rating').myRow, null,
  'Never invent an exact rank outside the TOP-50');
assert.equal(arenaRankView([], 'a', 'arena_wins').leader, null);

const read = p => readFileSync(p, 'utf8');
const board = read('src/components/LeaderboardScreen.tsx');
const season = read('src/components/SeasonScreen.tsx');
const app = read('src/App.tsx');
const css = read('src/components/arenaRankJourney.css');
const seasonCss = read('src/components/seasonJourney.css');
const cloud = read('src/game/cloud.ts');

assert.match(board, /getLeaderboard\(50, kind === 'rating' \? 'arena_rating' : 'arena_wins'\)/,
  'Fetch separate server-sorted TOP-50 views');
assert.match(cloud, /\.order\(orderBy, \{ ascending: false \}\)/);
assert.match(board, /arenaRankView\(entries, user\.id, metric\)/);
assert.match(board, /ticket !== requestId\.current/, 'Discard stale requests when switching tabs');
assert.match(board, /role="alert"/, 'Failed server reads must be visible');
assert.match(board, /onClick=\{\(\) => void loadLeaderboard\(tab\)\}/, 'Retry the actual failed tab');
assert.match(board, /data-testid="arena-rank-personal"/);
assert.match(board, /data-testid="arena-rank-next-rival"/);
assert.match(board, /data-testid="arena-rank-leader"/);
assert.match(board, /onClick=\{onArena\}/);
assert.match(board, /onRankings=\{\(\) => setTab\('rating'\)\}/);
assert.match(season, /data-testid="season-open-top50"/);
assert.match(season, /onClick=\{onRankings\}/);
assert.match(season, /'Открыть Арену'/, 'Inactive season must not mislabel Arena as TOP-50');
assert.match(app, /onArena=\{\(\) => setScreen\('arena'\)\}/);
assert.doesNotMatch(board, /useGame\.set|saveCloudSave|supabase\.(?:rpc|from)|claimReward|admin_grants/,
  'Rankings must be strictly read-only');
assert.ok(existsSync('public/ic-trophy.webp'), 'Reuse existing approved art');
assert.match(css, /min-height:48px/);
assert.match(css, /min-height:44px/);
assert.match(css, /@media\(max-width:350px\)/);
assert.match(css, /prefers-reduced-motion/);
assert.match(seasonCss, /season-journey__secondary--four/);
console.log('Arena TOP-50 journey PASS: server-sorted ranks, honest outside-top status, rival gap, retry, Arena/season routes, mobile and read-only boundaries.');
