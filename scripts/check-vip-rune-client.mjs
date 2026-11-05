import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const user='10000000-0000-4000-8000-000000000001';
const slots=Array.from({length:15},(_,i)=>({
  slotId:'rune_slot_'+String(i+1).padStart(2,'0'),
  runeId:i===0?'shield_wall_r1':null,
}));
const storage=new Map();
globalThis.window={localStorage:{
  getItem:key=>storage.get(key)??null,
  setItem:(key,v)=>storage.set(key,String(v)),
  removeItem:key=>storage.delete(key),
}};
let revision=1,networkError=null,calls=[],runes=structuredClone(slots);
globalThis.__runeVipFixture={
  auth:{getUser:async()=>({data:{user:{id:user}},error:null})},
  rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='territory_vip_rune_presets_status_v1'){
      return {data:{vip:3,presets:[{slot:1,slots}]},error:null};
    }
    if(name==='territory_vip_rune_preset_save_v1'){
      return {data:{success:true,preset_no:args.p_slot,revision:args.p_revision,slots:runes},error:null};
    }
    if(name==='territory_vip_rune_preset_apply_v1'){
      if(networkError)return {data:null,error:networkError};
      revision=Math.max(revision,args.p_revision+1);
      runes=structuredClone(slots);
      return {data:{schema:'territory-rune-slots/1',operationId:args.p_operation,
        revision,slots:runes,alreadyApplied:false},error:null};
    }
    if(name==='territory_runes_status_v1'){
      return {data:{schema:'territory-rune-slots/1',revision,slots:runes,
        owned:[{runeId:'shield_wall_r1',level:1}]},error:null};
    }
    throw Error('Unexpected RPC '+name);
  },
};
async function load(enabled){
 const b=await build({entryPoints:['src/game/vipRunePresets.ts'],bundle:true,
  platform:'node',format:'esm',write:false,logLevel:'silent',
  define:{'import.meta.env':JSON.stringify({VITE_VIP_RUNE_PRESETS_ENABLED:enabled?'true':'false'})},
  plugins:[{name:'stub-vip-rpc',setup(build){
    build.onResolve({filter:/^\.\/supabase$/},()=>({path:'supabase',namespace:'rune-vip'}));
    build.onLoad({filter:/.*/,namespace:'rune-vip'},
      ()=>({contents:'export const supabase={auth:globalThis.__runeVipFixture.auth,rpc:globalThis.__runeVipFixture.rpc};',loader:'js'}));
  }}]});
 return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
}
const disabled=await load(false);
assert.equal(disabled.vipRunePresetsEnabled(),false);
await assert.rejects(disabled.fetchVipRunePresets(),/not_enabled/);
const api=await load(true);
const status=await api.fetchVipRunePresets();
assert.equal(status.vip,3);
assert.equal(status.presets[0].slots.length,15);
assert.throws(()=>api.parseVipRunePresetStatus({vip:3,presets:[{slot:1,slots:[...slots.slice(1),slots[0]]}]}),
  /status_invalid/);
await api.saveVipRunePreset(1,revision);
assert.equal(calls.at(-1).name,'territory_vip_rune_preset_save_v1');
assert.equal(calls.at(-1).args.p_revision,1);
await assert.rejects(api.saveVipRunePreset(3,1),/invalid_request/);

assert.equal(await api.applyVipRunePreset(1,revision),true);
assert.equal(revision,2);
assert.equal(api.hasPendingVipRunePreset(user),false);
assert.equal(calls.filter(x=>x.name==='territory_vip_rune_preset_apply_v1').length,1);

networkError={message:'mobile connection closed'};
const before=calls.length;
await assert.rejects(api.applyVipRunePreset(1,revision));
assert.equal(api.hasPendingVipRunePreset(user),true);
const operation=JSON.parse(storage.get('territory:vip-rune-preset:v1:'+user)).operation;
assert.equal(api.pendingVipRunePresetSlot(user),1);
networkError=null;
assert.equal(await api.applyVipRunePreset(1,revision),true,'retry original operation after lost ACK');
const applies=calls.slice(before).filter(x=>x.name==='territory_vip_rune_preset_apply_v1');
assert.equal(applies.length,2);
assert.equal(applies[0].args.p_operation,operation);
assert.equal(applies[1].args.p_operation,operation);
assert.equal(api.hasPendingVipRunePreset(user),false);

networkError={code:'P0001',message:'vip_rune_combat_active'};
await assert.rejects(api.applyVipRunePreset(1,revision));
assert.equal(api.hasPendingVipRunePreset(user),false,'verified rollback retires the same UUID');

const book=readFileSync('src/components/builds/ServerRuneBook.tsx','utf8');
const ui=readFileSync('src/components/builds/VipRunePresets.tsx','utf8');
assert.match(book,/<VipRunePresets en=\{en\} revision=\{status\.revision\} dirty=\{changed\}/);
assert.match(book,/locked=\{claiming/);
assert.match(ui,/dirty\|\|pending/);
console.log('VIP rune client: 15 verified slots, saved preset, retries, rollback, draft gate, RU/EN UI PASS');
