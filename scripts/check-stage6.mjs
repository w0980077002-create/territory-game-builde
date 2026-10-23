import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (path) => fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const parse = (path,moduleDeps,extra={}) => {
  const {outputText,diagnostics}=ts.transpileModule(read(path),{fileName:path,reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
  const errors=(diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,`${path}: ${errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' '))}`);
  const loaded={exports:{}};
  vm.runInNewContext(outputText,{module:loaded,exports:loaded.exports,require:(p)=>{assert(p in moduleDeps,`unknown dependency ${p}`);return moduleDeps[p];},Number,Error,Set,JSON,console,...extra});
  return loaded.exports;
};
const version=parse('src/game/walletVersion.ts',{});
assert.deepEqual(JSON.parse(JSON.stringify(version.safeWalletVersion({gold:100,gems:45},{gold:1,gems:1}))),{gold:100,gems:45});
assert.equal(version.walletMatchesVersion({gold:5,gems:10},{gold:5,gems:10}),true);
assert.equal(version.walletMatchesVersion({gold:5,gems:10},{gold:5,gems:99999}),false);
assert.throws(()=>version.safeWalletVersion({gold:-1,gems:50},null),/invalid_server_wallet/);
assert.throws(()=>version.safeWalletVersion({gold:100,gems:1.5},null),/invalid_server_wallet/);
console.log('Stage6: cross-RPC gold/gems CAS validation: PASS');

const resources=['gather-wood','gather-herb','gather-ore','gather-crystal','gather-hide'].map(id=>({id,name:id,icon:'🪵',rarity:'common'}));
const supabase={rpc:async()=>({error:{code:'PGRST202',message:'not found'}}),auth:{getUser:async()=>({data:{user:{id:'accountA'}},error:null})}};
const memory={};const sessionStorage={getItem:k=>memory[k]??null,setItem:(k,v)=>{memory[k]=v},removeItem:k=>{delete memory[k]}};
const craft=parse('src/game/craftApi.ts',{
 './supabase':{supabase},'./professions':{RESOURCE_DEFINITIONS:resources},
 './equipmentBalance':{prepareNewEquipment:x=>x},
},{sessionStorage});
assert.equal(await craft.fetchCraftStatus(),null,'legacy RPC missing is safe');
supabase.rpc=async()=>({data:{enabled:false},error:null});
assert.equal((await craft.fetchCraftStatus()).enabled,false);
supabase.rpc=async()=>({data:{enabled:true,profession:'smith',mastery_level:8,mastery_xp:90,resources:{'gather-ore':9,'gather-wood':3}},error:null});
const status=await craft.fetchCraftStatus();
assert.equal(status.masteryLevel,8);assert.equal(status.resources['gather-herb'],0);
assert.equal(status.resources['gather-ore'],9);
supabase.rpc=async()=>({data:{enabled:true,profession:'smith',mastery_level:8,mastery_xp:90,resources:{'gather-ore':-1}},error:null});
await assert.rejects(craft.fetchCraftStatus(),/invalid_resource_balance/);
const op='11111111-1111-4111-8111-111111111111';
const item='33333333-3333-4333-8333-333333333333';
let captured=[];
supabase.rpc=async(fn,args)=>{captured.push([fn,args]);return {data:{success:true,item_id:item,recipe_id:'smith_apprentice_blade',item_output:{name:'Sword',icon:'⚔️',type:'equipment',rarity:'rare',description:'safe',equipment:{slot:'weapon',level:5,attack:20}},mastery_level:2,mastery_xp:10},error:null}};
const receipt=await craft.submitVerifiedCraft('smith_apprentice_blade',op);
assert.equal(receipt.itemId,item);
assert.equal(craft.receiptDisplayItem(receipt).id,'craft_'+item);
assert.equal(craft.receiptDisplayItem(receipt).equipment.attack,20);
await craft.submitVerifiedCraft('smith_apprentice_blade',op);
assert.equal(captured[0][1].p_operation,captured[1][1].p_operation);
assert.equal(craft.mirrorCraftResources([{id:'unrelated',name:'x'},{id:'gather-ore',qty:999} ],{'gather-ore':3,'gather-wood':0,'gather-herb':0,'gather-crystal':0,'gather-hide':0}).find(x=>x.id==='gather-ore').qty,3);
await assert.rejects(craft.submitVerifiedCraft('bad recipe',op),/invalid_request/);
await craft.keepPendingCraft({recipeId:'smith_apprentice_blade',operationId:op});
assert.equal((await craft.readPendingCraft()).operationId,op);
await craft.keepPendingCraft(null);
assert.equal(await craft.readPendingCraft(),null);
console.log('Stage6: server-verified craft, receipt replay, resource mirror, restart-safe retry: PASS');

const shop=parse('src/game/shopApi.ts',{'./supabase':{supabase}},{sessionStorage});
supabase.rpc=async()=>({error:{code:'PGRST202',message:'not installed'},data:null});
assert.equal(await shop.fetchShopStatus(),null);
supabase.rpc=async()=>({error:null,data:{enabled:false}});
assert.equal((await shop.fetchShopStatus()).enabled,false);
supabase.rpc=async()=>({error:null,data:{enabled:true,gems:30,stones:11,bought_today:18,stone_day:'2026-10-15'}});
assert.equal((await shop.fetchShopStatus()).boughtToday,18);
supabase.rpc=async()=>({error:null,data:{enabled:true,gems:30,stones:11,bought_today:26,stone_day:'2026-10-15'}});
await assert.rejects(shop.fetchShopStatus(),/invalid_shop_wallet/);
supabase.rpc=async(fn,args)=>{captured.push([fn,args]);return {error:null,data:{success:true,item_id:'shop_stone_5',quantity:2,gems_after:14,stones_after:21,stone_bought:20,stone_day:'2026-10-15'}};};
const request={itemId:'shop_stone_5',quantity:2,operationId:op};
const result=await shop.purchaseServerStones(request);
assert.equal(result.stonesAfter,21);
await assert.rejects(shop.purchaseServerStones({...request,quantity:200}),/invalid_shop_operation/);
await shop.keepPendingShop(request);
assert.equal((await shop.readPendingShop()).operationId,op);
await shop.keepPendingShop(null);
assert.equal(await shop.readPendingShop(),null);
console.log('Stage6: protected server stone-shop, 25/day verification, restart-safe receipt: PASS');


const migrationDir=new URL('../supabase/migrations/',import.meta.url);
const migrations=fs.readdirSync(migrationDir);
assert(!migrations.some(x=>/stage[3-6]|cutover|auction/i.test(x)),'do not auto apply unfinished backend');
const sql=read('supabase/staged/territory_stage6_craft_status.sql');
const shopSql=read('supabase/staged/territory_stage6_shop_status.sql');
assert(shopSql.includes('wallet_not_verified') && shopSql.includes('shop_enabled') && shopSql.includes('Europe/Kyiv'));
const shopUI=read('src/components/ShopScreen.tsx');
assert(shopUI.includes('purchaseServerStones') && shopUI.includes('keepPendingShop'));
assert(shopUI.includes('fetchShopStatus()'),'shop must re-query server before purchase');
for (const s of ['SECURITY DEFINER', "auth.uid()", "craft_enabled",'mastery_not_verified','profession_disagreement','REVOKE ALL', 'GRANT EXECUTE']) assert(sql.includes(s),s);
const cutover=read('supabase/staged/territory_stage6_production_cutover_GATE.sql.example');
assert(cutover.includes('RAISE EXCEPTION'));
const gate=JSON.parse(read('economy-release.json'));
assert.equal(typeof gate.ready,'boolean','Economy release setting must be explicit; publishing is an owner decision');
const pages=read('.github/workflows/pages.yml');
assert(pages.includes('economy_ready') && pages.includes("'true'"));
assert(!fs.existsSync(new URL('../.github/workflows/territory-pages-repair.yml', import.meta.url)),
  'Legacy second Pages publisher must stay deleted; only gated pages.yml may deploy');
const screen=read('src/components/ProfessionsScreen.tsx');
assert(screen.includes('submitVerifiedCraft') && screen.includes('keepPendingCraft') && screen.includes('mirrorCraftResources'));
assert(screen.includes("craftCheck !== 'ready'"),'do not craft while backend status unknown');
{ const file='src/components/ProfessionsScreen.tsx'; const v=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});assert.equal((v.diagnostics??[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0); }
parse('src/game/cloud.ts',{
 './supabase':{supabase},'./auth':{ensurePlayerSession:async()=>true},'./engine':{},'./equipmentBalance':{},
 './saveQueue':{},'./followers':{},'./saveToken':{},'./walletVersion':version,
  './economyInvariant':{validEconomySnapshot:()=>true}, './appearance':{getPlayableAppearance:id=>id},
});
console.log('Stage6: release gate checked, staged-only SQL, client code syntactically valid: PASS');
