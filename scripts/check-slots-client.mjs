import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const memory=new Map();let storageFail=false;let calls=[];
const localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>{if(storageFail)throw Error('blocked');memory.set(k,v);},removeItem:k=>memory.delete(k)};
const supabase={rpc:async(name,args)=>{calls.push([name,args]);return {data:{enabled:false},error:null};}};
const m={exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync('src/game/slotsApi.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports,localStorage,setTimeout,clearTimeout,require:p=>p==='./supabase'?{supabase}:{SLOT_COIN_BET_CHOICES:[5,10,25,50],SLOT_ICONS:{gold:{},gem:{},sword:{}}}});
const api=m.exports;
assert.equal(await api.withSlotsDeadline(Promise.resolve('ok'),25),'ok');
await assert.rejects(api.withSlotsDeadline(new Promise(()=>{}),10),/slots_request_timeout/,
 'an unresponsive status RPC must not trap the Telegram WebView in a loading screen');
await assert.rejects(api.withSlotsDeadline(Promise.reject(new Error('offline')),25),/offline/);
assert.equal((await api.fetchSlotsStatus()).enabled,false);
supabase.rpc=async()=>({data:null,error:{code:'PGRST202',message:'missing'}});
assert.equal(await api.fetchSlotsStatus(),null);
supabase.rpc=async()=>({data:null,error:{code:'503',message:'offline'}});
await assert.rejects(api.fetchSlotsStatus(),/offline/,'network failure cannot masquerade as demo availability');
const id='11111111-1111-4111-8111-111111111111';
const op={id,expected:0,request:{action:'spin',lines:9,bet:5}};
api.keepPendingSlots('A',op);assert.equal(api.readPendingSlots('A').id,id);
assert.equal(api.readPendingSlots('B'),null,'other account cannot reuse replay');
api.keepPendingSlots('B',null);assert.equal(api.readPendingSlots('A').id,id);
storageFail=true;assert.throws(()=>api.keepPendingSlots('A',op),/blocked/);storageFail=false;
assert.equal(calls.length,1,'marker writes never submit RPCs');
const status={enabled:true,coins:500000,collected:0,state:{phase:'ready',revision:0,pending:0,riskSteps:0,opened:[],picksLeft:5,shields:0}};
supabase.rpc=async(name,args)=>{calls.push([name,args]);return {data:status,error:null};};
await api.submitSlotsAction(op);await api.submitSlotsAction(op);
assert.equal(calls.at(-1)[1].p_operation,calls.at(-2)[1].p_operation,'timeout retries preserve UUID');
assert.equal(calls.at(-1)[1].p_lines,9);
await assert.rejects(api.submitSlotsAction({id,request:{action:'spin',lines:2,bet:5}}),/slots_invalid_operation/);
await assert.rejects(api.submitSlotsAction({id,request:{action:'risk',choice:4}}),/slots_invalid_operation/);
supabase.rpc=async()=>({data:{...status,coins:-1},error:null});await assert.rejects(api.fetchSlotsStatus(),/slots_invalid_reply/);
supabase.rpc=async()=>({data:{...status,state:{...status.state,outcome:{grid:[[]]}}},error:null});await assert.rejects(api.fetchSlotsStatus(),/slots_invalid_outcome/);
supabase.rpc=async()=>({data:null,error:{code:'P0001',message:'slots_no_gold'}});
await assert.rejects(api.submitSlotsAction(op),e=>e instanceof api.SlotsRejected);
const ui=readFileSync('src/components/ServerVikingSlots.tsx','utf8');
const apiSource=readFileSync('src/game/slotsApi.ts','utf8');
assert.ok(ui.indexOf('keepPendingSlots(userId,operation)')<ui.indexOf('await submitSlotsAction(operation)'),'persist before sending');
assert.match(ui,/if \(lock\.current/,'synchronous double-click guard');
assert.match(ui,/readPendingSlots\(userId\)/,'restore saved operation');
assert.match(apiSource,/await withSlotsDeadline\(supabase\.rpc\('territory_slots_v1', \{ p_action:'status' \}\)\)/,
 'status must not leave the enabled/demo gate spinning forever when offline');
assert.match(apiSource,/\}\), 15_000\)/,
 'an unconfirmed bet must time out while retaining its durable operation for replay');
assert.match(ui,/await withSlotsDeadline\(saveCloudSave\(userId,snapshot\),8_000\)/,'flush pending game actions before spending real gold, with a prompt no-wager deadline');
assert.match(ui,/slots_save_slow/,'a slow pre-save must explain that no bet was sent');
assert.match(ui,/LIVE_REEL_TRAIL = 3/,'mobile live reels must render only nine symbols per reel');
assert.match(ui,/document\.addEventListener\('visibilitychange',stopAutoOnHide\)/,
 'Telegram backgrounding must stop autospin');
assert.match(ui,/if\(document\.visibilityState!=='visible'\)\{setAuto\(0\);return;\}/,
 'a queued autospin must not wager while the WebView is hidden');
const css=readFileSync('src/components/vikingSlots.css','utf8');
assert.match(css,/\.vslot-reel-track--rolling\.vslot-reel-track--quick\{\s*height:300%;/,
 'nine-symbol animated reel must retain three visible rows');
assert.match(css,/\.vslot-reel-track--rolling\.vslot-reel-track--quick \.vslot-symbol\{\s*flex:0 0 calc\(100% \/ 9\);/,
 'all nine travelling symbols must have equal heights');
assert.match(css,/@keyframes vslot-short-reel-roll\{[\s\S]*?100%\{transform:translateY\(-66\.666667%\)\}/,
 'the last three symbols must land exactly on the three-row viewport');
assert.match(ui,/vslot-reels--confirming/,'pending stake should visibly progress instead of showing a frozen board');
assert.match(ui,/acceptMonopolyClaimReceipt\(userId,receipt\)/,'adopt the exact verified server wallet receipt');
assert.doesNotMatch(ui,/spinVikingSlots|fairDemoInt|setBalance|useGame\.set|autoClaimHallGold/,'live screen cannot invent outcomes or balances');
assert.doesNotMatch(ui,/status\.tickets|БИЛЕТОВ НА ЛИНИЮ/,'slot stakes must use hero gold, not hall tickets');
api.keepPendingSlots('A',null);assert.equal(api.readPendingSlots('A'),null);
console.log('Slots client PASS: unavailable vs disabled gate, malformed response guards, real hero gold, account-scoped recovery, durable markers, stable UUID and server-only outcomes.');
