import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// The prize table is presentation only; real grants must be enabled on server
// in a separately reviewed rollout. Bots keep their places but get no prizes.
const source = readFileSync('src/game/arenaPrizePreview.ts', 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { ARENA_PRIZE_PREVIEW, arenaPrizePreviewForRank } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(js));
assert.deepEqual(ARENA_PRIZE_PREVIEW.map(({ from, to }) => [from, to]), [[1,1],[2,2],[3,3],[4,4],[5,5],[6,50]]);
assert.deepEqual(ARENA_PRIZE_PREVIEW.map(({ blueGems, redGems, stones, elixirs }) => [blueGems, redGems, stones, elixirs]), [
  [120,3,25,20],[80,2,20,15],[50,1,15,12],[30,0,12,10],[30,0,10,8],[15,0,5,5],
]);
for (let rank = 1; rank <= 50; rank += 1) {
  const reward = arenaPrizePreviewForRank(rank);
  assert.ok(reward && reward.from <= rank && rank <= reward.to, `No prize preview for place ${rank}`);
}
for (const invalid of [null, 0, 51, -1, 2.5, NaN, Infinity]) {
  assert.equal(arenaPrizePreviewForRank(invalid), null, `Unexpected prize preview for ${invalid}`);
}
assert.doesNotMatch(js, /supabase|\.rpc\(|\.from\(|\.update\(|\.insert\(/i, 'Preview must never call server or grant prizes');

const board = readFileSync('src/components/arena/ArenaWeeklyBoard.tsx', 'utf8');
const styles = readFileSync('src/components/arena/arenaLobby.css', 'utf8');
assert.match(board, /arena-weekly-prize-button/, 'Small prize button must appear in the Arena header');
assert.match(board, /onClick=\{\(\) => setShowPrizes\(true\)\}/, 'Prize button must open the dialog');
assert.match(board, /aria-modal="true"/, 'Prize dialog must be accessible');
assert.match(board, /arenaPrizePreviewForRank\(rank\)/, 'Player position must highlight the appropriate tier');
assert.match(board, /План наград за неделю/, 'Keep the prize plan label until server payouts are enabled');
assert.doesNotMatch(board, /Боты призы|игровой бот|Arena AI opponent|Bot opponents|arena-weekly-npc|arena-weekly-winner-npc|arena-prizes-disclaimer/i,
  'No virtual-contender labels or the removed disclaimer may be visible in the Arena UI');
assert.match(board, /arenaSeasonWindow\(now\)/, 'Countdown must follow the Arena Sunday UTC calendar');
assert.match(board, /arenaWeeklyWithBots\(status, now\)/, 'Display must keep current server-and-bot ranking');
assert.match(board, /arena-weekly-winners/, 'The approved podium must display real ranking data');
assert.match(styles, /\.arena-prizes-panel/, 'Reward dialog requires game-styled panel');
assert.match(styles, /\.arena-weekly-winner-1/, 'Leaderboard champion requires gold styling');
console.log('Arena TOP-50 podium and preview-only prize dialog: PASS');
