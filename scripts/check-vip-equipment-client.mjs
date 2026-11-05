import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const user='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const items={helmet:null,amulet:null,armor:null,weapon:'owned-weapon',
  shield:null,ring:null,boots:null};
const row={player:{gold:100,gems:20,redGems:0},inventory:[],forgeMaterials:0};
const saved=new Map(),blocked=new Set(),tokens=new Map([[user,'2026-11-05T06:00:00.000Z']]);
let state=row,actualUser=user,cloudWrites=0,rpcCalls=[],failApply=null,issued=null;
const fixture={
  store:{get:()=>state,set:s=>{state=s;}},
  blocked,tokens,
  save:async(id,s)=>{
    assert.equal(id,user);
    assert.strictEqual(s,state);
    cloudWrites++;
    tokens.set(user,'2026-11-05T06:00:'+String(cloudWrites).padStart(2,'0')+'.000Z');
    return true;
  },
  protect:id=>blocked.add(id),
  release:id=>blocked.delete(id),
  accept:(id,r)=>{assert.equal(id,user);blocked.delete(id);tokens.set(id,r.updated_at);return r.game_state;},
  owner:async id=>id===actualUser,
  server:{
    auth:{getUser:async()=>({data:{user:{id:actualUser}},error:null})},
    rpc:async(name,args)=>{
      rpcCalls.push({name,args});
      if(name==='territory_vip_equipment_presets_status_v1')
        return {data:{vip:5,presets:[{slot:1,equipment_ids:items}]},error:null};
      if(name==='territory_vip_equipment_preset_save_v1')
        return {data:{success:true,preset_no:args.p_slot,updated_at:args.p_expected},error:null};
      if(name==='territory_vip_equipment_preset_apply_v1'){
        issued=args.p_operation;
        if(failApply)return {data:null,error:failApply};
        return {data:{success:true,already_applied:false,operation_id:args.p_operation,
          updated_at:'2026-11-05T06:05:00.000Z',wallet_gold:100,wallet_gems:20,
          game_state:{...row,presetApplied:true}},error:null};
      }
      throw Error('Unexpected RPC: '+name);
    },
  },
};
globalThis.__vipEqFixture=fixture;
const localStore=new Map();
globalThis.window={localStorage:{
  getItem:key=>localStore.get(key)??null,
  setItem:(key,value)=>localStore.set(key,String(value)),
  removeItem:key=>localStore.delete(key),
}};
const stubs={
  './actions':'export const useGame=globalThis.__vipEqFixture.store;',
  './cloud':[
    'const f=globalThis.__vipEqFixture;',
    'export const saveBlocked=f.blocked,saveTokens=f.tokens,saveCloudSave=f.save;',
    'export const protectFortuneSave=f.protect,releaseArenaRejectedAction=f.release;',
    'export const acceptMonopolyClaimReceipt=f.accept;',
  ].join('\n'),
  './supabase':'export const supabase=globalThis.__vipEqFixture.server;',
  './auth':'export const ensurePlayerSession=globalThis.__vipEqFixture.owner;',
  './saveToken':'export const validSaveToken=v=>typeof v==="string" && Number.isFinite(Date.parse(v));',
};
async function load(enabled) {
 const compiled=await build({entryPoints:['src/game/vipEquipmentPresets.ts'],bundle:true,
   platform:'node',format:'esm',write:false,logLevel:'silent',
   define:{'import.meta.env':JSON.stringify({VITE_VIP_EQUIPMENT_PRESETS_ENABLED:enabled?'true':'false'})},
   plugins:[{name:'vip-fixtures',setup(builder){
      builder.onResolve({filter:/^\.\/(actions|cloud|supabase|auth|saveToken)$/},
        arg=>({path:arg.path,namespace:'vip'}));
      builder.onLoad({filter:/.*/,namespace:'vip'},
        arg=>({contents:stubs[arg.path],loader:'js'}));
   }}]});
 return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
}
const off=await load(false);
assert.equal(off.vipEquipmentPresetsEnabled(),false);
assert.equal(off.hasPendingVipEquipmentPreset(user),false);
await assert.rejects(off.fetchVipEquipmentPresets(user),/not_enabled/);
const api=await load(true);
const stats=await api.fetchVipEquipmentPresets(user);
assert.deepEqual(stats,{vip:5,presets:[{slot:1,equipmentIds:items}]});
assert.throws(()=>api.parseVipEquipmentPresetStatus({vip:5,presets:[{slot:1,equipment_ids:{weapon:'fake'}}]}));
assert.equal(api.hasPendingVipEquipmentPreset(user),false);
await api.saveVipEquipmentPreset(user,1);
assert.equal(cloudWrites,1);
assert.equal(rpcCalls.at(-1).name,'territory_vip_equipment_preset_save_v1');
assert.equal(rpcCalls.at(-1).args.p_expected,tokens.get(user));

