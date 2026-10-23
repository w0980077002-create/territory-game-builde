import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const raw = readFileSync('src/game/vikingSlots.ts','utf8');
const compiled = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exports = {};
runInNewContext(compiled, { exports, crypto: webcrypto });
const { SLOT_LINES, SLOT_PAYTABLE, fairDemoInt, scoreSlotGrid, spinVikingSlots } = exports;

// Retired generic sprite must never return: neither on disk nor in render mappings.
const retired = 'follower-' + 'shield.webp';
assert.equal(existsSync('public/' + retired), false, 'Retired follower image must be deleted');
const artMapping = readFileSync('src/game/combatArt.ts','utf8');
assert.ok(!raw.includes(retired) && !artMapping.includes(retired), 'No retired companion references');
assert.match(raw,/followers\/rune_mage\/idle\.webp/,'Slot must use an approved bright companion');
assert.match(artMapping,/followers\/moon_hunter\/idle\.webp/,'Fallback must use an approved companion');
for (const name of ['loyal_shield','northern_warrior','forest_healer','moon_hunter','rune_mage']) {
  assert.ok(existsSync('public/assets/territory/characters/followers/' + name + '/idle.webp'), 'Approved follower missing: ' + name);
}
assert.equal(SLOT_LINES.length,9);
assert.ok(SLOT_LINES.every(line=>line.length===5 && line.every(x=>[0,1,2].includes(x))));
const filled = symbol => Array.from({length:5},()=>Array.from({length:3},()=>symbol));
const line = (symbols,other='hero') => {
  const grid=filled(other);
  symbols.forEach((symbol,reel)=>grid[reel][1]=symbol);
  return grid;
};
const left=scoreSlotGrid(line(['gold','gold','gold','gold','gold']),1,1);
assert.equal(left.payout,SLOT_PAYTABLE.gold[2],'A five-symbol left-edge line must pay once');
assert.equal(left.lines.length,1);
const right=scoreSlotGrid(line(['hero','hero','boss','boss','boss']),1,1);
assert.equal(right.payout,SLOT_PAYTABLE.boss[0],'Right-edge matches must count');
const wild=scoreSlotGrid(line(['wild','gold','gold','hero','hero']),1,1);
assert.equal(wild.payout,SLOT_PAYTABLE.gold[0],'Wild must substitute for gold');
const allWild=scoreSlotGrid(line(['wild','wild','wild','wild','wild']),1,1);
assert.equal(allWild.payout,SLOT_PAYTABLE.wild[2],'Wild 5-of-kind uses its best pay');
const scatter=filled('gold');
scatter[0][0]='hero';scatter[2][2]='hero';scatter[4][0]='hero';
assert.equal(scoreSlotGrid(scatter,1,1).bonusSymbols,3,'Three heroes anywhere open the bonus');
assert.throws(()=>scoreSlotGrid(filled('gold'),2,1),'Only 1/3/5/7/9 paylines are valid');
assert.throws(()=>scoreSlotGrid(filled('gold'),9,3),'Only configured per-line bets are valid');
for(let i=0;i<1000;i++){
 const rand=fairDemoInt(9);
 assert.ok(Number.isInteger(rand) && rand>=0 && rand<9);
}
for(let i=0;i<100;i++){
 const result=spinVikingSlots(9,1);
 assert.equal(result.grid.length,5);
 assert.ok(result.payout>=0);
}
const ui=readFileSync('src/components/VikingSlots.tsx','utf8');
assert.match(ui,/INITIAL_BALANCE = 500/);
assert.match(ui,/setBalance\(v => v - wager\)/);
assert.doesNotMatch(ui,/supabase\.rpc|saveCloudSave|useGame\.set|hallStart|hallFinish/,'Preview must not mutate the player wallet');
assert.match(ui,/setAuto\(0\)/,'Bonus/risk must break auto mode');
const cabinetCss = readFileSync('src/components/vikingSlots.css','utf8');
assert.match(ui,/FILLER_PER_REEL = 12/,'Reels must include moving intermediate symbols');
assert.match(ui,/REEL_SPIN_MS = 2320/,'Outcome must wait until all reels stop');
assert.match(ui,/setReelTracks\(field\.map/,'Each reel must have a long animated strip');
assert.match(ui,/\.\.\.outcome\.grid\[index\]/,'Animation must land on its real final grid');
assert.match(ui,/animationDelay: \(r \* 100\)/,'Reels must stop in sequence, not simultaneously');
assert.match(ui,/vslot-reel-window/,'Five visible reel windows required');
assert.doesNotMatch(ui,/vslot-reel--moving/,'Do not regress to wobbling the old static tiles');
assert.match(cabinetCss,/@keyframes vslot-real-reel-roll/,'Must animate vertical symbol travel');
assert.match(cabinetCss,/translateY\(-83\.333333%\)/,'Travel must land on final three symbols of 18');
assert.match(cabinetCss,/vslot-reel-track--rolling[^{]*\{/,'Rolling track class is required');
assert.match(cabinetCss,/max-width:430px/,'Mobile cabinet must be compact');
assert.match(cabinetCss,/\.vslot-action-bar button\{height:42px/,'Spin controls must fit on mobile');

console.log('Viking slots PASS: 9 lines, both-edge pay, wild, bonus, bet guard, spin RNG, preview wallet isolation.');
