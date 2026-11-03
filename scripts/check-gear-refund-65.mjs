// Staged #253 proof: owner-bound 65% forge refund, only after attested spending.
// Run with: node scripts/check-gear-refund-65.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db=new PGlite();
const owner='10000000-0000-0000-0000-000000000061';
const other='10000000-0000-0000-0000-000000000062';
const gear=(id,level=4)=>({id,type:'equipment',qty:1,name:'Клинок победителя',rarity:'rare',
  equipment:{id,name:'Клинок победителя',slot:'weapon',rarity:'rare',level,
    baseLevel:4,upgradeCount:level-4,baseStats:{attack:18},attack:18+(level-4)*2}});
const state=(id='loot_test',level=4,materials=1000,gold=100000)=>({
  inventoryCleanupVersion:1,player:{gold,level:250,gems:12,equipped:{}},
  forgeMaterials:materials,forgeMaterialBatches:[{qty:materials,expiresAt:'2099-01-01T00:00:00.000Z'}],
  inventory:[gear(id,level)],battleStones:25,chapterWins:7
});
const one=async(sql,args=[])=> (await db.query(sql,args)).rows[0];
const read=async(id=owner)=>one('SELECT * FROM public.players WHERE id=$1',[id]);
const quote=async(item='loot_test')=>(await one('SELECT public.territory_forge_refund_quote_65_v1($1) AS q',[item])).q;
const refund=async(item,expected)=>(await one('SELECT public.territory_inventory_recycle_refund_65_v1($1,$2) AS r',[item,expected])).r;
async function change(id,edit){ const prev=await read(id);const next=structuredClone(prev.game_state);edit(next);
  await db.query('UPDATE public.players SET game_state=$2, gold=$3,forge_materials=$4 WHERE id=$1',
    [id,next,next.player.gold,next.forgeMaterials]);return read(id);
}
async function upgrade(id='loot_test'){
  const prev=(await read()).game_state;
  const old=prev.inventory.find(i=>i.id===id).equipment.level;
  const m=1+Math.floor(old/3),g=50+old*30;
  return change(owner,s=>{
    const eq=s.inventory.find(i=>i.id===id).equipment;
    eq.level++;eq.upgradeCount++;eq.attack+=2;
    s.forgeMaterials-=m;s.player.gold-=g;
    s.forgeMaterialBatches[0].qty-=m;
  });
}
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT NULLIF(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    CREATE SCHEMA territory_private;
    CREATE TABLE public.players(
      id uuid PRIMARY KEY, game_state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      forge_materials integer,gold integer,gems integer);
    CREATE FUNCTION public.fixture_touch_refund() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN IF NEW.game_state IS DISTINCT FROM OLD.game_state THEN
      NEW.updated_at:=GREATEST(clock_timestamp(),OLD.updated_at+interval ''1 microsecond'');
      END IF; RETURN NEW; END';
    CREATE TRIGGER touch_refund BEFORE UPDATE ON public.players
      FOR EACH ROW EXECUTE FUNCTION public.fixture_touch_refund();
    CREATE TABLE territory_private.equipment_salvage_daily_v1(
      player_id uuid NOT NULL, salvage_day date NOT NULL,
      awarded int NOT NULL DEFAULT 0, PRIMARY KEY(player_id,salvage_day));
  `);
  const initial=state();
  await db.query('INSERT INTO public.players(id,game_state,forge_materials,gold,gems) VALUES($1,$2,$3,$4,12),($5,$2,$3,$4,12)',
    [owner,initial,initial.forgeMaterials,initial.player.gold,other]);
  await db.exec(readFileSync('supabase/staged/territory_gear_refund_65_v1.sql','utf8'));
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);

  assert.deepEqual((await quote()).refund,0,'legacy gear has no imaginary reimbursement');
  await assert.rejects(refund('loot_test',(await read()).updated_at),/refund_history_unverified/);

  // Fake level bump without the exact wallet debit cannot produce a receipt.
  await change(owner,s=>{const e=s.inventory[0].equipment;e.level=5;e.upgradeCount=1;});
  assert.equal((await quote()).refund,0,'client level is not evidence of spending');
  await change(owner,s=>{const e=s.inventory[0].equipment;e.level=4;e.upgradeCount=0;});
  // Four real, exact forge transitions from level 4 -> 8 cost 2+2+3+3=10.
  for(let i=0;i<4;i++)await upgrade();
  const q=await quote();
  assert.equal(q.eligible,true);
  assert.equal(q.spent_verified,10);
  assert.equal(q.refund,6);
  const before=await read();
  assert.equal(before.game_state.player.gold,100000-(170+200+230+260));
  assert.equal(before.game_state.forgeMaterials,990);

  // Another authenticated player may only see their own inventory and receipts.
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[other]);
  assert.equal((await quote()).eligible,false);
  await assert.rejects(refund('loot_test',before.updated_at),/refund_history_unverified/);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);

  await assert.rejects(refund('loot_test','2020-01-01T00:00:00Z'),/refund_conflict_reload/);
  const done=await refund('loot_test',before.updated_at);
  assert.equal(done.awarded,6);
  assert.equal(done.spent_verified,10);
  assert.equal(done.game_state.forgeMaterials,996);
  assert.equal(done.game_state.inventory.length,0);
  assert.equal(done.game_state.chapterWins,7);
  assert.equal(done.game_state.battleStones,25);
  assert.equal(done.game_state.player.gold,before.game_state.player.gold);
  assert.equal(done.game_state.forgeMaterialBatches.length,2);
  assert.equal((await read()).forge_materials,996);
  await assert.rejects(refund('loot_test',before.updated_at),/refund_conflict_reload/);
  assert.equal((await one("SELECT count(*)::int AS n FROM territory_private.forge_upgrade_receipts_65_v1 WHERE refunded_at IS NULL")).n,0);

  // No 65% credit for unsupported/untested historic item or fake injected upgrades.
  await change(owner,s=>{s.inventory.push(gear('legacy_forged',24));});
  assert.equal((await quote('legacy_forged')).eligible,false);

  // Malformed attempts cannot turn premium currencies into free forge resources.
  await assert.rejects(refund('legacy_forged',(await read()).updated_at),/refund_history_unverified/);
  assert.deepEqual((await read(other)).game_state,initial,'other players are untouched');
  console.log('Forge refund 65 PASS: authenticated owner, 10->6, CAS, immutable ledger, unchanged economy and no guessed legacy refunds.');
} finally {await db.close();}
