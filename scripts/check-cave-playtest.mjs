import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built=await build({stdin:{contents:`export * as engine from './src/game/cavePreviewWorld/engine'; export * as checkpoint from './src/game/cavePreviewWorld/checkpoint'; export * as gear from './src/game/cave/umbra'; export * as sandbox from './src/game/cave/sandbox';`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const {engine:e,checkpoint:c,gear:g,sandbox:s}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
for(let slot=0;slot<7;slot++) {
 const w=e.createWorld();e.start(w);w.phase='FIGHT';w.hp=100;w.energy=20;w.followerHp=[100,100];w.cooldown.cleave=10;
 const before=structuredClone(w);assert.ok(e.drinkPotion(w,slot));assert.equal(w.belt[slot],4);assert.equal(w.beltUsed[slot],1);
 if(slot<2)assert.equal(w.hp,slot===0?220:340);if(slot===2)assert.equal(w.energy,55);if(slot===3)assert.equal(w.shieldUntil,3);if(slot===4)assert.equal(w.furyUntil,10);if(slot===5)assert.deepEqual(w.followerHp,[180,180]);if(slot===6)assert.equal(w.cooldown.cleave,7);
 const used=structuredClone(w);assert.equal(e.drinkPotion(w,slot),false);assert.deepEqual(w,used);
 w.paused=true;w.time=20;assert.equal(e.drinkPotion(w,slot),false);w.paused=false;
 w.belt[slot]=0;w.beltUsed[slot]=5;assert.equal(e.drinkPotion(w,slot),false);
 assert.equal(c.decodeCheckpoint(JSON.stringify({version:1,runId:'test-run',world:before})).world.hp,100);
}
for(const fps of [30,60,120])for(const speed of [1,2]){
 const w=e.createWorld();e.start(w);w.speed=speed;for(let n=0;n<fps;n++)e.advanceRealtime(w,1/fps);assert.ok(Math.abs(w.time-speed)<.001,`${fps}fps x${speed}`);
}
const a=e.createWorld();e.start(a);a.phase='FIGHT';a.hp=100;a.autoPotions=true;a.auto=false;e.update(a,.025);assert.equal(a.belt[1],4);assert.ok(a.hp>100);
const w=e.createWorld();const raw=JSON.stringify({version:1,runId:'test-run',world:w});assert.ok(c.decodeCheckpoint(raw));assert.equal(c.decodeCheckpoint(raw.replace('"hp":900','"hp":-1')),null);assert.equal(c.decodeCheckpoint('{'),null);
assert.equal(g.UMBRA_MAX_ENHANCE,500);assert.equal(g.enhanceMultiplier(100),1.15);assert.ok(Math.abs(g.enhanceMultiplier(300)-1.31)<1e-8);assert.ok(Math.abs(g.enhanceMultiplier(500)-1.39)<1e-8);
assert.equal(Array.from({length:500},(_,enhance)=>g.enhanceCost({enhance})).reduce((a,b)=>a+b),1500);
console.log('PASS: seven potion effects, atomic refusal, isolated checkpoint decode, auto potions without Auto, x2 at 30/60/120Hz, +500 curve and 1500-stone cost.');

let bank=s.emptySandbox();const tryon=s.applyCaveAction(bank,{type:'wings',style:'astral'},'test-wings-1');assert.ok(tryon.ok);assert.deepEqual(tryon.state.loadout,{});assert.equal(tryon.state.enhanceStones,0);assert.equal(s.decodeSandbox(tryon.state).previewWings,'astral');
assert.equal(s.applyCaveAction(bank,{type:'claimPlaytestHonor'},'rank-too-soon').ok,false);
bank=s.applyCaveAction(bank,{type:'loot',floor:6,boss:true},'expedition:test-boss').state;assert.equal(bank.playtestWins,1);bank=s.applyCaveAction(bank,{type:'claimPlaytestHonor'},'test-rank-1').state;assert.equal(bank.playtestBlueDiamonds,10);assert.equal(s.applyCaveAction(bank,{type:'claimPlaytestHonor'},'test-rank-again').ok,false);assert.equal(bank.essence,s.decodeSandbox({...bank,enhanceStones:undefined}).essence);
console.log('PASS: wings stay outside Umbra/economy; test honor requires victory and grants once; legacy essence preserved.');

const profile=e.createWorld();profile.attackBonus=60;profile.critChance=100;profile.critDamage=75;
assert.equal(e.heroStrikeDamage(profile,99),158,'real critical damage participates in strikes');
profile.critChance=0;assert.equal(e.heroStrikeDamage(profile,0),90,'real attack participates in strikes');
assert.ok(c.decodeCheckpoint(JSON.stringify({version:1,runId:'hero-profile',world:profile})));
console.log('PASS hero attack/critical profile affects actual damage and survives checkpoint decode');
