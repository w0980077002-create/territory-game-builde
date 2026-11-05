import assert from 'node:assert/strict';
import { build } from 'esbuild';

const user = '10000000-0000-4000-8000-000000000001';
const session = '20000000-0000-4000-8000-000000000002';
const secondSession = '20000000-0000-4000-8000-000000000003';
const thirdSession = '20000000-0000-4000-8000-000000000004';
const choice = { type:'potion', name:'Healing', rarity:'common',
  effect:{stat:'hp',value:50} };
const item = (qty=5) => ({id:'stock',name:'Healing',qty,type:'potion',
  rarity:'common',icon:'potion.webp',description:'Healing',effect:choice.effect,
  expiresAt:'2099-01-01T00:00:00Z'});
const fresh = () => ({player:{level:90,gold:100,gems:20},
  activeDays:90,belt:Array(7).fill(null),inventory:[item()],
  beltRefillChoices:[choice,...Array(6).fill(null)],autoRefillBelt:true});
let state=fresh(),serverState=structuredClone(state),writes=0,accepted=true,
  changedServer=false,delayed=false,doneSave=null,revision='2026-11-05T04:00:00.000Z';
const blocked=new Set(),tokens=new Map([[user,revision]]),storage=new Map();
const account={permanentVip:5,vip:5,vipRemaining:0,vipCheckedAt:0};
const store={get:()=>state,set:next=>{state=next;}};
const server={from:name=>{
  assert.equal(name,'players');
  return {select:()=>({eq:()=>({maybeSingle:async()=>({
    error:null,data:{updated_at:revision,game_state:changedServer?fresh():serverState,
      gold:100,gems:20},
  })})})};
}};
const save=async(_id,next)=>{
  writes++;
  if(delayed)await new Promise(resolve=>{doneSave=resolve;});
  if(!accepted)return false;
  serverState=structuredClone(next);
  revision='2026-11-05T04:00:'+String(writes).padStart(2,'0')+'.000Z';
  tokens.set(user,revision);
  return true;
};
globalThis.__caveVipFixture={actions:{useAccount:{get:()=>account},
  useArena:{get:()=>({wins:100})},useGame:store},
  cloud:{saveBlocked:blocked,saveCloudSave:save,saveTokens:tokens},
  supabase:{supabase:server}};
globalThis.window={localStorage:{getItem:k=>storage.get(k)??null,
  setItem:(k,v)=>storage.set(k,v)}};
const sources={
  './actions':'export const {useAccount,useArena,useGame}=globalThis.__caveVipFixture.actions;',
  './cloud':'export const {saveBlocked,saveCloudSave,saveTokens}=globalThis.__caveVipFixture.cloud;',
  './supabase':'export const {supabase}=globalThis.__caveVipFixture.supabase;',
};
const result=await build({entryPoints:['src/game/vipBeltCave.ts'],bundle:true,write:false,
  platform:'node',format:'esm',plugins:[{name:'vip-cave-fixtures',setup(b){
    b.onResolve({filter:/^\.\/(actions|cloud|supabase)$/},arg=>({path:arg.path,namespace:'vip-cave'}));
    b.onLoad({filter:/.*/,namespace:'vip-cave'},arg=>({contents:sources[arg.path],loader:'js'}));
  }}]});
const {persistCaveVipBeltAfterSettlement:refill}=await import(
  'data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const verified=(id=session,outcome='hero_won')=>({session_id:id,state:{status:outcome},
  settlement:{outcome}});

assert.equal(await refill(user,{session_id:session,state:{status:'fighting'}}),false);
assert.equal(await refill(user,{...verified(),settlement:{outcome:'draw'}}),false);
assert.equal(await refill(user,verified('fake-id')),false);
assert.equal(writes,0,'unconfirmed combat cannot move stock');

delayed=true;
const one=refill(user,verified()),two=refill(user,verified());
assert.strictEqual(one,two,'same combat has one in-flight refill');
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(writes,1);
assert.equal(storage.get(`territory.vip.belt.cave.v1:${user}:${session}`),'pending');
doneSave();delayed=false;
assert.equal(await one,true);
assert.equal(state.belt[0].qty,5);
assert.equal(state.inventory.length,0);
assert.equal(await refill(user,verified()),false,'terminal replay cannot refill twice');
assert.equal(writes,1);
assert.equal(storage.get(`territory.vip.belt.cave.v1:${user}:${session}`),'done');

state=fresh();serverState=structuredClone(state);accepted=false;
assert.equal(await refill(user,verified(secondSession,'enemy_won')),false);
assert.equal(state.belt[0],null,'failed save cannot advertise a refill');
assert.equal(await refill(user,verified(secondSession,'enemy_won')),false,'ambiguous write cannot repeat');
assert.equal(writes,2);
assert.equal(storage.get(`territory.vip.belt.cave.v1:${user}:${secondSession}`),'pending');

state=fresh();serverState=structuredClone(state);accepted=true;blocked.add(user);
assert.equal(await refill(user,verified(thirdSession,'draw')),false);
assert.equal(writes,2,'other save fences are not bypassed');
blocked.clear();
account.permanentVip=0;account.vip=0;
assert.equal(await refill(user,verified(thirdSession,'draw')),false);
assert.equal(writes,2,'non-VIP cannot refill');
account.permanentVip=5;
changedServer=true;
assert.equal(await refill(user,verified(thirdSession,'draw')),false,
  'cloud mismatch after CAS must not install a potentially stale state');
assert.equal(state.belt[0],null);
assert.equal(storage.get(`territory.vip.belt.cave.v1:${user}:${thirdSession}`),'pending');
console.log('VIP Cave post-settlement: verified receipt, one in-flight save, CAS readback, replay, fail-closed PASS');
