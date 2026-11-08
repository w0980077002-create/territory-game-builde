// #366 RED contract: isolated PGlite only. No production connection, migrations or player writes.
// Expected to FAIL until the server preserves crafted gear on a low-level owner's save.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const highOwner = '10000000-0000-0000-0000-000000000050';
const lowOwner = '10000000-0000-0000-0000-000000000010';
const itemId = '50000000-0000-0000-0000-000000000050';
const crafted = {
  id: itemId, name: 'Меч мастера', slot: 'weapon', rarity: 'rare',
  level: 50, baseLevel: 1, upgradeCount: 49,
  baseStats: { attack: 20 }, attack: 118,
};
const row = (heroLevel, item) => ({
  player: { level: heroLevel, equipped: {} },
  inventory: [{ id: itemId, type: 'equipment', qty: 1, equipment: item }],
});
try {
  await db.exec(`
    CREATE SCHEMA territory_private;
    CREATE TABLE public.players(id uuid PRIMARY KEY, game_state jsonb NOT NULL);
    -- This stub is never reached for an unknown custom item until after its level is capped.
    CREATE FUNCTION public.territory_normalize_gear_v4(item jsonb)
      RETURNS jsonb LANGUAGE sql IMMUTABLE AS 'SELECT item';
  `);
  const sql = readFileSync('supabase/migrations/20261018_permanent_gear_level_rule.sql', 'utf8');
  const begin = sql.indexOf('CREATE OR REPLACE FUNCTION territory_private.cap_overlevel_item_20261018(');
  const end = sql.indexOf('$function$', sql.indexOf('AS $function$', begin) + 'AS $function$'.length);
  assert.ok(begin >= 0 && end > begin, 'historical server guard function exists');
  await db.exec(sql.slice(begin, end + '$function$'.length) + ';');

  await db.query('INSERT INTO public.players(id,game_state) VALUES($1,$2),($3,$4)', [
    highOwner, row(60, crafted), lowOwner, row(10, { ...crafted, id: 'other-owned-item' }),
  ]);
  const before = (await db.query('SELECT game_state FROM public.players WHERE id=$1', [highOwner])).rows[0].game_state;
  // Simulate the server save performed after the exact same crafted item changes owner.
  // The receiving hero is level 10; item must stay level 50, retaining its UUID and upgrades.
  const result = (await db.query(
    'SELECT territory_private.cap_overlevel_item_20261018($1::jsonb,$2) AS equipment',
    [crafted, 10],
  )).rows[0].equipment;
  assert.deepEqual(result, crafted,
    'TRANSFER CONTRACT: low-level buyer must retain UUID, level 50, upgradeCount 49 and stats; upgrade 50→51 remains possible');

  const after = (await db.query('SELECT game_state FROM public.players WHERE id=$1', [highOwner])).rows[0].game_state;
  assert.deepEqual(after, before, 'original owner must not be mutated by the isolated transfer test');
  console.log('#366 two-owner crafted-gear preservation contract PASS');
} finally {
  await db.close();
}
