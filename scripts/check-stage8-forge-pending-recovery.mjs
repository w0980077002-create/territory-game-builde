import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const UID='5af7beac-1a7b-4def-9780-f52db48bac3c';
const ITEM_UUID='4abcf946-7d58-4299-8637-40a70d0e5465';
const ITEM_ID='stage8_'+ITEM_UUID;
const KEY='territory_stage8_forge_pending_v1:'+UID;

const store=new Map();
globalThis.localStorage={
  getItem:(key)=>store.get(key)??null,
  setItem:(key,value)=>store.set(key,String(value)),
  removeItem:(key)=>store.delete(key),
};
globalThis.__forgeTestEnv={
  uid:UID, owned:[], forgeCalls:[], response:null, error:null,
};
const fixture={
  '@/game/supabase': `export const supabase={
    auth:{getUser:async()=>({data:{user:{id:globalThis.__forgeTestEnv.uid}},error:null})},
    rpc:async(name,args)=>{
      if(name==='territory_stage8_forge_ready_v1')return {data:true,error:null};
      if(name!=='territory_stage8_forge_v1')throw Error('Unexpected RPC '+name);
      globalThis.__forgeTestEnv.forgeCalls.push(args);
      return {data:globalThis.__forgeTestEnv.response,error:globalThis.__forgeTestEnv.error};
    },
  };`,
  '@/game/cloud': `export function acceptMonopolyClaimReceipt(_uid,result){
    if(!result?.game_state)throw Error('Missing test cloud receipt');
    return result.game_state;
  }`,
  '@/game/stage8CraftApi': `export async function fetchStage8Items(){
    return globalThis.__forgeTestEnv.owned;
  }`,
};
const compiled=await build({
  entryPoints:[resolve('src/game/stage8ForgeApi.ts')],
  bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',
  plugins:[{name:'forge-fixtures',setup(b){
    b.onResolve({filter:/^@\/game\/(supabase|cloud|stage8CraftApi)$/},args=>({path:args.path,namespace:'test-stub'}));
    b.onLoad({filter:/.*/,namespace:'test-stub'},args=>({contents:fixture[args.path],loader:'js'}));
  }}],
});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const env=globalThis.__forgeTestEnv;
const marker=(level,id=ITEM_ID)=>({itemId:id,level,operationId:'c750df60-e329-4c89-a9ab-4d458393692a'});
const owned=(level)=>[{itemId:ITEM_UUID,output:{equipment:{level}}}];
const write=(value)=>localStorage.setItem(KEY,JSON.stringify(value));

env.owned=owned(23);
write(marker(22));
assert.equal(await api.recoverCompletedStage8Forge(UID),true,'A confirmed 22→23 upgrade releases stale local marker');
assert.equal(localStorage.getItem(KEY),null,'Account-scoped pending marker must be removed once');
assert.equal(env.forgeCalls.length,0,'Read-only recovery MUST NOT initiate a second paid forge attempt');

env.owned=owned(22);
write(marker(22));
assert.equal(await api.recoverCompletedStage8Forge(UID),false,'No advancement means an unresolved or failed roll');
assert.notEqual(localStorage.getItem(KEY),null,'Never discard a failed/unconfirmed paid operation');
await assert.rejects(api.attemptStage8Forge(UID,ITEM_ID,23),/stage8_forge_other_operation_pending/);
assert.equal(env.forgeCalls.length,0,'Unconfirmed previous roll cannot be bypassed');

env.owned=owned(23);
await assert.rejects(api.attemptStage8Forge(UID,ITEM_ID,23),/stage8_forge_previous_operation_recovered/);
assert.equal(localStorage.getItem(KEY),null,'Mismatch is healed from authenticated server inventory');
assert.equal(env.forgeCalls.length,0,'Recovery tap has no paid side effects');

env.response={
  success:true,item_id:ITEM_UUID,level_before:23,level_after:24,
  upgraded:true,cost_gold:740,cost_materials:8,game_state:{player:{level:61}},
};
const next=await api.attemptStage8Forge(UID,ITEM_ID,23);
assert.equal(next.afterLevel,24);
assert.equal(next.upgraded,true);
assert.equal(env.forgeCalls.length,1,'Only the second explicit tap starts a new roll');
assert.equal(localStorage.getItem(KEY),null,'Confirmed receipt is cleared');

env.response=null;
env.error={message:'network timeout'};
await assert.rejects(api.attemptStage8Forge(UID,ITEM_ID,24),/network timeout/);
const pending=JSON.parse(localStorage.getItem(KEY));
assert.equal(pending.level,24,'Unknown outcome preserves the same pending operation');
env.response={
  success:true,item_id:ITEM_UUID,level_before:24,level_after:24,
  upgraded:false,cost_gold:770,cost_materials:9,game_state:{player:{level:61}},
};
env.error=null;
const recovered=await api.attemptStage8Forge(UID,ITEM_ID,24);
assert.equal(recovered.upgraded,false);
assert.equal(env.forgeCalls.at(-1).p_operation,pending.operationId,
  'Retry uses the exact original UUID, never a second paid operation');
assert.equal(localStorage.getItem(KEY),null,'Confirmed failed roll can be followed by another try');

console.log('Stage8 forge: stale success self-heals without spend; failed/unknown rolls retain idempotency');
