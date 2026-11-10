import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Isolated in-memory PostgreSQL test: no production data, no Telegram access.
const db = new PGlite();
const migration = readFileSync('supabase/migrations/20261109224945_trial_chest_vault_v1.sql', 'utf8');
const playerId = '20000000-0000-4000-8000-000000000001';
const otherId = '20000000-0000-4000-8000-000000000002';
const initial = (level=1) => ({
  player: { gold: 1000, gems: 10, level: 20, xp: 0, maxEnergy: 20 },
  inventory: [], forgeMaterials: 50, battleStones: 100,
  trialLevel: level, trialChestClaims: [], trialChestUnopenedFloors: [],
  trialChestOpenedFloors: [], lastTrialChest: null, territoryCityReputation: 0,
});

async function snapshot(id=playerId) {
  return (await db.query('SELECT * FROM public.players WHERE id=$1',[id])).rows[0];
}
async function update(id, state) {
  await db.query('UPDATE public.players SET game_state=$2::jsonb WHERE id=$1',[id,state]);
}
async function open(floor, expected) {
  return (await db.query('SELECT public.territory_trial_chest_open_v1($1,$2) AS r',[floor,expected])).rows[0].r;
}
/* PGlite returns timestamptz as a JS Date, dropping fractional microseconds.
 * Preserve the exact PostgreSQL CAS token within SQL for positive test cases.
 * Production callers use an exact cloud string, not this isolated Date fixture. */
async function openCurrent(floor, playerId) {
  return (await db.query(
    'SELECT public.territory_trial_chest_open_v1($1,(SELECT updated_at FROM public.players WHERE id=$2)) AS r',
    [floor,playerId]
  )).rows[0].r;
}
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA territory_private; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    CREATE TABLE public.players (
      id uuid PRIMARY KEY, banned boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      gold integer NOT NULL, gems integer NOT NULL, forge_materials integer NOT NULL,
      game_state jsonb NOT NULL);
    CREATE FUNCTION public.fixture_touch_vault() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN IF NEW.game_state IS DISTINCT FROM OLD.game_state THEN
          NEW.updated_at := GREATEST(clock_timestamp(),OLD.updated_at + interval ''1 microsecond'');
        END IF; RETURN NEW; END';
    CREATE TRIGGER fixture_touch_vault BEFORE UPDATE OF game_state ON public.players
      FOR EACH ROW EXECUTE FUNCTION public.fixture_touch_vault();
  `);
  await db.exec(migration);
  await db.query('INSERT INTO public.players(id,gold,gems,forge_materials,game_state) VALUES($1,1000,10,50,$2::jsonb)',[playerId,initial()]);
  await db.query('INSERT INTO public.players(id,gold,gems,forge_materials,game_state) VALUES($1,1000,10,50,$2::jsonb)',[otherId,{...initial(12),trialChestClaims:Array.from({length:11},(_,i)=>i+1),lastTrialChest:{floor:11,tier:'common',gold:23,gems:1}}]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM territory_private.trial_chest_v1')).rows[0].n,0,
    'legacy paid chests must never be backfilled');
  await db.query('SELECT set_config($1,$2,false)',['request.jwt.claim.sub',playerId]);

  // A forged pending floor without a legitimate 1-floor advance creates no server chest.
  await update(playerId,{...initial(),trialChestUnopenedFloors:[999],trialChestClaims:[999]});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM territory_private.trial_chest_v1')).rows[0].n,0);
  await assert.rejects(open(999,(await snapshot()).updated_at),/trial_chest_not_reserved/);
  await update(playerId,initial());

  let won={...initial(),trialLevel:2,trialChestClaims:[1],trialChestUnopenedFloors:[1]};
  await update(playerId,won);
  let chestRows=(await db.query('SELECT floor,tier,opened_at FROM territory_private.trial_chest_v1 WHERE player_id=$1',[playerId])).rows;
  assert.deepEqual(chestRows.map(x=>[x.floor,x.tier]),[[1,'common']]);
  assert.equal(chestRows[0].opened_at,null);
  let before=await snapshot();
  assert.equal(before.gold,1000,'victory cannot auto-pay sealed chest');
  assert.equal(before.gems,10);
  let receipt=await openCurrent(1,playerId);
  assert.equal(receipt.success,true);
  assert.equal(receipt.already_opened,false);
  assert.equal(receipt.receipt.floor,1);
  assert.equal(receipt.receipt.tier,'common');
  assert(receipt.receipt.gold>=20 && receipt.receipt.gold<=40);
  assert.equal(receipt.game_state.player.gold,1000+receipt.receipt.gold);
  assert.deepEqual(receipt.game_state.trialChestUnopenedFloors,[]);
  assert.deepEqual(receipt.game_state.trialChestOpenedFloors,[1]);
  assert.equal(receipt.wallet_gold,receipt.game_state.player.gold);
  const paid=await snapshot();
  const replay=await open(1,before.updated_at);
  assert.equal(replay.already_opened,true);
  assert.deepEqual(replay.receipt,receipt.receipt,'receipt cannot be rolled again');
  assert.equal((await snapshot()).gold,paid.gold,'idempotent replay cannot pay twice');

  const cases=[
    {floor:5,tier:'explorer',gold:90,gems:2,materials:1,elixirs:1},
    {floor:10,tier:'guardian',gold:160,gems:3,materials:2,elixirs:2},
    {floor:25,tier:'legendary',gold:280,gems:5,materials:3,elixirs:3},
  ];
  for(const expected of cases) {
    const current=await snapshot();
    const base={...current.game_state,trialLevel:expected.floor,trialChestUnopenedFloors:[]};
    await update(playerId,base); // simulated progression through earlier floors; no new payout.
    won={...base,trialLevel:expected.floor+1,
      trialChestClaims:[...base.trialChestClaims,expected.floor],
      trialChestUnopenedFloors:[expected.floor]};
    await update(playerId,won);
    const queued=await snapshot();
    const seen=(await db.query('SELECT tier,opened_at FROM territory_private.trial_chest_v1 WHERE player_id=$1 AND floor=$2',[playerId,expected.floor])).rows[0];
    assert.equal(seen.tier,expected.tier);
    assert.equal(seen.opened_at,null);
    await assert.rejects(open(expected.floor,new Date(0)),/trial_chest_reload_required/);
    assert.equal((await snapshot()).gold,queued.gold,'stale CAS must not grant loot');
    const value=await openCurrent(expected.floor,playerId);
    assert.equal(value.receipt.tier,expected.tier);
    for(const field of ['gold','gems','materials','elixirs']) assert.equal(value.receipt[field],expected[field]);
    assert.equal(value.wallet_gold,queued.gold+expected.gold);
    assert.equal(value.wallet_gems,queued.gems+expected.gems);
    assert(!value.game_state.trialChestUnopenedFloors.includes(expected.floor));
    assert(value.game_state.trialChestOpenedFloors.includes(expected.floor));
    assert.equal((await open(expected.floor,queued.updated_at)).already_opened,true);
  }
  await db.query('SELECT set_config($1,$2,false)',['request.jwt.claim.sub',otherId]);
  await assert.rejects(open(1,(await snapshot(otherId)).updated_at),/trial_chest_not_reserved/,
    'player can never read or open another player’s chest');

  const oldRow=await snapshot(otherId);
  assert.equal(oldRow.game_state.lastTrialChest.floor,11);
  assert.deepEqual(oldRow.game_state.trialChestUnopenedFloors,[]);
  console.log('Sealed Trial chest SQL PASS: server-reserved win, historical safety, wallet unchanged until open, four tiers, CAS, receipts, replay and owner scope.');
} finally { await db.close(); }
