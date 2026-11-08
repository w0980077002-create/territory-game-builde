// #366: isolated PostgreSQL regression for the future authoritative
// Stage8 item guard. NO connected Supabase, NO real player mutation.
// The production owner-save trigger is intentionally NOT replaced here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const seller = '10000000-0000-4000-8000-000000000060';
const buyer = '10000000-0000-4000-8000-000000000010';
const gearUuid = '50000000-0000-4000-8000-000000000050';
const itemId = 'stage8_' + gearUuid;
const canonical = {
  id: itemId, slot: 'weapon', name: 'Меч мастера', rarity: 'rare',
  level: 50, baseLevel: 1, upgradeCount: 49, attack: 118, baseStats: {attack: 20},
};
const registryOutput = {
  type:'equipment',rarity:'rare',name:'Меч мастера',
  equipment: {...canonical,id:'stage8_inventory_does_not_trust_this_id'},
};
const one = async (sql, values=[]) => (await db.query(sql, values)).rows[0];
const run = async (equipment, owner) => (await one(
  'SELECT territory_private.stage8_verified_gear_v2($1::jsonb,$2::uuid) AS gear',
  [JSON.stringify(equipment), owner]
)).gear;

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA territory_private;
    CREATE TABLE public.territory_profession_stage8_items(
      item_id uuid PRIMARY KEY, player_id uuid NOT NULL, item_output jsonb NOT NULL);
    CREATE TABLE public.players(id uuid PRIMARY KEY, game_state jsonb NOT NULL);
  `);
  await db.query('INSERT INTO public.players(id,game_state) VALUES($1,$2),($3,$4)',
    [seller,JSON.stringify({player:{level:60}}),buyer,JSON.stringify({player:{level:10}})]);
  await db.query('INSERT INTO public.territory_profession_stage8_items(item_id,player_id,item_output) VALUES($1,$2,$3)',
    [gearUuid,seller,JSON.stringify(registryOutput)]);
  const sql = readFileSync('supabase/staged/territory_stage8_verified_gear_v2.sql','utf8');
  assert.doesNotMatch(sql,/\bUPDATE\s+public\.players\b|\bUPDATE\s+public\.territory_profession_stage8_items\b/i);
  await db.exec(sql);

  // Initial owner holds an immutable identity and all earned stats.
  const first=await run(canonical,seller);
  assert.deepEqual(first,canonical,'Source owner gets certified exact original level 50');
  await assert.rejects(()=>run(canonical,buyer),/stage8_item_not_owned/,
    'Unauthorized client cannot mint a copy just by knowing an item UUID');

  // Simulate a separate, trusted trade transaction IN FIXTURE ONLY.
  await db.query('UPDATE public.territory_profession_stage8_items SET player_id=$1 WHERE item_id=$2',
    [buyer,gearUuid]);
  const verified=await run(canonical,buyer);
  assert.equal(verified.level,50,'Low-level hero inherits the SAME level-50 item');
  assert.equal(verified.id,itemId);
  assert.equal(verified.upgradeCount,49);
  assert.equal(verified.baseLevel,1);
  assert.equal(verified.attack,118);
  await assert.rejects(()=>run(canonical,seller),/stage8_item_not_owned/,
    'Seller loses verified ownership after authoritative transfer');

  const spoof=await run({...canonical,attack:99999,baseLevel:99,upgradeCount:499},buyer);
  assert.deepEqual(spoof,canonical,'A client cannot rewrite certified item attributes');

  // Simulate future server-authoritative successful forge 50 → 51.
  const level51 = {...canonical,level:51,upgradeCount:50,attack:120};
  await db.query(`UPDATE public.territory_profession_stage8_items
    SET item_output=jsonb_set(item_output,'{equipment}',$1::jsonb,true)
    WHERE item_id=$2`,[JSON.stringify(level51),gearUuid]);
  const afterForge=await run(canonical,buyer);
  assert.equal(afterForge.level,51,'After server forge, old client snapshot recovers level 51');
  assert.equal(afterForge.upgradeCount,50);
  assert.equal(afterForge.id,itemId);
  assert.equal(afterForge.attack,120);
  await assert.rejects(()=>run({...canonical,level:99},buyer),/stage8_reconciliation_required/,
    'Never accept a client-fabricated high-level upgrade');

  const normal=await run({...canonical,id:'ordinary-sword'},buyer);
  assert.equal(normal,null,'Non-server items stay under established legacy cap');
  await assert.rejects(()=>run({...canonical,id:'stage8_bad'},buyer),/stage8_invalid_item_reference/);
  await assert.rejects(()=>run({...canonical,id:'stage8_60000000-0000-4000-8000-000000000060'},buyer),
    /stage8_item_not_owned/);

  // The three known historical conflicts must be reviewed, not erased.
  const oldRegistry={...canonical,level:5,upgradeCount:0};
  await db.query(`UPDATE public.territory_profession_stage8_items
    SET item_output=jsonb_set(item_output,'{equipment}',$1::jsonb,true)
    WHERE item_id=$2`,[JSON.stringify(oldRegistry),gearUuid]);
  await assert.rejects(()=>run(canonical,buyer),/stage8_reconciliation_required/,
    'A saved level-50 item must never be silently downgraded to old registry level 5');

  const preserved=await one('SELECT game_state FROM public.players WHERE id=$1',[buyer]);
  assert.deepEqual(preserved.game_state,{player:{level:10}},'Validation must not touch player progress');
  console.log('Stage8 verified gear: owner authorization, lvl50 transfer, lvl51 next, spoof refusal and mismatch fence PASS');
} finally { await db.close(); }
