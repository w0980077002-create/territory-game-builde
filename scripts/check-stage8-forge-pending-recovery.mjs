import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const PLAYER='5af7beac-1a7b-4def-9780-f52db48bac3c';
const RAW='4abcf946-7d58-4299-8637-40a70d0e5465';
const ITEM='stage8_'+RAW;
const OLD_OPERATION='8c24d64f-d1c6-47ec-93f4-f041e72c87eb';
const KEY='territory_stage8_forge_pending_v1:'+PLAYER;
const calls=[];
const records=new Map();
globalThis.localStorage={
  getItem:key=>records.get(key)??null,
  setItem:(key,val)=>{records.set(key,val);},
  removeItem:key=>{records.delete(key);},
};
globalThis.crypto={randomUUID};
let handler=async()=>{throw Error('Unexpected remote request');};
globalThis.__forgeTestSupabase={
  auth:{getUser:async()=>({data:{user:{id:PLAYER}},error:null})},
  rpc:async(name,args)=>{calls.push({name,args});return handler(name,args);},
};
const output=await build({
  entryPoints:[resolve('src/game/stage8ForgeApi.ts')],
  bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',
  plugins:[{
    name:'forge-recovery-fixtures',
    setup(b){
      b.onResolve({filter:/^@\/game\/(supabase|cloud)$/},args=>({path:args.path,namespace:'forge-fixture'}));
      b.onLoad({filter:/.*/,namespace:'forge-fixture'},args=>({
        contents:args.path.endsWith('supabase')
          ? 'export const supabase=globalThis.__forgeTestSupabase;'
          : 'export const acceptMonopolyClaimReceipt=(_id,data)=>data.game_state;',
        loader:'js',
      }));
    },
  }],
});
const api=await import('data:text/javascript;base64,'+
  Buffer.from(output.outputFiles[0].text).toString('base64'));

function state(level){
  return {inventory:[{id:ITEM,equipment:{id:ITEM,slot:'ring',level}}],
    player:{equipped:{},gold:1000,gems:0},forgeMaterials:100};
}
function pending(level=22){
  records.set(KEY,JSON.stringify({itemId:ITEM,level,operationId:OLD_OPERATION}));
}
function makeRecovery(found=true,currentLevel=23){
  return {data:{
    success:true,found,item_id:RAW,expected_level:22,current_level:currentLevel,
    result:found?{item_id:RAW,success:true,upgraded:true,
      level_before:22,level_after:23,cost_gold:710,cost_materials:8}:null,
    updated_at:'2026-11-14T00:20:00.123Z',wallet_gold:1000,wallet_gems:0,
    game_state:state(currentLevel),
  },error:null};
}
const call=async(level=23)=>api.attemptStage8Forge(PLAYER,ITEM,level);

// Last success 22 -> 23 made it to the registry, but its local pending marker
// survived a Telegram reconnect. Recover the old receipt WITHOUT spending.
pending();
handler=async(name,args)=>{
  assert.equal(name,'territory_stage8_forge_pending_recovery_v1');
  assert.equal(args.p_item,RAW);
  assert.equal(args.p_expected_level,22);
  assert.equal(args.p_operation,OLD_OPERATION);
  return makeRecovery(true,23);
};
const restored=await call();
assert.equal(restored.recovered,true);
assert.equal(restored.afterLevel,23);
assert.equal(restored.goldCost,0);
assert.equal(restored.materialCost,0);
assert.equal(calls.length,1,'read-only recovery; never call the paid forge RPC');
assert.equal(records.has(KEY),false,'clear only after verified server snapshot');

// Next explicit tap starts one NEW operation for 23 -> 24.
calls.length=0;
handler=async(name,args)=>{
  assert.equal(name,'territory_stage8_forge_v1');
  assert.equal(args.p_expected_level,23);
  assert.notEqual(args.p_operation,OLD_OPERATION);
  return {data:{success:true,replayed:false,item_id:RAW,upgraded:false,
    level_before:23,level_after:23,cost_gold:740,cost_materials:8,
    game_state:state(23),updated_at:'2026-11-14T00:20:01.456Z',
    wallet_gold:1000,wallet_gems:0},error:null};
};
const roll=await call();
assert.equal(roll.recovered,false);
assert.equal(roll.upgraded,false);
assert.equal(calls.length,1);
assert.equal(records.has(KEY),false);

// A marker with NO receipt can only be retired if the canonical server item
// is already ahead; never silently roll at the previous level.
calls.length=0;
pending();
handler=async(name)=>{assert.equal(name,'territory_stage8_forge_pending_recovery_v1');return makeRecovery(false,23);};
const stale=await call();
assert.equal(stale.recovered,true);
assert.equal(calls.length,1);
assert.equal(records.has(KEY),false);

calls.length=0;
pending();
handler=async(name)=>{assert.equal(name,'territory_stage8_forge_pending_recovery_v1');return makeRecovery(false,22);};
await assert.rejects(()=>call(),/stage8_forge_previous_operation_unconfirmed/);
assert.equal(records.has(KEY),true,'do not erase an unconfirmed operation');
assert.equal(calls.length,1);

calls.length=0;
handler=async()=>({data:null,error:{message:'network_offline'}});
await assert.rejects(()=>call(),/network_offline/);
assert.equal(records.has(KEY),true,'network unknown: preserve same operation id');
assert.equal(calls.length,1);

// A forged or broken recovery record must never make the UI accept a new roll.
handler=async()=>({data:{...makeRecovery(true,23).data,item_id:randomUUID()},error:null});
await assert.rejects(()=>call(),/stage8_forge_recovery_unverified/);
assert.equal(records.has(KEY),true);

const source=readFileSync('src/components/ForgeScreen.tsx','utf8');
const server=readFileSync('supabase/staged/territory_stage8_forge_pending_recovery_v1.sql','utf8');
assert.match(source,/receipt\.recovered/);
assert.match(source,/visibilitychange/);
assert.match(server,/p_operation uuid/);
assert.match(server,/v_uid uuid := auth\.uid\(\)/);
assert.match(server,/WHERE player_id=v_uid AND operation_id=p_operation/);
assert.match(server,/REVOKE ALL ON FUNCTION public\.territory_stage8_forge_pending_recovery_v1/);
assert.match(server,/GRANT EXECUTE ON FUNCTION public\.territory_stage8_forge_pending_recovery_v1/);
console.log('Stage8 forge pending recovery: read-only replay, fresh roll, stale marker, unconfirmed and network guards PASS');
