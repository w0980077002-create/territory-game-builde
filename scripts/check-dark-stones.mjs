import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Run the actual wallet and RPC definitions, excluding the separate live combat
// function patch. PGlite is disposable and contains synthetic accounts only.
const db = new PGlite();
const player = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA territory_private;
    CREATE TABLE public.players(id uuid PRIMARY KEY, banned boolean DEFAULT false);
    CREATE TABLE territory_private.adventure_progress_v1(player_id uuid PRIMARY KEY, completed_stage integer, unlocked_stage integer);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA territory_private TO service_role;
    GRANT SELECT ON public.players TO service_role;`);
  await query('INSERT INTO public.players(id) VALUES($1),($2)', [player, other]);
  const source = readFileSync('supabase/staged/territory_dark_stones_20261030.sql', 'utf8');
  const marker = '-- Patch only the obsolete battle-stone debit section';
  assert.ok(source.includes(marker));
  await db.exec(source.slice(0, source.indexOf(marker)));
  const touch = async id => (await query('SELECT territory_private.dark_stone_touch_v1($1) AS n', [id]))[0].n;
  const take = async id => (await query('SELECT territory_private.dark_stone_take_v1($1) AS n', [id]))[0].n;
  assert.equal(await touch(player), 5, 'first touch creates exactly five');
  assert.equal(await touch(player), 5, 'same UTC day does not grant twice');
  assert.equal(await take(player), 4, 'one entry costs exactly one');
  await query(`UPDATE territory_private.dark_stones_v1 SET balance=29, grant_day=(timezone('UTC',now())::date-3) WHERE player_id=$1`, [player]);
  assert.equal(await touch(player), 38, 'three missed UTC days accrue without the former cap');
  assert.equal(await touch(player), 38, 'accrued days are not paid twice');
  assert.equal(await touch(other), 5, 'other accounts have independent wallets');
  await db.exec('BEGIN');
  assert.equal(await take(player), 37);
  await db.exec('ROLLBACK');
  assert.equal(await touch(player), 38, 'failed surrounding transaction rolls back the debit');
  await query(`UPDATE territory_private.dark_stones_v1 SET balance=0 WHERE player_id=$1`, [player]);
  await assert.rejects(take(player), /combat_no_dark_stones/);
  assert.equal(await touch(player), 0, 'insufficient funds do not debit');
  await db.exec('SET ROLE authenticated');
  await assert.rejects(query('SELECT territory_private.dark_stone_take_v1($1)', [player]), /permission denied/);
  await db.exec('RESET ROLE');
  console.log('Dark Stones PGlite PASS: initial grant, missed UTC days, idempotency, account isolation, debit and rollback.');
} finally { await db.close(); }
