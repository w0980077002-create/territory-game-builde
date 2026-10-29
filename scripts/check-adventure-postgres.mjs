/** Destructive fixture for a disposable PostgreSQL database. Never point at production. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const connection = process.env.ADVENTURE_TEST_DATABASE_URL;
const target = connection ? new URL(connection) : null;
if (!target || !['postgres:', 'postgresql:'].includes(target.protocol)
  || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
  || target.pathname !== '/territory_adventure_ci' || target.search || target.hash) {
  throw new Error('ADVENTURE_TEST_DATABASE_URL must identify local disposable territory_adventure_ci');
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
const noLevel = '10000000-0000-4000-8000-000000000003';
const op = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fighter = { stats: { hp: 1000, maxHp: 1000, attack: 100, defense: 4, critChance: 0, dodgeChance: 0, blockChance: 0 }, ownership: { heroLevel: 1, skills: {}, runes: {}, passives: {} }, loadout: { skills: [], passives: [] } };
const weak = { ...fighter, stats: { ...fighter.stats, hp: 1, maxHp: 1, attack: 1 } };
const enemy = { ...fighter, stats: { ...fighter.stats, hp: 10, maxHp: 10, attack: 1 } };
const rules = { stepMs: 10, maxDurationMs: 10000, approachMs: 20, attackIntervalMs: 200, basicWindupMs: 20, basicMultiplier: 1, defenseFactor: 0.5, magicDefenseFactor: 0.2, minimumDamage: 1, critMultiplier: 2, blockMultiplier: 0, maxEnergy: 100, initialEnergy: 100, energyPerSecond: 0, modeDamageMultiplier: { pve: 1, boss: 1, pvp: 1 } };
const save = { player: { gold: 50, xp: 90, level: 1, xpToNext: 100, maxEnergy: 20, stats: { hp: 100, maxHp: 100, attack: 20, defense: 5 }, equipped: { weapon: { id: 'old' } } }, inventory: [{ id: 'old' }], battleStones: 10, vip: 7, redGems: 45, achievements: [{ id: 'old' }] };
const noLevelSave = structuredClone(save); noLevelSave.player.xp = 0;

// Refuse to reuse any database that already contains application data.
assert.equal(await sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')"), '0', 'test database must be empty');
await sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.test_uid',true),'')::uuid $$;
 CREATE TABLE public.players(id uuid PRIMARY KEY,banned boolean DEFAULT false,game_state jsonb,gold integer,gems integer,xp integer,level integer,max_energy integer,updated_at timestamptz DEFAULT clock_timestamp());
 CREATE FUNCTION public.test_touch_player() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;
 CREATE TRIGGER test_player_timestamp BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.test_touch_player();
 GRANT SELECT,UPDATE ON public.players TO service_role;
 INSERT INTO public.players(id,game_state,gold,gems,xp,level,max_energy) VALUES
 (${quote(player)},${json(save)},50,9,90,1,20),(${quote(loser)},${json(save)},50,9,90,1,20),
 (${quote(noLevel)},${json(noLevelSave)},50,9,0,1,20);`);
for (const path of ['supabase/staged/territory_v1_combat_completion.sql', 'supabase/staged/territory_v1_adventure_settlement.sql', 'supabase/staged/territory_v1_combat_profiles_reconciliation.sql']) await file(path);
assert.deepEqual(await scalar(`SELECT game_state FROM public.players WHERE id=${quote(player)}`), save, 'installation leaves the old save untouched');
await sql(`INSERT INTO territory_private.combat_profile_attestations_v1(player_id,source_game_state,source_player_level,fighter,equipped_item_ids,evidence_reference,reviewed_by)
 VALUES (${quote(player)},${json(save)},1,${json(fighter)},'{}','synthetic evidence','test reviewer'),
 (${quote(loser)},${json(save)},1,${json(weak)},'{}','synthetic evidence','test reviewer'),
 (${quote(noLevel)},${json(noLevelSave)},1,${json(fighter)},'{}','synthetic evidence','test reviewer');`);
const prepared = await scalar(`SET ROLE service_role; SELECT public.territory_combat_prepare_profile_v1(${quote(player)})`);
assert.equal(prepared.status, 'ready');
assert.equal((await scalar(`SET ROLE service_role; SELECT public.territory_combat_prepare_profile_v1(${quote(loser)})`)).status, 'ready');
assert.equal((await scalar(`SET ROLE service_role; SELECT public.territory_combat_prepare_profile_v1(${quote(noLevel)})`)).status, 'ready');
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
assert.equal(start.start_save.battle_stones,9);
assert.equal((await scalar(`SELECT game_state FROM public.players WHERE id=${quote(player)}`)).battleStones,9);
assert.deepEqual(await execute(player,{action:'start',operationId:op(2),encounterId:'s1',control:'auto'}),start);
await assert.rejects(execute(player,{action:'start',operationId:op(12),encounterId:'s1',control:'auto'}),/combat_active_session_exists/);
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
assert.deepEqual(row.game_state.inventory,save.inventory); assert.deepEqual(row.game_state.player.equipped,save.player.equipped);
assert.equal(row.game_state.vip,7); assert.equal(row.game_state.redGems,45); assert.deepEqual(row.game_state.achievements,save.achievements);
assert.equal(await sql(`SELECT count(*) FROM territory_private.adventure_settlements_v1 WHERE session_id=${quote(start.session_id)}`),'1');
const progress=await scalar(`SET ROLE authenticated; SELECT set_config('request.test_uid',${quote(player)},false); SELECT public.territory_adventure_progress_v1()` .replace(`SELECT set_config('request.test_uid',${quote(player)},false);`, `SET request.test_uid=${quote(player)};`));
assert.deepEqual(progress,{completed_stage:1,unlocked_stage:2});
const next=await execute(player,{action:'start',operationId:op(7),encounterId:'s2',control:'auto'});
assert.equal(next.state.input.stage,2,'next stage starts immediately after level-up');
const profile=await scalar(`SELECT fighter FROM territory_private.combat_profiles_v1 WHERE player_id=${quote(player)}`);
assert.equal(profile.ownership.heroLevel,2); assert.equal(profile.stats.attack,105); assert.equal(profile.stats.maxHp,1020);
const noLevelStart=await execute(noLevel,{action:'start',operationId:op(8),encounterId:'s1',control:'auto'});
await sql(`UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-1000 WHERE session_id=${quote(noLevelStart.session_id)}`);
const noLevelWin=await execute(noLevel,{action:'advance',operationId:op(9),sessionId:noLevelStart.session_id,revision:0});
assert.equal(noLevelWin.settlement.game_state.player.level,1);
const noLevelNext=await execute(noLevel,{action:'start',operationId:op(10),encounterId:'s2',control:'auto'});
assert.equal(noLevelNext.state.input.stage,2,'next stage starts immediately without level-up');
await sql(`UPDATE public.players SET game_state=jsonb_set(game_state,'{player,equipped,weapon,id}','"tampered"') WHERE id=${quote(noLevel)};
 UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-1000 WHERE session_id=${quote(noLevelNext.session_id)}`);
await assert.rejects(execute(noLevel,{action:'advance',operationId:op(11),sessionId:noLevelNext.session_id,revision:0}),/combat_profile_needs_reconciliation/);
assert.equal(await sql(`SELECT revision FROM territory_private.combat_sessions_v1 WHERE session_id=${quote(noLevelNext.session_id)}`),'0');
// The second synthetic player loses a genuine engine fight; no win reward is paid.
const strongEnemy={...fighter,stats:{...fighter.stats,attack:1000}};
await sql(`UPDATE territory_private.combat_encounters_v1 SET enemy=${json(strongEnemy)} WHERE encounter_id='s1'`);
const lostStart=await execute(loser,{action:'start',operationId:op(5),encounterId:'s1',control:'auto'});
await sql(`UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-1000 WHERE session_id=${quote(lostStart.session_id)}`);
const lost=await execute(loser,{action:'advance',operationId:op(6),sessionId:lostStart.session_id,revision:0});
assert.equal(lost.state.status,'enemy_won'); assert.equal(lost.settlement.reward.gold,0); assert.equal(lost.settlement.reward.xp,0);
assert.deepEqual(await scalar(`SELECT game_state FROM public.players WHERE id=${quote(loser)}`),{...save,battleStones:9},'a defeat consumes one entry stone but awards no gold or XP');
console.log('PostgreSQL 17 PASS: reviewed synthetic profile, locked stages, engine victory/loss, rollback and retry, durable receipts, preserved save and real concurrent lock contention.');
