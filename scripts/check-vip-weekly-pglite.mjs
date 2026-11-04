import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const A='10000000-0000-0000-0000-000000000001';
const B='10000000-0000-0000-0000-000000000002';
const key=n=>`30000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const sql=async(query,args=[]) => (await db.query(query,args)).rows;
const as=async id => sql("SELECT set_config('request.jwt.claim.sub',$1,false)",[id??'']);
const rpc=async(action='status',id=null,rev=null) =>
  (await sql("SELECT public.territory_vip_weekly_v1($1,$2::uuid,$3::timestamptz) AS r",[action,id,rev]))[0].r;
const fixture={player:{gold:100,gems:20,redGems:7,level:40,equipped:{}},
  inventory:[],belt:Array(7).fill(null),battleStones:8,forgeMaterials:0};
try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA territory_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    CREATE TABLE public.players(
      id uuid PRIMARY KEY,banned boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      vip_level int NOT NULL DEFAULT 0,level int NOT NULL DEFAULT 40,
      gold int NOT NULL DEFAULT 100,gems int NOT NULL DEFAULT 20,game_state jsonb NOT NULL);
    CREATE FUNCTION territory_private.fortune_vip_v1(u uuid) RETURNS int
      LANGUAGE sql STABLE AS 'SELECT vip_level FROM public.players WHERE id=u';`);
  await sql('INSERT INTO public.players(id,vip_level,game_state) VALUES($1,5,$3),($2,1,$3)',[A,B,fixture]);
  await db.exec(readFileSync('supabase/staged/20261105_vip_weekly_chest_v1.sql','utf8'));
  assert.equal((await sql("SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='territory_private.vip_weekly_claims_v1'::regclass"))[0].enabled,true);
  assert.equal((await sql("SELECT has_table_privilege('authenticated','territory_private.vip_weekly_claims_v1','UPDATE') AS yes"))[0].yes,false);
  assert.equal((await sql("SELECT has_function_privilege('anon','public.territory_vip_weekly_v1(text,uuid,timestamptz)','execute') AS yes"))[0].yes,false);
  await as(A);
  const before=await rpc();
  assert.equal(before.claimed_this_week,false);
  assert.equal(before.vip,5);
  assert.equal(new Date(before.server_week).getUTCDay(),1,'weekly reset must start Monday UTC');
  assert.equal(Date.parse(before.next_reset_at)-Date.parse(before.server_week),7*24*3600*1000);
  const award=await rpc('claim',key(1),before.updated_at);
  assert.equal(award.reward.vip,5);
  assert.deepEqual([award.reward.gold,award.reward.gems,award.reward.stones,award.reward.materials],[600,5,2,2]);
  assert.equal(award.game_state.player.gold,700);
  assert.equal(award.game_state.player.gems,25);
  assert.equal(award.game_state.player.redGems,7,'no withdrawable gems');
  assert.equal(award.game_state.battleStones,10);
  assert.equal(award.game_state.forgeMaterials,2);
  assert.equal(award.game_state.forgeMaterialBatches.length,1);
  assert.equal(award.game_state.forgeMaterialBatches[0].qty,2);
  assert(Date.parse(award.game_state.forgeMaterialBatches[0].expiresAt)>Date.now()+6*24*3600*1000);
  const replay=await rpc('claim',key(1),before.updated_at);
  assert.equal(replay.replayed,true);
  assert.deepEqual(replay.game_state,award.game_state);
  assert.equal((await rpc()).claimed_this_week,true);
  await assert.rejects(rpc('claim',key(2),award.updated_at),/vip_weekly_already_claimed/);
  assert.equal((await sql('SELECT count(*)::int n FROM territory_private.vip_weekly_claims_v1 WHERE player_id=$1',[A]))[0].n,1);

  await as(B);
  const low=await rpc();
  await assert.rejects(rpc('claim',key(3),low.updated_at),/vip_weekly_vip2_required/);
  assert.equal((await sql('SELECT gold FROM public.players WHERE id=$1',[B]))[0].gold,100);
  await sql('UPDATE public.players SET vip_level=10 WHERE id=$1',[B]);
  await assert.rejects(rpc('claim',key(4),'2020-01-01T00:00:00Z'),/vip_weekly_reload_required/);
  const high=await rpc();
  const max=await rpc('claim',key(5),high.updated_at);
  assert.deepEqual([max.reward.gold,max.reward.gems,max.reward.stones,max.reward.materials],[3000,20,5,6]);

  // A corrupted server snapshot must never receive a partial reward.
  const C='10000000-0000-0000-0000-000000000003';
  await sql('INSERT INTO public.players(id,vip_level,game_state) VALUES($1,5,$2)',[C,{...fixture,forgeMaterials:10,forgeMaterialBatches:[{qty:2,expiresAt:new Date(Date.now()+86400000).toISOString()}]}]);
  await as(C);
  const corrupt=await rpc();
  await assert.rejects(rpc('claim',key(6),corrupt.updated_at),/vip_weekly_material_batches_mismatch/);
  assert.equal((await sql('SELECT gold FROM public.players WHERE id=$1',[C]))[0].gold,100);
  const invalidStates=[
    Object.fromEntries(Object.entries(fixture).filter(([k])=>k!=='battleStones')),
    {...fixture,battleStones:null},
    Object.fromEntries(Object.entries(fixture).filter(([k])=>k!=='forgeMaterials')),
    {...fixture,forgeMaterials:null},
    {...fixture,forgeMaterialBatches:[{expiresAt:new Date(Date.now()+86400000).toISOString()}]},
    {...fixture,forgeMaterialBatches:[{qty:null,expiresAt:new Date(Date.now()+86400000).toISOString()}]},
  ];
  for(const state of invalidStates){
    await sql('UPDATE public.players SET game_state=$2 WHERE id=$1',[C,state]);
    const status=await rpc();
    await assert.rejects(rpc('claim',key(7),status.updated_at),/vip_weekly_(invalid_save|material_batches_invalid)/);
    const row=(await sql('SELECT gold,gems,game_state FROM public.players WHERE id=$1',[C]))[0];
    assert.deepEqual(row,{gold:100,gems:20,game_state:state},'invalid save is untouched');
    assert.equal((await sql('SELECT count(*)::int n FROM territory_private.vip_weekly_claims_v1 WHERE player_id=$1',[C]))[0].n,0);
  }
  await as(null);
  await assert.rejects(rpc(),/vip_weekly_login_required/);
  console.log('VIP weekly staged: UTC Monday, protected ledger, wallet+expiry lots, replay, deny, CAS, max tier: PASS');
} finally {
  await db.close();
}
