/** Offline PGlite contract test. NEVER uses the production Supabase project. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const sql=await readFile(new URL('../supabase/staged/territory_master_license_shop_v1.sql',import.meta.url),'utf8');
const db=new PGlite();
const hero='11111111-1111-4111-8111-111111111111';
const poor='22222222-2222-4222-8222-222222222222';
const guest='33333333-3333-4333-8333-333333333333';
const noProfession='44444444-4444-4444-8444-444444444444';
const op='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const one=async(query,params=[]) => (await db.query(query,params)).rows[0];
const as=(id)=>db.query("SELECT set_config('test.uid',$1::text,false)",[id]);

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA territory_private;
    CREATE FUNCTION auth.uid() RETURNS uuid STABLE LANGUAGE sql
      AS $$ SELECT NULLIF(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE public.players(
      id uuid PRIMARY KEY,telegram_id bigint,banned boolean NOT NULL DEFAULT false,
      gold integer NOT NULL DEFAULT 0,gems integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
      game_state jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE public.territory_profession_unlocks(
      player_id uuid PRIMARY KEY REFERENCES public.players(id),
      profession text NOT NULL,master_license boolean NOT NULL DEFAULT false);
    CREATE TABLE public.admin_grants(
      id uuid PRIMARY KEY,player_id uuid NOT NULL REFERENCES public.players(id),
      payload jsonb NOT NULL,claimed_at timestamptz);
    CREATE TABLE territory_private.referral_claim_cursor_v1(
      player_id uuid PRIMARY KEY REFERENCES public.players(id),red_paid integer NOT NULL DEFAULT 0);
    INSERT INTO public.players(id,telegram_id,game_state) VALUES
      ('${hero}',123,'{"player":{"redGems":75}}'),
      ('${poor}',456,'{"player":{"redGems":49}}'),
      ('${guest}',NULL,'{"player":{"redGems":100}}'),
      ('${noProfession}',789,'{"player":{"redGems":100}}');
    INSERT INTO public.territory_profession_unlocks(player_id,profession) VALUES
      ('${hero}','smith'),('${poor}','smith'),('${guest}','smith');
  `);
  await db.exec(sql);

  const initial=await one('SELECT balance FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=$1',[hero]);
  assert.equal(initial.balance,75,'cutover preserves existing red gems');
  const heroRevision=(await one('SELECT updated_at AS value FROM public.players WHERE id=$1',[hero])).value;
  const poorRevision=(await one('SELECT updated_at AS value FROM public.players WHERE id=$1',[poor])).value;
  const guestRevision=(await one('SELECT updated_at AS value FROM public.players WHERE id=$1',[guest])).value;
  const noProfessionRevision=(await one('SELECT updated_at AS value FROM public.players WHERE id=$1',[noProfession])).value;
  assert.equal((await one("SELECT has_table_privilege('authenticated','territory_private.territory_master_license_red_wallet_v1','UPDATE') AS allowed")).allowed,false);
  assert.equal((await one("SELECT has_table_privilege('authenticated','territory_private.territory_master_license_red_wallet_v1','SELECT') AS allowed")).allowed,false);
  assert.equal((await one("SELECT has_function_privilege('anon','public.territory_master_license_shop_buy_v1(uuid,timestamptz)','EXECUTE') AS allowed")).allowed,false);

  // Client can inflate legacy JSON, but this cannot inflate license balance.
  await db.exec(`UPDATE public.players SET game_state='{"player":{"redGems":999999}}' WHERE id='${hero}';`);
  await as(hero);
  await db.exec('SET ROLE authenticated;');
  const status=(await one('SELECT public.territory_master_license_shop_status_v1() AS value')).value;
  assert.deepEqual([status.price,status.red_balance,status.owned,status.has_profession,status.verified_telegram],[50,75,false,true,true]);
  await assert.rejects(()=>one('SELECT public.territory_master_license_shop_buy_v1($1::uuid,$2::timestamptz) AS value',[op,'2000-01-01T00:00:00Z']),/license_reload_save/);
  const paid=(await one('SELECT public.territory_master_license_shop_buy_v1($1::uuid,$2::timestamptz) AS value',[op,heroRevision])).value;
  assert.deepEqual([paid.success,paid.red_balance,paid.replayed],[true,25,false]);
  const replay=(await one('SELECT public.territory_master_license_shop_buy_v1($1::uuid,$2::timestamptz) AS value',[op,heroRevision])).value;
  assert.deepEqual([replay.success,replay.red_balance,replay.replayed],[true,25,true]);
  await assert.rejects(()=>one('SELECT public.territory_master_license_shop_buy_v1($1::uuid,$2::timestamptz) AS value',[other,paid.updated_at]),/license_already_owned/);
  const after=(await one('SELECT public.territory_master_license_shop_status_v1() AS value')).value;
  assert.equal(after.owned,true);
  assert.equal(after.red_balance,25);

  await db.exec('RESET ROLE;');
  const wallet=(await one('SELECT balance FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=$1',[hero])).balance;
  const saved=(await one('SELECT game_state #>> \'{player,redGems}\' AS red FROM public.players WHERE id=$1',[hero])).red;
  const entries=(await one('SELECT count(*)::int AS count FROM territory_private.territory_master_license_buy_events_v1 WHERE player_id=$1',[hero])).count;
  assert.equal(wallet,25);assert.equal(saved,'25');assert.equal(entries,1);

  await as(poor);await db.exec('SET ROLE authenticated;');
  await assert.rejects(()=>one('SELECT public.territory_master_license_shop_buy_v1($1::uuid,$2::timestamptz) AS value',[op,poorRevision]),/license_insufficient_red_gems/);
  await db.exec('RESET ROLE;');
  assert.equal((await one('SELECT balance FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=$1',[poor])).balance,49);

  // Verified rewards credit the protected balance exactly once, without
  // re-reading user-writable game_state (which later mirrors the receipt).
  await db.exec(`INSERT INTO public.admin_grants(id,player_id,payload)
    VALUES('${other}','${poor}','{"redGems":4}');`);
  await db.exec(`UPDATE public.admin_grants SET claimed_at=clock_timestamp() WHERE id='${other}';`);
  await db.exec(`UPDATE public.admin_grants SET claimed_at=clock_timestamp() WHERE id='${other}';`);
  assert.equal((await one('SELECT balance FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=$1',[poor])).balance,53,'mail credits once');
  await db.exec(`INSERT INTO territory_private.referral_claim_cursor_v1(player_id) VALUES('${poor}');`);
  await db.exec(`UPDATE territory_private.referral_claim_cursor_v1 SET red_paid=2 WHERE player_id='${poor}';`);
  assert.equal((await one('SELECT balance FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=$1',[poor])).balance,55,'referral cursor credits delta');
  await db.exec(`UPDATE public.players SET game_state='{"player":{"redGems":55}}' WHERE id='${poor}';`);
  await as(poor);await db.exec('SET ROLE authenticated;');
  const earned=(await one('SELECT public.territory_master_license_shop_buy_v1($1::uuid,$2::timestamptz) AS value',[op,poorRevision])).value;
  assert.equal(earned.red_balance,5,'purchase consumes legitimately earned grants');
  await db.exec('RESET ROLE;');

  await as(guest);await db.exec('SET ROLE authenticated;');
  await assert.rejects(()=>one('SELECT public.territory_master_license_shop_buy_v1($1::uuid,$2::timestamptz) AS value',[op,guestRevision]),/license_verified_telegram_required/);
  await db.exec('RESET ROLE;');
  await as(noProfession);await db.exec('SET ROLE authenticated;');
  await assert.rejects(()=>one('SELECT public.territory_master_license_shop_buy_v1($1::uuid,$2::timestamptz) AS value',[op,noProfessionRevision]),/license_profession_required/);
  await db.exec('RESET ROLE;');
  assert.equal((await one('SELECT count(*)::int AS count FROM territory_private.territory_master_license_buy_events_v1')).count,2);
  console.log('Master License PASS: 50 protected red gems, one-time snapshot, verified mail/referral credits, auth, profession check, atomic purchase, replay, no double debit, no JSON forgery.');
} finally {await db.close();}
