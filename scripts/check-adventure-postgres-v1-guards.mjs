/** Destructive fixture for a disposable PostgreSQL database. Never point at production. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {readFile, writeFile, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { build } from 'esbuild';

const connection = process.env.ADVENTURE_TEST_DATABASE_URL;
const target = connection ? new URL(connection) : null;
if (!target || !['postgres:', 'postgresql:'].includes(target.protocol)
  || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
  || target.pathname !== '/territory_adventure_guards_ci' || target.search || target.hash) {
  throw new Error('ADVENTURE_TEST_DATABASE_URL must identify local disposable territory_adventure_guards_ci');
}
const run = promisify(execFile);
async function sql(statement, app = 'adventure-ci') {
  try {
    const { stdout } = await run('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', connection, '-c', statement],
      { env: { ...process.env, PGAPPNAME: app }, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  } catch (e) { throw new Error(String(e.stderr || e.message)); }
}
async function file(path) {
  await run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', connection, '-f', path], { env: process.env, maxBuffer: 4 * 1024 * 1024 });
}
const quote = x => "'" + String(x).replaceAll("'", "''") + "'";
const json = x => `${quote(JSON.stringify(x))}::jsonb`;
const scalar = async statement => JSON.parse(await sql(statement));
const player = '10000000-0000-4000-8000-000000000001';
const loser = '10000000-0000-4000-8000-000000000002';
const op = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fighter = { stats: { hp: 1000, maxHp: 1000, attack: 100, defense: 4, critChance: 0, dodgeChance: 0, blockChance: 0 }, ownership: { heroLevel: 1, skills: {}, runes: {}, passives: {} }, loadout: { skills: [], passives: [] } };
const enemy = { ...fighter, stats: { ...fighter.stats, hp: 10, maxHp: 10, attack: 1 } };
const rules = { stepMs: 10, maxDurationMs: 10000, approachMs: 20, attackIntervalMs: 200, basicWindupMs: 20, basicMultiplier: 1, defenseFactor: 0.5, magicDefenseFactor: 0.2, minimumDamage: 1, critMultiplier: 2, blockMultiplier: 0, maxEnergy: 100, initialEnergy: 100, energyPerSecond: 0, modeDamageMultiplier: { pve: 1, boss: 1, pvp: 1 } };
const save = { player: { gold: 50, gems:9, xp: 90, level: 1, xpToNext: 100, maxEnergy: 20, stats: { hp: 100, maxHp: 100, attack: 20, defense: 5,critChance:5,critDamage:50 }, equipped: { weapon: { id:'old', name:'Меч воина',slot:'weapon',rarity:'common',level:1,attack:8 } } }, inventory: [{ id: 'old',name:'Potion',qty:1 }],belt:[],battleStones:10,inventoryCleanupVersion:1, vip: 7, redGems: 45, achievements: [{ id: 'old' }] };

// Refuse to reuse any database that already contains application data.
assert.equal(await sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')"), '0', 'test database must be empty');
await sql(`DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
 END $$;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.test_uid',true),'')::uuid $$;
 CREATE TABLE public.players(id uuid PRIMARY KEY,banned boolean DEFAULT false,game_state jsonb,gold integer,gems integer,xp integer,level integer,max_energy integer,attack integer,defense integer,max_hp integer,crit_chance integer,updated_at timestamptz DEFAULT clock_timestamp());
 GRANT SELECT,UPDATE ON public.players TO service_role;
 INSERT INTO public.players(id,game_state,gold,gems,xp,level,max_energy) VALUES
 (${quote(player)},${json(save)},50,9,90,1,20),(${quote(loser)},${json(save)},50,9,90,1,20);`);
// These are real V1 function/trigger sources, with only the historical file's
// missing dollar terminators normalized as in check-admin-gear-relevel-v4.mjs.
await file('supabase/migrations/20261017_equipment_guard_v4.sql');
await sql('CREATE SCHEMA IF NOT EXISTS territory_private');
const historical=(await readFile('supabase/migrations/20261018_permanent_gear_level_rule.sql','utf8')).replaceAll(/^\$function\$$/gm,'$function$;');
const fixedPath=join(tmpdir(),'territory-adventure-level-guard-ci.sql');
await writeFile(fixedPath,historical); try { await file(fixedPath); } finally { await unlink(fixedPath); }
for (const path of ['supabase/migrations/20261022_owner_test_equipment_levels.sql','supabase/migrations/20261022_owner_test_gear_stats_receipt_v3.sql','supabase/staged/20261027_owner_test_gear_relevel_v4.sql']) await file(path);
const ownerFix=await readFile('supabase/staged/20261029_owner_gear_authority_forge_fix.sql','utf8');
const ownerBegin=ownerFix.indexOf('CREATE OR REPLACE FUNCTION territory_private.owner_cap_item_v1('),ownerEnd=ownerFix.indexOf('$owner_gear$;',ownerBegin)+'$owner_gear$;'.length;
assert.ok(ownerBegin>=0 && ownerEnd>ownerBegin); const ownerPath=join(tmpdir(),'territory-adventure-owner-guard-ci.sql');
await writeFile(ownerPath,ownerFix.slice(ownerBegin,ownerEnd)); try { await file(ownerPath); } finally { await unlink(ownerPath); }
for (const path of ['supabase/migrations/20261017_inventory_cleanup_prepare.sql','supabase/production/territory_economy_guard_20261015.sql','supabase/migrations/20261018_hero_level_cap_100.sql']) await file(path);
await sql('UPDATE public.players SET game_state=game_state');
const normalizedSave=await scalar(`SELECT game_state FROM public.players WHERE id=${quote(player)}`);
assert.equal((await scalar(`SELECT row_to_json(p) FROM public.players p WHERE id=${quote(player)}`)).attack,28);
for (const path of ['supabase/staged/territory_v1_combat_completion.sql', 'supabase/staged/territory_v1_adventure_settlement.sql', 'supabase/staged/territory_v1_combat_profiles_reconciliation.sql']) await file(path);
assert.deepEqual(await scalar(`SELECT game_state FROM public.players WHERE id=${quote(player)}`), normalizedSave, 'installation leaves the old save untouched');
await sql(`INSERT INTO territory_private.combat_profile_attestations_v1(player_id,source_game_state,source_player_level,fighter,equipped_item_ids,evidence_reference,reviewed_by)
 VALUES (${quote(player)},${json(normalizedSave)},1,${json(fighter)},'{}','synthetic evidence','test reviewer'),
 (${quote(loser)},${json(normalizedSave)},1,${json(fighter)},'{}','synthetic evidence','test reviewer');`);
const prepared = await scalar(`SET ROLE service_role; SELECT public.territory_combat_prepare_profile_v1(${quote(player)})`);
assert.equal(prepared.status, 'ready');
assert.equal((await scalar(`SET ROLE service_role; SELECT public.territory_combat_prepare_profile_v1(${quote(loser)})`)).status, 'ready');
await sql(`INSERT INTO territory_private.combat_encounters_v1(encounter_id,mode,stage,enemy,enabled,approval_reference)
 VALUES ('s1','pve',1,${json(enemy)},true,'synthetic'),('s2','pve',2,${json(enemy)},true,'synthetic');
 INSERT INTO territory_private.adventure_rewards_v1(stage,encounter_id,enabled,gold,xp,approval_reference)
 VALUES (1,'s1',true,15,20,'synthetic'),(2,'s2',true,15,20,'synthetic');
 UPDATE territory_private.combat_config_v1 SET catalog=${json({skills:[],runes:[],passives:[]})},rules=${json(rules)},enabled=true,settlement_ready=true,approval_reference='synthetic';`);
const built = await build({ entryPoints: ['src/game/combatV1/service.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { executeCombatCommand } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const invocation = (name, args) => `public.${name}(${args.map((x, i) => i === 0 ? `${quote(x)}::uuid` : json(x)).join(',')})`;
const repo = {
  async context(p, c) { return scalar(`SET ROLE service_role; SELECT ${invocation('territory_combat_context_v1', [p,c])}`); },
  async commit(p, c, x, r) { return scalar(`SET ROLE service_role; SELECT ${invocation('territory_combat_commit_v1', [p,c,x,r])}`); },
};
const execute = (p,c,repository=repo) => executeCombatCommand(repository,p,c,() => 12);
await assert.rejects(execute(player,{action:'start',operationId:op(1),encounterId:'s2',control:'auto'}), /adventure_stage_locked/);
const start = await execute(player,{action:'start',operationId:op(2),encounterId:'s1',control:'auto'});
await sql(`UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-1000 WHERE session_id=${quote(start.session_id)};
 UPDATE territory_private.adventure_rewards_v1 SET items='[{"id":"unapproved"}]' WHERE stage=1;`);
const cmd = {action:'advance',operationId:op(3),sessionId:start.session_id,revision:0};
await assert.rejects(execute(player,cmd), /adventure_reward_not_ready/);
assert.equal(await sql(`SELECT revision FROM territory_private.combat_sessions_v1 WHERE session_id=${quote(start.session_id)}`), '0', 'failed settlement rolls back the terminal combat update');
await sql("UPDATE territory_private.adventure_rewards_v1 SET items='[]' WHERE stage=1");

// Compute both moves from the same authoritative revision, then run commits on
// two simultaneous psql connections. The first holds the player row long enough
// to observe the second blocked on a PostgreSQL lock.
const contextA = await repo.context(player,cmd);
const cmdB = {...cmd,operationId:op(4)};
const contextB = await repo.context(player,cmdB);
let releaseA;
const firstHasLock = new Promise(resolve => { releaseA=resolve; });
async function waitFor(query) {
  for (let n=0;n<100;n++) {
    if (await sql(query) === '1') return;
    await new Promise(resolve => setTimeout(resolve,50));
  }
  throw new Error('concurrent PostgreSQL sessions did not reach expected state');
}
const concurrentRepo = {
  async context(_p,c) { return c.operationId===cmd.operationId ? contextA : contextB; },
  async commit(p,c,x,r) {
    const call = invocation('territory_combat_commit_v1',[p,c,x,r]);
    if (c.operationId===cmd.operationId) {
      const pending = sql(`BEGIN; SET LOCAL ROLE service_role; DO $$ BEGIN PERFORM 1 FROM public.players WHERE id=${quote(p)} FOR UPDATE; PERFORM pg_sleep(8); END $$; SELECT ${call}; COMMIT`, 'adventure-lock-holder');
      await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='adventure-lock-holder' AND wait_event='PgSleep'");
      releaseA();
      return JSON.parse(await pending);
    }
    await firstHasLock;
    const pending = sql(`BEGIN; SET LOCAL ROLE service_role; SELECT ${call}; COMMIT`, 'adventure-lock-waiter');
    await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='adventure-lock-waiter' AND wait_event_type='Lock'");
    return JSON.parse(await pending);
  },
};
const attempts=await Promise.allSettled([execute(player,cmd,concurrentRepo),execute(player,cmdB,concurrentRepo)]);
assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
assert.match(String(attempts.find(x=>x.status==='rejected').reason),/combat_revision_conflict/);
const won=attempts.find(x=>x.status==='fulfilled').value;
assert.equal(won.state.status,'hero_won'); assert.equal(won.settlement.reward.gold,15); assert.equal(won.settlement.reward.xp,20);
assert.equal(won.settlement.unlocked_stage,2);
assert.deepEqual(await execute(player,cmd),won, 'retry must return the committed receipt');
assert.deepEqual((await execute(player,{action:'resume',sessionId:start.session_id})).settlement,won.settlement);
const row=await scalar(`SELECT row_to_json(p) FROM public.players p WHERE id=${quote(player)}`);
assert.equal(row.gold,65); assert.equal(row.xp,10); assert.equal(row.level,2);
assert.deepEqual(row.game_state.inventory,normalizedSave.inventory); assert.deepEqual(row.game_state.player.equipped,normalizedSave.player.equipped);
assert.deepEqual([row.attack,row.defense,row.max_hp,row.crit_chance],[33,7,120,5]);
assert.equal(await sql(`SELECT count(*) FROM public.territory_economy_audit_v1 WHERE player_id=${quote(player)}`),'1');
const stale = structuredClone(row.game_state); delete stale.inventoryCleanupVersion;
await assert.rejects(sql(`UPDATE public.players SET game_state=${json(stale)} WHERE id=${quote(player)}`), /territory_stale_inventory_cleanup_snapshot/);
const mismatch = structuredClone(row.game_state); mismatch.player.gold++;
await assert.rejects(sql(`UPDATE public.players SET game_state=${json(mismatch)} WHERE id=${quote(player)}`), /territory_wallet_snapshot_mismatch/);
assert.equal(row.game_state.vip,7); assert.equal(row.game_state.redGems,45); assert.deepEqual(row.game_state.achievements,save.achievements);
assert.equal(await sql(`SELECT count(*) FROM territory_private.adventure_settlements_v1 WHERE session_id=${quote(start.session_id)}`),'1');
const progress=await scalar(`SET ROLE authenticated; SELECT set_config('request.test_uid',${quote(player)},false); SELECT public.territory_adventure_progress_v1()` .replace(`SELECT set_config('request.test_uid',${quote(player)},false);`, `SET request.test_uid=${quote(player)};`));
assert.deepEqual(progress,{completed_stage:1,unlocked_stage:2});
// The second synthetic player loses a genuine engine fight; no win reward is paid.
const strongEnemy={...fighter,stats:{...fighter.stats,attack:1000}};
await sql(`UPDATE territory_private.combat_encounters_v1 SET enemy=${json(strongEnemy)} WHERE encounter_id='s1'`);
const weak={...fighter,stats:{...fighter.stats,hp:1,maxHp:1,attack:1}};
await sql(`UPDATE territory_private.combat_profile_attestations_v1 SET fighter=${json(weak)} WHERE player_id=${quote(loser)};
 UPDATE territory_private.combat_profiles_v1 SET fighter=${json(weak)} WHERE player_id=${quote(loser)};`);
const lostStart=await execute(loser,{action:'start',operationId:op(5),encounterId:'s1',control:'auto'});
await sql(`UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-1000 WHERE session_id=${quote(lostStart.session_id)}`);
const lost=await execute(loser,{action:'advance',operationId:op(6),sessionId:lostStart.session_id,revision:0});
assert.equal(lost.state.status,'enemy_won'); assert.equal(lost.settlement.reward.gold,0); assert.equal(lost.settlement.reward.xp,0);
assert.deepEqual(await scalar(`SELECT game_state FROM public.players WHERE id=${quote(loser)}`),normalizedSave);
console.log('PostgreSQL 17 with actual V1 economy, gear and inventory guards PASS: reviewed synthetic profile, locked stages, engine victory/loss, rollback and retry, durable receipts, preserved save and real concurrent lock contention.');
