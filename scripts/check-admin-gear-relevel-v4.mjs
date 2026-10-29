/** Offline server regression: no Supabase production connection, no player edits. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const one = async (sql, params=[]) => (await db.query(sql,params)).rows[0];
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const migration = (path) => readFileSync(`supabase/${path}`,'utf8');
const fixSql = migration('staged/20261029_owner_gear_authority_forge_fix.sql');
const fixFunctionStart = fixSql.indexOf('CREATE OR REPLACE FUNCTION territory_private.owner_cap_item_v1(');
const fixFunctionEnd = fixSql.indexOf('$owner_gear$;',fixFunctionStart) + '$owner_gear$;'.length;
assert(fixFunctionStart >= 0 && fixFunctionEnd > fixFunctionStart,'Owner gear patch must define a full DB function');
assert.match(fixSql,/Never replay outdated item\./,'Old admin grants must not overwrite newer forge progress');

const install = async path => {
  // The 2026-10-18 historical SQL snapshot omitted statement terminators
  // between its function definitions; the live DB already has those functions.
  const sql = path.endsWith('20261018_permanent_gear_level_rule.sql')
    ? migration(path).replaceAll(/^\$function\$$/gm,'$function$;')
    : migration(path);
  try { await db.exec(sql); }
  catch (error) { throw new Error(`Migration ${path}: ${error.message}`, {cause:error}); }
};
const equipment = (id,name,slot,rarity,level,stats) => ({id,name,slot,rarity,level,...stats});
const basicState = (gear,level=10) => ({
  player:{level,stats:{attack:20+5*(level-1),defense:5+2*(level-1),
    maxHp:100+20*(level-1),hp:100+20*(level-1),critChance:5},
    equipped:{[gear.slot]:gear},gold:1234,gems:15},
  inventory:[{id:'untouched',name:'Potion',qty:1}],
  belt:[],balanceVersion:4,
});
const grant = async (slot,level) => (await one(
  'SELECT public.territory_owner_apply_test_gear_v2($1::uuid,$2::text,$3::integer) receipt',
  [id,slot,level])).receipt;
const get = async () => one('SELECT * FROM public.players WHERE id=$1::uuid',[id]);
const seed = async (gear,level=10) => db.query(
  'UPDATE public.players SET level=$2,game_state=$3::jsonb WHERE id=$1::uuid',
  [id,level,JSON.stringify(basicState(gear,level))]);

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA territory_private;
    CREATE TABLE public.players (
      id uuid PRIMARY KEY, level integer NOT NULL DEFAULT 10,
      gold integer NOT NULL DEFAULT 1234,
      gems integer NOT NULL DEFAULT 15,
      game_state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      attack integer NOT NULL DEFAULT 0,
      defense integer NOT NULL DEFAULT 0,
      max_hp integer NOT NULL DEFAULT 0,
      crit_chance integer NOT NULL DEFAULT 0);
    CREATE TABLE public.admin_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      player_id uuid NOT NULL REFERENCES public.players(id),
      kind text NOT NULL,
      payload jsonb NOT NULL,
      claimed_at timestamptz);
  `);
  await install('migrations/20261017_equipment_guard_v4.sql');
  await install('migrations/20261018_permanent_gear_level_rule.sql');
  await install('migrations/20261022_owner_test_equipment_levels.sql');
  await install('migrations/20261022_owner_test_gear_stats_receipt_v3.sql');
  await install('staged/20261027_owner_test_gear_relevel_v4.sql');
  // Test the deployed replacement against an isolated in-memory PostgreSQL.
  // Only the helper is installed: the grant claim migration has separate setup.
  await db.exec(fixSql.slice(fixFunctionStart,fixFunctionEnd));

  const initial = basicState(equipment('rare-shield','Укреплённый щит','shield','rare',10,
    {defense:20,hp:40,baseLevel:10,baseStats:{defense:20,hp:40},upgradeCount:0}));
  await db.query('INSERT INTO public.players(id,level,game_state) VALUES($1,10,$2::jsonb)',
    [id,JSON.stringify(initial)]);
  await db.query('INSERT INTO public.players(id,level,game_state) VALUES($1,10,$2::jsonb)',
    [otherId,JSON.stringify(initial)]);
  const otherBefore = (await one('SELECT game_state FROM public.players WHERE id=$1',[otherId])).game_state;

  const higher = await grant('shield',20);
  assert.equal(higher.applied,true);
  assert.deepEqual([higher.gear.level,higher.gear.defense,higher.gear.hp],[20,25,48],
    'custom shield must GAIN exact fixed-growth stats on level increase');
  assert.equal(higher.combat.defense,48);
  assert.equal(higher.combat.hp,328);
  let row = await get();
  assert.equal(row.game_state.player.equipped.shield.upgradeCount,10);
  assert.deepEqual(row.game_state.player.equipped.shield.baseStats,{defense:20,hp:40});
  assert.equal(row.game_state.inventory[0].id,'untouched');
  assert.equal(row.game_state.player.gold,1234);

  // A second, still-open Telegram tab must NOT undo the owner-approved stats.
  await db.query('UPDATE public.players SET game_state=$2::jsonb WHERE id=$1',
    [id,JSON.stringify(initial)]);
  row=await get();
  assert.deepEqual([
    row.game_state.player.equipped.shield.level,
    row.game_state.player.equipped.shield.defense,
    row.game_state.player.equipped.shield.hp,
  ],[20,25,48],'stale client save must not undo canonical approved gear');

  const lower = await grant('shield',10);
  assert.deepEqual([lower.gear.level,lower.gear.defense,lower.gear.hp],[10,20,40],
    'reversing level must restore ORIGINAL stats instead of keeping higher stats');
  assert.equal(lower.combat.defense,43);
  assert.equal(lower.combat.hp,320);
  const approved=(await one(`SELECT approved_equipment FROM territory_private.owner_test_gear_v1
    WHERE player_id=$1::uuid AND slot='shield'`,[id])).approved_equipment;
  assert.deepEqual([approved.level,approved.defense,approved.hp],[10,20,40],
    'new approval must REPLACE the previous higher-level receipt');
  const repeat = await grant('shield',10);
  assert.deepEqual(repeat.gear,lower.gear,'repeat owner edit must not compound stats');

  const belowBase = await grant('shield',5);
  assert.deepEqual([belowBase.gear.level,belowBase.gear.defense,belowBase.gear.hp],[5,10,20],
    'custom gear reduced below its first level must lose proportionate strength');
  row = await get();
  assert.equal(row.game_state.player.equipped.shield.baseLevel,5);

  await seed(equipment('epic-sword','Героический меч','weapon','epic',5,
    {attack:35,critChance:8,baseLevel:5,baseStats:{attack:35,critChance:8},upgradeCount:0}));
  const epicHigh=await grant('weapon',15);
  assert.deepEqual([epicHigh.gear.attack,epicHigh.gear.critChance],[55,8],
    'catalog gear raises attack but keeps crit constant');
  const epicLow=await grant('weapon',1);
  assert.deepEqual([epicLow.gear.attack,epicLow.gear.critChance],[7,2],
    'catalog gear below template uses proportional level-one stats');
  const epicRestore=await grant('weapon',5);
  assert.deepEqual([epicRestore.gear.attack,epicRestore.gear.critChance],[35,8]);

  await seed(equipment('boss-armor','Доспех воина','armor','legendary',165,
    {attack:0,defense:335,hp:845,baseLevel:165,baseStats:{attack:0,defense:335,hp:845},upgradeCount:0}),165);
  const bossDown=await grant('armor',82);
  assert.deepEqual([bossDown.gear.level,bossDown.gear.defense,bossDown.gear.hp],[82,169,430],
    'historic chapter loot must be rebuilt at the new chapter curve');
  const bossUp=await grant('armor',165);
  assert.deepEqual([bossUp.gear.level,bossUp.gear.defense,bossUp.gear.hp],[165,335,845]);

  // The owner chooses a baseline, but regular one-level forge upgrades must
  // persist afterwards. Simulate an advanced hero and a successful forge.
  await db.query(`UPDATE public.players SET level=200,
    game_state=jsonb_set(game_state,'{player,level}','200'::jsonb)
    WHERE id=$1::uuid`,[id]);
  await db.query(`UPDATE public.players
    SET game_state=jsonb_set(game_state,'{player,equipped,armor,level}','166'::jsonb)
    WHERE id=$1::uuid`,[id]);
  row=await get();
  assert.equal(row.game_state.player.equipped.armor.level,166,
    'owner gear must accept a normal forge level above the previous admin value');
  await db.query(`UPDATE public.players
    SET game_state=jsonb_set(game_state,'{player,equipped,armor,level}','165'::jsonb)
    WHERE id=$1::uuid`,[id]);
  row=await get();
  assert.equal(row.game_state.player.equipped.armor.level,166,
    'stale owner receipt and older saves must not roll back a forged item');
  const ownerLowerAfterForge=await grant('armor',82);
  assert.equal(ownerLowerAfterForge.gear.level,82,
    'a later owner correction DOWN must always override the forged level');
  const ownerRaiseAgain=await grant('armor',190);
  assert.equal(ownerRaiseAgain.gear.level,190,
    'a later owner correction UP must always override the forged level');

  row=await get();
  const last=(await one(`SELECT payload FROM public.admin_grants WHERE player_id=$1
      ORDER BY id DESC LIMIT 1`,[id]));
  assert(last?.payload,'owner grant must remain available for client sync');
  assert.equal(row.game_state.player.equipped.armor.adminTestLevel,true);
  assert.deepEqual((await one('SELECT game_state FROM public.players WHERE id=$1',[otherId])).game_state,otherBefore,
    'unrelated player must stay untouched');
  assert.equal((await one("SELECT has_function_privilege('anon','public.territory_owner_apply_test_gear_v2(uuid,text,integer)','execute') allowed")).allowed,false);
  console.log('ADMIN GEAR RELEVEL V4 PASS: custom up/down/repeat, stale-save protection, below-base, catalog below template, boss curve, combat columns, player isolation and server receipt');
} finally {
  await db.close();
}
