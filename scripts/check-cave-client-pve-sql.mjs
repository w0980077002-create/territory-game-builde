import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/** Disposable in-memory PostgreSQL, synthetic accounts. Never connect to production. */
const db = new PGlite();
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const uuid = n => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const exec = async sql => db.exec(sql);
const as = async (id, fn) => {
  await exec('SET ROLE authenticated');
  await exec("SET test.uid='" + id + "'");
  try { return await fn(); }
  finally { await exec('RESET ROLE'); }
};
const status = () => query('SELECT public.territory_cave_pve_status_v1() s').then(r => r[0].s);
const start = (id, floor) => query('SELECT public.territory_cave_pve_start_v1($1,$2) s', [id, floor]).then(r => r[0].s);
const finish = (id, won) => query('SELECT public.territory_cave_pve_finish_v1($1,$2) s', [id, won]).then(r => r[0].s);
try {
  await exec([
    'CREATE ROLE anon',
    'CREATE ROLE authenticated',
    'CREATE ROLE service_role BYPASSRLS',
    'CREATE SCHEMA auth',
    'CREATE SCHEMA territory_private',
    'CREATE TABLE public.players(id uuid PRIMARY KEY, banned boolean DEFAULT false, gold integer DEFAULT 71, red_gems integer DEFAULT 17)',
    'CREATE TABLE territory_private.adventure_progress_v1(player_id uuid PRIMARY KEY REFERENCES public.players(id), unlocked_stage integer NOT NULL DEFAULT 1 CHECK(unlocked_stage BETWEEN 1 AND 100), completed_stage integer NOT NULL DEFAULT 0 CHECK(completed_stage BETWEEN 0 AND 100), CHECK(unlocked_stage=least(100,completed_stage+1)))',
    'CREATE TABLE territory_private.combat_sessions_v1(session_id uuid PRIMARY KEY, player_id uuid, encounter_id text, state jsonb, created_at timestamptz DEFAULT now())',
    "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$",
    'GRANT USAGE ON SCHEMA territory_private TO service_role',
    'GRANT SELECT ON public.players TO service_role'
  ].join('; ') + ';');
  await query('INSERT INTO public.players(id) VALUES ($1),($2)', [A, B]);
  const legacy = readFileSync('supabase/staged/territory_dark_stones_20261030.sql', 'utf8');
  const stop = '-- Patch only the obsolete battle-stone debit section';
  assert.ok(legacy.includes(stop));
  await exec(legacy.slice(0, legacy.indexOf(stop)));
  await exec(readFileSync('supabase/staged/territory_cave_client_pve_v1.sql', 'utf8'));

  await as(A, async () => {
    let s = await status();
    assert.deepEqual([s.completed_stage, s.unlocked_stage, s.dark_stones, s.active_run_id], [0, 1, 5, null]);
    await assert.rejects(start(uuid(1), 2), /cave_floor_locked/);
    s = await start(uuid(1), 1);
    assert.deepEqual([s.dark_stones, s.active_run_id, s.active_floor], [4, uuid(1), 1]);
    s = await start(uuid(1), 1);
    assert.equal(s.dark_stones, 4, 'replay must not charge twice');
    await assert.rejects(start(uuid(2), 1), /cave_run_in_progress/);
    assert.equal((await status()).active_run_id, uuid(1));
    s = await finish(uuid(1), true);
    assert.deepEqual([s.completed_stage, s.unlocked_stage, s.dark_stones, s.run_status], [1, 2, 4, 'won']);
    s = await finish(uuid(1), false);
    assert.deepEqual([s.completed_stage, s.unlocked_stage, s.dark_stones, s.run_status], [1, 2, 4, 'won'], 'duplicate terminal report cannot change the outcome');
    s = await start(uuid(3), 2);
    assert.equal(s.dark_stones, 3);
    s = await finish(uuid(3), false);
    assert.deepEqual([s.completed_stage, s.unlocked_stage, s.dark_stones, s.run_status], [1, 2, 4, 'lost']);
    assert.equal((await finish(uuid(3), false)).dark_stones, 4, 'no repeated loss refund');
  });
  await as(B, async () => {
    assert.equal((await status()).dark_stones, 5, 'account balances are independent');
    await assert.rejects(finish(uuid(1), true), /cave_run_not_found/);
    await assert.rejects(start(uuid(1), 1), /cave_run_owner_or_floor_mismatch/);
    assert.equal((await start(uuid(7), 1)).dark_stones, 4);
  });
  await query('INSERT INTO territory_private.combat_sessions_v1(session_id,player_id,encounter_id,state) VALUES ($1,$2,$3,$4)', [uuid(9), A, 'adventure_v1_stage_2', JSON.stringify({ status: 'fighting' })]);
  await as(A, async () => {
    assert.equal((await status()).legacy_active_session_id, uuid(9));
    await assert.rejects(start(uuid(10), 2), /cave_legacy_recovery_required/);
  });
  await query('DELETE FROM territory_private.combat_sessions_v1 WHERE session_id=$1', [uuid(9)]);
  await query('UPDATE territory_private.adventure_progress_v1 SET completed_stage=99,unlocked_stage=100 WHERE player_id=$1', [A]);
  await as(A, async () => {
    assert.equal((await start(uuid(11), 100)).active_floor, 100);
    const last = await finish(uuid(11), true);
    assert.deepEqual([last.completed_stage, last.unlocked_stage], [100, 100]);
    await assert.rejects(start(uuid(12), 100), /cave_floor_locked/);
  });
  const w = (await query('SELECT gold,red_gems FROM public.players WHERE id=$1', [A]))[0];
  assert.deepEqual(w, {gold: 71, red_gems: 17}, 'No account economy or premium values are modified');
  console.log('PASS Cave client PvE SQL: isolated users, one debit, replay, win/loss, old-session gate, floor 100 and intact wallet');
} finally { await db.close(); }
