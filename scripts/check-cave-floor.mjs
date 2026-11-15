import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({stdin:{contents:`export * from './src/game/cavePreviewWorld/engine';export * from './src/game/cavePreviewWorld/checkpoint';export * from './src/game/cave/sandbox';`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const e=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
for(const route of [[0,0,0,0],[1,1,1,1],[2,2,2,2],[0,2,1,2],[2,0,2,1]]){
 let w=e.createWorld();e.start(w);w.auto=true;w.autoPotions=true;const phases=new Set();let choices=0;
 for(let n=0;n<100000&&!['VICTORY','DEFEAT'].includes(w.phase);n++){
  if(w.phase==='PORTAL_CHOICE'){
   assert.equal(w.kills,route.slice(0,choices).reduce((s,v)=>s+9+v,0));assert.equal(w.unlockedFloor,1);assert.equal(w.bossSpawned,false);
   assert.equal(e.choosePortal(w,3),false);assert.ok(e.choosePortal(w,route[choices++]));assert.equal(e.choosePortal(w,0),false);
  }
  if(n%100===0){const copy=e.decodeCheckpoint(JSON.stringify({version:1,runId:'floor-test',world:w}));assert.ok(copy,`decode ${w.phase}`);w=copy.world;}
  e.update(w,.025);if(w.phase==='BOSS'){assert.equal(choices,4);assert.equal(w.kills,route.reduce((s,v)=>s+9+v,0));phases.add(w.bossPhase);}
 }
 assert.equal(w.phase,'VICTORY',`${route}: ${w.hp} ${w.time}`);assert.equal(w.kills,route.reduce((s,v)=>s+9+v,1));assert.equal(w.unlockedFloor,2);assert.deepEqual([...phases],[1,2,3]);assert.deepEqual(w.stars,route.map(n=>n+1));
 const frozen=JSON.stringify(w);for(let i=0;i<500;i++)e.update(w,.025);assert.equal(JSON.stringify(w),frozen);
 e.start(w,2);assert.equal(w.floor,2);assert.equal(w.kills,0);assert.deepEqual(w.stars,[]);
 console.log('PASS full floor',route.join('/'));
}
for(const floor of [10,99,100]){const w=e.createWorld();w.floor=floor;w.unlockedFloor=floor;e.start(w);w.auto=true;w.autoPotions=true;for(let n=0;n<100000&&w.phase!=='VICTORY';n++){if(w.phase==='PORTAL_CHOICE')e.choosePortal(w,0);e.update(w,.025);}assert.equal(w.unlockedFloor,Math.min(100,floor+1));}
let common=0,rare=0,ordinaryOnHard=false;for(let n=0;n<100;n++){
 const a=e.applyCaveAction(e.emptySandbox(),{type:'loot',floor:6,boss:true,lootRolls:1},'expedition:roll-'+n);
 const b=e.applyCaveAction(e.emptySandbox(),{type:'loot',floor:6,boss:true,lootRolls:3},'expedition:roll-'+n);
 common+=a.state.items.reduce((s,i)=>s+i.rank,0);rare+=b.state.items.reduce((s,i)=>s+i.rank,0);
 ordinaryOnHard ||= b.state.items.some(i=>i.rank===1);
 assert.ok(b.state.items.every(i=>i.rank<=2));assert.equal(e.applyCaveAction(b.state,{type:'loot',floor:6,boss:true,lootRolls:3},'expedition:roll-'+n).replay,true);
}
assert.ok(rare>common);assert.ok(ordinaryOnHard,'Three rolls must not guarantee a rare item');console.log('PASS rarity opportunity, no guaranteed rare and idempotency');
// Durable victory receipts survive ordinary inventory history and storage decode.
let stock=e.applyCaveAction(e.emptySandbox(),{type:'loot',floor:6,boss:true},'expedition:durable').state;
for(let n=0;n<300;n++)stock=e.applyCaveAction(stock,{type:'wings',style:n%2?'astral':'ember'},'ordinary-action-'+n).state;
stock=e.decodeSandbox(JSON.parse(JSON.stringify(stock)));
assert.equal(e.applyCaveAction(stock,{type:'loot',floor:6,boss:true},'expedition:durable').replay,true);
const lost=e.createWorld();e.start(lost);for(let n=0;n<100000&&lost.phase!=='DEFEAT';n++){if(lost.phase==='PORTAL_CHOICE')e.choosePortal(lost,2);e.update(lost,.025);}assert.equal(lost.phase,'DEFEAT');assert.equal(lost.unlockedFloor,1);e.start(lost);assert.equal(lost.floor,1);assert.equal(lost.kills,0);
const fake=e.createWorld();fake.phase='VICTORY';assert.equal(e.decodeCheckpoint(JSON.stringify({version:1,runId:'fake-win',world:fake})),null);
console.log('PASS defeat/retry, corrupt premature victory rejected, durable reward replay');
