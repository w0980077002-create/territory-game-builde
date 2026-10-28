/** All completion SQL in one isolated PostgreSQL; no production or network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/game/combatV1/service.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { executeCombatCommand } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const db = new PGlite();
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
let n = 0;
const op = () => `20000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const rpc = async (name, args = []) => (await q(`SELECT ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args))[0].r;
const as = async player => q("SELECT set_config('request.jwt.claim.sub',$1,false)", [player]);
const repository = {
  context: (player, command) => rpc('territory_combat_context_v1', [player, command]),
  commit: (player, command, context, result) => rpc('territory_combat_commit_v1', [player, command, context, result]),
};
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA territory_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE players(id uuid PRIMARY KEY,telegram_id bigint UNIQUE,display_name text,banned boolean DEFAULT false,
      vip_level integer DEFAULT 0,gold integer DEFAULT 1000,gems integer DEFAULT 1000,forge_materials integer DEFAULT 0,
      game_state jsonb DEFAULT '{}',updated_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE admin_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_id uuid REFERENCES players(id),kind text,subject text,body text,payload jsonb,claimed_at timestamptz);
    CREATE TABLE territory_release_flags_v1(id integer PRIMARY KEY); INSERT INTO territory_release_flags_v1 VALUES(1);
    CREATE TABLE territory_crafted_items_v1(item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_id uuid REFERENCES players(id),item_output jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE territory_profession_stage8_items(item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_id uuid REFERENCES players(id),item_output jsonb,expires_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE territory_wallet_v1(player_id uuid PRIMARY KEY REFERENCES players(id),gold bigint,gems bigint,verified boolean DEFAULT false,updated_at timestamptz DEFAULT now());
    CREATE TABLE territory_resource_wallet(player_id uuid REFERENCES players(id),resource_id text,quantity bigint,PRIMARY KEY(player_id,resource_id));
    CREATE TABLE territory_private.territory_master_license_red_wallet_v1(player_id uuid PRIMARY KEY,balance integer);
    CREATE TABLE territory_private.territory_master_license_buy_events_v1(player_id uuid PRIMARY KEY);
    CREATE TABLE territory_profession_unlocks(player_id uuid PRIMARY KEY,master_license boolean);
    CREATE TABLE territory_profession_mastery_v1(player_id uuid PRIMARY KEY,verified boolean,mastery_level integer);
    CREATE TABLE territory_profession_stage8_progress(player_id uuid PRIMARY KEY,verified boolean,mastery_level integer);
    CREATE FUNCTION territory_profession_stage8_execute(text,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
    CREATE TABLE territory_private.fortune_inventory_v1(player_id uuid PRIMARY KEY,vip_until timestamptz);
    CREATE FUNCTION territory_private.fortune_vip_v1(u uuid) RETURNS integer LANGUAGE sql STABLE AS $$SELECT greatest(p.vip_level,CASE WHEN f.vip_until>statement_timestamp() THEN 1 ELSE 0 END) FROM public.players p LEFT JOIN territory_private.fortune_inventory_v1 f ON f.player_id=p.id WHERE p.id=u$$;
    GRANT SELECT ON players TO service_role;`);
  const legacy = { player: { name: 'Legacy', gold: 1000, gems: 1000, redGems: 1000, equipped: {} }, inventory: [{ id: 'legacy', qty: 7 }], blessing: { day: '', charges: 2 }, unknown: { keep: true } };
  for (const [player, telegram] of [[A, 111], [B, 222]]) {
    await q('INSERT INTO players(id,telegram_id,display_name,game_state,vip_level) VALUES($1,$2,$3,$4,1)', [player, telegram, player, legacy]);
    await q('INSERT INTO territory_wallet_v1 VALUES($1,1000,1000,true,now())', [player]);
    await q('INSERT INTO territory_private.territory_master_license_red_wallet_v1 VALUES($1,1000)', [player]);
  }
  const before = await q('SELECT * FROM players ORDER BY id');
  for (const filename of ['territory_stage5_auction.sql', '20261026_admin_claim_atomic_v2.sql',
    'territory_v1_auction_completion.sql', 'territory_v1_progression_completion.sql',
    'territory_v1_monetization_completion.sql', 'territory_v1_combat_completion.sql', 'territory_v1_completion_integration.sql'])
    await db.exec(readFileSync('supabase/staged/' + filename, 'utf8'));
  assert.deepEqual(await q('SELECT * FROM players ORDER BY id'), before, 'combined install preserves player rows');
  // Test-only catalogs. No production values are inserted by completion SQL.
  await db.exec(`UPDATE territory_release_flags_v1 SET auction_enabled=true,auction_completion_enabled=true;
    UPDATE territory_private.v1_progression_config SET enabled=true;
    UPDATE territory_private.monetization_config_v1 SET vip_enabled=true,payments_enabled=true;
    INSERT INTO territory_private.vip_tiers_v1 VALUES(1,0,1000,0,1000,'TEST FIXTURE');
    INSERT INTO territory_private.v1_gem_rules VALUES('test_ruby',1,null,10,0,20);
    INSERT INTO territory_private.v1_socket_rules VALUES('rare',1);
    INSERT INTO territory_private.stars_catalog_v1(sku,title,description,stars,gold,enabled,approval_reference) VALUES('fixture','Test','Test',10,50,true,'TEST FIXTURE');`);
  for (let i = 1; i <= 5; i++) await q('INSERT INTO territory_private.v1_activity_rules VALUES($1,$2,1)', ['test_activity_' + i, i]);
  await q("INSERT INTO territory_private.v1_reward_rules VALUES('daily20','daily',null,'free',20,'{\"gold\":5}')");
  await as(A);
  const item = (await q(`INSERT INTO territory_crafted_items_v1(player_id,item_output) VALUES($1,'{"name":"Test Axe","type":"equipment","rarity":"rare","equipment":{"slot":"weapon","attack":10}}') RETURNING item_id`, [A]))[0].item_id;
  await rpc('territory_private.v1_progression_event', [A, op(), 'gem_grant', { kind: 'test_ruby', level: 1, quantity: 1 }]);
  await rpc('territory_progression_action_v1', ['insert_gem', op(), { source: 'stage3', itemId: item, socket: 1, kind: 'test_ruby', level: 1 }]);
  const lot = await rpc('territory_auction_trade_v2', ['list', op(), item, null, 100, 'gold', 'stage3', 86400]);
  await as(B);
  await rpc('territory_auction_trade_v2', ['buy', op(), null, lot.listing_id, null, 'gold', 'stage3', 86400]);
  assert.equal((await rpc('territory_private.v1_gem_item_stats', [B, item])).attack, 10, 'socket follows auction ownership');
  await assert.rejects(rpc('territory_private.v1_gem_item_stats', [A, item]), /unverified/);
  // A paid order after a trade must use exactly the same canonical wallet.
  const order = await rpc('territory_stars_order_v1', ['fixture', op()]);
  assert.equal(await rpc('territory_stars_precheckout_v1', [order.orderId, 222, 'XTR', 10, 'combined-query']), true);
  await rpc('territory_stars_fulfill_v1', [order.orderId, 222, 'XTR', 10, 'combined-charge']);
  const wallet = (await q('SELECT p.gold,w.gold AS verified_gold,p.game_state FROM players p JOIN territory_wallet_v1 w ON w.player_id=p.id WHERE p.id=$1', [B]))[0];
  assert.equal(wallet.gold, 950); assert.equal(Number(wallet.verified_gold), 950); assert.equal(wallet.game_state.player.gold, 950);
  assert.deepEqual(wallet.game_state.inventory, legacy.inventory);
  const fighter = { stats: { hp: 100, maxHp: 100, attack: 100, defense: 0, critChance: 0, dodgeChance: 0, blockChance: 0 },
    loadout: { skills: [], passives: [] }, ownership: { heroLevel: 1, skills: {}, runes: {}, passives: {} } };
  const enemy = structuredClone(fighter); enemy.stats.attack = 1; enemy.stats.hp = enemy.stats.maxHp = 1;
  const rules = { stepMs: 10, maxDurationMs: 1000, approachMs: 10, attackIntervalMs: 100, basicWindupMs: 10, basicMultiplier: 1,
    defenseFactor: 0.5, magicDefenseFactor: 0.2, minimumDamage: 1, critMultiplier: 2, blockMultiplier: 0,
    maxEnergy: 0, initialEnergy: 0, energyPerSecond: 0, modeDamageMultiplier: { pve: 1, boss: 1, pvp: 1 } };
  await q("UPDATE territory_private.combat_config_v1 SET enabled=true,approval_reference='TEST',rules=$1", [rules]);
  await q("INSERT INTO territory_private.combat_profiles_v1(player_id,verified,fighter,equipped_item_ids,approval_reference) VALUES($1,true,$2,$3,'TEST')", [B, fighter, [item]]);
  await q("INSERT INTO territory_private.combat_encounters_v1(encounter_id,enabled,mode,stage,enemy,approval_reference) VALUES('test_fight',true,'pve',1,$1,'TEST')", [enemy]);
  await db.exec("INSERT INTO territory_private.v1_combat_activity_sources VALUES('pve','test_activity_1','TEST'); INSERT INTO territory_private.v1_combat_fund_sources VALUES('test_fight','adventure',1,'TEST')");
  const command = { action: 'start', operationId: op(), encounterId: 'test_fight', control: 'auto' };
  const started = await executeCombatCommand(repository, B, command, () => 7);
  assert.equal(started.state.actors.hero.stats.attack, 121, '(100+10 gem)*1.1 VIP, once');
  assert.equal(started.state.actors.hero.stats.maxHp, 132);
  await q('UPDATE territory_private.combat_sessions_v1 SET cursor_ms=cursor_ms-100 WHERE session_id=$1', [started.session_id]);
  const turn = { action: 'advance', operationId: op(), sessionId: started.session_id, revision: 0 };
  const finished = await executeCombatCommand(repository, B, turn, () => 7);
  assert.equal(finished.state.status, 'hero_won');
  assert.deepEqual(await executeCombatCommand(repository, B, turn, () => 7), finished);
  assert.equal(finished.state.input.hero.stats.attack, 121, 'advance never reapplies gem/VIP');
  assert.equal((await rpc('territory_progression_status_v1')).dailyPoints, 20, 'trusted outcome -> once activity');
  assert.equal((await rpc('territory_progression_status_v1')).funds[0].progress, 1);
  const reward = await rpc('territory_progression_action_v1', ['claim_reward', op(), { ruleId: 'daily20' }]);
  await rpc('territory_admin_claim_grant_v2', [reward.grantId]);
  const afterClaim = (await q('SELECT p.gold,w.gold AS verified_gold,p.game_state FROM players p JOIN territory_wallet_v1 w ON w.player_id=p.id WHERE p.id=$1', [B]))[0];
  assert.equal(afterClaim.gold, 955); assert.equal(Number(afterClaim.verified_gold), 955);
  assert.deepEqual(afterClaim.game_state.unknown, legacy.unknown);
  await db.exec("INSERT INTO territory_private.stars_catalog_v1(sku,title,description,stars,premium_fund,enabled,approval_reference) VALUES('fund_fixture','Test fund','Test fund',10,'adventure',true,'TEST FIXTURE')");
  const fundOrder = await rpc('territory_stars_order_v1', ['fund_fixture', op()]);
  assert.equal(await rpc('territory_stars_precheckout_v1', [fundOrder.orderId, 222, 'XTR', 10, 'combined-fund-query']), true);
  const fulfillArgs = [fundOrder.orderId, 222, 'XTR', 10, 'combined-fund-charge'];
  await rpc('territory_stars_fulfill_v1', fulfillArgs);
  await rpc('territory_stars_fulfill_v1', fulfillArgs);
  const fund = (await rpc('territory_progression_status_v1')).funds.find(f => f.fund === 'adventure');
  assert.equal(fund.premium, true, 'real payment -> premium fund entitlement');
  assert.equal((await q('SELECT gold FROM players WHERE id=$1', [B]))[0].gold, 955, 'fund-only payment never invents a currency grant');
  console.log('PASS combined staging: unchanged install, gem resale, auction->Stars same wallet, gem+VIP once combat, outcome->activity/fund->real mail reward.');
} finally { await db.close(); }
