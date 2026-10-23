import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const raw = readFileSync('src/game/vikingSlots.ts','utf8');
const compiled = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exports = {};
runInNewContext(compiled, { exports, crypto: webcrypto });
const { SLOT_LINES, SLOT_PAYTABLE, SLOT_REEL_STRIPS, fairDemoInt, scoreSlotGrid, spinVikingSlots, gridFromReelStops, reelSpinTrail } = exports;

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
assert.equal(SLOT_REEL_STRIPS.length,5,'Exactly five independent virtual reels');
for (let r=0;r<5;r++) {
  const strip=SLOT_REEL_STRIPS[r];
  assert.equal(strip.length,40,'Fixed reel strip length is 40');
  assert.equal(strip.filter(x=>x==='hero').length,2,'Bonus rarity per reel must be stable');
  assert.equal(strip.filter(x=>x==='wild').length,1,'Wild rarity per reel must be stable');
  for(let stop=0;stop<strip.length;stop++){
    const ends=[0,0,0,0,0];ends[r]=stop;
    const result=gridFromReelStops(ends);
    assert.equal(result[r].join('|'),[strip[stop],strip[(stop+1)%40],strip[(stop+2)%40]].join('|'),
      'Three visible symbols MUST be adjacent positions on the same reel strip');
    const trail=reelSpinTrail(r,stop,12);
    assert.equal(trail.length,12);
    assert.equal(trail[11],strip[(stop-1+40)%40],'Animated reel must roll into the winning stop');
  }
}
const realSpin=spinVikingSlots(9,1);
assert.equal(realSpin.stops.length,5,'Each game spin must expose exactly five genuine stop positions');
assert.equal(realSpin.grid.map(x=>x.join(',')).join('|'),
 gridFromReelStops(realSpin.stops).map(x=>x.join(',')).join('|'),
 'Rendered symbols must match real reel stops exactly');

