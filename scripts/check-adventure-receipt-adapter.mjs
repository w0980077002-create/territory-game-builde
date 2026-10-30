import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const cloudSource=readFileSync('src/game/cloud.ts','utf8');
const start=cloudSource.indexOf('export function validateAdventureSettlementReceipt(');
const end=cloudSource.indexOf('/** Adopt a permanent license debit',start);
assert.ok(start>0&&end>start);
const tokens=new Map(), wallets=new Map(), generations=new Map(), blocked=new Set();
const cloudExports={};
vm.runInNewContext(compile(cloudSource.slice(start,end)),{exports:cloudExports,Number,Math,Date,Array,Error,
 validSaveToken:v=>typeof v==='string' && Number.isFinite(Date.parse(v)),
 validEconomySnapshot:s=>!!s?.player && Number.isSafeInteger(s.player.gold) && Number.isSafeInteger(s.player.gems) && Number.isSafeInteger(s.player.level) && Number.isSafeInteger(s.battleStones),
 safeWalletVersion:(x)=>({gold:x.gold,gems:x.gems}),walletMatchesVersion:(w,p)=>w.gold===p.gold&&w.gems===p.gems,
 saveTokens:tokens,walletVersions:wallets,saveGenerations:generations,saveBlocked:blocked,
 protectFortuneSave:id=>{blocked.add(id);generations.set(id,(generations.get(id)??0)+1);}});
const adapterSource=readFileSync('src/game/combatV1/receiptAdapter.ts','utf8');
const persisted=new Map();
const storage={getItem:k=>persisted.get(k)??null,setItem:(k,v)=>persisted.set(k,v),removeItem:k=>persisted.delete(k)};
const A='10000000-0000-4000-8000-000000000001', B='10000000-0000-4000-8000-000000000002';
const session='30000000-0000-4000-8000-000000000001';
const cmd={action:'advance',operationId:'20000000-0000-4000-8000-000000000001',sessionId:session,revision:0};
const time1='2026-10-29T10:00:00.000Z',time2='2026-10-29T10:00:01.000Z',time3='2026-10-29T10:00:02.000Z';
const initial={player:{gold:10,gems:5,level:1,xp:90},battleStones:1,forgeMaterials:0,inventory:[]};
const won={...initial,player:{...initial.player,gold:25,level:2,xp:10}};
const receipt={success:true,session_id:session,outcome:'hero_won',stage:1,completed_stage:1,unlocked_stage:2,reward:{gold:15,xp:20,items:[]},updated_at:time2,wallet_gold:25,wallet_gems:5,game_state:won};
let user=A,remoteToken=time2,remoteState=won,mode='offline',saveCalls=0,calls=[],current=initial,applyCalls=0,saveGate=null;
const supabase={auth:{getUser:async()=>({data:{user:{id:user}},error:null})},functions:{invoke:async(_name,{body})=>{
 calls.push(body);if(mode==='offline')return {data:null,error:new Error('offline')};
 return {data:{success:true,session_id:session,revision:1,state:{status:'hero_won'},settlement:mode==='malformed'?{...receipt,wallet_gold:999}:receipt},error:null};
}},from:()=>({select:()=>({eq:(column,id)=>({maybeSingle:async()=>({data:{
 id, updated_at:remoteToken,game_state:remoteState,gold:remoteState.player.gold,gems:remoteState.player.gems,
},error:null})})})})};
const cloud={saveBlocked:blocked,protectFortuneSave:id=>{blocked.add(id);generations.set(id,(generations.get(id)??0)+1);},
 releaseArenaRejectedAction:id=>blocked.delete(id),saveCloudSave:async()=>{saveCalls++;if(saveGate)await saveGate;return true;},
 acceptAdventureSettlementReceipt:cloudExports.acceptAdventureSettlementReceipt,
 acceptAdventureLatestCloudSnapshot:cloudExports.acceptAdventureLatestCloudSnapshot,
 validateAdventureSettlementReceipt:cloudExports.validateAdventureSettlementReceipt,
 validateAdventureStartReceipt:cloudExports.validateAdventureStartReceipt};
