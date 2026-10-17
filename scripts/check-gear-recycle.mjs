import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const uid='10000000-0000-0000-0000-000000000001';
const stranger='10000000-0000-0000-0000-000000000002';
const gear=(id,kind='loot',upgrades=0)=>({
  id, name:kind==='loot'?'Клинок победителя':'Героический меч',
  type:'equipment',qty:1,rarity:'rare',
  equipment:{
    id,slot:'weapon',name:kind==='loot'?'Клинок победителя':'Героический меч',
    rarity:'rare',level:4+upgrades,baseLevel:4,upgradeCount:upgrades,attack:18
  }
});
const potion={id:'hp_potion',type:'potion',qty:17,name:'Potion'};
const items=['loot_a','loot_b','loot_c','loot_d','loot_e'].map(id=>gear(id)).concat([
  gear('shop_sword','shop'),gear('loot_forged','loot',1),potion
]);
const worn={weapon:{...gear('worn','loot').equipment,attack:333}};
const state={inventoryCleanupVersion:1,balanceVersion:4,player:{equipped:worn,level:9,gold:444,gems:12},
  forgeMaterials:7,battleStones:20,inventory:items,belt:[potion],chapterWins:10};
const query=async(sql,params=[]) => (await db.query(sql,params)).rows;
const row=async id => (await query('SELECT * FROM public.players WHERE id=$1',[id]))[0];
const rpc=async (item,action,expected)=> (await query(
  'SELECT public.territory_inventory_recycle_v1($1,$2,$3) AS receipt',
  [item,action,expected]
))[0].receipt;
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT NULLIF(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    CREATE SCHEMA territory_private;
    CREATE TABLE public.players(id uuid PRIMARY KEY,game_state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),forge_materials int,
      gold int NOT NULL,gems int NOT NULL);
    CREATE FUNCTION public.fixture_touch_timestamp() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN IF NEW.game_state IS DISTINCT FROM OLD.game_state THEN
      NEW.updated_at:=GREATEST(clock_timestamp(),OLD.updated_at+interval ''1 microsecond'');
      END IF; RETURN NEW; END';
    CREATE TRIGGER fixture_touch_timestamp BEFORE UPDATE ON public.players
      FOR EACH ROW EXECUTE FUNCTION public.fixture_touch_timestamp();
  `);
  await db.query('INSERT INTO public.players(id,game_state,forge_materials,gold,gems) VALUES ($1,$2,7,444,12),($3,$2,7,444,12)',[uid,state,stranger]);
  await db.exec(readFileSync('supabase/migrations/20261017_gear_compare_recycle_v1.sql','utf8'));
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);

  const first=await row(uid);
  await assert.rejects(rpc('hp_potion','salvage',first.updated_at),/recycle_not_spare_equipment/);
  await assert.rejects(rpc('shop_sword','salvage',first.updated_at),/recycle_only_unforged_boss_loot/);
  await assert.rejects(rpc('loot_forged','salvage',first.updated_at),/recycle_only_unforged_boss_loot/);
  await assert.rejects(rpc('loot_a','salvage',new Date('2020-01-01').toISOString()),/recycle_conflict_reload/);
  await assert.rejects(rpc('absent','discard',first.updated_at),/recycle_item_missing_or_duplicate/);

  let snap=first;
  for(const item of ['loot_a','loot_b','loot_c']){
    const receipt=await rpc(item,'salvage',snap.updated_at);
    assert.equal(receipt.success,true);
    assert.equal(receipt.awarded,1);
    assert.equal(receipt.remaining_today,2-['loot_a','loot_b','loot_c'].indexOf(item));
    assert.equal(receipt.game_state.forgeMaterials,8+['loot_a','loot_b','loot_c'].indexOf(item));
    assert.ok(!receipt.game_state.inventory.some(i=>i.id===item));
    snap=await row(uid);
  }
  assert.equal(snap.forge_materials,10);
  assert.equal(snap.gold,444); assert.equal(snap.gems,12);
  assert.deepEqual(snap.game_state.player.equipped,worn);
  assert.deepEqual(snap.game_state.belt,[potion]);
  assert.equal(snap.game_state.chapterWins,10);
  await assert.rejects(rpc('loot_d','salvage',snap.updated_at),/recycle_daily_limit_3/);
  await assert.rejects(rpc('loot_a','salvage',snap.updated_at),/recycle_item_missing_or_duplicate/);
  await assert.rejects(rpc('loot_d','salvage',first.updated_at),/recycle_conflict_reload/);
  const discarded=await rpc('loot_d','discard',snap.updated_at);
  assert.equal(discarded.awarded,0);assert.equal(discarded.game_state.forgeMaterials,10);
  const afterDiscard=await row(uid);
  const shopDiscard=await rpc('shop_sword','discard',afterDiscard.updated_at);
  assert.equal(shopDiscard.awarded,0);
  assert.equal(shopDiscard.game_state.player.gold,444);
  assert.ok(shopDiscard.game_state.inventory.some(i=>i.id==='loot_forged'));
  assert.ok(shopDiscard.game_state.inventory.some(i=>i.id==='loot_e'));
  assert.equal((await row(stranger)).game_state.forgeMaterials,7,'another player never changed');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[stranger]);
  await assert.rejects(rpc('loot_e','discard',(await row(uid)).updated_at),/recycle_conflict_reload/);
  console.log('Gear recycle PASS: owner-bound atomic consume, 3/day, worn/forged/shop safeguards, replay, stale, all other progress.');
} finally { await db.close(); }
