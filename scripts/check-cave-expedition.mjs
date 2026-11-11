import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
const result = await build({entryPoints:['src/game/cavePreviewWorld/engine.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const { createWorld, start, update, choosePortal, skill, collectRune, MAX_HP } = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function step(w, seconds) { for(let t=0;t<seconds;t+=.025)update(w,.025); }
function until(w, predicate, limit=300) { for(let t=0;t<limit&&!predicate(w);t+=.025)update(w,.025);assert.ok(predicate(w),`Stuck in ${w.phase}, HP ${w.hp}, time ${w.time}`); }
const moving=createWorld(); start(moving);step(moving,2);assert.equal(moving.phase,'RUN_RIGHT');assert.ok(moving.heroX>250);assert.ok(moving.cameraX>30);
const charge=moving.energy;assert.ok(collectRune(moving));assert.ok(moving.energy>charge);assert.equal(collectRune(moving),false);
const before=moving.heroX;moving.paused=true;step(moving,5);assert.equal(moving.heroX,before);moving.paused=false;update(moving,100);assert.ok(moving.heroX-before<=4.76,'Clamp a long resumed frame');assert.equal(moving.kills,0);assert.equal(moving.hp,MAX_HP);
until(moving,w=>w.phase==='APPROACH');assert.ok(moving.time<4,'First meaningful encounter in 3–5 seconds');
for(const first of [0,1])for(const second of [0,1]){
 const w=createWorld();start(w);w.auto=true;
 until(w,x=>x.phase==='PORTAL_CHOICE');assert.equal(w.kills,6);assert.equal(w.room,0);assert.equal(w.wave,2);assert.deepEqual(w.followerPose,['idle','idle'],'Living companions rest at the portal instead of freezing mid-attack');
 const frozen=w.heroX;step(w,4);assert.equal(w.heroX,frozen,'Choice waits for actual touch');assert.equal(w.kills,6);assert.equal(choosePortal(w,99),false);assert.equal(choosePortal(w,first),true);assert.equal(choosePortal(w,1-first),false);
 const x=w.heroX;step(w,.5);assert.ok(w.heroX>x,'Physical approach to selected arch');
 until(w,x=>x.room===1);assert.equal(w.biome,first?'ember':'spore');
 until(w,x=>x.phase==='PORTAL_CHOICE');assert.equal(w.kills,12);choosePortal(w,second);until(w,x=>x.room===2);assert.equal(w.biome,second?'forge':'astral');
 until(w,x=>x.phase==='BOSS');assert.ok(w.enemies.some(e=>e.species==='boss'&&e.hp===e.maxHp));
 if (first===0 && second===0) { const splash=structuredClone(w); splash.auto=false; splash.followerHp=[1,1]; step(splash,10); assert.deepEqual(splash.followerHp,[0,0]); assert.deepEqual(splash.followerPose,['death','death']); assert.equal(splash.kills,15,'Follower death does not count as enemy death'); }
 until(w,x=>x.phase==='VICTORY');assert.equal(w.kills,16);assert.equal(w.route.length,3);assert.ok(w.hp>0);const kills=w.kills;step(w,10);assert.equal(w.kills,kills,'No repeated loot or deaths after result');
 start(w);assert.equal(w.kills,0);assert.equal(w.hp,MAX_HP);assert.equal(w.route.length,1);assert.equal(w.enemies.length,0);
 console.log(`✓ complete 3-room route ${first}/${second}, 16 deaths, boss, restart`);
}
const manual=createWorld();start(manual);until(manual,w=>w.phase==='FIGHT');const energy=manual.energy;assert.ok(skill(manual,'cleave'));assert.ok(manual.energy<energy);assert.equal(skill(manual,'cleave'),false,'Cooldown prevents repeat');manual.hp=300;manual.energy=100;assert.ok(skill(manual,'heal'));assert.equal(manual.hp,580);manual.energy=100;assert.ok(skill(manual,'ward'));const hp=manual.hp;step(manual,.5);assert.ok(manual.hp>=hp-10,'Ward reduces incoming damage');
const lost=createWorld();start(lost);until(lost,w=>w.phase==='FIGHT');lost.hp=1;until(lost,w=>w.phase==='DEFEAT');assert.equal(lost.pose,'death');start(lost);assert.equal(lost.hp,MAX_HP);assert.equal(lost.phase,'ENTER');
for (const manual of [false,true]) {
 const w=createWorld();start(w);const phases=new Set();let camera=0;
 for(let i=0;i<20000&&!['VICTORY','DEFEAT'].includes(w.phase);i++) {
   if(w.phase==='PORTAL_CHOICE')choosePortal(w,0);
   if(manual){const boss=w.enemies.find(e=>e.species==='boss'&&e.hp>0);if(boss&&boss.heavy&&boss.impact>w.time&&boss.impact-w.time<.7&&w.shieldUntil<=w.time)skill(w,'ward');if(w.hp<600)skill(w,'heal');if(w.enemies.filter(e=>e.hp>0).length>1&&w.energy>=54)skill(w,'cleave');}
   update(w,.025);if(w.phase==='BOSS')phases.add(w.bossPhase);camera=Math.max(camera,w.cameraX);
 }
 assert.equal(w.phase,manual?'VICTORY':'DEFEAT','Manual decisions change the outcome');
 if(manual){assert.deepEqual([...phases],[1,2,3]);assert.ok(w.blocks>0);assert.ok(w.energy<70);}
 assert.ok(camera>720,'Continuous travel crosses two ground segments during encounters');
}
const strike=createWorld();start(strike);strike.auto=true;until(strike,w=>w.phase==='PORTAL_CHOICE');choosePortal(strike,0);until(strike,w=>w.phase==='PORTAL_CHOICE');choosePortal(strike,0);until(strike,w=>w.phase==='BOSS');strike.auto=false;until(strike,w=>w.enemies.some(e=>e.heavy&&e.impact>w.time));
const protectedWorld=structuredClone(strike);strike.hp=900;protectedWorld.hp=900;protectedWorld.energy=100;assert.ok(skill(protectedWorld,'ward'));step(strike,1.6);step(protectedWorld,1.6);assert.ok(protectedWorld.hp-strike.hp>100,'Ward genuinely counters a telegraphed collapse');
console.log('✓ manual vs idle outcomes, 3 boss phases, heavy strike counterplay, meaningful energy, two segment crossings');
const sourceDirs=['src/game/cavePreviewWorld','src/components/pve/cavePreview'];const files=sourceDirs.flatMap(d=>readdirSync(d).filter(f=>/\.(ts|tsx)$/.test(f)).map(f=>`${d}/${f}`));files.push('src/components/pve/CaveExpeditionPreview.tsx');for(const file of files){const s=readFileSync(file,'utf8');assert.ok(!/supabase|localStorage|sessionStorage|fetch\s*\(|territory-combat|\/game\/actions/.test(s),`Isolated module ${file}`);}
const component=readFileSync(files.at(-1),'utf8');assert.match(component,/cancelAnimationFrame/);assert.match(component,/removeEventListener\('visibilitychange'/);assert.match(component,/document.hidden/);
console.log('✓ movement, range, impacts, manual skills, pause, delta clamp, defeat, isolation and lifecycle');
