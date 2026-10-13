import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Isolated PostgreSQL engine. Never connects to a Supabase project.
const db = new PGlite();
const uid = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const initial = { player: { gems: 1500 }, inventory: [{ id: 'sword', qty: 1 }], professions: { active: null, masteryLevel: 1, masteryXp: 0 } };
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
async function rpc(name, args = [], signature = args.map((_, i) => `$${i + 1}`).join(',')) {
  return scalar(`select public.${name}(${signature}) as result`, args);
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to authenticated;
    create table public.players (
      id uuid primary key, gems integer not null, game_state jsonb,
      banned boolean not null default false, updated_at timestamptz default now()
    );
    create table public.territory_resource_wallet (
      player_id uuid references players(id), resource_id text, quantity bigint check(quantity>=0),
      primary key(player_id,resource_id)
    );
    create table public.territory_gather_jobs (
      player_id uuid primary key references players(id), resource_id text,
      started_at timestamptz, finishes_at timestamptz
    );
    create table public.territory_profession_unlocks (
      player_id uuid primary key references players(id), profession text, master_license boolean default false
    );
    alter table players enable row level security;
    create policy owner on players to authenticated using(id=auth.uid()) with check(id=auth.uid());
    grant select, insert, update(gems,game_state,updated_at) on players to authenticated;
  `);
  for (const fn of JSON.parse(await readFile(new URL('./fixtures/economy-live-contract.json', import.meta.url)))) {
    await db.exec(fn.definition);
  }
  await db.query('insert into players(id,gems,game_state) values($1,1500,$2),($3,1500,$2)', [uid, initial, other]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);

  // Reproduce the live vulnerabilities on synthetic records, not real players.
  check((await rpc('territory_profession_unlock', ['smith'])).gems_after === 500, 'unlock charges 1000');
  await db.exec('set role authenticated');
  await db.query('update players set gems=1500,game_state=$1 where id=$2', [initial, uid]);
  await db.exec('reset role');
  check(await scalar('select gems as result from players where id=$1', [uid]) === 1500, 'live stale-save refund reproduced');
  await db.exec('set role authenticated');
  await db.query('update players set gems=999999 where id=$1', [uid]);
  await db.exec('reset role');
  check(await scalar('select gems as result from players where id=$1', [uid]) === 999999, 'live direct gem forgery reproduced');
  // Reconcile only synthetic fixture data before testing the proposed migration.
  const owned = { ...initial, player: { gems: 500 }, professions: { active: 'smith', masteryLevel: 1, masteryXp: 0 } };
  await db.query('update players set gems=500,game_state=$1 where id=$2', [owned, uid]);
  const legacy = { ...initial, professions: { active: 'alchemist', masteryLevel: 8, masteryXp: 17 } };
  await db.query('update players set game_state=$1 where id=$2', [legacy, other]);
  await db.exec(await readFile(new URL('../supabase/migrations/20261013211739_economy_revision_and_professions.sql', import.meta.url), 'utf8'));
  check(await scalar('select profession as result from territory_profession_unlocks where player_id=$1', [other]) === 'alchemist', 'legacy profession retained free of charge');
  check((await rpc('territory_profession_unlock', ['smith'])).gems_after === 500, 'retry does not debit twice');
  check((await rpc('territory_profession_unlock', ['alchemist'])).error === 'only_one_profession', 'second profession rejected');
  check((await rpc('territory_gather_start', ['invalid'])).error === 'invalid_resource', 'invalid resource rejected');
  check((await rpc('territory_gather_start', ['gather-ore'])).success, 'gather starts');
  check(await scalar("select finishes_at-started_at=interval '4 hours' as result from territory_gather_jobs where player_id=$1", [uid]), 'exactly four hours');
  check((await rpc('territory_gather_start', ['gather-wood'])).error === 'already_gathering', 'one active gather');
  check((await rpc('territory_gather_claim')).error === 'not_ready_or_no_job', 'early claim rejected');
  // Test fixture clock advancement: never executed on a live database.
  await db.query("update territory_gather_jobs set finishes_at=clock_timestamp()-interval '1 second' where player_id=$1", [uid]);
  check((await rpc('territory_gather_claim')).quantity === 1, 'ready job rewards one resource');
  check((await rpc('territory_gather_claim')).error === 'not_ready_or_no_job', 'repeated claim cannot award twice');
  check((await rpc('territory_gather_start', ['gather-wood'])).success, 'next gather allowed after claim');

  const op = '20000000-0000-0000-0000-000000000001';
  const next = { ...owned, player: { gems: 510 }, inventory: [...owned.inventory, { id: 'legitimate-item', qty: 1 }] };
  const commitArgs = [uid, op, 'validated_quest_reward', 0, next];
  const signature = '$1::uuid,$2::uuid,$3::text,$4::bigint,$5::jsonb';
  await db.exec('set role authenticated');
  await assert.rejects(() => rpc('territory_commit_validated_state', commitArgs, signature), /permission denied/);
  checks++;
  await db.exec('reset role; set role service_role');
  const committed = await rpc('territory_commit_validated_state', commitArgs, signature);
  check(committed.success && committed.revision === 1, 'trusted action commits with revision');
  assert.deepEqual(await rpc('territory_commit_validated_state', commitArgs, signature), committed); checks++;
  await assert.rejects(() => rpc('territory_commit_validated_state', [...commitArgs.slice(0,4), owned], signature), /operation_id_reused/); checks++;
  check((await rpc('territory_commit_validated_state', [uid, '20000000-0000-0000-0000-000000000002', 'stale_save', 0, owned], signature)).error === 'save_conflict', 'stale snapshot rejected');
  await assert.rejects(() => rpc('territory_commit_validated_state', [uid, '20000000-0000-0000-0000-000000000003', 'invalid', 1, { ...next, professions: { ...next.professions, active: 'engineer' } }], signature), /immutable_profession/); checks++;
  await assert.rejects(() => rpc('territory_commit_validated_state', [uid, '20000000-0000-0000-0000-000000000004', 'invalid', 1, { ...next, professions: { ...next.professions, masteryLevel: 301 } }], signature), /invalid_mastery/); checks++;
  await db.exec('reset role');
  assert.deepEqual(await scalar('select game_state as result from players where id=$1', [uid]), next); checks++;
  check(await scalar('select count(*)::int as result from territory_economy_receipts') === 1, 'one receipt despite replay and failed requests');
  console.log(`${checks} PostgreSQL economy/save regression checks passed.`);
  console.log('NOT a production security certification: legacy direct writes remain enabled; cutover is blocked.');
} finally {
  await db.close();
}
