import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const uid='10000000-0000-0000-0000-000000000081';
const other='10000000-0000-0000-0000-000000000082';
const gear=(id,{level=4,base=level,rarity='common',upgrades=0,name='Клинок победителя',slot='weapon'}={})=>({
 id,type:'equipment',qty:1,name,rarity,
 equipment:{id,name,slot,rarity,level,baseLevel:base,upgradeCount:upgrades,
 baseStats:{attack:18},attack:18+upgrades*2}
});
const starting={inventoryCleanupVersion:1,player:{gold:2000,gems:8,level:60,equipped:{}},
 forgeMaterials:30,forgeMaterialBatches:[{qty:30,expiresAt:'2099-01-01T00:00:00.000Z'}],
 battleStones:25,chapterWins:13,
 inventory:['loot_a','loot_b','loot_c','loot_d'].map(id=>gear(id)).concat([
  gear('forged_a',{level:6,base:4,rarity:'rare',upgrades:2,name:'Клинок рыцаря'}),
  gear('legendary_a',{level:7,base:4,rarity:'legendary',upgrades:3})
 ])};
const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
const profile=async(id=uid)=>(await q('SELECT * FROM public.players WHERE id=$1',[id]))[0];
const quote=async()=>(await q('SELECT public.territory_inventory_batch_quote_253() AS r'))[0].r;
const salvage=async(ids,token)=>(await q('SELECT public.territory_inventory_batch_salvage_253($1,$2) AS r',[ids,token]))[0].r;
try {
 await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    'SELECT NULLIF(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
  CREATE SCHEMA territory_private;
  CREATE TABLE public.players(id uuid PRIMARY KEY,game_state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    forge_materials int,gold int,gems int);
  CREATE FUNCTION public.touch_253() RETURNS trigger LANGUAGE plpgsql AS
    'BEGIN IF NEW.game_state IS DISTINCT FROM OLD.game_state
      THEN NEW.updated_at:=GREATEST(clock_timestamp(),OLD.updated_at+interval ''1 microsecond'');
      END IF; RETURN NEW; END';
  CREATE TRIGGER touch_253 BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.touch_253();
  CREATE TABLE territory_private.equipment_salvage_daily_v1(
    player_id uuid NOT NULL,salvage_day date NOT NULL,awarded int NOT NULL DEFAULT 0,
    PRIMARY KEY(player_id,salvage_day));
  CREATE TABLE territory_private.forge_upgrade_receipts_65_v1(
    player_id uuid NOT NULL,item_id text NOT NULL,upgrade_to int NOT NULL,
    material_cost int NOT NULL,recorded_at timestamptz DEFAULT clock_timestamp(),
    refunded_at timestamptz,PRIMARY KEY(player_id,item_id,upgrade_to));
 `);
 await db.query('INSERT INTO public.players(id,game_state,forge_materials,gold,gems) VALUES($1,$2,30,2000,8),($3,$2,30,2000,8)',[uid,starting,other]);
 await db.query('INSERT INTO territory_private.forge_upgrade_receipts_65_v1(player_id,item_id,upgrade_to,material_cost) VALUES($1,$2,6,4)',[uid,'forged_a']);
 await db.exec(readFileSync('supabase/staged/territory_inventory_batch_salvage_253.sql','utf8'));
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
 let offer=await quote();
 assert.equal(offer.ready,true);
 assert.equal(offer.eligible.length,5);
 assert.equal(offer.eligible.find(x=>x.item_id==='forged_a').awarded,2);
 assert.equal(offer.eligible.some(x=>x.item_id==='legendary_a'),false);
 let initial=await profile();
 await assert.rejects(salvage(['loot_a','legendary_a'],initial.updated_at),/batch_item_unverified/);
 assert.deepEqual((await profile()).game_state,initial.game_state,'invalid mixed batch rolled back');
 await assert.rejects(salvage(['loot_a','loot_a'],initial.updated_at),/batch_invalid_request/);
 let receipt=await salvage(['loot_a','forged_a'],initial.updated_at);
 assert.equal(receipt.awarded,3);
 assert.equal(receipt.removed.length,2);
 assert.equal(receipt.remaining_today,2);
 assert.equal(receipt.game_state.forgeMaterials,33);
 assert.equal(receipt.game_state.forgeMaterialBatches.length,2);
 assert.equal(receipt.game_state.chapterWins,13);
 assert.equal(receipt.game_state.battleStones,25);
 assert.equal(receipt.game_state.player.gold,2000);
 assert.equal(receipt.game_state.inventory.some(x=>x.id==='legendary_a'),true);
 assert.equal((await profile()).forge_materials,33);
 assert.equal((await q("SELECT count(*)::int AS n FROM territory_private.forge_upgrade_receipts_65_v1 WHERE refunded_at IS NULL"))[0].n,0);
 await assert.rejects(salvage(['loot_a','forged_a'],initial.updated_at),/batch_conflict_reload/);
 let next=await profile();
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[other]);
 offer=await quote();
 assert.equal(offer.eligible.length,4,'stranger does not see owner forged receipts');
 await assert.rejects(salvage(['forged_a'],(await profile(other)).updated_at),/batch_item_unverified/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
 receipt=await salvage(['loot_b','loot_c'],next.updated_at);
 assert.equal(receipt.awarded,2);
 assert.equal(receipt.remaining_today,0);
 await assert.rejects(salvage(['loot_d'],(await profile()).updated_at),/batch_daily_limit_3/);
 assert.equal((await profile()).game_state.inventory.some(x=>x.id==='loot_d'),true);
 assert.deepEqual((await profile(other)).game_state,starting,'other player progress unchanged');
 console.log('Batch gear PASS: owner isolation, 65% + base reward, quota, mixed invalid atomicity, replay, event rarity shield, no other progression touched.');
} finally {await db.close();}
