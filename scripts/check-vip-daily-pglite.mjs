import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const A='10000000-0000-0000-0000-000000000001';
const B='10000000-0000-0000-0000-000000000002';
const sql = async (query,args=[]) => (await db.query(query,args)).rows;
const as = async (id) => sql("SELECT set_config('request.jwt.claim.sub',$1,false)",[id??'']);
const key = (n) => `20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const rpc = async(action='status',id=null,rev=null) =>
  (await sql("SELECT public.territory_vip_daily_v1($1,$2::uuid,$3::timestamptz) AS r",[action,id,rev]))[0].r;
const fixture = { player:{ gold:100,gems:20,redGems:7,level:40,equipped:{} },
  inventory:[],belt:Array(7).fill(null),battleStones:8 };
try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA territory_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    CREATE TABLE public.players (
      id uuid PRIMARY KEY, banned boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      vip_level int NOT NULL DEFAULT 0,level int NOT NULL DEFAULT 40,
      gold int NOT NULL DEFAULT 100,gems int NOT NULL DEFAULT 20,
      game_state jsonb NOT NULL
    );
    CREATE FUNCTION territory_private.fortune_vip_v1(u uuid) RETURNS int
      LANGUAGE sql STABLE AS 'SELECT vip_level FROM public.players WHERE id=u';
    `);
  await sql('INSERT INTO public.players(id,vip_level,game_state) VALUES($1,5,$3),($2,0,$3)',
    [A,B,fixture]);
  await db.exec(readFileSync('supabase/staged/20261105_vip_entitlements_v1.sql','utf8'));
  const source=readFileSync('supabase/staged/20261104_vip_daily_chest_v1.sql','utf8');
  await db.exec(source);
  assert.equal((await sql("SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='territory_private.vip_daily_claims_v1'::regclass"))[0].enabled,true);
  assert.equal((await sql("SELECT has_table_privilege('authenticated','territory_private.vip_daily_claims_v1','UPDATE') AS allowed"))[0].allowed,false);
  assert.equal((await sql("SELECT has_function_privilege('anon','public.territory_vip_daily_v1(text,uuid,timestamptz)','execute') AS allowed"))[0].allowed,false);
  await as(A);
  const before=await rpc();
  assert.equal(before.claimed_today,false);
  assert.equal(before.vip,5);
  const award=await rpc('claim',key(1),before.updated_at);
  assert.equal(award.success,true);
  assert.equal(award.reward.vip,5);
  assert.equal(award.reward.gold,350);
  assert.equal(award.reward.gems,4);
  assert.equal(award.reward.stones,1);
  assert.equal(award.wallet_gold,450);
  assert.equal(award.wallet_gems,24);
  assert.equal(award.game_state.battleStones,9);
  assert.equal(award.game_state.player.redGems,7,'VIP must not mint cash-out red gems');
  const replay=await rpc('claim',key(1),before.updated_at);
  assert.equal(replay.replayed,true);
  assert.equal(replay.wallet_gold,450);
  assert.deepEqual(replay.game_state,award.game_state);
  const today=await rpc();
  assert.equal(today.claimed_today,true);
  await assert.rejects(rpc('claim',key(2),award.updated_at),/vip_daily_already_claimed/);
  const count=(await sql('SELECT count(*)::int AS n FROM territory_private.vip_daily_claims_v1 WHERE player_id=$1',[A]))[0].n;
  assert.equal(count,1,'exactly one durable receipt for this day');

  await as(B);
  const zero=await rpc();
  assert.equal(zero.vip,0);
  await assert.rejects(rpc('claim',key(3),zero.updated_at),/vip_required/);
  assert.equal((await sql('SELECT gold FROM public.players WHERE id=$1',[B]))[0].gold,100);
  await sql('UPDATE public.players SET vip_level=10 WHERE id=$1',[B]);
  await assert.rejects(rpc('claim',key(4),'2020-01-01T00:00:00Z'),/vip_reload_required/);
  const maxStatus=await rpc();
  const maxAward=await rpc('claim',key(5),maxStatus.updated_at);
  assert.equal(maxAward.reward.vip,10);
  assert.equal(maxAward.reward.gold,1600);
  assert.equal(maxAward.reward.gems,10);
  assert.equal(maxAward.reward.stones,3);
  assert.equal(maxAward.wallet_gold,1700);

  const C='10000000-0000-0000-0000-000000000003';
  const {battleStones: omitted, ...withoutStones}=fixture;
  for (const state of [withoutStones,{...fixture,battleStones:null}]) {
    await sql('INSERT INTO public.players(id,vip_level,game_state) VALUES($1,5,$2) ON CONFLICT(id) DO UPDATE SET game_state=excluded.game_state',[C,state]);
    await as(C);
    const status=await rpc();
    await assert.rejects(rpc('claim',key(6),status.updated_at),/vip_invalid_save/);
    const row=(await sql('SELECT gold,gems,game_state FROM public.players WHERE id=$1',[C]))[0];
    assert.deepEqual(row,{gold:100,gems:20,game_state:state},'invalid save is untouched');
    assert.equal((await sql('SELECT count(*)::int n FROM territory_private.vip_daily_claims_v1 WHERE player_id=$1',[C]))[0].n,0);
  }
  await as(null);
  await assert.rejects(rpc(),/vip_login_required/);
  console.log('VIP daily staged: RLS, account identity, USD-neutral earned rewards, CAS, replay, zero-VIP deny, max tier: PASS');
} finally {
  await db.close();
}
