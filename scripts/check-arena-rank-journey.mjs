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

const weekly = read('src/components/arena/ArenaWeeklyBoard.tsx');
const bots = read('src/game/arenaWeeklyBots.ts');
assert.match(board, /import \\{ ArenaWeeklyBoard \\} from '\\.\\/arena\\/ArenaWeeklyBoard'/);
assert.match(board, /data-testid="arena-rank-shared-top50"[\\s\\S]*?<ArenaWeeklyBoard \\/>/,
  'Top Players must use exactly the existing Arena board');
assert.match(weekly, /arenaWeeklyWithBots\\(status, now\\)/);
assert.match(bots, /\\.\\.\\.humans\\.map/);
assert.match(bots, /\\.\\.\\.bots/);
assert.match(board, /onRankings=\\{\\(\\) => setTab\\('arena'\\)\\}/);
assert.match(board, /onClick=\\{onArena\\}/);
assert.match(board, /role="tabpanel"/);
assert.doesNotMatch(board, /getLeaderboard\\(|arenaRankView\\(|Серверный ТОП-50|Server TOP-50|entry\\.level/,
  'Old player-only server leaderboard, conflicting ranks and visible levels must not return');
assert.doesNotMatch(weekly, /\\{player\\.level\\}/,
  'Weekly TOP-50 shared with Arena and Championship must not expose hero levels');
assert.match(season, /data-testid="season-open-top50"/);
assert.match(season, /onClick=\\{onRankings\\}/);
assert.match(season, /'Открыть Арену'/, 'Inactive season must not mislabel Arena as TOP-50');
assert.match(app, /onArena=\\{\\(\\) => setScreen\\('arena'\\)\\}/);
assert.doesNotMatch(board, /useGame\\.set|saveCloudSave|supabase\\.(?:rpc|from)|claimReward|admin_grants/,
  'Rankings must be strictly read-only');
assert.ok(existsSync('public/ic-trophy.webp'), 'Keep approved Arena art');
assert.match(css, /min-height:48px/);
assert.match(css, /min-height:44px/);
assert.match(css, /@media\\(max-width:350px\\)/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /arena-rank-journey__arena-top/);
assert.match(seasonCss, /season-journey__secondary--four/);
console.log('Arena TOP-50 journey PASS: one player-and-bot board across Arena/Top Players/Championship, no hero level disclosure, mobile and read-only routes.');
