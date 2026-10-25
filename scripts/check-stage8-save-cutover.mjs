/**
 * Ephemeral PostgreSQL integration test. Never touches live Supabase.
 * This intentionally does NOT claim full economic anti-cheat: PvE/quests
 * still need server-authoritative handlers before the preflight turns green.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const sql=await readFile(new URL('../supabase/staged/territory_stage8_save_cutover.sql',import.meta.url),'utf8');
const db=new PGlite();
const alice='11111111-1111-4111-8111-111111111111';
const bob='22222222-2222-4222-8222-222222222222';
const op1='33333333-3333-4333-8333-333333333333';
const op2='44444444-4444-4444-8444-444444444444';
const op3='55555555-5555-4555-8555-555555555555';
const gameState={player:{gold:123,gems:45,level:9,xp:700,inventory:[]},
  inventory:[{id:'equipped-sword',qty:1}],professions:{active:'smith',masteryLevel:6,masteryXp:45},
  battleStones:20,settings:{speed:1,auto:false},appearance:'m2'};
const before=JSON.stringify(gameState);
const setup=`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('test.uid',true),'')::uuid $$;
CREATE TABLE public.players(
  id uuid PRIMARY KEY,
  banned boolean NOT NULL DEFAULT false,
  gold integer NOT NULL, gems integer NOT NULL,
  level integer NOT NULL, xp integer NOT NULL,
  forge_materials integer NOT NULL DEFAULT 0,
  game_state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
CREATE POLICY only_own_player ON public.players FOR SELECT TO authenticated
  USING(id=auth.uid());
GRANT SELECT ON public.players TO authenticated;
CREATE TABLE public.territory_resource_wallet(
  player_id uuid NOT NULL REFERENCES public.players(id),
  resource_id text NOT NULL,quantity bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(player_id,resource_id));
CREATE FUNCTION public.territory_profession_unlock(text)
RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
GRANT EXECUTE ON FUNCTION public.territory_profession_unlock(text) TO authenticated;
GRANT UPDATE(gold,gems,level,xp,forge_materials,game_state,updated_at)
  ON public.players TO authenticated;
`;
const rows=async(query,params=[]) => (await db.query(query,params)).rows;
const one=async(query,params=[]) => (await rows(query,params))[0];
const role=async(name) => {await db.exec('RESET ROLE');if(name)await db.exec(`SET ROLE ${name}`);};
const user=async(id) => {await role();await db.query("SELECT set_config('test.uid',$1::text,false)",[id]);await role('authenticated');};
const save=async(revision,operation,speed,auto,appearance) =>
  (await one('SELECT public.territory_stage8_cosmetic_save($1::timestamptz,$2::uuid,$3::int,$4::boolean,$5::text) AS result',
    [revision,operation,speed,auto,appearance])).result;
const deny=(fn,pattern)=>assert.rejects(fn(),pattern);
try{
  await db.exec(setup);
  await db.query('INSERT INTO public.players(id,gold,gems,level,xp,game_state) VALUES($1,123,45,9,700,$2::jsonb),($3,45,6,2,7,$4::jsonb)',
    [alice,before,bob,before]);
  const snapshot=await rows('SELECT id,gold,gems,level,xp,game_state FROM public.players ORDER BY id');
  await db.exec(sql);
  assert.deepEqual(await rows('SELECT id,gold,gems,level,xp,game_state FROM public.players ORDER BY id'),snapshot,
    'Installing a staged save bridge cannot rewrite active player data');
  await role('service_role');
  const preflight=(await one('SELECT public.territory_stage8_save_cutover_preflight() AS result')).result;
  assert.equal(preflight.ready,false,'The existing direct-save economy is UNSAFE');
  assert.ok(preflight.blockers.includes('authenticated_direct_gems_update'));
  assert.ok(preflight.blockers.includes('authenticated_direct_game_state_update'));
  assert.ok(preflight.blockers.includes('authenticated_old_profession_rpc'));
  assert.ok(preflight.blockers.includes('server_pve_reward_missing'));
  assert.ok(preflight.blockers.includes('independent_economy_cutover_review_required'),
    'A matching function name can never certify real-world economy integrity');
  await user(alice);
  await deny(()=>rows('SELECT public.territory_stage8_save_cutover_preflight()'),
    /permission denied/i,'Private rollout information is not exposed to browsers');
  await deny(()=>rows('SELECT * FROM public.territory_stage8_cosmetic_receipts'),
    /permission denied/i,'Receipt table is not browser-readable');
  const rev=(await one('SELECT updated_at FROM public.players WHERE id=$1',[alice])).updated_at;
  const receipt=await save(rev,op1,2,true,'f1');
  assert.equal(receipt.success,true);
  assert.equal(receipt.settings.speed,2);
  assert.equal(receipt.settings.auto,true);
  assert.equal(receipt.appearance,'f1');
  assert.ok(Date.parse(receipt.updated_at)>=Date.parse(rev));
  assert.deepEqual(await save(rev,op1,2,true,'f1'),receipt,'Same UUID replays exact receipt');
  await deny(()=>save(rev,op1,2,false,'f1'),/operation_id_conflict/i);
  await deny(()=>save(rev,op2,2,true,'f1'),/stale_save_revision/i);
  await deny(()=>save(receipt.updated_at,op2,3,true,'f1'),/invalid_cosmetic_request/i);
  await deny(()=>save(receipt.updated_at,op2,1,true,'evil'),/invalid_cosmetic_request/i);
  const updated=(await one('SELECT game_state,gold,gems,level,xp FROM public.players WHERE id=$1',[alice]));
  assert.equal(updated.gold,123);
  assert.equal(updated.gems,45);
  assert.equal(updated.level,9);
  assert.equal(updated.xp,700);
  assert.deepEqual(updated.game_state.player,gameState.player);
  assert.deepEqual(updated.game_state.inventory,gameState.inventory);
  assert.deepEqual(updated.game_state.professions,gameState.professions);
  assert.equal(updated.game_state.settings.speed,2);
  assert.equal(updated.game_state.appearance,'f1');
  assert.equal((await rows('SELECT game_state FROM public.players WHERE id=$1',[bob])).length,0,
    'The authenticated read policy must hide other players');
  await role();
  assert.equal((await one('SELECT game_state FROM public.players WHERE id=$1',[bob])).game_state.appearance,'m2');
  await user(bob);
  await deny(()=>save('2000-01-01T00:00:00Z',op2,2,true,'f1'),/stale_save_revision/i);
  const bRev=(await one('SELECT updated_at FROM public.players WHERE id=$1',[bob])).updated_at;
  const bobSaved=await save(bRev,op2,2,true,'f1');
  assert.equal(bobSaved.appearance,'f1');
  await role();
  assert.equal((await one('SELECT game_state FROM public.players WHERE id=$1',[alice])).game_state.appearance,'f1',
    'A different player cannot mutate Alice’s chosen appearance');
  // Simulate a production trigger that modifies an economic field during a
  // purportedly cosmetic UPDATE: the RPC must notice and roll back entirely.
  await db.exec(`CREATE FUNCTION public.test_trap_cosmetic_trigger() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN NEW.gold:=NEW.gold+1; RETURN NEW; END $$;
    CREATE TRIGGER test_trap_cosmetic_trigger BEFORE UPDATE OF game_state ON public.players
    FOR EACH ROW EXECUTE FUNCTION public.test_trap_cosmetic_trigger();`);
  await user(bob);
  await deny(()=>save(bobSaved.updated_at,op3,1,false,'m2'),/cosmetic_affected_gameplay/i);
  await role();
  assert.equal((await one('SELECT gold FROM public.players WHERE id=$1',[bob])).gold,45,
    'Trigger side effects must be rolled back with the failed cosmetic operation');
  assert.equal((await one('SELECT count(*)::int AS n FROM public.territory_stage8_cosmetic_receipts WHERE operation_id=$1',[op3])).n,0);
  await db.exec('DROP TRIGGER test_trap_cosmetic_trigger ON public.players');
  await db.exec('DROP FUNCTION public.test_trap_cosmetic_trigger()');
  await db.exec('REVOKE UPDATE(gems) ON public.players FROM authenticated');
  await role('service_role');
  const stillUnsafe=(await one('SELECT public.territory_stage8_save_cutover_preflight() AS result')).result;
  assert.equal(stillUnsafe.ready,false,'Removing a single privilege never proves full game security');
  assert.ok(stillUnsafe.blockers.includes('server_quest_claim_missing'));
  console.log('Stage8 save-cutover PASS: cosmetics-only idempotent CAS, no currency/XP/inventory mutations, account isolation, RLS, honest FAIL-CLOSED release preflight.');
}finally{
  await db.close();
}