// Seeded deterministic statistical *DEMO only* smoke audit. Do not confuse with
// real-money fairness certification or reward economy release approval.
let randomSeed=0xC0FFEE;
const seededStop=(max)=>{randomSeed ^= randomSeed<<13;randomSeed ^= randomSeed>>>17;randomSeed ^= randomSeed<<5;return (randomSeed>>>0)%max;};
let samplePayout=0, bonusTriggers=0, wins=0;
const samples=18000;
for(let n=0;n<samples;n++){
 const stops=SLOT_REEL_STRIPS.map(strip=>seededStop(strip.length));
 const game=scoreSlotGrid(gridFromReelStops(stops),9,1);
 samplePayout+=game.payout;
 if(game.payout>0)wins++;
 if(game.bonusSymbols>=3)bonusTriggers++;
}
const baseReturn=samplePayout/(samples*9);
const bonusRate=bonusTriggers/samples;
assert.ok(baseReturn>0.2&&baseReturn<1.15,'Demo reel base payouts changed drastically: '+baseReturn);
assert.ok(bonusRate>0.001&&bonusRate<0.15,'Demo bonus trigger rate changed drastically: '+bonusRate);
assert.ok(wins>0,'Some virtual reel spins should win');
console.log('Slots DEMO sample only:',{spins:samples,baseReturn:Number(baseReturn.toFixed(4)),
 bonusRate:Number(bonusRate.toFixed(4)),hitRate:Number((wins/samples).toFixed(4))});

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
// Exercise the actual bonus game implementation, including deterministic sealed picks.
const bonusSource = readFileSync('src/game/slotAdventure.ts','utf8');
const compiledBonus = ts.transpileModule(bonusSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const bonusExports = {};
runInNewContext(compiledBonus,{exports:bonusExports,require(name){assert.equal(name,'./vikingSlots');return {fairDemoInt};}});
const {prepareBonusTiles,prepareSuperChests,prepareRiskCards,resolveBonusTile} = bonusExports;
const shuffled = prepareBonusTiles(9, () => 0);
assert.equal(shuffled.length,5);
assert.equal(shuffled.filter(t=>t.kind==='trap').length,1);
assert.equal(shuffled.filter(t=>t.kind==='shield').length,1);
assert.equal(shuffled.filter(t=>t.kind==='treasure').length,3);
assert.equal(shuffled.reduce((sum,t)=>sum+t.payout,0),54,'Bonus prizes stay fixed at setup');
assert.equal(prepareBonusTiles(9,()=>0).map(t=>t.kind+':'+t.payout).join('|'),
 shuffled.map(t=>t.kind+':'+t.payout).join('|'),'Same seeded shuffle must preserve the sealed locations');
const basic = {picksLeft:5,shields:0,total:20};
const treasure = resolveBonusTile(basic,shuffled.find(t=>t.kind==='treasure'));
assert.ok(treasure.next.total>basic.total);
const death = resolveBonusTile(basic,shuffled.find(t=>t.kind==='trap'));
assert.equal(death.endedByTrap,true);
assert.equal(death.next.total,basic.total,'Trap does not fabricate or destroy collected winnings');
const saved = resolveBonusTile({...basic,shields:1},shuffled.find(t=>t.kind==='trap'));
assert.equal(saved.blockedTrap,true);
assert.equal(saved.endedByTrap,false);
assert.equal(saved.next.shields,0);
const shield = resolveBonusTile(basic,shuffled.find(t=>t.kind==='shield'));
assert.equal(shield.next.shields,1);
assert.equal(resolveBonusTile({picksLeft:1,shields:1,total:40},shuffled[0]).superReady,true);
const chestDeck = prepareSuperChests(9,()=>0);
assert.equal(chestDeck.length,3);
assert.equal(new Set(chestDeck.map(x=>x.payout)).size,3,'All three sealed chests have distinct prizes');
const riskDeck = prepareRiskCards(()=>0);
assert.equal(riskDeck.length,4);
assert.equal(riskDeck.filter(x=>x.wins).length,2,'Exactly two choices win');
assert.equal(riskDeck.filter(x=>!x.wins).length,2,'Exactly two choices lose');
assert.throws(()=>prepareBonusTiles(0));
assert.throws(()=>prepareSuperChests(101));

const savedSource = readFileSync('src/game/slotDemoSave.ts','utf8');
const savedJS = ts.transpileModule(savedSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const savedExports={};
const store = new Map();
runInNewContext(savedJS, {exports:savedExports,window:{localStorage:{
  getItem:key=>store.get(key)??null,
  setItem:(key,value)=>store.set(key,value),
}}});
const {parseSlotDemo,slotSaveKey,saveSlotDemo,loadSlotDemo} = savedExports;
const saveSnapshot = {
  balance:491,lines:9,bet:1,phase:'bonus',wagerAtSpin:9,pending:36,
  field:filled('gold'),recent:null,bonusLeft:3,bonusShield:1,
  bonusDeck:shuffled,bonusOpened:[0,2],superDeck:[],superOpened:null,
  riskDeck:[],riskOpened:null,riskSteps:0,auto:0,soundOn:false,hapticsOn:false,
};
saveSlotDemo('user-A',saveSnapshot);
const loaded = loadSlotDemo('user-A');
assert.equal(loaded?.phase,'bonus','Bonus must resume after re-opening Telegram');
assert.equal(loaded?.pending,36,'Unclaimed demo prizes must survive a reload');
assert.equal(loaded?.bonusOpened.length,2,'Already-revealed runes must stay revealed');
assert.equal(loadSlotDemo('user-B'),null,'Demo credits must not spill across players');
assert.ok(slotSaveKey('a')!==slotSaveKey('b'));
assert.equal(parseSlotDemo(null),null,'No saved session must start fresh');
assert.equal(parseSlotDemo('not-json'),null,'Corrupt session must fail safely');
assert.equal(parseSlotDemo(JSON.stringify({version:99,state:saveSnapshot})),null,'Legacy formats must not leak balances');
assert.equal(parseSlotDemo(JSON.stringify({version:3,state:{...saveSnapshot,field:[]}})),null,'Bad grids must fail safely');
const interrupted = parseSlotDemo(JSON.stringify({version:3,state:{...saveSnapshot,
  phase:'spinning',balance:470,wagerAtSpin:9,pending:0
}}));
assert.equal(interrupted?.phase,'ready','Interrupted spin must restore ready mode');
assert.equal(interrupted?.balance,479,'Interrupted spin must refund only its test stake');
assert.equal(interrupted?.pending,0);
assert.equal(interrupted?.auto,0,'Auto play must not restart unexpectedly after reload');

const ui=readFileSync('src/components/VikingSlots.tsx','utf8');
assert.match(ui,/INITIAL_BALANCE = 500/);
assert.match(ui,/setBalance\(v => v - wager\)/);
assert.doesNotMatch(ui,/supabase\.rpc|saveCloudSave|useGame\.set|hallStart|hallFinish/,'Preview must not mutate the player wallet');
assert.match(ui,/setAuto\(0\)/,'Bonus/risk must break auto mode');
assert.match(ui,/prepareBonusTiles\(wager\)/,'Sealed rune rewards must be prepared before player choice');
assert.match(ui,/prepareSuperChests\(wager\)/,'Super chest outcomes must be fixed before selection');
assert.match(ui,/prepareRiskCards\(\)/,'Risk cards must be prepared before the reveal');
assert.match(ui,/resolveBonusTile/,'Bonus selection must use revealed fixed tile');
assert.doesNotMatch(ui,/const roll = fairDemoInt\(10\)/,'Do not use random-on-click fake choices');
assert.match(ui,/vslot-adventure-backdrop/,'Bonus games must be immersive and independent');
assert.match(ui,/vslot-win-path/,'Winning payline must be rendered on reels');
assert.match(ui,/soundOn, setSoundOn\] = useState\(restored\?\.soundOn \?\? false\)/,'Sound must default to muted');
assert.match(ui,/hapticsOn, setHapticsOn\] = useState\(restored\?\.hapticsOn \?\? false\)/,'Vibration must be opt-in');
assert.match(ui,/950 \+ i\*320/,'Reel click sound follows staggered animation stop');
assert.match(ui,/hapticImpact/,'Use Telegram-native haptics when enabled');
assert.match(ui,/vslot-fx-toggles/,'Effects controls must be visible');
assert.match(ui,/loadSlotDemo\(userId\)/,'Demo session must restore per player');
assert.match(ui,/saveSlotDemo\(userId,snapshot\)/,'Demo state must persist');
const hallScreen = readFileSync('src/components/HallPlayScreen.tsx','utf8');
assert.match(hallScreen,/key=\{userId\} userId=\{userId\}/,'Slot state must isolate Telegram players');

