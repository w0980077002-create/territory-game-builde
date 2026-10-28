/** Executes the production Edge service against isolated PostgreSQL. No network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

const compiled = await build({ entryPoints: ['src/game/combatV1/service.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { executeCombatCommand, parseCombatCommand } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const projectionBuild = await build({ entryPoints: ['src/game/combatV1/projection.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { projectTerritoryCombatStats } = await import('data:text/javascript;base64,' + Buffer.from(projectionBuild.outputFiles[0].text).toString('base64'));
assert.deepEqual(projectTerritoryCombatStats({ hp: 40, maxHp: 100, attack: 30, defense: 20, critChance: 12, critDamage: 50 },
  { dodgeChance: 0.06, blockChance: 0.2 }), { hp: 40, maxHp: 100, attack: 30, defense: 20, critChance: 0.12,
  critMultiplier: 1.5, dodgeChance: 0.06, blockChance: 0.2 });
assert.throws(() => projectTerritoryCombatStats({ hp: 100, maxHp: 40, attack: 1, defense: 0, critChance: 0, critDamage: 0 },
  { dodgeChance: 0, blockChance: 0 }), /combat_invalid_verified_projection/);
const db = new PGlite();
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
let counter = 0;
const op = () => `20000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const rpc = async (name, args) => (await query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args))[0].r;
const repository = {
  context: (player, command) => rpc('territory_combat_context_v1', [player, command]),
  commit: (player, command, context, result) => rpc('territory_combat_commit_v1', [player, command, context, result]),
};
const execute = (player, command) => executeCombatCommand(repository, player, command, () => 12);
// These coefficients are test fixtures; no balance or prices are seeded by SQL.
const catalog = {
  skills: [{ id: 'test_slash', category: 'base', unlockLevel: 1, priority: 1,
    levels: [{ multiplier: 2, energyCost: 0, cooldownMs: 200, windupMs: 20, effects: [] }] }],
  runes: [{ id: 'test_fire', unlockLevel: 1, compatibleSkillIds: ['test_slash'],
    levels: [{ chance: 1, cooldownMs: 200, effects: [{ type: 'burn', target: 'opponent', value: 2, durationMs: 400, tickMs: 100 }] }] }], passives: [],
};
const loadout = { skills: [{ skillId: 'test_slash', level: 1, runes: [{ runeId: 'test_fire', level: 1 }] }], passives: [] };
const fighter = { stats: { hp: 1000, maxHp: 1000, attack: 12, defense: 4, critChance: 0, dodgeChance: 0, blockChance: 0 },
  ownership: { heroLevel: 1, skills: { test_slash: 1 }, runes: { test_fire: 1 }, passives: {} }, loadout };
const rules = { stepMs: 10, maxDurationMs: 10_000, approachMs: 20, attackIntervalMs: 200, basicWindupMs: 20,
  basicMultiplier: 1, defenseFactor: 0.5, magicDefenseFactor: 0.2, minimumDamage: 1, critMultiplier: 2, blockMultiplier: 0,
  maxEnergy: 100, initialEnergy: 100, energyPerSecond: 0, modeDamageMultiplier: { pve: 1, boss: 1, pvp: 1 } };

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.players(id uuid PRIMARY KEY,banned boolean DEFAULT false,game_state jsonb,gold int DEFAULT 91);
    GRANT SELECT ON public.players TO service_role;`);
  await query(`INSERT INTO players(id,game_state) VALUES($1,'{"legacy":"preserve","vip":7,"diamonds":888}'),($2,'{"license":true}')`, [A, B]);
  const oldPlayers = await query('SELECT * FROM players ORDER BY id');
  await db.exec(readFileSync('supabase/staged/territory_v1_combat_completion.sql', 'utf8'));
  assert.deepEqual(await query('SELECT * FROM players ORDER BY id'), oldPlayers, 'install never migrates old saves');
  for (const player of [A, B]) await query(`INSERT INTO territory_private.combat_profiles_v1(player_id,verified,fighter,approval_reference) VALUES($1,true,$2,'test fixture only')`, [player, fighter]);
  await query(`INSERT INTO territory_private.combat_encounters_v1(encounter_id,mode,stage,enemy,enabled,approval_reference)
    VALUES('test_pve','pve',1,$1,true,'test fixture only'),('test_boss','boss',1,$1,true,'test fixture only')`, [fighter]);
  await query(`INSERT INTO territory_private.combat_encounters_v1(encounter_id,mode,stage,enemy_player_id,enabled,approval_reference)
    VALUES('test_pvp','pvp',1,$1,true,'test fixture only')`, [B]);
  await query(`UPDATE territory_private.combat_config_v1 SET catalog=$1,rules=$2`, [catalog, rules]);
  const start = { action: 'start', operationId: op(), encounterId: 'test_pve', control: 'auto' };
  await assert.rejects(execute(A, start), /combat_not_enabled/);
  await query(`UPDATE territory_private.combat_config_v1 SET enabled=true,approval_reference='test fixture only'`);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(repository.context(A, start), /permission denied/);
  await assert.rejects(query('SELECT * FROM territory_private.combat_profiles_v1'), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE service_role');

  const wrongLoadout = structuredClone(loadout);
  wrongLoadout.skills[0].level = 2;
  await assert.rejects(execute(A, { action: 'loadout', operationId: op(), revision: 0, loadout: wrongLoadout }), /combat_invalid_loadout/);
  const saved = await execute(A, { action: 'loadout', operationId: op(), revision: 0, loadout });
  assert.equal(saved.profile_revision, 1);
  // The actual live game must NOT switch to this combat session while
  // its legacy gold/XP/arena reward ledger has not been atomically migrated.
  await assert.rejects(execute(A, start), /combat_settlement_not_ready/);
  await query(`UPDATE territory_private.combat_config_v1 SET settlement_ready=true`);
  const receipt = await execute(A, start);
  assert.equal(receipt.state.input.mode, 'pve');
  assert.equal(receipt.rewards_claimed, false);
  assert.deepEqual(await execute(A, start), receipt, 'timeout/reopen exact replay retains seed and session');
  await assert.rejects(execute(A, { ...start, control: 'manual' }), /combat_operation_reused/);
  await assert.rejects(execute(A, { ...start, operationId: op() }), /combat_active_session_exists/);
  await assert.rejects(execute(B, { action: 'resume', sessionId: receipt.session_id }), /combat_session_not_found/);
  const resume = await execute(A, { action: 'resume', sessionId: receipt.session_id });
  assert.deepEqual(resume.state, receipt.state, 'JSON round-trip resumes the real engine');
  await assert.rejects(execute(A, { action: 'advance', operationId: op(), sessionId: receipt.session_id,
    revision: 0, skillId: 'test_slash' }), /combat_skill_not_available/, 'manual commands require manual battle');
  assert.throws(() => parseCombatCommand({ ...start, attack: 999999 }), /combat_invalid_command/);
  for (const action of ['constructor', '__proto__', 'toString'])
    assert.throws(() => parseCombatCommand({ action }), /combat_invalid_command/);
  assert.throws(() => parseCombatCommand({ action: 'advance', sessionId: receipt.session_id, revision: 0, operationId: op(), elapsedMs: 999999 }), /combat_invalid_command/);

  // Advance by server-verified elapsed time, not a client-supplied delta.
  await db.exec('RESET ROLE');
  await query(`UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-1000 WHERE session_id=$1`, [receipt.session_id]);
  await db.exec('SET ROLE service_role');
  const advance = { action: 'advance', operationId: op(), sessionId: receipt.session_id, revision: 0 };
  const first = await execute(A, advance);
  assert.equal(first.revision, 1);
  assert.ok(first.state.atMs >= 1000);
  assert.ok(first.events.some(e => e.type === 'rune_proc'));
  assert.ok(first.state.actors.enemy.stats.hp < 1000);
  assert.deepEqual(await execute(A, advance), first, 'repeated request deals no second damage');
  await assert.rejects(execute(A, { ...advance, operationId: op() }), /combat_revision_conflict/);
  const command = { ...advance, operationId: op(), revision: 1 };
  const context = await repository.context(A, command);
  const next = { state: first.state, events: [], cursorMs: context.session.cursorMs };
  const cas = await repository.commit(A, command, context, next);
  await assert.rejects(repository.commit(A, { ...command, operationId: op() }, context, next), /combat_revision_conflict/, 'competing revisions serialize');
  assert.equal(cas.revision, 2);

  await db.exec('RESET ROLE');
  await query(`UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-20000 WHERE session_id=$1`, [receipt.session_id]);
  await db.exec('SET ROLE service_role');
  const finishedCommand = { ...advance, operationId: op(), revision: 2 };
  const finished = await execute(A, finishedCommand);
  assert.notEqual(finished.state.status, 'fighting');
  assert.deepEqual(await execute(A, finishedCommand), finished);
  assert.equal((await query('SELECT count(*)::int n FROM territory_private.combat_outcomes_v1'))[0].n, 1, 'one terminal outcome');
  await assert.rejects(execute(A, { ...advance, operationId: op(), revision: 3 }), /combat_already_finished/);
  const pvp = await execute(A, { ...start, operationId: op(), encounterId: 'test_pvp', control: 'manual' });
  assert.equal(pvp.state.input.mode, 'pvp');
  assert.deepEqual(pvp.state.input.enemy.ownership, fighter.ownership, 'PvP defender uses verified ownership');
  await db.exec('RESET ROLE');
  await query(`UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-61000 WHERE session_id=$1`, [pvp.session_id]);
  await db.exec('SET ROLE service_role');
  await assert.rejects(execute(A, { action: 'advance', operationId: op(), sessionId: pvp.session_id,
    revision: 0, skillId: 'test_slash' }), /combat_catchup_required/, 'manual commands cannot rewrite unattended history');
  await assert.rejects(execute(B, { ...start, operationId: op(), encounterId: 'test_pvp' }), /combat_self_battle/);
  const boss = await execute(B, { ...start, operationId: op(), encounterId: 'test_boss' });
  assert.equal(boss.state.input.mode, 'boss');
  await db.exec('RESET ROLE');
  assert.deepEqual(await query('SELECT * FROM players ORDER BY id'), oldPlayers, 'all accounts keep old progress, wallets, VIP and license');
  console.log('PASS T3 PostgreSQL + real combat service: ownership, saved build, PvE/boss/PvP, replay, concurrent revision conflict, resume, server time, terminal once, old saves preserved.');
} finally { await db.close(); }
