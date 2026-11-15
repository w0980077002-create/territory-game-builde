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
  if (process.env.CAVE_TEST_STONE_CONTRACT === 'live')
    await exec(readFileSync('scripts/fixtures/cave-dark-stone-live-20261115.sql', 'utf8'));
  await exec(readFileSync('supabase/staged/territory_cave_client_pve_v1.sql', 'utf8'));
  await exec(readFileSync('supabase/staged/territory_cave_client_pve_v1.sql', 'utf8')); // deployment replay is additive
  await as(A, async () => {
    await assert.rejects(query('SELECT * FROM territory_private.cave_client_runs_v1'), /permission denied/);
  });

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
  await query("UPDATE territory_private.combat_sessions_v1 SET state='{\"status\":\"hero_won\"}'::jsonb WHERE session_id=$1", [uuid(9)]);
  await as(A,async()=>{
    const h=(await status()).history;
    assert.ok(h.some(r=>r.source==='legacy' && r.run_id===uuid(9) && r.floor===2 && r.status==='won'));
    assert.ok(h.every(r=>r.run_id!==uuid(7)), 'history cannot expose another account');
  });
  await query('UPDATE territory_private.adventure_progress_v1 SET completed_stage=99,unlocked_stage=100 WHERE player_id=$1', [A]);
  await as(A, async () => {
    assert.equal((await start(uuid(11), 100)).active_floor, 100);
    const last = await finish(uuid(11), true);
    assert.deepEqual([last.completed_stage, last.unlocked_stage], [100, 100]);
    await assert.rejects(start(uuid(12), 101), /cave_invalid_run/);
    await assert.rejects(start(uuid(12), null), /cave_invalid_run/);
    await start(uuid(12), 1);
    const repeated = await finish(uuid(12), true);
    assert.deepEqual([repeated.completed_stage, repeated.unlocked_stage], [100,100]);
    assert.equal((await finish(uuid(12), true)).dark_stones, repeated.dark_stones);
    await start(uuid(13), 100);
    const old = await finish(uuid(12), true);
    assert.equal(old.active_run_id, uuid(13), 'old receipt cannot hide the current run');
    await finish(uuid(13), false);
  });
  for (const [completed, target] of [[9,10],[10,11],[98,99],[99,100],[30,1],[30,10],[30,30],[30,31]]) {
    await query('UPDATE territory_private.adventure_progress_v1 SET completed_stage=$2,unlocked_stage=least(100,$2+1) WHERE player_id=$1', [A,completed]);
    await query('UPDATE territory_private.dark_stones_v1 SET balance=50 WHERE player_id=$1', [A]);
    await as(A, async () => {
      const id=uuid(1000+completed*100+target);
      await start(id,target);
      await assert.rejects(start(uuid(20000+target),target), /cave_run_in_progress/);
      const result=await finish(id,true);
      assert.deepEqual([result.completed_stage,result.unlocked_stage], [Math.max(completed,target),Math.min(100,Math.max(completed,target)+1)]);
      assert.equal(result.dark_stones,49);
      assert.deepEqual(await finish(id,true),result,'receipt replay is stable');
    });
  }
  await exec('SET ROLE anon');
  await assert.rejects(status(), /permission denied/);
  await assert.rejects(start(uuid(50000),1), /permission denied/);
  await exec('RESET ROLE');
  await query('UPDATE public.players SET banned=true WHERE id=$1',[A]);
  await as(A,async()=>{ await assert.rejects(status(),/cave_account_unavailable/); });
  const w = (await query('SELECT gold,red_gems FROM public.players WHERE id=$1', [A]))[0];
  assert.deepEqual(w, {gold: 71, red_gems: 17}, 'No account economy or premium values are modified');
  console.log('PASS Cave client PvE SQL: isolated users, one debit, replay, win/loss, old-session gate, 1→2 / 10→11 / 99→100, repeated floors, stale receipt vs active run, null/101 rejection, role denial, bans and intact wallet');
} finally { await db.close(); }