for (const file of ['rune-sealed.svg','chest-sealed.svg','card-sealed.svg']) {
  assert.ok(existsSync('public/slots/'+file),'Original sealed mini-game art is required: '+file);
  const svg = readFileSync('public/slots/'+file,'utf8');
  assert.ok(svg.length<8000,'Keep bonus art lightweight for Telegram');
  assert.doesNotMatch(svg,/<script|javascript:|<image[^>]+href=["']https?:/i,'No remote or unsafe SVG contents');
  assert.ok(ui.includes(file),'Bonus mini-game must render its own original art: '+file);
}
for (const path of [
 'assets/territory/characters/enemies/wolf/idle.webp',
 'assets/territory/ui/items/sword.webp',
 'assets/territory/ui/equipment/helmet.webp',
]) {
  assert.ok(existsSync('public/'+path),'Approved slot symbol missing: '+path);
  assert.ok(raw.includes(path),'Slots must use current TERRITORY symbol: '+path);
}


const app = readFileSync('src/App.tsx','utf8');
assert.match(app,/slotImmersive/,'Slot view must suppress obstructing game navigation');
assert.match(app,/!slotImmersive && <nav/,'Bottom navigation must not overlay immersive reels');

const cabinetCss = readFileSync('src/components/vikingSlots.css','utf8');
assert.match(ui,/FILLER_PER_REEL = 12/,'Reels must include moving intermediate symbols');
assert.match(ui,/reelSpinTrail\(index,outcome\.stops\?\.\[index\] \?\? 0,FILLER_PER_REEL\)/,'Animated strips must follow actual stop strips');
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
