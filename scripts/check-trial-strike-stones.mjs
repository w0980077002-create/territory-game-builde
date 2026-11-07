import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const src = p => readFileSync(p, 'utf8');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const pg = ts.transpileModule(src('src/game/progression.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
vm.runInNewContext(pg.outputText, {
  module, exports: module.exports,
  require: name => {
    if (name === './actions') return { grantRewards: () => {}, updateProgress: () => {} };
    if (name === './live') return { useLive: { get: () => ({ goldX2: false }) } };
    if (name === './weeklyQuests') return { calendarDayKey: () => 'today', previousCalendarDayKey: () => 'yesterday' };
    throw Error('Unexpected import in progression.ts: ' + name);
  },
});
const { spendStones } = module.exports;
let stones = { battleStones: 3, trialLevel: 10 };
const paid1 = spendStones(stones, 1);
assert.equal(paid1.battleStones, 2);
assert.equal(stones.battleStones, 3, 'no in-place state mutation');
const paid2 = spendStones(paid1, 1);
assert.equal(paid2.battleStones, 1);
const paid3 = spendStones(paid2, 1);
assert.equal(paid3.battleStones, 0);
assert.equal(spendStones(paid3, 1), null, 'cannot strike with zero stones');
assert.equal(spendStones(paid3, -1), null, 'never turn an invalid attack into currency credit');

const start = src('src/components/BattleScreen.tsx');
const fight = src('src/components/pve/PveFight.tsx');
const trial = src('src/game/trialGauntlet.ts');
assert.match(start, /const paid = kind === 'trial'\s*\?\s*\(s\.battleStones >= PVE_STONE_COST \? s : null\)\s*:\s*spendStones\(s, PVE_STONE_COST\)/,
  'Trial entry cannot deduct a stone; Campaign still charges once at entry');
assert.match(start, /if \(kind !== 'trial'\) useGame\.set\(paid\)/,
  'Entry may mutate saved currency only for Campaign');
assert.match(start, /1 удар = 1 камень/,
  'Displayed Trial price must match implementation');
assert.match(fight, /roundFlight\.current = true;[\s\S]*?if \(kind === 'trial'\) \{\s*const paidStrike = spendStones\(useGame\.get\(\), PVE_STONE_COST\);[\s\S]*?useGame\.set\(paidStrike\);/,
  'Charge one stone after the synchronous double-tap lock and before the round starts');
assert.match(fight, /if \(!paidStrike\) \{\s*finish\(false, 'out_of_stones'\)/,
  'Fail instead of granting an unpaid strike');
assert.match(fight, /const stonesExhausted = kind === 'trial' && useGame\.get\(\)\.battleStones < PVE_STONE_COST/,
  'End a live Trial when its last stone has been spent');
assert.match(fight, /if \(res\.enemy\.hp <= 0\) \{[\s\S]*?waveIndex \+ 1 < trialWaves\.length\)[\s\S]*?if \(stonesExhausted\) \{\s*finish\(false, 'out_of_stones'\)/,
  'Defeating a normal opponent on the last stone still loses before the boss');
assert.match(fight, /\} else finish\(true\);/,
  'Defeating the final boss on the last paid strike still wins');
assert.match(fight, /else if \(stonesExhausted\) finish\(false, 'out_of_stones'\)/,
  'Unfinished boss battle loses immediately on zero stones');
assert.match(fight, /kind !== 'trial' && !auto && \(guardedZone \|\| showThreatTell\)/,
  'Never reveal exact enemy attack/guard in the Trial arena');
assert.match(fight, /kind !== 'trial' && !auto && !busy && tacticalReport/,
  'No per-round guidance messages in Trials');
for (const hint of ['riposteReady', 'momentum.streak > 0', 'staggerReady']) {
  assert.match(fight, new RegExp("kind !== 'trial' && " + hint.replaceAll('.', '\\.')),
    'No combat tip cards in Trials: ' + hint);
}
assert.match(fight, /kind !== 'trial' && <div data-testid="pve-live-damage-totals"/,
  'No banner before the Trial arena');
assert.match(fight, /kind !== 'trial' && <div className="rounded-xl border border-white\/10 bg-black\/30 p-2 max-h-32/,
  'No scrolling chat-style battle messages in Trials');
assert.match(fight, /kind === 'trial' && <span[\s\S]*?<Currency kind="stones" value="−1"/,
  'Strike button must display its stone cost');
assert.match(fight, /kind === 'trial' \? false : state\.settings\.auto/,
  'Trial auto-battle stays disabled');
assert.match(trial, /TRIAL_REGULAR_ENEMIES = 5/,
  'Keep the approved five enemies followed by a guardian');

console.log('TRIAL 1-STONE/STRIKE PASS: 3 paid attacks, depleted-stone defeat, last-boss victory, no Trial fight spoilers, other modes unchanged');