let delayed;
const originalRpc=fixture.server.rpc;
fixture.server.rpc=async(name,args)=>{
 if(name==='territory_vip_equipment_preset_apply_v1') await new Promise(r=>{delayed=r});
 return originalRpc(name,args);
};
const first=api.applyVipEquipmentPreset(user,1);
const second=api.applyVipEquipmentPreset(user,1);
assert.strictEqual(first,second,'double tap reuses one flight');
for(let i=0;i<5 && !delayed;i++)await new Promise(r=>setTimeout(r,0));
assert.equal(api.hasPendingVipEquipmentPreset(user),true);
assert.equal(api.pendingVipEquipmentPresetSlot(user),1);
assert.equal(api.restoreVipEquipmentPresetFence(user),true);
assert.equal(blocked.has(user),true);
delayed();
assert.equal(await first,true);
assert.equal(api.hasPendingVipEquipmentPreset(user),false);
assert.equal(state.presetApplied,true);
assert.equal(rpcCalls.filter(x=>x.name==='territory_vip_equipment_preset_apply_v1').length,1);

fixture.server.rpc=originalRpc;
failApply={message:'network lost'};
const callBefore=cloudWrites;
await assert.rejects(api.applyVipEquipmentPreset(user,1));
const pending=localStore.get('territory:vip-equipment-apply:v1:'+user);
assert(pending,'ambiguous RPC preserved original operation UUID');
const operation=JSON.parse(pending).operation;
assert.equal(blocked.has(user),true);
failApply=null;
assert.equal(await api.applyVipEquipmentPreset(user,1),true);
assert.equal(cloudWrites,callBefore+1,'replaying preserved operation must not write an extra preflight save');
assert.equal(issued,operation,'replay uses original UUID');
assert.equal(api.hasPendingVipEquipmentPreset(user),false);

failApply={code:'P0001',message:'vip_preset_combat_active'};
await assert.rejects(api.applyVipEquipmentPreset(user,1));
assert.equal(api.hasPendingVipEquipmentPreset(user),false,'definite rollback releases original marker');
assert.equal(blocked.has(user),false,'definite rollback releases the save fence');

actualUser=other;
const beforeForeign=rpcCalls.length;
await assert.rejects(api.fetchVipEquipmentPresets(user),/login_required/);
assert.equal(rpcCalls.length,beforeForeign,'foreign identity never reaches owner RPC');
actualUser=user;

const app=readFileSync('src/App.tsx','utf8');
const component=readFileSync('src/components/GearShowcase.tsx','utf8');
assert.match(app,/restoreVipEquipmentPresetFence\(user\.id\)/);
assert.match(app,/equipmentPending && \(cavePendingAdvance \|\| cavePendingStart \|\| rewardPending \|\| victoryPending\)/);
assert.match(component,/<VipEquipmentPresets userId=\{userId\}/);
console.log('VIP equipment client: owner, server snapshot, delayed ACK, one-flight, replay, rollback, boot fence, UI PASS');
