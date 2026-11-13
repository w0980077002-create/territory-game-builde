import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const ts=require('typescript');
const code=await readFile(new URL('../src/game/stage8CraftApi.ts',import.meta.url),'utf8');
const catalog=JSON.parse(await readFile(new URL('../supabase/staged/territory_profession_stage8_catalog.json',import.meta.url),'utf8'));
const compiled=ts.transpileModule(code,{fileName:'stage8CraftApi.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
let response={data:null,error:null};
let lastRpc=null;
let masterworksReady=false;
let userId='11111111-1111-4111-8111-111111111111';
const client={
  rpc:async (...args)=>{lastRpc=args;
    if(args[0]==='territory_profession_masterworks_ready')
      return {data:masterworksReady,error:null};
    return response;},
  auth:{getUser:async()=>({data:{user:{id:userId}},error:null})},
};
const module={exports:{}};
new Function('require','module','exports',compiled)((name)=>{
  if(name==='./supabase') return {supabase:client};
  if(name==='./craftApi') return {receiptDisplayItem:({itemId,output})=>({
    id:`craft_${itemId}`,name:output.name,icon:output.icon,type:output.type,
    rarity:output.rarity,qty:1,description:output.description,
    equipment:output.type==='equipment'?{...output.equipment,id:`craft_${itemId}`}:undefined,
  })};
  if(name.endsWith('territory_profession_stage8_catalog.json')) return catalog;
  throw new Error(`Unexpected Stage8 import: ${name}`);
},module,module.exports);
const api=module.exports;
const uuid='22222222-2222-4222-8222-222222222222';

assert.equal(api.STAGE8_CATALOG_VERSION,catalog.version);
assert.equal(api.STAGE8_DAILY_XP_CAP,300);
assert.equal(api.STAGE8_RECIPES.length,97);
assert.equal(api.STAGE8_RECIPES.filter(r=>r.id.startsWith('mw_')).length,25);
assert.equal(api.stage8XpToNext(1),26);
assert.equal(api.stage8XpToNext(300),0);

response={data:{enabled:false},error:null};
const disabled=await api.fetchStage8Status();
assert.equal(disabled.enabled,false);
assert.equal(lastRpc[0],'territory_profession_stage8_status');
response={data:null,error:{message:'function missing'}};
await assert.rejects(()=>api.fetchStage8Status(),/status_unavailable/);

const okStatus={enabled:true,version:catalog.version,profession:'smith',mastery_level:25,mastery_xp:15,
  daily_xp_used:80,daily_xp_cap:300,master_license:false,
  resources:{'gather-ore':8,'gather-herb':2,'gather-wood':2,'gather-hide':1,'gather-crystal':0}};
response={data:okStatus,error:null};
const status=await api.fetchStage8Status();
assert.equal(status.masteryLevel,25);
assert.equal(status.resources['gather-ore'],8);
response={data:{...okStatus,version:'profession-stage8-draft-20261025-r2'},error:null};
await assert.rejects(()=>api.fetchStage8Status(),/stage8_masterworks_not_ready/,
  'Do not display r4 craft prices/stats before server confirms 25 new recipe IDs');
masterworksReady=true;
const additive=await api.fetchStage8Status();
assert.equal(additive.enabled,true,'A verified additive r4 release must work alongside live r2 status');
assert.equal(additive.version,'profession-stage8-draft-20261025-r2');
masterworksReady=false;
response={data:{...okStatus,version:'old-client'},error:null};
await assert.rejects(()=>api.fetchStage8Status(),/status_mismatch/);
response={data:{...okStatus,daily_xp_used:301},error:null};
await assert.rejects(()=>api.fetchStage8Status(),/status_mismatch/);
response={data:{...okStatus,resources:{...okStatus.resources,'gather-ore':-5}},error:null};
await assert.rejects(()=>api.fetchStage8Status(),/invalid_resources/);

const spark=catalog.recipes.find(r=>r.id==='mw_s8_jeweler_spark_ring');
assert.ok(spark?.output?.equipment);
const qualityOutput={...spark.output,equipment:{
  ...spark.output.equipment,qualityVersion:'mastery-v2',
  masteryQualityPct:35,craftedMastery:25,attack:13,critChance:5}};
response={data:{success:true,quality_version:'mastery-v2',mastery_level:25,
  master_license:false,previews:{
    [spark.id]:{status:'ready',quality_pct:35,item_level:3,item_output:qualityOutput},
  }},error:null};
const quality=await api.fetchStage8QualityPreviews();
assert.equal(quality.masteryLevel,25);
assert.equal(quality.previews[spark.id].item_output.equipment.attack,13);
assert.equal(lastRpc[0],'territory_profession_stage8_quality_previews');
response={data:{...response.data,previews:{
  [spark.id]:{status:'ready',quality_pct:35,item_level:3,
    item_output:{...qualityOutput,equipment:{...qualityOutput.equipment,
      masteryQualityPct:160}}},
}},error:null};
await assert.rejects(()=>api.fetchStage8QualityPreviews(),/preview_invalid_equipment/);
response={data:null,error:{message:'missing endpoint'}};
await assert.rejects(()=>api.fetchStage8QualityPreviews(),/preview_unavailable/);
response={data:null,error:{code:'PGRST202',message:'Could not find the function public.territory_profession_stage8_quality_previews'}};
await assert.rejects(()=>api.fetchStage8QualityPreviews(),/server_not_deployed/,
  'Only an explicitly absent v2 RPC allows existing legacy craft behavior');
response={data:null,error:{code:'PGRST202',message:'Could not find a DIFFERENT function'}};
await assert.rejects(()=>api.fetchStage8QualityPreviews(),/preview_unavailable/,
  'Other failures must not silently revert to old craft');

const practiceId='s8_smith_practice_1';
response={data:{success:true,recipe_id:practiceId,kind:'practice',item_id:null,item_output:null,
  expires_at:null,mastery_level:2,mastery_xp:4,daily_xp_used:30},error:null};
const practice=await api.executeStage8(practiceId,uuid);
assert.equal(practice.kind,'practice');
assert.equal(practice.itemId,null);
assert.deepEqual(lastRpc,['territory_profession_stage8_execute',{p_recipe:practiceId,p_operation:uuid}]);
response={data:{...response.data,item_id:uuid},error:null};
await assert.rejects(()=>api.executeStage8(practiceId,uuid),/unexpected_reward/);
await assert.rejects(()=>api.executeStage8('invalid_recipe',uuid),/invalid_request/);

const itemId='s8_smith_watch_blade';
response={data:{success:true,recipe_id:itemId,kind:'item',item_id:uuid,item_output:{name:'Клинок дозорного',icon:'🗡️',type:'equipment',rarity:'rare'},expires_at:null,
  mastery_level:25,mastery_xp:26,daily_xp_used:100},error:null};
assert.equal((await api.executeStage8(itemId,uuid)).itemId,uuid);
response={data:{...response.data,kind:'practice'},error:null};
await assert.rejects(()=>api.executeStage8(itemId,uuid),/receipt_unconfirmed/);

// Production consumables intentionally have no expiration. Historical items
// with existing server timestamps must remain readable, never rewritten.
const consumable=catalog.recipes.find(x=>x.output?.type==='potion'||x.output?.type==='elixir');
assert.ok(consumable?.output,'At least one consumable Stage8 recipe should exist');
const consumableReply={success:true,recipe_id:consumable.id,kind:'item',item_id:uuid,
  item_output:consumable.output,expires_at:null,mastery_level:25,mastery_xp:26,daily_xp_used:100};
response={data:consumableReply,error:null};
assert.equal((await api.executeStage8(consumable.id,uuid)).expiresAt,null,
  'No-expiry hotfix must survive quality-v2 frontend');
response={data:{...consumableReply,expires_at:'2026-11-15T00:00:00.000Z'},error:null};
assert.equal((await api.executeStage8(consumable.id,uuid)).expiresAt,'2026-11-15T00:00:00.000Z',
  'Old server-stamped expiry is retained only on historical item');
response={data:{...consumableReply,expires_at:'not-a-date'},error:null};
await assert.rejects(()=>api.executeStage8(consumable.id,uuid),/invalid_expiry/);
response={data:{success:true,items:[{item_id:uuid,recipe_id:consumable.id,
  item_output:consumable.output,expires_at:null}]},error:null};
const permanentItems=await api.fetchStage8Items();
assert.equal(permanentItems[0].expiresAt,null);
const permanentMirror=api.mirrorStage8Items([],permanentItems);
assert.equal(permanentMirror[0].expiresAt,undefined,'Display must never invent an expiration');

response={data:{success:true,profession:'smith',gems_after:73,mastery_level:1,mastery_xp:0},error:null};
const bought=await api.purchaseStage8('smith',uuid);
assert.deepEqual(bought,{profession:'smith',gemsAfter:73});
assert.deepEqual(lastRpc,['territory_profession_stage8_purchase',{p_profession:'smith',p_operation:uuid}]);
response={data:{...response.data,profession:'jeweler'},error:null};
await assert.rejects(()=>api.purchaseStage8('smith',uuid),/purchase_not_confirmed/);
response={data:null,error:{message:'currency_not_server_authoritative'}};
await assert.rejects(()=>api.purchaseStage8('smith',uuid),/purchase_not_confirmed/);
response={data:null,error:{message:'insufficient_gems'}};
await assert.rejects(()=>api.purchaseStage8('smith',uuid),/stage8_purchase_insufficient_gems/,'A known insufficient-gems rejection must not remain an ambiguous pending purchase');
await assert.rejects(()=>api.purchaseStage8('wrong_profession',uuid),/invalid_purchase/);

response={data:{success:true,items:[{
  item_id:uuid,recipe_id:itemId,
  item_output:{name:'Клинок дозорного',icon:'🗡️',type:'equipment',rarity:'rare',
    description:'Ремесленная экипировка: Клинок дозорного.',equipment:{slot:'weapon',attack:17}},expires_at:null,
}]},error:null};
const owned=await api.fetchStage8Items();
assert.equal(lastRpc[0],'territory_profession_stage8_inventory');
assert.equal(owned.length,1);
response={data:{success:true,items:[{
  item_id:uuid,recipe_id:'smith_knight_blade',
  item_output:{name:'Клинок рыцаря',icon:'🗡️',type:'equipment',rarity:'rare',
    description:'Old server craft',equipment:{slot:'weapon',attack:18,critChance:3}},expires_at:null,
}]},error:null};
assert.equal((await api.fetchStage8Items())[0].output.name,'Клинок рыцаря',
  'Old owned Stage8 items must remain readable even when future crafts have stronger stats');

const mirrored=api.mirrorStage8Items([{id:'legacy-sword',qty:1},{id:'stage8_fake',qty:1}],owned);
assert.deepEqual(mirrored.map(i=>i.id),['legacy-sword',`stage8_${uuid}`]);
assert.equal(mirrored[1].equipment.id,`stage8_${uuid}`);
const equippedCopy=api.mirrorStage8Items([{id:'legacy-sword',qty:1}],owned,new Set([`stage8_${uuid}`]));
assert.deepEqual(equippedCopy.map(i=>i.id),['legacy-sword'],'Equipped server item must not be duplicated in the backpack');
response={data:{success:true,items:[{...response.data.items[0],item_id:'not-a-uuid'}]},error:null};
await assert.rejects(()=>api.fetchStage8Items(),/inventory_invalid/);
response={data:{success:true,items:[{...owned[0],item_id:uuid,recipe_id:itemId,
  item_output:{name:'Cheat sword',type:'equipment',rarity:'rare'},expires_at:null}]},error:null};
await assert.rejects(()=>api.fetchStage8Items(),/catalog_mismatch/);

const values=new Map();
const durable=new Map();
const storage=(values)=>({setItem:(key,value)=>values.set(key,value),getItem:(key)=>values.get(key)??null,removeItem:(key)=>values.delete(key)});
globalThis.sessionStorage=storage(values);
globalThis.localStorage=storage(durable);
await api.setStage8Pending({recipeId:practiceId,operationId:uuid});
assert.deepEqual(await api.readStage8Pending(),{recipeId:practiceId,operationId:uuid});
await api.setStage8PurchasePending({profession:'smith',operationId:uuid});
assert.deepEqual(await api.readStage8PurchasePending(),{profession:'smith',operationId:uuid});
values.clear(); // Full restart discards tab storage but preserves the operation UUID.
assert.deepEqual(await api.readStage8Pending(),{recipeId:practiceId,operationId:uuid});
assert.deepEqual(await api.readStage8PurchasePending(),{profession:'smith',operationId:uuid});
await assert.rejects(()=>api.setStage8Pending({recipeId:practiceId,operationId:userId}),/pending_operation_exists/);
await assert.rejects(()=>api.setStage8PurchasePending({profession:'jeweler',operationId:uuid}),/pending_operation_exists/);
userId='33333333-3333-4333-8333-333333333333';
assert.equal(await api.readStage8Pending(),null,'Another account cannot replay someone else’s pending receipt');
assert.equal(await api.readStage8PurchasePending(),null,'Another account cannot reuse a purchase UUID');
await api.setStage8Pending({recipeId:practiceId,operationId:userId});
await api.setStage8PurchasePending({profession:'jeweler',operationId:userId});
assert.equal(durable.size,4,'Each account retains independent recovery markers');
await api.setStage8Pending(null);
await api.setStage8PurchasePending(null);
userId='11111111-1111-4111-8111-111111111111';
await api.setStage8Pending(null);
await api.setStage8PurchasePending(null);
assert.equal(await api.readStage8Pending(),null);
assert.equal(await api.readStage8PurchasePending(),null);
values.set('territory_stage8_pending_operation_v1',JSON.stringify({userId,recipeId:practiceId,operationId:uuid}));
assert.deepEqual(await api.readStage8Pending(),{recipeId:practiceId,operationId:uuid},'In-flight old-tab markers migrate before another request');
assert.equal(values.size,0);
await api.setStage8Pending(null);
durable.set(`territory_stage8_pending_operation_v1:${userId}`,'{broken');
await assert.rejects(()=>api.readStage8Pending(),/pending_corrupt/,'Corruption cannot silently permit another resource debit');
durable.clear();
const saved=globalThis.localStorage;delete globalThis.localStorage;
await assert.rejects(()=>api.setStage8Pending({recipeId:practiceId,operationId:uuid}),/storage_unavailable/);
globalThis.localStorage=saved;

const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
const screen=await readFile(new URL('../src/components/ProfessionsStage8Screen.tsx',import.meta.url),'utf8');
assert.match(app,/VITE_TERRITORY_PROFESSIONS_STAGE8 !== 'false'/,
  'Owner approved Stage8 for release with a reversible explicit false switch');
assert.match(screen,/!status\?\.enabled/);
assert.match(screen,/Характеристики создаваемой экипировки/,
  'Players must see the crafted equipment stat preview before spending materials');
assert.match(screen,/actualOutput\.equipment\.level/,
  'Player must see verified item level, not the recipe mastery requirement');
assert.match(screen,/preview\?\.status==='ready'/,
  'Server quality preview must be ready before new-quality masterwork crafting');
assert.match(screen,/qualityMode==='legacy'/,
  'Existing masterworks must remain usable until actual RPC migration is live');
assert.match(screen,/stage8_quality_server_not_deployed/,
  'Only the exact missing RPC is allowed to use legacy stats');
assert.match(screen,/actualOutput\?\.equipment\?\.\[stat\]/,
  'Player must see server-verified dynamic stats, not old static r4 stats');
assert.match(screen,/\['attack','defense','hp','critChance'\]/,
  'All four combat stats need visible preview for crafted gear');
assert.match(screen,/purchaseStage8\(/);
assert.doesNotMatch(screen,/territory_profession_unlock/,'Stage8 must never use the legacy gem-debit RPC');
assert.doesNotMatch(screen,/craftItem\(|addMasteryXp\(/,'Stage8 must not grant local rewards');
assert.doesNotMatch(code,/craftItem\(|addMasteryXp\(/,'Stage8 API must not grant local rewards');
console.log('Stage8 client PASS: server-only status, strict version, XP cap, item/practice receipts, atomic purchase and reload-safe server inventory, persisted UUID retry, account isolation, owner-enabled UI with emergency disable.');
