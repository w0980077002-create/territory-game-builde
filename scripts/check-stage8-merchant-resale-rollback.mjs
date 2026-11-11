// #366: isolated, non-production regression for level-1 merchants and resale rollback.
// This exercises the STAGED read-only registry contract, NOT the live save trigger or auction.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const owners = [
  '10000000-0000-4000-8000-000000000060', // crafter level 60
  '10000000-0000-4000-8000-000000000001', // merchant level 1
  '10000000-0000-4000-8000-000000000010', // reseller level 10
];
const uuid = '70000000-0000-4000-8000-000000000050';
const id = 'stage8_' + uuid;
const gear = {
  id, slot: 'weapon', name: 'Меч мастера', rarity: 'rare',
  level: 50, baseLevel: 1, upgradeCount: 49,
  attack: 118, defense: 7, baseStats: { attack: 20, defense: 7 },
};
const output = { type: 'equipment', equipment: { ...gear, id: 'registry_display_id' } };
const verify = async owner => (await db.query(
  'SELECT territory_private.stage8_verified_gear_v2($1::jsonb,$2::uuid) AS gear',
  [JSON.stringify(gear), owner],
)).rows[0].gear;
const transfer = async (expectedOwner, nextOwner) => db.query(
  'UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2 AND player_id=$3 RETURNING item_id',
  [nextOwner, uuid, expectedOwner],
);

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA territory_private;
    CREATE TABLE public.territory_profession_stage8_items(
      item_id uuid PRIMARY KEY, player_id uuid NOT NULL, item_output jsonb NOT NULL);
    CREATE TABLE public.players(id uuid PRIMARY KEY, game_state jsonb NOT NULL);
  `);
  for (const [index, owner] of owners.entries()) {
    await db.query('INSERT INTO public.players VALUES($1,$2::jsonb)',
      [owner, JSON.stringify({ player: { level: [60, 1, 10][index] } })]);
  }
  await db.query(
    'INSERT INTO public.territory_profession_stage8_items VALUES($1,$2,$3::jsonb)',
    [uuid, owners[0], JSON.stringify(output)],
  );
  const sql = readFileSync('supabase/staged/territory_stage8_verified_gear_v2.sql', 'utf8');
  const forbiddenWrite = /\bUPDATE\s+public\.(players|territory_profession_stage8_items)\b/i;
  assert.match('UPDATE public.players SET game_state = game_state', forbiddenWrite);
  assert.doesNotMatch(sql, forbiddenWrite);
  await db.exec(sql);

  assert.deepEqual(await verify(owners[0]), gear);
  // A level-1 trader may own and resell level-50 gear without changing its stats.
  assert.equal((await transfer(owners[0], owners[1])).rows.length, 1);
  assert.deepEqual(await verify(owners[1]), gear);
  // A level-1 owner's stale client snapshot must not downgrade canonical level 50.
  const staleClientGear = { ...gear, level: 1, upgradeCount: 0, attack: 20 };
  const restored = (await db.query(
    'SELECT territory_private.stage8_verified_gear_v2($1::jsonb,$2::uuid) AS gear',
    [JSON.stringify(staleClientGear), owners[1]],
  )).rows[0].gear;
  assert.deepEqual(restored, gear,
    'Server registry must restore level 50, 49 upgrades and canonical stats despite stale level-1 client data');
  await assert.rejects(() => db.query(
    'SELECT territory_private.stage8_verified_gear_v2($1::jsonb,$2::uuid)',
    [JSON.stringify({ ...gear, level: 51 }), owners[1]],
  ), /stage8_reconciliation_required/,
  'Unverified level 51 must not be accepted as a legitimate forge upgrade');
  await assert.rejects(() => verify(owners[0]), /stage8_item_not_owned/);
  assert.equal((await transfer(owners[1], owners[2])).rows.length, 1);
  assert.deepEqual(await verify(owners[2]), gear);
  await assert.rejects(() => verify(owners[1]), /stage8_item_not_owned/);

  // Simulate a failed resale inside an isolated transaction; rollback restores owner.
  await db.exec('BEGIN');
  try {
    assert.equal((await transfer(owners[2], owners[1])).rows.length, 1);
    assert.deepEqual(await verify(owners[1]), gear);
  } finally {
    await db.exec('ROLLBACK');
  }
  assert.deepEqual(await verify(owners[2]), gear);
  await assert.rejects(() => verify(owners[1]), /stage8_item_not_owned/);
  // A delayed request from the former merchant must not steal resold gear.
  assert.equal((await transfer(owners[1], owners[0])).rows.length, 0);
  assert.deepEqual(await verify(owners[2]), gear);
  const row = (await db.query(
    'SELECT player_id, item_output FROM public.territory_profession_stage8_items WHERE item_id=$1',
    [uuid],
  )).rows[0];
  assert.equal(row.player_id, owners[2]);
  assert.deepEqual(row.item_output, output);
  for (const [index, owner] of owners.entries()) {
    const saved = (await db.query('SELECT game_state FROM public.players WHERE id=$1', [owner])).rows[0];
    assert.deepEqual(saved.game_state, { player: { level: [60, 1, 10][index] } });
  }
  console.log('Stage8 merchant level-1 resale and transaction rollback PASS (isolated PGlite)');
} finally {
  await db.close();
}
