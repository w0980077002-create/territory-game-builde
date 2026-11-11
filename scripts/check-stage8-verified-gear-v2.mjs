// #366: isolated PostgreSQL regression for ANY item level carried across trade.
// Numerical values here are varied fixtures, never gameplay level requirements.
// NO connected Supabase; production player-save trigger is NOT replaced.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const seller = '10000000-0000-4000-8000-000000000060';
const buyer = '10000000-0000-4000-8000-000000000010';
const gearUuid = '70000000-0000-4000-8000-000000000070';
const itemId = 'stage8_' + gearUuid;
const makeGear = level => ({
  id:itemId,slot:'weapon',name:'Меч мастера',rarity:'rare',
  level,baseLevel:1,upgradeCount:level-1,
  attack:20+2*(level-1),baseStats:{attack:20},
});
const outputFor = eq => ({
  type:'equipment',rarity:'rare',name:'Меч мастера',
  equipment:{...eq,id:'unverified_registry_display_id'},
});
const one = async (sql, values=[]) => (await db.query(sql, values)).rows[0];
const run = async (equipment, owner) => (await one(
  'SELECT territory_private.stage8_verified_gear_v2($1::jsonb,$2::uuid) AS gear',
  [JSON.stringify(equipment),owner]
)).gear;
const putInRegistry = async (eq, owner) =>
  db.query('UPDATE public.territory_profession_stage8_items SET player_id=$1,item_output=$2::jsonb WHERE item_id=$3',
    [owner,JSON.stringify(outputFor(eq)),gearUuid]);

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA territory_private;
    CREATE TABLE public.territory_profession_stage8_items(
      item_id uuid PRIMARY KEY,player_id uuid NOT NULL,item_output jsonb NOT NULL);
    CREATE TABLE public.players(id uuid PRIMARY KEY,game_state jsonb NOT NULL);
  `);
  await db.query('INSERT INTO public.players(id,game_state) VALUES($1,$2),($3,$4)',
    [seller,JSON.stringify({player:{level:60}}),buyer,JSON.stringify({player:{level:10}})]);
  await db.query('INSERT INTO public.territory_profession_stage8_items(item_id,player_id,item_output) VALUES($1,$2,$3)',
    [gearUuid,seller,JSON.stringify(outputFor(makeGear(8)))]);
  const sql = readFileSync('supabase/staged/territory_stage8_verified_gear_v2.sql','utf8');
  assert.doesNotMatch(sql,/\bUPDATE\s+public\.players\b|\bUPDATE\s+public\.territory_profession_stage8_items\b/i);
  await db.exec(sql);

  // Multiple nonconsecutive starting levels ensure no test fixture is a rule.
  for (const level of [8,37,72]) {
    const item=makeGear(level);
    await putInRegistry(item,seller);
    assert.deepEqual(await run(item,seller),item,'Seller keeps verified current item');
    await assert.rejects(()=>run(item,buyer),/stage8_item_not_owned/,
      'Buyer cannot claim ownership before authenticated trade');

    // Server-simulated ownership transfer only inside temporary PGlite.
    await db.query('UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2',
      [buyer,gearUuid]);
    const received=await run(item,buyer);
    assert.deepEqual(received,item,'New owner inherits ALL attributes at actual current level');
    assert.equal(received.id,itemId);
    assert.equal(received.upgradeCount,level-item.baseLevel);
    await assert.rejects(()=>run(item,seller),/stage8_item_not_owned/,
      'Seller cannot duplicate item after authoritative transfer');
    const spoof=await run({...item,attack:99999,baseLevel:99,upgradeCount:499},buyer);
    assert.deepEqual(spoof,item,'Client cannot rewrite certified item attributes');

    // Next successful server-side upgrade always continues from current level.
    const nextItem=makeGear(level+1);
    await putInRegistry(nextItem,buyer);
    const afterForge=await run(item,buyer);
    assert.deepEqual(afterForge,nextItem,'Upgrade continues at current level + 1');
    assert.equal(afterForge.upgradeCount,item.upgradeCount+1);
    await assert.rejects(()=>run({...item,level:level+20},buyer),
      /stage8_reconciliation_required/,'Reject forged future levels');
  }

  const fixture=makeGear(72);
  await assert.rejects(()=>run({...fixture,level:null},buyer),/stage8_invalid_level/);
  await putInRegistry({...fixture,level:null},buyer);
  await assert.rejects(()=>run(fixture,buyer),/stage8_invalid_level/);
  await putInRegistry(fixture,buyer);
  assert.equal(await run({...fixture,id:'ordinary-sword'},buyer),null,
    'Non-server items use existing legacy guard');
  await assert.rejects(()=>run({...fixture,id:'stage8_bad'},buyer),
    /stage8_invalid_item_reference/);
  await assert.rejects(()=>run({...fixture,id:'stage8_60000000-0000-4000-8000-000000000060'},buyer),
    /stage8_item_not_owned/);

  // Historical mismatches require provenance review, not silent downgrade.
  const oldRegistry=makeGear(5);
  await putInRegistry(oldRegistry,buyer);
  await assert.rejects(()=>run(fixture,buyer),/stage8_reconciliation_required/,
    'Saved-upgrade vs registry mismatch must never silently erase levels');

  const preserved=await one('SELECT game_state FROM public.players WHERE id=$1',[buyer]);
  assert.deepEqual(preserved.game_state,{player:{level:10}},
    'Guard validation cannot mutate player progress');
  console.log('Stage8 generic gear transfer: multiple levels, +1 upgrades, UUID, provenance and anti-spoof checks PASS');
} finally { await db.close(); }
