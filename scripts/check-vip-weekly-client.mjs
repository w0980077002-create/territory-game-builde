import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';

const mocks = {
  './supabase': 'export const supabase = globalThis.fixture.supabase;',
  './actions': 'export const useGame = globalThis.fixture.useGame;',
  './cloud': `export const {acceptMonopolyClaimReceipt,protectFortuneSave,
    releaseArenaRejectedAction,saveBlocked,saveCloudSave,saveTokens}=globalThis.fixture.cloud;`,
};
const result = await build({entryPoints:['src/game/vipWeekly.ts'],bundle:true,platform:'node',
  format:'esm',write:false,plugins:[{name:'fixtures',setup(build){
    build.onResolve({filter:/^\.\/(supabase|actions|cloud)$/}, args => ({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:mocks[args.path],loader:'js'}));
  }}]});
const storage = new Map();
globalThis.window = {localStorage:{getItem:k=>storage.get(k) ?? null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
if (!globalThis.crypto) Object.defineProperty(globalThis,'crypto',{value:webcrypto});
const user='player';
const snapshot={player:{gold:100}};
const calls=[];
let releaseStatus;
let failClaim=false;
const reply={success:true,updated_at:'2026-11-04T00:00:00Z',game_state:snapshot,wallet_gold:100,wallet_gems:0};
globalThis.fixture={
  supabase:{rpc:async (_name,args)=>{
    calls.push(args);
    if(args.p_action==='status' && releaseStatus) await new Promise(resolve=>{releaseStatus.resolve=resolve;});
    if(args.p_action==='claim' && failClaim) return {error:{code:'PGRST003',message:'timeout'}};
    return {data:args.p_action==='status'
      ? {...reply,vip:5,server_week:'2026-11-03',next_reset_at:'2026-11-05T00:00:00Z',claimed_this_week:false}
      : {...reply,reward:{gold:600,gems:5,stones:2,materials:2,vip:5,week:'2026-11-04'}}};
  }},
  useGame:{get:()=>snapshot,set:()=>{}},
  cloud:{acceptMonopolyClaimReceipt:()=>snapshot,protectFortuneSave:()=>{},releaseArenaRejectedAction:()=>{},
    saveBlocked:new Set(),saveCloudSave:async()=>true,saveTokens:new Map([[user,reply.updated_at]])},
};
const weekly=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
releaseStatus={};
const status=weekly.fetchVipWeeklyStatus(user);
await new Promise(resolve=>setTimeout(resolve,0));
const claim=weekly.claimVipWeekly(user);
assert.deepEqual(calls.map(c=>c.p_action),['status']);
releaseStatus.resolve(); releaseStatus=null;
assert.equal((await status).claimedThisWeek,false);
assert.equal((await claim).gold,600);
assert.deepEqual(calls.map(c=>c.p_action),['status','claim']);

failClaim=true;
await assert.rejects(weekly.claimVipWeekly(user),/timeout/);
const pending=JSON.parse(storage.get(`territory.vip.weekly.pending.v1:${user}`));
assert(pending.operation,'ambiguous failure retains the operation ID');
failClaim=false;
await weekly.recoverVipWeekly(user);
assert.equal(calls.at(-1).p_operation,pending.operation,'recovery retries the original operation');
assert.equal(storage.size,0);
console.log('VIP weekly client: serialized status/claim and ambiguous-response recovery: PASS');
