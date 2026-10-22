import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Test the production TypeScript helper directly. Do not duplicate math in test.
const source = readFileSync('src/game/arenaProgress.ts','utf8');
const output = ts.transpileModule(source,{compilerOptions:{
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}}).outputText;
const moduleObject={exports:{}};
vm.runInNewContext(output,{module:moduleObject,exports:moduleObject.exports,Math,Number,Object},{timeout:5000});
const {arenaNextGoal}=moduleObject.exports;
assert.equal(typeof arenaNextGoal,'function');
const scores=Array.from({length:50},(_,i)=>({
  player_id:'test-'+i,display_name:'Rival '+(i+1),rank:i+1,
  wins:Math.max(1,120-i*2),level:20,appearance:'m2',arenaBot:i>=9,
}));
const currentPlayer={...scores[33],arenaBot:false,wins:15};
scores[33]=currentPlayer;

const next=arenaNextGoal(scores,34,15);
assert.equal(next.nextRank,33);
assert.equal(next.targetWins,scores[32].wins,'Passing a simulated opponent only needs a tie');
assert.equal(next.winsNeeded,scores[32].wins-15);
assert(next.progressPercent>0 && next.progressPercent<100);
assert.equal(arenaNextGoal(scores,1,100),null,'The current leader has no next rank');

const withHuman=scores.map(p=>p.rank===33?{...p,arenaBot:false}:p);
assert.equal(arenaNextGoal(withHuman,34,15).winsNeeded,withHuman[32].wins-15+1,
  'Passing another person requires one more win on current standings');
assert.equal(arenaNextGoal(scores,null,5).nextRank,50,'Outside TOP-50 target is rank 50');
assert.equal(arenaNextGoal(scores,null,5).winsNeeded,scores[49].wins-5);
assert.equal(arenaNextGoal([],null,0),null,'No goal when the weekly ranking is unavailable');
assert.equal(arenaNextGoal(scores,34,Number.NaN).winsNeeded,scores[32].wins,'Invalid values must not produce NaN');

const weekly = readFileSync('src/components/arena/ArenaWeeklyBoard.tsx','utf8');
const css=readFileSync('src/components/arena/arenaLobby.css','utf8');
assert.match(weekly,/arenaNextGoal\(rows, display\?\.displayRank/, 'Must use verified weekly standings, not the lifetime rating');
assert.match(weekly,/aria-valuenow=\{goal\.progressPercent\}/, 'Progress must be accessible');
assert.match(weekly,/По текущему ТОПу/, 'Do not promise a fixed rank while opponents move');
assert.match(css,/prefers-reduced-motion:reduce/, 'Respect reduced-motion preferences');
assert.match(css,/arena-weekly-chase/, 'Race HUD must be styled');
assert.match(css,/territory-arena-theme \.territory-screen/, 'Background must only affect Arena screens');
console.log('Arena goal: live next-place target, real-vs-bot ties, top-50 entry, leader, accessibility and scoped visuals: PASS');
