/** Offline characterization of the REAL owner_cap_item_v1 save path (#366).
 * This intentionally documents the CURRENT destructive behavior; PASS is NOT a fix.
 * No network, production database, migration execution outside in-memory PGlite.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const requireSafe = process.argv.includes('--require-safe');
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const load = path => readFileSync(`supabase/${path}`, 'utf8');
const install = async path => {
  const sql = path.endsWith('20261018_permanent_gear_level_rule.sql')
    ? load(path).replaceAll(/^\$function\$$/gm, '$function$;')
    : load(path);
  await db.exec(sql);
};
const patch = load('staged/20261029_owner_gear_authority_forge_fix.sql');
const start = patch.indexOf('CREATE OR REPLACE FUNCTION territory_private.owner_cap_item_v1(');
const end = patch.indexOf('$owner_gear$;', start);
assert(start >= 0 && end > start, 'real owner cap implementation must be present');
const sword = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Ремесленный меч', slot: 'weapon', rarity: 'rare',
  level: 50, baseLevel: 1, upgradeCount: 49,
  attack: 170, defense: 0, hp: 0,
  baseStats: {attack: 23, defense: 0, hp: 0},
};
const state = {player: {level: 10, equipped: {}}, inventory: [
  {id: sword.id, equipment: sword}
], belt: []};
try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA territory_private;
    CREATE TABLE public.players (
      id uuid PRIMARY KEY, level integer NOT NULL DEFAULT 10,
      gold integer NOT NULL DEFAULT 1234, gems integer NOT NULL DEFAULT 15,
      game_state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      attack integer NOT NULL DEFAULT 0, defense integer NOT NULL DEFAULT 0,
      max_hp integer NOT NULL DEFAULT 0, crit_chance integer NOT NULL DEFAULT 0);
    CREATE TABLE public.admin_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      player_id uuid NOT NULL REFERENCES public.players(id),
      kind text NOT NULL, payload jsonb NOT NULL, claimed_at timestamptz);
  `);
  await install('migrations/20261017_equipment_guard_v4.sql');
  await install('migrations/20261018_permanent_gear_level_rule.sql');
  await install('migrations/20261022_owner_test_equipment_levels.sql');
  await install('migrations/20261022_owner_test_gear_stats_receipt_v3.sql');
  await install('staged/20261027_owner_test_gear_relevel_v4.sql');
  await db.exec(patch.slice(start, end + '$owner_gear$;'.length));
  // The buyer is a level-1 merchant with an empty inventory, not a cloned owner.
  await db.query('INSERT INTO public.players(id,level,game_state) VALUES($1,10,$2::jsonb)',
    [owner, JSON.stringify(state)]);
  const merchantState = {player: {level: 1, equipped: {}}, inventory: [], belt: []};
  await db.query('INSERT INTO public.players(id,level,game_state) VALUES($1,1,$2::jsonb)',
    [other, JSON.stringify(merchantState)]);
  const beforeOwner = (await db.query('SELECT game_state FROM public.players WHERE id=$1', [owner])).rows[0].game_state;
  const beforeOther = (await db.query('SELECT game_state FROM public.players WHERE id=$1', [other])).rows[0].game_state;
  const result = (await db.query(
    'SELECT territory_private.owner_cap_item_v1($1::jsonb,10,$2::uuid) AS gear',
    [JSON.stringify(sword), owner])).rows[0].gear;
  assert.equal(result.id, sword.id, 'UUID must remain identifiable');
  if (requireSafe) {
    assert.equal(result.level, sword.level, 'owner save must preserve crafted level 50');
    assert.equal(result.upgradeCount, sword.upgradeCount, 'owner save must preserve 49 upgrades');
    assert.equal(result.attack, sword.attack, 'owner save must preserve attack stat');
    assert.deepEqual(result.baseStats, sword.baseStats, 'owner save must preserve base stats');
  } else {
    assert.equal(result.level, 10,
      'KNOWN DEFECT: real owner save cap currently destroys level 50 on a level-10 owner');
    assert.notEqual(result.level, sword.level, 'characterization must expose destructive cap');
  }
  const secondOwnerResult = (await db.query(
    'SELECT territory_private.owner_cap_item_v1($1::jsonb,1,$2::uuid) AS gear',
    [JSON.stringify(sword), other])).rows[0].gear;
  assert.equal(secondOwnerResult.id, sword.id, 'second owner must receive the same item identity');
  assert.equal(secondOwnerResult.level, requireSafe ? sword.level : 1,
    'second low-level owner must follow the selected characterization or safety contract');
  if (requireSafe) {
    assert.equal(secondOwnerResult.upgradeCount, sword.upgradeCount, 'second owner upgrades preserved');
    assert.equal(secondOwnerResult.attack, sword.attack, 'second owner attack preserved');
    assert.deepEqual(secondOwnerResult.baseStats, sword.baseStats, 'second owner base stats preserved');
  }
  const afterOwner = (await db.query('SELECT game_state FROM public.players WHERE id=$1', [owner])).rows[0].game_state;
  assert.deepEqual(afterOwner, beforeOwner, 'function-only characterization must not silently write owner state');
  const afterOther = (await db.query('SELECT game_state FROM public.players WHERE id=$1', [other])).rows[0].game_state;
  assert.deepEqual(afterOther, beforeOther, 'other owner must be untouched');
  assert.equal(sword.level, 50, 'synthetic source object must not be mutated');
  if (!requireSafe) console.warn('KNOWN FAILING PRODUCT INVARIANT #366: PASS confirms downgrade, not safety. Run with --require-safe for the expected failing acceptance contract.');
} finally {
  await db.close();
}