const parseCombatCommand=v=>{if(!v||!['advance','resume'].includes(v.action)||typeof v.sessionId!=='string')throw Error('bad command');return v};
function mount(){const exports={};vm.runInNewContext(compile(adapterSource),{exports,localStorage:storage,Set,JSON,Error,Response,
 require:id=>id==='../supabase'?{supabase}:id==='../auth'?{ensurePlayerSession:async id=>user===id}:id==='../cloud'?cloud:id==='./service'?{parseCombatCommand}: (()=>{throw Error(id)})()});return exports;}
const hooks={getState:()=>current,applyState:s=>{current=s;applyCalls++;}};
tokens.set(A,time1);tokens.set(B,time1);
let adapter=mount();
await assert.rejects(adapter.requestAdventureSettlement(A,cmd,hooks),/adventure_unconfirmed/);
assert.equal(blocked.has(A),true);assert.equal(saveCalls,1);assert.ok(storage.getItem('territory_adventure_pending_v1:'+A));
// Remount recovers the original command and save fence; the same operation is retried.
adapter=mount();assert.deepEqual(JSON.parse(JSON.stringify(adapter.restoreAdventureSaveFence(A))),cmd);
mode='success';await adapter.requestAdventureSettlement(A,cmd,hooks);
assert.equal(current.player.level,2);assert.equal(current.player.gold,25);assert.equal(applyCalls,1);assert.equal(blocked.has(A),false);
assert.equal(storage.getItem('territory_adventure_pending_v1:'+A),null);assert.equal(saveCalls,1);assert.deepEqual(calls.at(-1),cmd);
// An exact replay cannot replace unsaved local state, even at the same token.
current={...won,extra:'unsaved'};
await adapter.requestAdventureSettlement(A,{action:'resume',sessionId:session},hooks);
assert.equal(current.extra,'unsaved');assert.equal(applyCalls,1);
// A replayed old receipt must adopt the LATEST complete cloud snapshot, not the
// old gold/XP/gear from the receipt, without issuing a second reward.
remoteToken=time3;
remoteState={...won,player:{...won.player,gold:70,xp:77},forgeMaterials:6,
 inventory:[{id:'new-equipped-item',qty:1}],extra:'saved on server'};
await adapter.requestAdventureSettlement(A,{action:'resume',sessionId:session},hooks);
assert.equal(current.player.gold,70);assert.equal(current.player.xp,77);
assert.equal(current.forgeMaterials,6);assert.equal(current.inventory[0].id,'new-equipped-item');
assert.equal(current.extra,'saved on server');assert.equal(blocked.has(A),false);
assert.equal(tokens.get(A),time3);
remoteToken=time2;remoteState=won;
// A malformed receipt and wrong account never affect the installed state.
mode='malformed';await assert.rejects(adapter.requestAdventureSettlement(A,{action:'resume',sessionId:session},hooks),/adventure_invalid_receipt/);
assert.equal(blocked.has(A),true);assert.equal(current.extra,'saved on server');blocked.delete(A);
user=B;await assert.rejects(adapter.requestAdventureSettlement(A,cmd,hooks),/adventure_auth_required/);user=A;
// Mutation while the pre-operation save is pending prevents sending the fight request.
mode='success';current=initial;let done;saveGate=new Promise(r=>done=r);const before=calls.length;
const attempt=adapter.requestAdventureSettlement(A,cmd,hooks);await new Promise(r=>setTimeout(r,0));current={...initial,extra:'new edit'};done();
await assert.rejects(attempt,/adventure_save_required/);assert.equal(calls.length,before);saveGate=null;
// A corrupted pending entry fails closed and keeps its account-specific fence.
storage.setItem('territory_adventure_pending_v1:'+B,'not-json');assert.throws(()=>adapter.restoreAdventureSaveFence(B));
assert.equal(blocked.has(B),true);assert.equal(blocked.has(A),false);
// A UI installation exception must not unblock old autosaves after the token moved.
tokens.set(A,time1);remoteToken=time2;current=initial;
await assert.rejects(adapter.requestAdventureSettlement(A,{action:'resume',sessionId:session},
 {getState:()=>current,applyState:()=>{throw Error('render failed')}}),/render failed/);
assert.equal(blocked.has(A),true);
console.log('Adventure receipt adapter PASS: timeout/replay/remount, account isolation, newer server saves, malformed reply and pending-save fence.');
