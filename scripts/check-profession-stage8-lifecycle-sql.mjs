/** Local-only PostgreSQL item lifecycle. Never opens a network connection. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const smith='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';
const alchemist='33333333-3333-4333-8333-333333333333';
const oldGear={id:'historic_sword',slot:'weapon',name:'Старый меч',icon:'⚔️',rarity:'rare',level:3,attack:17};
const initial={player:{level:100,gold:100000,gems:77,equipped:{weapon:oldGear},stats:{hp:100,maxHp:100,attack:10,defense:5,critChance:5}},inventory:[{id:'historic_ore',qty:4,type:'material'}],belt:[null,null,null],forgeMaterials:100,forgeMaterialBatches:[{qty:100,expiresAt:new Date(Date.now()+3*86400000).toISOString()}],vip:{until:'2030-01-01'},keep:'historic'};
const file=async(name)=>readFile(new URL(`../supabase/staged/${name}`,import.meta.url),'utf8');
const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
const one=async(sql,args=[]) => (await rows(sql,args))[0];
const value=async(sql,args=[]) => (await one(sql,args)).result;
const owner=async(fn)=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
const user=async(id)=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('test.uid',$1,false)",[id]);await db.exec('SET ROLE authenticated');};
const craft=(recipe,operation=randomUUID())=>value('SELECT public.territory_profession_stage8_execute($1,$2::uuid) result',[recipe,operation]);
const action=(item,kind,operation=randomUUID())=>value('SELECT public.territory_profession_stage8_item_action($1::uuid,$2,$3::uuid) result',[item,kind,operation]);
const inventory=()=>value('SELECT public.territory_profession_stage8_inventory() result');
const state=(id=smith)=>owner(async()=> (await one('SELECT game_state result FROM public.players WHERE id=$1',[id])).result);
const balance=()=>owner(()=>one('SELECT gold,forge_materials FROM public.players WHERE id=$1',[smith]));
const setState=async(next,id=smith)=>owner(()=>rows('UPDATE public.players SET game_state=$1::jsonb WHERE id=$2',[JSON.stringify(next),id]));
try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE public.players(id uuid PRIMARY KEY,telegram_id bigint,gold integer DEFAULT 100000,gems integer DEFAULT 77,
 forge_materials integer DEFAULT 100,banned boolean DEFAULT false,created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz DEFAULT clock_timestamp(),game_state jsonb DEFAULT '{}'::jsonb);
 CREATE TABLE public.territory_profession_unlocks(player_id uuid PRIMARY KEY REFERENCES public.players,profession text,master_license boolean DEFAULT false);
 CREATE TABLE public.territory_resource_wallet(player_id uuid REFERENCES public.players,resource_id text,quantity bigint CHECK(quantity>=0),PRIMARY KEY(player_id,resource_id));`);
 for(const [id,profession] of [[smith,'smith'],[second,'smith'],[alchemist,'alchemist']]){
  await db.query('INSERT INTO public.players(id,game_state) VALUES($1,$2::jsonb)',[id,JSON.stringify(initial)]);
  await db.query('INSERT INTO public.territory_profession_unlocks(player_id,profession) VALUES($1,$2)',[id,profession]);
  for(const resource of ['gather-ore','gather-wood','gather-hide','gather-herb','gather-crystal']) await db.query('INSERT INTO public.territory_resource_wallet VALUES($1,$2,10000)',[id,resource]);
 }
 const backendSource=await file('territory_profession_stage8_backend.sql');
 const lifecycleSource=await file('territory_profession_stage8_lifecycle.sql');
 const executeStart='CREATE OR REPLACE FUNCTION public.territory_profession_stage8_execute(';
 const originalExecute=backendSource.slice(backendSource.indexOf(executeStart),backendSource.indexOf('-- A device must be able'));
 assert.ok(lifecycleSource.includes(originalExecute.replace('IF v_receipt.recipe_id<>p_recipe THEN',"IF v_receipt.result ? 'action' OR v_receipt.recipe_id<>p_recipe THEN")),
  'Incremental replacement must extend the installed RPC by only the UUID collision check; no forked crafting logic');
 await db.exec(await file('territory_profession_stage8_backend.sql'));
 const before=await rows('SELECT * FROM public.players ORDER BY id');
 await db.exec(await file('territory_profession_stage8_lifecycle.sql'));
 assert.deepEqual(await rows('SELECT * FROM public.players ORDER BY id'),before,'Installation cannot modify any saved progress');
 // Additive component is independently repeatable, without reinstalling Stage8.
 await db.exec(await file('territory_profession_stage8_lifecycle.sql'));
 await user(smith);
 await assert.rejects(action(randomUUID(),'equip'),/disabled/);
 await owner(()=>db.exec(`UPDATE public.territory_profession_stage8_release SET enabled=true,cutover_at=clock_timestamp() WHERE id=1;
 INSERT INTO public.territory_profession_stage8_progress(player_id,profession,mastery_level,mastery_xp,verified,origin,reconciled_at)
 SELECT player_id,profession,300,0,true,'new_unlock',clock_timestamp() FROM public.territory_profession_unlocks;`));
 const operation=randomUUID();
 const [first,repeated]=await Promise.all([craft('smith_apprentice_blade',operation),craft('smith_apprentice_blade',operation)]);
 assert.deepEqual(first,repeated,'Double click / timeout retry mints exactly one item');
 assert.equal((await inventory()).items.length,1);
 const item=first.item_id;
 await assert.rejects(action(item,'equip',operation),/operation_id_conflict/,'Craft/action share operation namespace');
 const equipOperation=randomUUID();
 const worn=await action(item,'equip',equipOperation);
 assert.equal(worn.game_state.player.equipped.weapon.id,`stage8_${item}`);
 assert.deepEqual(worn.game_state.inventory.find(i=>i.id===oldGear.id).equipment,oldGear,'Swapping preserves exact legacy worn gear');
 assert.equal(worn.game_state.keep,'historic');assert.deepEqual(worn.game_state.vip,initial.vip);
 assert.equal(worn.game_state.inventory.filter(i=>i.id===`stage8_${item}`).length,0);
 assert.equal((await inventory()).items[0].equipped_slot,'weapon');
 assert.deepEqual(await action(item,'equip',equipOperation),worn,'Reconnect replay returns committed receipt');
 await assert.rejects(craft('smith_apprentice_blade',equipOperation),/operation_id_conflict/);
 await assert.rejects(action(item,'recycle'),/item_equipped/,'Cannot dispose of worn gear without removing it');
 await user(second);
 await assert.rejects(action(item,'equip',equipOperation),/item_unavailable/,'Account switch cannot reuse another owner operation');
 assert.deepEqual((await inventory()).items,[],'Second account sees none of first account gear');
 await user(smith);
 const stale=structuredClone(worn.game_state);
 // Stale browser cannot alter worn stats/identity or forge extra backpack copy.
 stale.player.equipped.weapon.attack=999999;
 stale.inventory.push({...first.item_output,id:`stage8_${item}`,qty:100,equipment:{...first.item_output.equipment,id:`stage8_${item}`,attack:999999}});
 await setState(stale);
 let saved=await state();
 assert.equal(saved.player.equipped.weapon.attack,8);
 assert.equal(saved.inventory.some(i=>i.id===`stage8_${item}`),false);
 const upgradeOperation=randomUUID();
 const cashBefore=await balance();
 let upgraded=await action(item,'upgrade',upgradeOperation);
 const cashAfter=await balance();
 assert.equal(cashBefore.gold-cashAfter.gold,80);assert.equal(cashBefore.forge_materials-cashAfter.forge_materials,1);
 assert.deepEqual(await action(item,'upgrade',upgradeOperation),upgraded,'Forge receipt must not reroll or charge twice');
 assert.deepEqual(await balance(),cashAfter);
 for(let i=0;i<20&&!upgraded.upgraded;i++)upgraded=await action(item,'upgrade');
 assert.equal(upgraded.upgraded,true,'Server forge eventually succeeds');
 assert.equal(upgraded.item_output.equipment.attack,9,'Linear growth preserves established balance');
 assert.equal(upgraded.item_output.equipment.level,2);
 assert.equal((await state()).player.equipped.weapon.attack,9,'Combat view consumes server-upgraded equipped stats');
 // Read a second device snapshot, then remove/recycle on first device.
 const otherDevice=structuredClone(await state());
 const unequipped=await action(item,'unequip');
 assert.equal(unequipped.game_state.player.equipped.weapon,undefined);
 assert.equal(unequipped.game_state.inventory.filter(i=>i.id===`stage8_${item}`).length,1);
 const disposalOperation=randomUUID();
 const recycled=await action(item,'recycle',disposalOperation);
 assert.equal(recycled.awarded,0,'Crafted gear cannot become unapproved free forge rewards');
 assert.deepEqual(await action(item,'recycle',disposalOperation),recycled);
 assert.deepEqual((await inventory()).items,[]);
 await assert.rejects(action(item,'equip'),/item_unavailable/);
 await setState(otherDevice);
 saved=await state();
 assert.equal(saved.player.equipped.weapon,undefined,'Stale save cannot resurrect a recycled equipped item');
 assert.equal(saved.inventory.some(i=>i.id===`stage8_${item}`),false);
 // Distinct concurrent requests contend for the final available ingredient.
 await owner(()=>db.query("UPDATE public.territory_resource_wallet SET quantity=5 WHERE player_id=$1 AND resource_id='gather-ore'",[smith]));
 const attempts=await Promise.allSettled([craft('smith_apprentice_blade'),craft('smith_apprentice_blade')]);
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 assert.match(String(attempts.find(x=>x.status==='rejected').reason),/insufficient_resources/);
 assert.equal(Number((await owner(()=>one("SELECT quantity FROM public.territory_resource_wallet WHERE player_id=$1 AND resource_id='gather-ore'",[smith]))).quantity),0);
 const finalItem=attempts.find(x=>x.status==='fulfilled').value.item_id;
 const noMaterials=await state();
 noMaterials.forgeMaterialBatches=[{qty:(await balance()).forge_materials,expiresAt:new Date(Date.now()-1000).toISOString()}];
 await setState(noMaterials);
 const beforeExpired=await balance();
 await assert.rejects(action(finalItem,'upgrade'),/insufficient_forge_materials/);
 assert.deepEqual(await balance(),beforeExpired,'Material expiry rolls back gold and item mutation');
 // Earliest-expiry-first material spending and persistence of remaining lots.
 const now=Date.now();const older=new Date(now+86400000).toISOString(),newer=new Date(now+2*86400000).toISOString();
 const lots=await state();lots.forgeMaterialBatches=[{qty:2,expiresAt:newer},{qty:1,expiresAt:older}];lots.forgeMaterials=3;
 await setState(lots);await owner(()=>db.query('UPDATE public.players SET forge_materials=3 WHERE id=$1',[smith]));
 await action(finalItem,'upgrade');
 assert.deepEqual((await state()).forgeMaterialBatches,[{qty:2,expiresAt:newer}]);
 // Server rewards not yet represented by dated lots are preserved, never lost.
 await owner(()=>db.query('UPDATE public.players SET forge_materials=5 WHERE id=$1',[smith]));
 await action(finalItem,'upgrade');
 const reconciledLots=await state();
 assert.equal(reconciledLots.forgeMaterials,4);
 assert.equal(reconciledLots.forgeMaterialBatches.reduce((n,b)=>n+b.qty,0),4);
 // Malformed lots cannot grant immortal materials or leave a partial debit.
 const badLots=await state();badLots.forgeMaterialBatches=[{qty:4}];
 await setState(badLots);const beforeMalformed=await balance();
 await assert.rejects(action(finalItem,'upgrade'),/invalid_material_batches/);
 assert.deepEqual(await balance(),beforeMalformed);
 // Two device equip requests cannot leave duplicate slots or lose the displaced item.
 await owner(async()=>{
  await db.query("UPDATE public.territory_resource_wallet SET quantity=100 WHERE player_id=$1 AND resource_id='gather-ore'",[smith]);
 });
 const gearA=await craft('smith_apprentice_blade'),gearB=await craft('smith_apprentice_blade');
 const equipRace=await Promise.all([action(gearA.item_id,'equip'),action(gearB.item_id,'equip')]);
 assert.equal(equipRace.every(r=>r.success),true);
 const afterRace=(await inventory()).items;
 assert.equal(afterRace.filter(i=>i.equipped_slot==='weapon').length,1);
 assert.equal(afterRace.filter(i=>i.item_id===gearA.item_id||i.item_id===gearB.item_id).length,2);
 assert.equal((await state()).inventory.filter(i=>i.id===oldGear.id).length,1,'Slot race must not duplicate displaced historical gear');
 // Durable consumables: same-recipe FIFO, one server instance on belt, no resurrection.
 await user(alchemist);
 const early=await craft('alchemist_health_potion'),late=await craft('alchemist_health_potion');
 const earlyExpiry=new Date(Date.now()+86400000).toISOString(),lateExpiry=new Date(Date.now()+2*86400000).toISOString();
 await owner(()=>db.query('UPDATE public.territory_profession_stage8_items SET expires_at=$1 WHERE item_id=$2',[earlyExpiry,early.item_id]));
 await owner(()=>db.query('UPDATE public.territory_profession_stage8_items SET expires_at=$1 WHERE item_id=$2',[lateExpiry,late.item_id]));
 const belted=await state(alchemist);belted.belt=[{...early.item_output,id:`stage8_${early.item_id}`,serverItemId:early.item_id,qty:100},null,null];
 await setState(belted,alchemist);
 const canonicalBelt=await state(alchemist);
 assert.equal(canonicalBelt.belt[0].qty,1,'Legacy belt cannot invent quantities for unique instances');
 assert.equal(canonicalBelt.inventory.some(i=>i.id===`stage8_${early.item_id}`),false);
 const consumeOperation=randomUUID();const used=await action(late.item_id,'consume',consumeOperation);
 assert.equal(used.consumed_item_id,early.item_id,'Using a later batch spends earliest same recipe first');
 assert.deepEqual(used.effect,{stat:'hp',value:50,duration:'instant'});
 assert.deepEqual(await action(late.item_id,'consume',consumeOperation),used);
 await setState(canonicalBelt,alchemist);
 const afterStaleBelt=await state(alchemist);
 assert.equal(afterStaleBelt.belt[0],null,'Consumed belt instance cannot resurrect from old save');
 assert.equal(afterStaleBelt.inventory.some(i=>i.id===`stage8_${early.item_id}`),false);
 await owner(()=>db.query("UPDATE public.territory_profession_stage8_items SET expires_at=clock_timestamp()-interval '1 second' WHERE item_id=$1",[late.item_id]));
 await assert.rejects(action(late.item_id,'consume'),/item_expired/);
 assert.deepEqual((await inventory()).items,[],'Expired items unavailable on second device');
 // Private growth is mechanically identical to client balance at every slot/rarity.
 const balanceSource=await readFile(new URL('../src/game/equipmentBalance.ts',import.meta.url),'utf8');
 const growthSource=balanceSource.split('export const FORGE_STAT_GROWTH:')[1].split('const LEGACY_FORGE_GAIN')[0];
 let checked=0;
 for(const [,slot,body] of growthSource.matchAll(/(\w+): \{\n(.*?)\n  \}/gs))for(const [,rarity,attack,defense,hp] of body.matchAll(/(\w+): \{ attack: ([\d.]+), defense: ([\d.]+), hp: ([\d.]+) \}/g)){
  const row=await owner(()=>one('SELECT growth FROM territory_private.stage8_forge_growth WHERE slot=$1 AND rarity=$2',[slot,rarity]));
  assert.deepEqual(row.growth,{attack:Number(attack),defense:Number(defense),hp:Number(hp)});checked++;
 }
 assert.equal(checked,28);
 const grants=await one("SELECT has_function_privilege('anon','public.territory_profession_stage8_item_action(uuid,text,uuid)','EXECUTE') anon,has_table_privilege('authenticated','public.territory_profession_stage8_items','UPDATE') client_update");
 assert.equal(grants.anon,false);assert.equal(grants.client_update,false);
 console.log('Stage8 lifecycle SQL PASS: atomic craft/replay, account isolation, equip/swap preserving old gear, canonical combat stats, linear forge and retry, FIFO/expired lots, disposal, FIFO consumables, belt deduplication, stale-save anti-resurrection, ACL, additive installation. Concurrency requests serialize in PGlite; separate-session lock contention requires real PostgreSQL.');
}finally{await db.close();}
