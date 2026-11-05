import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Disposable database: exercise both real chest functions against the real
// entitlement ledger, never a client-supplied tier or a mocked VIP lookup.
const db = new PGlite();
const sql = async (q, args=[]) => (await db.query(q,args)).rows;
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const op = n => `30000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const as = n => sql("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(n)]);
const rpc = async (period, action='status', operation=null, revision=null) =>
  (await sql(`SELECT public.territory_vip_${period}_v1($1,$2::uuid,$3::timestamptz) AS result`,[action,operation,revision]))[0].result;
const state={player:{gold:100,gems:20,redGems:7,level:40},inventory:[],belt:Array(7).fill(null),battleStones:8,forgeMaterials:0};
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA territory_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    CREATE TABLE public.players(id uuid PRIMARY KEY, banned boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), vip_level int NOT NULL DEFAULT 0,
      level int NOT NULL DEFAULT 40, gold int NOT NULL DEFAULT 100, gems int NOT NULL DEFAULT 20,
      game_state jsonb NOT NULL);
    CREATE FUNCTION territory_private.fortune_vip_v1(u uuid) RETURNS int LANGUAGE sql STABLE AS
      'SELECT vip_level FROM public.players WHERE id=u';`);
  for (let n=1;n<=4;n++) await sql('INSERT INTO public.players(id,game_state) VALUES($1,$2)',[id(n),state]);
  for (const name of ['20261105_vip_entitlements_v1.sql','20261104_vip_daily_chest_v1.sql','20261105_vip_weekly_chest_v1.sql'])
    await db.exec(readFileSync(`supabase/staged/${name}`,'utf8'));
  await sql(`INSERT INTO territory_private.vip_payment_ledger_v1
    (provider_transaction_id,player_id,sku,price_version,stars_amount,verified_usd_cents,status)
    VALUES ('verified-payment-1',$1,'pack','v1',50,1000,'settled'),
           ('verified-payment-2',$2,'pack','v1',50,1000,'settled')`,[id(1),id(2)]);
  await sql(`INSERT INTO territory_private.vip_entitlement_grants_v1
    (grant_id,player_id,campaign_key,kind,vip_level,expires_at,reason) VALUES
    ($1,$2,'gift','gift',5,NULL,'tester'),
    ($3,$2,'active','temporary',8,now()+interval '1 day','event'),
    ($4,$5,'expired','temporary',10,now()-interval '1 day','event')`,[op(90),id(2),op(91),op(92),id(3)]);
  await as(1);
  let status=await rpc('daily');
  assert.equal(status.vip,2,'settled purchase unlocks daily');
  const daily=await rpc('daily','claim',op(1),status.updated_at);
  assert.deepEqual([daily.reward.vip,daily.reward.gold,daily.reward.gems],[2,150,2]);
  status=await rpc('weekly');
  assert.equal(status.vip,2,'settled purchase unlocks weekly');
  const weekly=await rpc('weekly','claim',op(2),status.updated_at);
  assert.equal(weekly.reward.vip,2);
  await sql("UPDATE territory_private.vip_payment_ledger_v1 SET status='refunded',refunded_at=clock_timestamp() WHERE player_id=$1",[id(1)]);
  assert.equal((await rpc('daily')).vip,0,'refund removes paid eligibility');
  assert.equal((await rpc('weekly','claim',op(2),status.updated_at)).replayed,true,'receipt remains recoverable after refund');
  await as(2);
  assert.equal((await rpc('daily')).vip,8,'active temporary tier is effective');
  await sql('INSERT INTO territory_private.vip_entitlement_revocations_v1(grant_id,reason) VALUES($1,$2)',[op(91),'event ended']);
  await sql("UPDATE territory_private.vip_payment_ledger_v1 SET status='refunded',refunded_at=clock_timestamp() WHERE player_id=$1",[id(2)]);
  status=await rpc('daily');
  assert.equal(status.vip,5,'gift survives refund and temporary revocation');
  assert.equal((await rpc('daily','claim',op(3),status.updated_at)).reward.gold,350);
  status=await rpc('weekly');
  assert.equal((await rpc('weekly','claim',op(4),status.updated_at)).reward.vip,5);
  await as(3);
  for (const period of ['daily','weekly']) {
    status=await rpc(period);
    assert.equal(status.vip,0,'expired temporary tier grants no access');
    await assert.rejects(rpc(period,'claim',op(5),status.updated_at),/vip_(required|weekly_vip2_required)/);
  }
  assert.equal((await sql('SELECT gold FROM public.players WHERE id=$1',[id(3)]))[0].gold,100);
  console.log('VIP chests + real entitlement ledger: paid, gift, temporary, refund, expiry and replay PASS');
} finally { await db.close(); }
