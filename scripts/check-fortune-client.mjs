import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
let state={player:{gold:100,gems:7},inventory:[],forgeMaterials:1},revision='2026-10-20T00:00:00.000Z';
let serverState=structuredClone(state),serverRevision=revision,receipt=null,tickets=4,mode='normal',calls=[],deferred=null;
const seen=new Map();
const data=()=>({success:true,updated_at:serverRevision,game_state:structuredClone(serverState),wallet_gold:serverState.player.gold,wallet_gems:serverState.player.gems,tickets,common:0,rare:0,golden_key:0,vip:0,vip_until:null,server_now:serverRevision,receipt});
const fixture={useGame:{get:()=>state,set:s=>{state=s;}},useAccount:{set:()=>{}},saveTokens:new Map([['A',revision]]),blocked:false,saves:0,installs:0,
 saveCloudSave:async()=>{fixture.saves++;return true;},claimHallGoldCloud:async()=>({state,gold:0}),protectFortuneSave:()=>{fixture.blocked=true;},acceptMonopolyClaimReceipt:(id,r)=>{fixture.installs++;fixture.blocked=false;fixture.saveTokens.set(id,r.updated_at);return r.game_state;},
 supabase:{rpc:async(name,args)=>{
  if(name==='territory_fortune_entitlement_v1')return {data:{vip:0,permanent_vip:0,server_now:serverRevision,vip_until:null}};
  if(name==='territory_hall_status_v1')return {data:{tickets,points:0,played:0,wins:0,pending_gold:0,claimed_gold:0,position:0,daily_remaining:0,free_ready:false,active:null}};
  if(name==='territory_hall_finish_v1')return {data:{won:true,earned_gold:100,points:10,daily_remaining:0,tickets,game:'treasury',new_position:null}};
  calls.push({...args});if(mode==='defer'&&args.p_action==='spin')await new Promise(resolve=>{deferred=resolve;});
  if(mode==='before'&&args.p_action==='spin')throw new Error('Network disconnected before request');
  if(args.p_action==='ack'){receipt=null;return {data:data()};}
  if(args.p_action==='spin'){
   if(mode==='reject')return {error:{message:'hall_no_tickets',code:'P0001'}};
   if(!receipt&&!seen.has(args.p_key)){
    tickets--;serverState.player.gold+=100;serverRevision=new Date(Date.parse(serverRevision)+1000).toISOString();
    receipt={id:args.p_key,action:'spin',prize:'gold',quantity:100,refunded:false};seen.set(args.p_key,receipt);
   }else if(seen.has(args.p_key))receipt=seen.get(args.p_key);
   if(mode==='after')throw new Error('Lost response after committed payout');
  }
  return {data:data()};
 }}};
globalThis.__fortuneFixture=fixture;
const stub=`const f=globalThis.__fortuneFixture;export const {useGame,useAccount,saveTokens,saveCloudSave,claimHallGoldCloud,protectFortuneSave,acceptMonopolyClaimReceipt,supabase}=f;`;
const result=await build({entryPoints:['src/game/fortune.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'client-fixtures',setup(b){b.onResolve({filter:/^\.\/(cloud|actions|supabase)$/},()=>({path:'stub',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub}));}}]});
let moduleCount=0;const load=()=>import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')+'#'+(++moduleCount));
let api=await load();
// Double click before even finishing the pre-save returns the same promise.
mode='defer';const one=api.playFortune('A','spin'),two=api.playFortune('A','spin');assert.equal(one,two);
await new Promise(r=>setTimeout(r,0));assert.equal(fixture.blocked,true);deferred();await one;
assert.equal(tickets,3);assert.equal(state.player.gold,200);assert.equal(calls.filter(c=>c.p_action==='spin').length,1);assert.equal(storage.size,0);
await api.acknowledgeFortune('A',receipt.id);
// A lost response retains the operation id. Reloading the client module must
// recover the same transaction, not pre-save/spin with another random key.
mode='after';await assert.rejects(api.playFortune('A','spin'),/Lost response/);assert.equal(tickets,2);assert.equal(fixture.blocked,true);assert.equal(storage.size,1);
const original=JSON.parse([...storage.values()][0]);const saves=fixture.saves;
api=await load();mode='normal';const recovered=await api.recoverFortune('A');assert.equal(recovered.receipt.id,original.key);assert.equal(tickets,2);assert.equal(state.player.gold,300);assert.equal(fixture.saves,saves);assert.equal(storage.size,0);assert.equal(fixture.blocked,false);
const lastSpin=calls.filter(c=>c.p_action==='spin').at(-1);assert.equal(lastSpin.p_key,original.key);assert.equal(lastSpin.p_expected,original.expected);
await api.acknowledgeFortune('A',receipt.id);
// Failure before delivery also reuses the persisted key on the next attempt.
mode='before';await assert.rejects(api.playFortune('A','spin'),/before request/);assert.equal(tickets,2);const early=JSON.parse([...storage.values()][0]);
mode='normal';const retry=await api.recoverFortune('A');assert.equal(retry.receipt.id,early.key);assert.equal(tickets,1);assert.equal(state.player.gold,400);await api.acknowledgeFortune('A',receipt.id);
// A definitive SQL rollback clears the marker only after status reconciliation.
mode='reject';await assert.rejects(api.playFortune('A','spin'),/hall_no_tickets/);assert.equal(tickets,1);assert.equal(storage.size,0);assert.equal(fixture.blocked,false);
assert.equal((await api.recoverFortune('A')).receipt,null);
// Regression: admin-issued / accumulated Hall balances can exceed the 20-ticket
// daily-claim threshold. The production wallet constraint allows up to 1000.
mode='normal';tickets=128;
assert.equal((await api.recoverFortune('A')).tickets,128);
const largeWallet=await api.playFortune('A','spin');
assert.equal(largeWallet.tickets,127);
assert.equal(state.player.gold,500);
await api.acknowledgeFortune('A',largeWallet.receipt.id);
tickets=1000;
assert.equal((await api.recoverFortune('A')).tickets,1000);
tickets=1001;
await assert.rejects(api.recoverFortune('A'),/fortune_invalid_receipt/);
// Exercise the real shared Hall response validators, not only Fortune's.
const hallBuild=await build({entryPoints:['src/game/gameHall.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'hall-fixtures',setup(b){b.onResolve({filter:/^\.\/(cloud|actions|supabase)$/},()=>({path:'stub',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub}));}}]});
const hall=await import('data:text/javascript;base64,'+Buffer.from(hallBuild.outputFiles[0].text).toString('base64'));
const session={token:'10000000-0000-0000-0000-000000000001',game:'treasury',question:{}};
tickets=128;
assert.equal((await hall.hallStatus()).tickets,128);
assert.equal((await hall.hallFinish(session,0)).tickets,128);
tickets=1000;
assert.equal((await hall.hallStatus()).tickets,1000);
assert.equal((await hall.hallFinish(session,0)).tickets,1000);
tickets=1001;
await assert.rejects(hall.hallStatus(),/hall_invalid_status_tickets/);
await assert.rejects(hall.hallFinish(session,0),/hall_invalid_result/);
assert.ok(calls.every(c=>!('prize'in c)&&!('quantity'in c)&&!('reward'in c)));
console.log('Wheel client PASS: double click mutex, blocked old saves, network failures before/after commit, persisted key, module restart, same-key recovery, definitive rollback reconciliation, Hall and Wheel balances 128/1000, invalid 1001 rejected, no reward payload.');
