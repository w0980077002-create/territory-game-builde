import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

async function module(path) {
  const result = await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const {animationState, visualId, drawAnimatedEnemy, prepareAnimations, animationImage} = await module('src/components/pve/cavePreview/actorAnimation.ts');
const {CaveVisualBudget, electricCut, bossTelegraph} = await module('src/components/pve/cavePreview/combatVfx.ts');
const {CaveLife} = await module('src/components/pve/cavePreview/world.ts');
const {CaveAudio} = await module('src/components/pve/cavePreview/audio.ts');
const {createWorld, start, update, choosePortal} = await module('src/game/cavePreviewWorld/engine.ts');
const registry = JSON.parse(readFileSync('src/components/pve/cavePreview/animationRegistry.json'));
for (const [id, clip] of Object.entries({...registry.clips, ...registry.textures})) {
  const bytes = readFileSync(`public/assets/territory/cave-expedition/animation/${id}.webp`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256);
  for (const frame of clip.frames ?? []) {
    const [x,y,w,h] = frame.rect;
    assert.ok(x >= 0 && y >= 0 && x+w <= clip.width && y+h <= clip.height);
    assert.equal(frame.pivot[1], h, 'Source foot stays on ground in every pose');
  }
}
const e = {id:2,species:'eel',worldX:285,hp:100,maxHp:100,pose:'attack',impact:10.5,poseUntil:10.8,deathAt:0,lane:1,heavy:false};
assert.equal(animationState(e, 10).frame,3);
assert.equal(animationState(e, 10.5).frame,4);
assert.equal(animationState(e, 10.75).frame,5);
assert.equal(animationState({...e,pose:'hit'},10).frame,6);
assert.equal(animationState({...e,pose:'death',deathAt:10},10.3).frame,7);
assert.equal(animationState({...e,pose:'run'},10,true).frame,0);
const draws=[];
const canvas = {save(){},restore(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},fillText(){},ellipse(){},drawImage(...args){draws.push(args)}};
const clip = registry.clips['08_armored_boar'];
for (const [pose,time] of [['idle',10],['run',10.2],['attack',10.4],['attack',10.6],['hit',10.7],['death',11]]) {
  const actor = {...e,pose,deathAt:10.7};
  assert.ok(drawAnimatedEnemy(canvas,{naturalWidth:clip.width,naturalHeight:clip.height},'08_armored_boar',actor,time,280,350,136,false));
  const d=draws.at(-1); assert.ok(Math.abs(d[6]+d[8]-350)<=1.3, 'Foot planted; only subpixel breathing allowed');
  assert.ok(d[5] >= 100 && d[5]+d[7]<=430,'Silhouette fits the contact position');
}
const w=createWorld();w.floor=21;
assert.equal(visualId(w,{...e,species:'boss'}),'spider_queen');
w.floor=6;w.biome='crystal';assert.equal(visualId(w,{...e,id:9,species:'shardling'}),'senior_driller');
w.biome='spore';assert.equal(visualId(w,{...e,id:9,species:'moth'}),'moss_eater');
assert.equal(visualId(w,{...e,id:10,species:'moth'}),'07_purple_mage');
assert.equal(visualId(structuredClone(w),{...e,id:9,species:'moth'}),'moss_eater');

// Fake image transport verifies missing/slow/cancelled optional art independently
// of browsers' optimistic onload. Failure stays cached, never spins a retry loop.
const pending=[];
globalThis.Image=class {naturalWidth=100;constructor(){pending.push(this)} removeAttribute(){this.src=''}};
const images=new Map(), controller=new AbortController();prepareAnimations(images,p=>'/territory-game-builde/'+p,controller.signal);
assert.equal(animationImage(images,'08_armored_boar'),undefined);
assert.equal(animationImage(images,'08_armored_boar'),undefined);assert.equal(pending.length,1);
assert.ok(pending[0].src.startsWith('/territory-game-builde/'));
pending[0].onerror();assert.equal(animationImage(images,'08_armored_boar'),undefined);assert.equal(pending.length,1);
animationImage(images,'04_club_raider');controller.abort();assert.equal(pending[1].src,'');assert.equal(pending[1].onload,null);
const budget=new CaveVisualBudget();for(let i=0;i<90;i++)budget.sample(14);assert.equal(budget.quality,'low');
for(let i=0;i<90;i++)budget.sample(2);assert.equal(budget.quality,'high');assert.equal(new CaveVisualBudget(2).quality,'low');

// Rendering/VFX/quality cannot change simulation state or consume combat RNG.
function run(withArt) {
  let seed=540;const saved=Math.random;
  Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
  try {
    const world=createWorld();start(world);world.auto=true;world.critChance=23;
    const life=new CaveLife();let portals=0;const phases=new Set();
    for(let i=0;i<100000&&!['VICTORY','DEFEAT'].includes(world.phase);i++) {
      if(world.phase==='PORTAL_CHOICE'){choosePortal(world,portals++%3)}
      update(world,.025);if(world.bossSpawned)phases.add(world.bossPhase);
      if(withArt) {
        const before=JSON.stringify(world);life.step(world,480,false);
        electricCut(canvas,world,380,1,false,'high');
        for(const enemy of world.enemies){animationState(enemy,world.time);visualId(world,enemy);bossTelegraph(canvas,world,enemy,300,380,175,1,false,'high')}
        assert.equal(JSON.stringify(world),before,'Visual code is read-only');
      }
    }
    assert.equal(world.phase,'VICTORY');assert.equal(portals,4);assert.equal(phases.size,3);
    return {world,seed};
  } finally {Math.random=saved}
}
assert.deepEqual(run(true),run(false),'Same seed, all four sections, phases, HP, energy, kills, progress and RNG with/without art');
globalThis.document={hidden:false};
const audio = new CaveAudio(), tones=[];
audio.context={suspend:async()=>{},resume:async()=>{}};audio.tone=(...args)=>tones.push(args);
const sounding=createWorld();Object.assign(sounding,{phase:'BOSS',time:10});sounding.effects=[{born:9.95,kind:'impact',text:'',x:200,lane:1}];
audio.tick(sounding);assert.equal(tones.length,0,'Reload must not repeat old impact/entry cues');
sounding.time=10.05;sounding.effects.push({born:10.05,kind:'impact',text:'',x:200,lane:1});audio.tick(sounding);
assert.equal(tones.length,1);audio.tick(sounding);assert.equal(tones.length,1,'One contact cue per existing effect');
sounding.paused=true;sounding.time=10.1;audio.tick(sounding);assert.equal(tones.length,1);
console.log('PASS cave animation: source hashes, clip rectangles/pivots, all poses, biome IDs, optional failure/cancel/base path, quality budget, pure VFX and identical seeded full-floor outcome.');
