/** Offline, rollback-safe owner ticket grant regression tests. No production access. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const original = readFileSync('supabase/migrations/20261017_admin_master_controls_v2.sql', 'utf8');
const hotfix = readFileSync('supabase/staged/20261026_admin_ticket_unlimited.sql', 'utf8');
const db = new PGlite();
const playerA = '11111111-1111-4111-8111-111111111111';
const playerB = '22222222-2222-4222-8222-222222222222';
const playerBanned = '33333333-3333-4333-8333-333333333333';
const request = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const grant = async (id, scope, player, delta, reason = 'owner ticket test') => {
  const sql = `SELECT public.territory_hall_admin_adjust_v2(
    $1::uuid,$2::text,$3::uuid,$4::integer,$5::text) AS receipt`;
  return (await one(sql, [id, scope, player, delta, reason])).receipt;
};
const balance = async id => (await one(
  'SELECT tickets FROM territory_private.hall_accounts_v1 WHERE player_id=$1', [id]
)).tickets;

try {
  await db.exec(`
    CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE SCHEMA territory_private;CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    CREATE TABLE public.players(
      id uuid PRIMARY KEY,telegram_id bigint,display_name text,
      banned boolean NOT NULL DEFAULT false,last_seen_at timestamptz,
      created_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE territory_private.hall_accounts_v1(
      player_id uuid PRIMARY KEY REFERENCES public.players(id),
      tickets integer NOT NULL DEFAULT 4 CHECK(tickets BETWEEN 0 AND 20),
      points int DEFAULT 0,played int DEFAULT 0,wins int DEFAULT 0,
      pending_gold int DEFAULT 0,claimed_gold int DEFAULT 0,daily_gold int DEFAULT 0);
    CREATE TABLE territory_private.hall_sessions_v1(
      player_id uuid PRIMARY KEY REFERENCES public.players(id),
      game text,created_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE territory_private.hall_history_v1(
      player_id uuid,game text,won boolean,earned_gold int,
      played_at timestamptz DEFAULT clock_timestamp());
  `);
  await db.query('INSERT INTO public.players(id,display_name,last_seen_at,banned) VALUES($1,$2,now(),false)', [playerA, 'Owner']);
  await db.query('INSERT INTO public.players(id,display_name,last_seen_at,banned) VALUES($1,$2,now(),false)', [playerB, 'Tester']);
  await db.query('INSERT INTO public.players(id,display_name,last_seen_at,banned) VALUES($1,$2,now(),true)', [playerBanned, 'Banned']);
  await db.exec(original);
  await db.exec(hotfix);

  const once = await grant(request(1), 'one', playerA, 500_000);
  assert.deepEqual([once.affected, once.balance, once.replayed], [1, 500_004, false]);
  const replay = await grant(request(1), 'one', playerA, 500_000);
  assert.deepEqual([replay.affected, replay.balance, replay.replayed], [1, 500_004, true]);
  assert.equal(await balance(playerA), 500_004, 'same request cannot award twice');
  await assert.rejects(grant(request(1), 'one', playerA, 5), /admin_request_conflict/);

  const all = await grant(request(2), 'all', null, 750_000);
  assert.equal(all.affected, 2, 'owner bulk grant excludes banned players');
  assert.equal(await balance(playerA), 1_250_004);
  assert.equal(await balance(playerB), 750_004);
  assert.equal((await one('SELECT tickets FROM territory_private.hall_accounts_v1 WHERE player_id=$1', [playerBanned]))?.tickets, undefined);

  const deducted = await grant(request(3), 'one', playerA, -2_000_000);
  assert.equal(deducted.balance, 0, 'large owner adjustment never creates negative tickets');
  assert.equal(await balance(playerB), 750_004, 'other player untouched');

  await db.query('UPDATE territory_private.hall_accounts_v1 SET tickets=2147483600 WHERE player_id=$1', [playerA]);
  await assert.rejects(grant(request(4), 'one', playerA, 100), /admin_ticket_wallet_overflow/);
  assert.equal(await balance(playerA), 2_147_483_600, 'overflow must roll back completely');
  assert.equal((await one('SELECT count(*)::int AS n FROM territory_private.hall_admin_receipts_v2 WHERE request_id=$1', [request(4)])).n, 0);

  const maxWithoutOverflow = await grant(request(5), 'one', playerA, 47);
  assert.equal(maxWithoutOverflow.balance, 2_147_483_647);
  assert.equal(await balance(playerA), 2_147_483_647);

  for (const role of ['anon', 'authenticated']) {
    assert.equal((await one(
      'SELECT has_function_privilege($1,$2,$3) AS allowed',
      [role, 'public.territory_hall_admin_adjust_v2(uuid,text,uuid,integer,text)', 'execute']
    )).allowed, false, `owner grant must be inaccessible to ${role}`);
  }
  assert.equal((await one(
    "SELECT has_function_privilege('service_role','public.territory_hall_admin_adjust_v2(uuid,text,uuid,integer,text)','execute') AS allowed"
  )).allowed, true);
  console.log('OWNER TICKET HOTFIX PASS: large rewards, bulk scope, idempotency, no silent clipping, overflow rollback, owner-only access.');
} finally {
  await db.close();
}
