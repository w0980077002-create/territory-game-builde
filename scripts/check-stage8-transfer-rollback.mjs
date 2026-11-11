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
const reseller = '44444444-4444-4444-8444-444444444444';
const uuid = '33333333-3333-4333-8333-333333333333';
const id = `stage8_${uuid}`;
const untouchedUuid = '66666666-6666-4666-8666-666666666666';
const untouchedId = `stage8_${untouchedUuid}`;
const untouchedGear = Object.freeze({
  id: untouchedId, slot: 'armor', rarity: 'rare', level: 34, baseLevel: 1,
  upgradeCount: 33, defense: 77, baseStats: { defense: 11 },
});
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
  await db.query('INSERT INTO public.players(id,game_state) VALUES($1,$2::jsonb)',
    [reseller, JSON.stringify({ player: { level: 1 } })]);
  await db.query('INSERT INTO public.territory_profession_stage8_items(item_id,player_id,item_output) VALUES($1,$2,$3::jsonb)',
    [uuid, seller, JSON.stringify(output)]);
  // A second crafted item owned by the original seller must be isolated
  // from all transfers, rollbacks and forged reads of the first item.
  await db.query('INSERT INTO public.territory_profession_stage8_items(item_id,player_id,item_output) VALUES($1,$2,$3::jsonb)',
    [untouchedUuid, seller, JSON.stringify({
      type: 'equipment', name: 'Independent crafted armor',
      equipment: { ...untouchedGear, id: 'registry-display-id-2' },
    })]);
  const sql = readFileSync(new URL('../supabase/staged/territory_stage8_verified_gear_v2.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.(players|territory_profession_stage8_items)\b/i);
  await db.exec(sql);

  assert.deepEqual(await verified(seller), gear);
  await assert.rejects(() => verified(buyer), /stage8_item_not_owned/);

  // Snapshot the canonical output itself, not only the normalized verifier
  // response. A handoff may update player_id but must not silently rewrite
  // the registry's stored level, rarity, upgrades, base stats or provenance.
  const registryOutputBefore = (await one(
    'SELECT item_output FROM public.territory_profession_stage8_items WHERE item_id=$1',
    [uuid],
  )).item_output;
  assert.deepEqual(registryOutputBefore, output);

  // A failed trade must roll back both the registry handoff and any
  // accompanying player snapshot writes in the SAME database transaction.
  // This is only a disposable transaction fixture, not a market implementation.
  const sellerBefore = (await one('SELECT game_state FROM public.players WHERE id=$1', [seller])).game_state;
  const buyerBefore = (await one('SELECT game_state FROM public.players WHERE id=$1', [buyer])).game_state;
  await db.exec('BEGIN');
  await db.query('UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2',
    [buyer, uuid]);
  await db.query('UPDATE public.players SET game_state=$2::jsonb WHERE id=$1',
    [seller, JSON.stringify({ player: { level: 60 }, pendingSale: id })]);
  await db.query('UPDATE public.players SET game_state=$2::jsonb WHERE id=$1',
    [buyer, JSON.stringify({ player: { level: 10 }, pendingPurchase: id })]);
  assert.equal(await ownerInRegistry(), buyer);
  assert.deepEqual(await verified(buyer), gear);
  await db.exec('ROLLBACK');
  assert.equal(await ownerInRegistry(), seller, 'Registry handoff must roll back');
  assert.deepEqual((await one('SELECT game_state FROM public.players WHERE id=$1', [seller])).game_state,
    sellerBefore, 'Seller snapshot must roll back with registry');
  assert.deepEqual((await one('SELECT game_state FROM public.players WHERE id=$1', [buyer])).game_state,
    buyerBefore, 'Buyer snapshot must roll back with registry');
  assert.deepEqual(await verified(seller), gear);
  await assert.rejects(() => verified(buyer), /stage8_item_not_owned/);
  // Regression: the FIRST cancelled sale must also leave the seller's
  // independent crafted armor unchanged, not just the traded sword.
  const untouchedAfterFirstRollback = await one(
    'SELECT player_id::text AS owner, item_output FROM public.territory_profession_stage8_items WHERE item_id=$1',
    [untouchedUuid],
  );
  assert.equal(untouchedAfterFirstRollback.owner, seller);
  assert.equal(untouchedAfterFirstRollback.item_output.equipment.level, 34);
  assert.equal(untouchedAfterFirstRollback.item_output.equipment.upgradeCount, 33);
  assert.equal(untouchedAfterFirstRollback.item_output.equipment.defense, 77);
  assert.deepEqual(await verified(seller, untouchedGear), untouchedGear);
  await assert.rejects(() => verified(buyer, untouchedGear), /stage8_item_not_owned/);

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

  // A forged client can also keep level=50 while changing stats, rarity,
  // upgrade count or baseStats. The read-only server contract must return
  // ONLY the canonical registry item, not merge any forged client fields.
  const forgedSameLevel = {
    ...gear,
    attack: 999999,
    defense: 999999,
    rarity: 'legendary',
    upgradeCount: 999,
    baseStats: { attack: 999999, defense: 999999 },
  };
  assert.deepEqual(await verified(buyer, forgedSameLevel), gear,
    'Same-level stat/rarity/upgrade forgery must be replaced by canonical registry fields');
  assert.equal(await ownerInRegistry(), buyer,
    'Forged save verification must not change the legitimate owner');
  assert.deepEqual(await verified(buyer), gear,
    'Forged save verification must not mutate the registry item');

  // Never accept a client-supplied identifier for a different or missing
  // registry row; the previous owner cannot reclaim it by changing stats.
  await assert.rejects(
    () => verified(buyer, { ...gear, id: 'stage8_55555555-5555-4555-8555-555555555555' }),
    /stage8_item_not_owned/,
  );
  await assert.rejects(
    () => verified(buyer, { ...gear, id: 'stage8_not-a-uuid' }),
    /stage8_invalid_item_reference/,
  );
  await assert.rejects(
    () => verified(seller, forgedSameLevel),
    /stage8_item_not_owned/,
  );

  // A stale seller request after the committed transfer must not overwrite
  // the buyer's ownership. Real transfer RPCs need an owner-checked CAS;
  // this fixture checks the PostgreSQL row-count contract only.
  const staleHandoff = await db.query(
    'UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2 AND player_id=$3 RETURNING item_id',
    [seller, uuid, seller],
  );
  assert.equal(staleHandoff.rows.length, 0,
    'Stale seller must not reclaim a transferred UUID through owner-checked update');
  assert.equal(await ownerInRegistry(), buyer);
  assert.deepEqual(await verified(buyer), gear);

  // A low-level trader may resell without ever equipping the gear.
  // Second handoff: level-10 buyer -> level-1 reseller. Neither transfer
  // is allowed to silently reduce the canonical crafted level or stats.
  await db.exec('BEGIN');
  await db.query('UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2',
    [reseller, uuid]);
  assert.deepEqual(await verified(reseller), gear);
  await db.exec('COMMIT');
  assert.equal(await ownerInRegistry(), reseller);
  assert.deepEqual(await verified(reseller), gear);
  await assert.rejects(() => verified(buyer), /stage8_item_not_owned/);

  // A delayed replay from the intermediate buyer must not reclaim the sword
  // after resale. The owner predicate is required for an atomic handoff.
  // A stale request attempts to transfer the sword to a DIFFERENT owner.
  // An unconditional UPDATE would steal it; the expected-owner predicate
  // must reject this replay after the intermediate buyer has resold it.
  const staleIntermediateHandoff = await db.query(
    'UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2 AND player_id=$3 RETURNING item_id',
    [seller, uuid, buyer],
  );
  assert.equal(staleIntermediateHandoff.rows.length, 0,
    'Stale intermediate buyer must not reclaim an already resold UUID');
  assert.equal(await ownerInRegistry(), reseller);
  assert.deepEqual(await verified(reseller), gear,
    'Replay rejection must preserve level, upgrades and canonical stats');
  await assert.rejects(() => verified(buyer), /stage8_item_not_owned/);
  await assert.rejects(() => verified(seller), /stage8_item_not_owned/);

  // Negative control: without the expected-owner predicate, the SAME stale
  // request would steal the item. Roll back the unsafe update immediately.
  // This proves the replay fixture is capable of detecting a missing guard.
  await db.exec('BEGIN');
  const unsafeReplay = await db.query(
    'UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2 RETURNING item_id',
    [seller, uuid],
  );
  assert.equal(unsafeReplay.rows.length, 1);
  assert.equal(await ownerInRegistry(), seller);
  await db.exec('ROLLBACK');
  assert.equal(await ownerInRegistry(), reseller);
  assert.deepEqual(await verified(reseller), gear);
  await assert.rejects(() => verified(seller), /stage8_item_not_owned/);
  assert.deepEqual((await one('SELECT game_state FROM public.players WHERE id=$1', [reseller])).game_state,
    { player: { level: 1 } }, 'Level-1 reseller progress must not change');

  // The SECOND handoff can fail too: a level-1 trader must retain the
  // exact item after a cancelled resale to the former level-10 buyer.
  // This specifically covers rollback AFTER the original seller has left
  // the ownership chain, without any live auction/payment implementation.
  const resellerBeforeRollback = (await one(
    'SELECT game_state FROM public.players WHERE id=$1', [reseller],
  )).game_state;
  const buyerBeforeRollback = (await one(
    'SELECT game_state FROM public.players WHERE id=$1', [buyer],
  )).game_state;
  await db.exec('BEGIN');
  await db.query(
    'UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2',
    [buyer, uuid],
  );
  await db.query('UPDATE public.players SET game_state=$2::jsonb WHERE id=$1',
    [reseller, JSON.stringify({ player: { level: 1 }, pendingResale: id })]);
  await db.query('UPDATE public.players SET game_state=$2::jsonb WHERE id=$1',
    [buyer, JSON.stringify({ player: { level: 10 }, pendingRepurchase: id })]);
  assert.deepEqual(await verified(buyer), gear);
  await assert.rejects(() => verified(reseller), /stage8_item_not_owned/);
  await db.exec('ROLLBACK');
  assert.equal(await ownerInRegistry(), reseller,
    'Cancelled second-hand resale must restore the level-1 merchant as owner');
  assert.deepEqual(await verified(reseller), gear,
    'Cancelled resale must preserve the canonical level-50 equipment');
  await assert.rejects(() => verified(buyer), /stage8_item_not_owned/);
  assert.deepEqual((await one('SELECT game_state FROM public.players WHERE id=$1', [reseller])).game_state,
    resellerBeforeRollback, 'Cancelled resale must roll back merchant snapshot');
  assert.deepEqual((await one('SELECT game_state FROM public.players WHERE id=$1', [buyer])).game_state,
    buyerBeforeRollback, 'Cancelled resale must roll back repurchaser snapshot');

  // An upgrade 50 -> 51 must be authorized by a future server forge operation;
  // never by an untrusted client save or an auction handoff.
  assert.equal((await verified(reseller)).level, 50);
  assert.deepEqual((await one('SELECT game_state FROM public.players WHERE id=$1', [buyer])).game_state,
    { player: { level: 10 } }, 'Transfer fixture must not mutate hero progress');
  // Registry verification must be item-scoped. Transferring one UUID may
  // never change the seller's OTHER gear, nor grant it to buyer/reseller.
  const independentRow = await one(
    'SELECT player_id::text AS owner, item_output FROM public.territory_profession_stage8_items WHERE item_id=$1',
    [untouchedUuid],
  );
  assert.equal(independentRow.owner, seller,
    'Resale of sword must not transfer unrelated armor owned by seller');
  assert.deepEqual(independentRow.item_output.equipment.level, untouchedGear.level);
  assert.equal(independentRow.item_output.equipment.upgradeCount, untouchedGear.upgradeCount);
  assert.equal(independentRow.item_output.equipment.defense, untouchedGear.defense);
  assert.deepEqual(await verified(seller, untouchedGear), untouchedGear,
    'Original seller must still have access to independently owned armor');
  await assert.rejects(() => verified(buyer, untouchedGear), /stage8_item_not_owned/);
  await assert.rejects(() => verified(reseller, untouchedGear), /stage8_item_not_owned/);
  assert.deepEqual(await verified(reseller), gear,
    'Unrelated gear checks must not alter transferred sword');

  const registryOutputAfter = (await one(
    'SELECT item_output FROM public.territory_profession_stage8_items WHERE item_id=$1',
    [uuid],
  )).item_output;
  assert.deepEqual(registryOutputAfter, registryOutputBefore,
    'Ownership handoffs, rollbacks and forged reads must never alter the canonical registry payload');
  assert.equal(registryOutputAfter.equipment.level, 50);
  assert.equal(registryOutputAfter.equipment.upgradeCount, 49);
  assert.equal(registryOutputAfter.equipment.attack, 118);
  assert.equal(registryOutputAfter.equipment.rarity, 'rare');

  console.log('PASS #366: two-hop resale through level-1 merchant, rollback, old-owner denial, item preservation and forged +1 rejection, unrelated-item isolation');
} finally {
  await db.close();
}
