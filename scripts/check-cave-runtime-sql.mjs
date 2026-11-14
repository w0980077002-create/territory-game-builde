import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCaveRuntimeFixture, PLAYER, OTHER } from './fixtures/cave-runtime.mjs';

const f = await createCaveRuntimeFixture();
const { db, exec, q } = f;
const start = () => exec({ action: 'start', operationId: randomUUID(), encounterId: 'adventure_v1_stage_1', control: 'manual' });
const step = (session, extra = {}, operationId = randomUUID()) => ({ action: 'advance', operationId, sessionId: session.session_id, revision: session.revision, ...extra });
const age = async (session, ms) => q('UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-$2 WHERE session_id=$1', [session.session_id, ms]);
try {
  await db.exec('SET ROLE service_role');
  const first = await start();
  assert.equal(first.state.caveRuntime.speed, 1);
  assert.equal(first.state.caveRuntime.belt[0].item.qty, 5);
  assert.equal(first.state.caveRuntime.belt[6], null, 'locked slot stays unusable even with an attestation');
  const startRequest = (await q('SELECT request FROM territory_private.combat_operations_v1 WHERE receipt->>\'session_id\'=$1', [first.session_id]))[0].request;
  assert.deepEqual(await exec(startRequest), first, 'exact start replay');
  assert.equal((await q('SELECT balance FROM territory_private.dark_stones_v1 WHERE player_id=$1', [PLAYER]))[0].balance, 4);
  const pauseCommand = step(first, { playback: 'pause' });
  const paused = await exec(pauseCommand);
  assert.equal(paused.state.caveRuntime.paused, true);
  assert.equal(paused.state.atMs, 0, 'pause does not fight');
  assert.deepEqual(await exec(pauseCommand), paused);
  await assert.rejects(exec(step(paused)), /combat_paused/);
  await assert.rejects(exec(step(paused, { beltSlot: 0 })), /combat_paused/);
  await age(paused, 3_600_000);
  const restored = await exec({ action: 'resume', sessionId: paused.session_id });
  assert.deepEqual(restored.state, paused.state, 'hour offline + reload cannot progress a paused attempt');
  let current = await exec(step(restored, { playback: 'play' }));
  await age(current, 30_000);
  current = await exec(step(current));
  assert.equal(current.state.atMs, 1100, 'unattended wall time is bounded to one active tick');
  current = await exec(step(current, { playback: 'fast' }));
  await age(current, 1100);
  current = await exec(step(current));
  assert.equal(current.state.atMs, 3300, 'x2 actually advances twice the combat time');
  const healthBefore = current.state.actors.hero.stats.hp;
  assert.ok(healthBefore < 1000);
  const drink = step(current, { beltSlot: 0 });
  const healed = await exec(drink);
  assert.equal(healed.state.actors.hero.stats.hp, Math.min(1000, healthBefore + 50));
  assert.equal(healed.belt_save.game_state.belt[0].qty, 4);
  assert.equal(healed.belt_save.game_state.battleStones, 37);
  assert.equal(healed.belt_save.wallet_gold, 50); assert.equal(healed.belt_save.wallet_gems, 9);
  assert.deepEqual(await exec(drink), healed, 'replayed dose heals and debits once');
  await assert.rejects(exec({ ...drink, operationId: randomUUID() }), /combat_revision_conflict/);
  await assert.rejects(exec(step(healed, { beltSlot: 6 })), /combat_belt_unavailable/);
  await assert.rejects(exec(step(healed), OTHER), /combat_session_not_found/);
  await assert.rejects(exec(step(healed, { beltSlot: 0, skillId: 'inject' })), /combat_invalid_command/);
  await assert.rejects(exec(step(healed, { elapsed: 1_000_000 })), /combat_invalid_command/);
  await assert.rejects(exec(step(healed, { playback: ['pause'] })), /combat_invalid_command/);
  // Unexpected legacy save triggers must roll back the WHOLE dose operation.
  await db.exec('RESET ROLE');
  await db.exec(`CREATE FUNCTION public.cave_test_bad_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF current_setting('test.bad_trigger',true)='on' THEN NEW.gold:=NEW.gold+1; END IF; RETURN NEW; END $$;
    CREATE TRIGGER cave_test_bad_trigger BEFORE UPDATE OF game_state ON public.players
    FOR EACH ROW EXECUTE FUNCTION public.cave_test_bad_trigger();
    SET test.bad_trigger='on'; SET ROLE service_role;`);
  await assert.rejects(exec(step(healed, { beltSlot: 0 })), /combat_belt_changed/);
  assert.equal((await q('SELECT gold FROM public.players WHERE id=$1', [PLAYER]))[0].gold, 50);
  assert.equal((await q('SELECT revision FROM territory_private.combat_sessions_v1 WHERE session_id=$1', [healed.session_id]))[0].revision, healed.revision);
  assert.equal((await q('SELECT slot_snapshot FROM territory_private.cave_belt_attestations_v1 WHERE player_id=$1 AND slot=0', [PLAYER]))[0].slot_snapshot.qty, 4);
  await db.exec("RESET ROLE; SET test.bad_trigger='off'; SET ROLE service_role;");
  // A modified writable slot cannot authorize an item or alter its effect.
  await db.exec('RESET ROLE');
  await q(`UPDATE public.players SET game_state=jsonb_set(game_state,'{belt,0,effect,value}','999999') WHERE id=$1`, [PLAYER]);
  await db.exec('SET ROLE service_role');
  await assert.rejects(exec(step(healed, { beltSlot: 0 })), /combat_belt_changed|combat_belt_no_effect/);
  await db.exec('RESET ROLE');
  await q('UPDATE public.players SET game_state=$2 WHERE id=$1', [PLAYER, healed.belt_save.game_state]);
  // Drain exactly the remaining four starting doses, setting HP in the fixture
  // only. A refill cannot extend this fight's pinned limit of five per kind.
  current = healed;
  for (let dose = 1; dose < 5; dose++) {
    await q(`UPDATE territory_private.combat_sessions_v1 SET state=jsonb_set(state,'{actors,hero,stats,hp}','100') WHERE session_id=$1`, [current.session_id]);
    await db.exec('SET ROLE service_role');
    current = await exec(step(current, { beltSlot: 0 }));
    await db.exec('RESET ROLE');
  }
  assert.equal(current.belt_save.game_state.belt[0], null);
  assert.equal(current.state.caveRuntime.belt[0].used, 5);
  await db.exec('SET ROLE service_role');
  await assert.rejects(exec(step(current, { beltSlot: 0 })), /combat_belt_unavailable/);
  // Finish on the real engine and real SQL; the reward must survive resume.
  let terminalCommand;
  for (let tick = 0; current.state.status === 'fighting' && tick < 100; tick++) {
    await age(current, 1100);
    terminalCommand = step(current);
    current = await exec(terminalCommand);
  }
  assert.notEqual(current.state.status, 'fighting');
  assert.equal(current.settlement.outcome, current.state.status);
  assert.deepEqual(await exec(terminalCommand), current);
  assert.deepEqual((await exec({ action: 'resume', sessionId: current.session_id })).settlement, current.settlement);
  assert.equal((await q('SELECT count(*)::int n FROM territory_private.adventure_settlements_v1 WHERE session_id=$1', [current.session_id]))[0].n, 1);
  assert.deepEqual((await q('SELECT game_state FROM public.players WHERE id=$1', [OTHER]))[0].game_state, f.save);
  await db.exec('RESET ROLE');
  await assert.rejects(db.exec(readFileSync('supabase/staged/territory_cave_runtime_belt_v1.sql', 'utf8')), /drift/);
  await db.exec('ROLLBACK; SET ROLE authenticated');
  await assert.rejects(q('SELECT territory_private.cave_belt_debit_v1($1,$2,$3)', [PLAYER, first.state, {}]), /permission denied/);
  console.log('Cave runtime SQL PASS: real service/engine/transactions, pause/reload, x2, pinned belt 5 cap, exact replay, competing revisions, source tamper, owner isolation, single settlement.');
} finally { await db.close(); }
