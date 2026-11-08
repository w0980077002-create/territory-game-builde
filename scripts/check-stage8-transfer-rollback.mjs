/**
 * #366: two-owner rollback/replay regression on a disposable PGlite database.
 * This does NOT implement a market transaction or touch production Supabase.
 * In particular, a successful registry ownership change alone is not proof
 * that an auction has an atomic payment, receipt, or inventory transfer.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const seller = '11111111-1111-4111-8111-111111111111';
const buyer = '22222222-2222-4222-8222-222222222222';
const uuid = '33333333-3333-4333-8333-333333333333';
const id = `stage8_${uuid}`;
const gear = Object.freeze({
  id, slot: 'weapon', rarity: 'rare', level: 50, baseLevel: 1,
  upgradeCount: 49, attack: 118, defense: 17,
  baseStats: { attack: 20, defense: 3 },
});
const output = {
  type: 'equipment', name: 'Crafted test sword',
  equipment: { ...gear, id: 'registry-display-id' },
};
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const verified = async (owner, item = gear) => (await one(
  'SELECT territory_private.stage8_verified_gear_v2($1::jsonb,$2::uuid) AS item',
  [JSON.stringify(item), owner],
)).item;
const ownerInRegistry = async () => (await one(
  'SELECT player_id::text AS owner FROM public.territory_profession_stage8_items WHERE item_id=$1',
  [uuid],
)).owner;
try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA territory_private;
    CREATE TABLE public.players(id uuid PRIMARY KEY, game_state jsonb NOT NULL);
    CREATE TABLE public.territory_profession_stage8_items(
      item_id uuid PRIMARY KEY, player_id uuid NOT NULL, item_output jsonb NOT NULL
    );
  `);
  await db.query('INSERT INTO public.players(id,game_state) VALUES($1,$2::jsonb),($3,$4::jsonb)',
    [seller, JSON.stringify({ player: { level: 60 } }),
      buyer, JSON.stringify({ player: { level: 10 } })]);
  await db.query('INSERT INTO public.territory_profession_stage8_items(item_id,player_id,item_output) VALUES($1,$2,$3::jsonb)',
    [uuid, seller, JSON.stringify(output)]);
  const sql = readFileSync(new URL('../supabase/staged/territory_stage8_verified_gear_v2.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.(players|territory_profession_stage8_items)\b/i);
  await db.exec(sql);

  assert.deepEqual(await verified(seller), gear);
  await assert.rejects(() => verified(buyer), /stage8_item_not_owned/);

  // A failed trade must never leave a transferred item with the wrong owner.
  await db.exec('BEGIN');
  await db.query('UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2',
    [buyer, uuid]);
  assert.deepEqual(await verified(buyer), gear);
  await db.exec('ROLLBACK');
  assert.equal(await ownerInRegistry(), seller);
  assert.deepEqual(await verified(seller), gear);
  await assert.rejects(() => verified(buyer), /stage8_item_not_owned/);

  // Commit only the simulated registry handoff, not any actual auction or
  // payment. The recipient's level must NOT reduce level/stats/upgrades.
  await db.exec('BEGIN');
  await db.query('UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2',
    [buyer, uuid]);
  await db.exec('COMMIT');
  assert.equal(await ownerInRegistry(), buyer);
  assert.deepEqual(await verified(buyer), gear);
  await assert.rejects(() => verified(seller), /stage8_item_not_owned/);

  // An old-owner retry must not reclaim the item. A forged client cannot
  // turn the low-level buyer's legitimate 50-level gear into level 51.
  await assert.rejects(() => verified(seller), /stage8_item_not_owned/);
  assert.deepEqual(await verified(buyer, { ...gear, level: 10, attack: 1, upgradeCount: 0 }), gear);
  await assert.rejects(() => verified(buyer, { ...gear, level: 51 }), /stage8_reconciliation_required/);

  // An upgrade 50 -> 51 must be authorized by a future server forge operation;
  // never by an untrusted client save or an auction handoff.
  assert.equal((await verified(buyer)).level, 50);
  assert.deepEqual((await one('SELECT game_state FROM public.players WHERE id=$1', [buyer])).game_state,
    { player: { level: 10 } }, 'Transfer fixture must not mutate hero progress');
  console.log('PASS #366: two-owner rollback, committed handoff, old-owner denial, low-level buyer preservation and forged +1 rejection');
} finally {
  await db.close();
}
