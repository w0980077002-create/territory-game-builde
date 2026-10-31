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
const observer = '10000000-0000-4000-8000-000000000003';
const op = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fighter = { stats: { hp: 1000, maxHp: 1000, attack: 100, defense: 4, critChance: 0, dodgeChance: 0, blockChance: 0 }, ownership: { heroLevel: 1, skills: {}, runes: {}, passives: {} }, loadout: { skills: [], passives: [] } };
const weak={...fighter,stats:{...fighter.stats,hp:1,maxHp:1,attack:1}};
const enemy = { ...fighter, stats: { ...fighter.stats, hp: 10, maxHp: 10, attack: 1 } };
const rules = { stepMs: 10, maxDurationMs: 10000, approachMs: 20, attackIntervalMs: 200, basicWindupMs: 20, basicMultiplier: 1, defenseFactor: 0.5, magicDefenseFactor: 0.2, minimumDamage: 1, critMultiplier: 2, blockMultiplier: 0, maxEnergy: 100, initialEnergy: 100, energyPerSecond: 0, modeDamageMultiplier: { pve: 1, boss: 1, pvp: 1 } };
const save = { player: { gold: 50, gems:9, xp: 90, level: 1, xpToNext: 100, maxEnergy: 20, stats: { hp: 100, maxHp: 100, attack: 20, defense: 5,critChance:5,critDamage:50 }, equipped: { weapon: { id:'old', name:'Меч воина',slot:'weapon',rarity:'common',level:1,attack:8 } } }, inventory: [{ id: 'old',name:'Potion',qty:1 }],belt:[],battleStones:0,inventoryCleanupVersion:1, vip: 7, redGems: 45, achievements: [{ id: 'old' }] };

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
 (${quote(player)},${json(save)},50,9,90,1,20),(${quote(loser)},${json(save)},50,9,90,1,20),(${quote(observer)},${json(save)},50,9,90,1,20);`);
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
// Synthetic supporting tables and relevant players fields; function/trigger
// bodies below are exact read-only captures, not stubs or player records.
await sql(`ALTER TABLE public.players
 ADD COLUMN telegram_id bigint UNIQUE, ADD COLUMN username text, ADD COLUMN photo_url text,
 ADD COLUMN display_name text NOT NULL DEFAULT 'Герой', ADD COLUMN energy integer NOT NULL DEFAULT 20,
 ADD COLUMN current_chapter integer NOT NULL DEFAULT 1, ADD COLUMN chapter_wins integer NOT NULL DEFAULT 0,
 ADD COLUMN total_battles_won integer NOT NULL DEFAULT 0, ADD COLUMN total_bosses_defeated integer NOT NULL DEFAULT 0,
 ADD COLUMN arena_wins integer NOT NULL DEFAULT 0, ADD COLUMN arena_losses integer NOT NULL DEFAULT 0,
 ADD COLUMN arena_rating integer NOT NULL DEFAULT 1000, ADD COLUMN forge_materials integer NOT NULL DEFAULT 0,
 ADD COLUMN vip_level integer NOT NULL DEFAULT 0 CHECK(vip_level BETWEEN 0 AND 10),
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN last_seen_at timestamptz;
 CREATE TABLE public.leaderboard(player_id uuid PRIMARY KEY,display_name text NOT NULL,level integer NOT NULL,
 arena_rating integer NOT NULL,total_battles_won integer NOT NULL,arena_wins integer NOT NULL,photo_url text,
 attack integer NOT NULL,defense integer NOT NULL,max_hp integer NOT NULL,crit_chance integer NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE territory_private.referral_invites_v1(invited_id uuid PRIMARY KEY,inviter_id uuid NOT NULL,qualified_at timestamptz);
 CREATE TABLE territory_private.referral_activity_v2(player_id uuid PRIMARY KEY,credited_wins integer NOT NULL DEFAULT 0,
 credited_xp integer NOT NULL DEFAULT 0,stage_wins integer NOT NULL DEFAULT 0,boss_wins integer NOT NULL DEFAULT 0);
 CREATE TABLE territory_private.referral_chests_v1(invited_id uuid PRIMARY KEY,inviter_id uuid NOT NULL);
 ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
 CREATE POLICY insert_own_player ON public.players FOR INSERT TO authenticated WITH CHECK(auth.uid()=id);
 CREATE POLICY select_own_player ON public.players FOR SELECT TO authenticated USING(auth.uid()=id);
 CREATE POLICY update_own_player ON public.players FOR UPDATE TO authenticated USING(auth.uid()=id AND banned=false) WITH CHECK(auth.uid()=id AND banned=false);
 GRANT USAGE ON SCHEMA auth TO authenticated;
 GRANT SELECT ON public.players TO authenticated,anon;
 GRANT INSERT(id,username,photo_url,display_name,level,xp,gold,gems,energy,max_energy,current_chapter,chapter_wins,total_battles_won,total_bosses_defeated,forge_materials,updated_at,game_state,attack,defense,max_hp,crit_chance) ON public.players TO authenticated;
 GRANT UPDATE(username,photo_url,display_name,level,xp,gold,gems,energy,max_energy,current_chapter,chapter_wins,total_battles_won,total_bosses_defeated,forge_materials,updated_at,game_state,attack,defense,max_hp,crit_chance) ON public.players TO authenticated;
 INSERT INTO territory_private.referral_invites_v1(invited_id,inviter_id) VALUES(${quote(player)},${quote(loser)});
 INSERT INTO territory_private.referral_activity_v2(player_id) VALUES(${quote(player)});`);
await file('scripts/fixtures/c1-live-players-triggers.sql');
const expectedTriggerHashes={territory_economy_audit_after_v1:'7ba019abd3d7e1d4c30811abaaa825db',territory_economy_guard_before_v1:'a67b564acce6e099c8d09bdef8bcc70d',territory_gear_guard_before_v4:'fafdd6235b112b4c43ef43cde73dcd47',territory_inventory_cleanup_guard_v1:'079cd4c81b08fff3e13f30c1616d0b66',territory_referral_after_save_v2:'f8842b0c043987c62f38687535d109ad',trigger_update_leaderboard:'736feaa5c704063f07d5ec1a461f1856'};
assert.deepEqual(await scalar(`SELECT jsonb_object_agg(t.tgname,md5(pg_get_functiondef(t.tgfoid))) FROM pg_trigger t WHERE t.tgrelid='public.players'::regclass AND NOT t.tgisinternal`),expectedTriggerHashes);
const expectedDependencyHashes={'public.territory_gear_recompute_columns_v4':'8b4ecef423454093058fd66c6fe1c07f','public.territory_normalize_state_v4':'9d3331adb8aa70786d1d670d56ef08c3','territory_private.owner_cap_item_v1':'998d1214fec14053b9bc9e20122c80e1','territory_private.owner_cap_state_v1':'0622c5331be3ca3b43479a79c0ab8e01','territory_private.referral_try_qualify_v2':'a2d115a0e708a8454f984e80c093f636'};
assert.deepEqual(await scalar(`SELECT jsonb_object_agg(n.nspname||'.'||p.proname,md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='territory_private' AND p.proname IN ('owner_cap_item_v1','owner_cap_state_v1','referral_try_qualify_v2')) OR (n.nspname='public' AND p.proname IN ('territory_normalize_state_v4','territory_gear_recompute_columns_v4'))`),expectedDependencyHashes);
assert.equal(await sql(`SET ROLE authenticated; SET request.test_uid=${quote(player)}; SELECT count(*) FROM public.players`),'1','owner RLS hides other player');
assert.equal(await sql(`SET ROLE authenticated; SET request.test_uid=${quote(loser)}; SELECT count(*) FROM public.players WHERE id=${quote(player)}`),'0','cannot read another player');
await sql('UPDATE public.players SET game_state=game_state');
const normalizedSave=await scalar(`SELECT game_state FROM public.players WHERE id=${quote(player)}`);
assert.equal((await scalar(`SELECT row_to_json(p) FROM public.players p WHERE id=${quote(player)}`)).attack,28);
for (const path of ['supabase/staged/territory_v1_combat_completion.sql', 'supabase/staged/territory_v1_adventure_settlement.sql', 'supabase/staged/territory_v1_combat_profiles_reconciliation.sql', 'supabase/staged/territory_dark_stones_20261030.sql']) await file(path);
await sql(`DROP TABLE territory_private.cave_canary_v1; ALTER TABLE territory_private.combat_config_v1 DROP COLUMN starts_enabled, DROP COLUMN canary_only;`);
await file('scripts/fixtures/c1-live-function-baseline.sql');
await file('supabase/staged/territory_c1_live_guarded_patch_DRAFT_20261031.sql');
await sql(`INSERT INTO territory_private.cave_canary_v1 VALUES(${quote(player)},'synthetic player'),(${quote(loser)},'synthetic loser'); UPDATE territory_private.combat_config_v1 SET starts_enabled=true,canary_only=true WHERE id`);
assert.deepEqual(await scalar(`SELECT game_state FROM public.players WHERE id=${quote(player)}`), normalizedSave, 'installation leaves the old save untouched');
const observerBefore=await scalar(`SELECT row_to_json(p) FROM public.players p WHERE id=${quote(observer)}`);
await sql(`INSERT INTO territory_private.combat_profile_attestations_v1(player_id,source_game_state,source_player_level,fighter,equipped_item_ids,legacy_equipped_ids,evidence_reference,reviewed_by)
 VALUES (${quote(player)},${json(normalizedSave)},1,${json(fighter)},'{}',ARRAY['old']::text[],'synthetic evidence','test reviewer'),
 (${quote(loser)},${json(normalizedSave)},1,${json(weak)},'{}',ARRAY['old']::text[],'synthetic evidence','test reviewer');`);
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
const startCmd={action:'start',operationId:op(2),encounterId:'s1',control:'auto'};
const [start,startReplay]=await Promise.all([execute(player,startCmd),execute(player,startCmd)]);
assert.deepEqual(start,startReplay,'two connections share a single start receipt');
assert.equal(start.start_save.battle_stones,0);
assert.equal(await sql(`SELECT balance FROM territory_private.dark_stones_v1 WHERE player_id=${quote(player)}`),'4');
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
assert.equal(await sql(`SELECT count(*) FROM public.territory_economy_audit_v1 WHERE player_id=${quote(player)}`),'1',
 'players wallet audit records only settlement; Cave debit is in the Dark Stone ledger');
const stale = structuredClone(row.game_state); delete stale.inventoryCleanupVersion;
await assert.rejects(sql(`UPDATE public.players SET game_state=${json(stale)} WHERE id=${quote(player)}`), /territory_stale_inventory_cleanup_snapshot/);
const mismatch = structuredClone(row.game_state); mismatch.player.gold++;
await assert.rejects(sql(`UPDATE public.players SET game_state=${json(mismatch)} WHERE id=${quote(player)}`), /territory_wallet_snapshot_mismatch/);
assert.equal(row.game_state.vip,7); assert.equal(row.game_state.redGems,45); assert.deepEqual(row.game_state.achievements,save.achievements);
assert.equal(await sql(`SELECT count(*) FROM territory_private.adventure_settlements_v1 WHERE session_id=${quote(start.session_id)}`),'1');
const progress=await scalar(`SET ROLE authenticated; SELECT set_config('request.test_uid',${quote(player)},false); SELECT public.territory_adventure_progress_v1()` .replace(`SELECT set_config('request.test_uid',${quote(player)},false);`, `SET request.test_uid=${quote(player)};`));
assert.deepEqual(progress,{completed_stage:1,unlocked_stage:2,dark_stones:4,active_session_id:null});
// The second synthetic player loses a genuine engine fight; no win reward is paid.
const strongEnemy={...fighter,stats:{...fighter.stats,attack:1000}};
await sql(`UPDATE territory_private.combat_encounters_v1 SET enemy=${json(strongEnemy)} WHERE encounter_id='s1'`);
const lostStart=await execute(loser,{action:'start',operationId:op(5),encounterId:'s1',control:'auto'});
await file('supabase/staged/territory_c1_pause_new_starts_DRAFT_20261031.sql');
assert.equal((await execute(loser,{action:'resume',sessionId:lostStart.session_id})).state.status,'fighting');
await assert.rejects(execute(player,{action:'start',operationId:op(30),encounterId:'s2',control:'auto'}),/combat_starts_paused/);
await assert.rejects(file('supabase/staged/territory_c1_restore_functions_DRAFT_20261031.sql'),/requires drained sessions/);
await sql(`UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-1000 WHERE session_id=${quote(lostStart.session_id)}`);
const lost=await execute(loser,{action:'advance',operationId:op(6),sessionId:lostStart.session_id,revision:0});
assert.equal(lost.state.status,'enemy_won'); assert.equal(lost.settlement.reward.gold,0); assert.equal(lost.settlement.reward.xp,0);
assert.deepEqual(await scalar(`SELECT game_state FROM public.players WHERE id=${quote(loser)}`),normalizedSave,'defeat preserves ordinary battle stones and all other save fields');
assert.equal(await sql(`SELECT count(*) FROM territory_private.referral_invites_v1 WHERE invited_id=${quote(player)} AND qualified_at IS NULL`),'1');
assert.equal(await sql(`SELECT count(*) FROM territory_private.referral_chests_v1`),'0');
const board=await scalar(`SELECT row_to_json(l) FROM public.leaderboard l WHERE player_id=${quote(player)}`);
assert.equal(board.level,2); assert.equal(board.attack,33);
assert.deepEqual(await scalar(`SELECT row_to_json(p) FROM public.players p WHERE id=${quote(observer)}`),observerBefore,'unrelated player remains unchanged');
const snapshotSql="SELECT jsonb_build_object('players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.players p),'wallets',(SELECT jsonb_agg(to_jsonb(w) ORDER BY player_id) FROM territory_private.dark_stones_v1 w),'receipts',(SELECT count(*) FROM territory_private.adventure_settlements_v1),'operations',(SELECT count(*) FROM territory_private.combat_operations_v1))";
const playerRowsBefore=await scalar(snapshotSql);
await file('supabase/staged/territory_c1_restore_functions_DRAFT_20261031.sql');
assert.deepEqual(await scalar(snapshotSql),playerRowsBefore,'phase B must not alter player assets, dark wallets or receipts');
assert.deepEqual(await execute(player,cmd),won,'receipt replay survives rollback');
console.log('PostgreSQL 17 with actual V1 economy, gear and inventory guards PASS: reviewed synthetic profile, locked stages, engine victory/loss, rollback and retry, durable receipts, preserved save and real concurrent lock contention.');
