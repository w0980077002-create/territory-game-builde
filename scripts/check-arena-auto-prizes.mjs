// Full offline PostgreSQL payout tests; NEVER connects to live Supabase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const sql = (statement, args = []) => db.query(statement, args);
const one = async (statement, args = []) => (await sql(statement, args)).rows[0];
const fixture = (name) => readFileSync(`supabase/staged/${name}.sql`, 'utf8');
const primary = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const banned = '33333333-3333-4333-8333-333333333333';
const fourth = '44444444-4444-4444-8444-444444444444';

function jsHash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}
function namesFromClient() {
  const client = readFileSync('src/game/arenaWeeklyBots.ts', 'utf8');
  const extract = (name) => [...client.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const`))[1]
    .matchAll(/'([^']+)'/g)].map(x => x[1]);
  return [...extract('RUSSIAN_ARENA_BOT_NAMES'), ...extract('ENGLISH_ARENA_BOT_NAMES')];
}
function clientFinalWins(week) {
  const ordered = namesFromClient().sort((a,b) =>
    jsHash(week + ':' + a + ':skill') - jsHash(week + ':' + b + ':skill') || a.localeCompare(b));
  return new Map(ordered.map((name, index) => {
    const strength = 49 - index;
    return [name, 1 + strength * 3 + Math.round(27 * (strength/49) ** 2)];
  }));
}

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA territory_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE players (
      id uuid PRIMARY KEY,display_name text,telegram_id bigint,banned boolean DEFAULT false,
      arena_rating integer NOT NULL DEFAULT 1000,
      gold integer NOT NULL DEFAULT 0,gems integer NOT NULL DEFAULT 0,
      forge_materials integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      game_state jsonb NOT NULL DEFAULT '{"player":{"gold":0,"gems":0,"redGems":0,"equipped":{}},"inventory":[],"battleStones":0,"forgeMaterials":0}'
    );
    CREATE TABLE public.territory_profession_unlocks(player_id uuid PRIMARY KEY REFERENCES players(id),profession text,master_license boolean DEFAULT false);
    CREATE TABLE territory_private.referral_claim_cursor_v1(player_id uuid PRIMARY KEY REFERENCES players(id),red_paid integer DEFAULT 0);
    CREATE TABLE admin_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_id uuid REFERENCES players(id),kind text,subject text,body text,payload jsonb,claimed_at timestamptz);
    CREATE TABLE arena_weekly_wins_v1(room_id uuid DEFAULT gen_random_uuid(),player_id uuid,won_at timestamptz,PRIMARY KEY(room_id,player_id));`);
  await db.exec(fixture('territory_master_license_shop_v1'));
  await db.exec(fixture('20261026_admin_claim_atomic_v2'));
  await db.exec(fixture('territory_arena_top50_auto_rewards_v1'));
  await db.exec('SELECT territory_private.arena_top50_rewards_tick_v1()');
  assert.equal((await one('SELECT count(*)::integer AS n FROM territory_private.arena_top50_reward_weeks_v1')).n,0,
    'Fresh install cannot pay until activation');

  for (const week of ['2026-10-18','2026-10-25','2026-11-01','2027-02-14','2028-10-29']) {
    const expected = clientFinalWins(week);
    const result = await sql('SELECT bot_name,wins FROM territory_private.arena_top50_bot_final_v1($1::date)',[week]);
    assert.equal(result.rows.length,50);
    assert.equal(new Set(result.rows.map(r => r.wins)).size,50);
    for (const {bot_name,wins} of result.rows) {
      assert.equal(wins,expected.get(bot_name),`${week}: SQL must match the displayed bot ${bot_name}`);
    }
  }

  const current = (await one(`SELECT ((now() AT TIME ZONE 'UTC')::date
    - extract(dow FROM (now() AT TIME ZONE 'UTC')::date)::integer) AS week`)).week;
  const currentWeek = new Date(current).toISOString().slice(0,10);
  const pastWeek = new Date(Date.parse(currentWeek+'T00:00:00Z')-7*86400000).toISOString().slice(0,10);
  await sql(`INSERT INTO players(id,display_name,telegram_id,banned,arena_rating)
    VALUES($1,'Сергей',1,false,1400),($2,'Гарик',2,false,1350),
      ($3,'Banned',3,true,1200),($4,'Фрей',4,false,1100)`,[primary,second,banned,fourth]);
  await sql(`INSERT INTO arena_weekly_wins_v1(player_id,won_at)
    SELECT $1::uuid,$5::date::timestamp AT TIME ZONE 'UTC' + interval '1 day'
    FROM generate_series(1,249)
    UNION ALL SELECT $2::uuid,$5::date::timestamp AT TIME ZONE 'UTC' + interval '2 days'
    FROM generate_series(1,215)
    UNION ALL SELECT $3::uuid,$5::date::timestamp AT TIME ZONE 'UTC' + interval '3 days'
    FROM generate_series(1,200)
    UNION ALL SELECT $4::uuid,$5::date::timestamp AT TIME ZONE 'UTC' + interval '4 days'
    FROM generate_series(1,40)`,[primary,second,banned,fourth,pastWeek]);

  // Simulate approved activation with one past/current week. Older weeks remain untouched.
  await sql(`UPDATE territory_private.arena_top50_reward_config_v1
    SET enabled=true,first_week=$1`,[pastWeek]);
  await db.exec(`CREATE FUNCTION refuse_arena_mail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.subject LIKE 'Арена · ТОП-50%' THEN RAISE EXCEPTION 'mail_outage'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER refuse_arena_mail BEFORE INSERT ON admin_grants
    FOR EACH ROW EXECUTE FUNCTION refuse_arena_mail();`);
  await assert.rejects(db.exec('SELECT territory_private.arena_top50_rewards_tick_v1()'),/mail_outage/);
  assert.equal((await one('SELECT count(*)::integer AS n FROM territory_private.arena_top50_reward_weeks_v1')).n,0,
    'No partial snapshot after mail failure');
  assert.equal((await one('SELECT count(*)::integer AS n FROM admin_grants')).n,0,
    'No partial payout mail after failure');
  await db.exec('DROP TRIGGER refuse_arena_mail ON admin_grants');

  await db.exec('SELECT territory_private.arena_top50_rewards_tick_v1()');
  const ranks=(await sql(`SELECT place,player_id,virtual_contender,wins,reward,grant_id
    FROM territory_private.arena_top50_reward_results_v1 ORDER BY place`)).rows;
  assert.equal(ranks.length,50,'Exactly 50 frozen standings');
  assert.deepEqual(ranks.slice(0,3).map(r=>r.player_id),[primary,second,banned]);
  assert.deepEqual(ranks.slice(0,3).map(r=>r.wins),[249,215,200]);
  assert.equal(ranks[2].grant_id,null,'Banned ranking must not pay or shift the prize');
  assert(ranks.some(r=>r.player_id===fourth),'Player below top 3 still ranks');
  assert(ranks.some(r=>r.virtual_contender),'Mixed ranking retains virtual contenders');
  assert(ranks.filter(r=>r.virtual_contender).every(r=>r.grant_id===null&&Object.keys(r.reward).length===0),
    'No payments for virtual contenders');
  const first = ranks[0];
  assert.equal(first.reward.gems,120);
  assert.equal(first.reward.redGems,3);
  assert.equal(first.reward.stones,25);
  assert.deepEqual(first.reward.items,{shop_elixir_atk:7,shop_elixir_def:7,shop_elixir_crit:6});
  for (const r of ranks.filter(r=>r.grant_id)) {
    assert.equal(Object.values(r.reward.items).reduce((sum,n)=>sum+n,0),
      r.place===1?20:r.place===2?15:r.place===3?12:r.place===4?10:r.place===5?8:5);
  }
  const countBefore=(await one('SELECT count(*)::integer AS n FROM admin_grants')).n;
  await db.exec('SELECT territory_private.arena_top50_rewards_tick_v1(); SELECT territory_private.arena_top50_rewards_tick_v1()');
  assert.equal((await one('SELECT count(*)::integer AS n FROM admin_grants')).n,countBefore,
    'Repeated cron ticks cannot issue twice');

  // Real claim updates blue/red/stones + three seven-day elixir item lots, once.
  await sql("SELECT set_config('test.uid',$1,false)",[primary]);
  const receipt=(await one('SELECT public.territory_admin_claim_grant_v2($1) AS v',[first.grant_id])).v;
  assert.equal(receipt.success,true);
  assert.equal(receipt.wallet_gems,120);
  assert.equal(receipt.game_state.player.redGems,3);
  assert.equal(receipt.game_state.battleStones,25);
  assert.equal(receipt.game_state.inventory.length,3);
  assert(receipt.game_state.inventory.every(i=>i.expiresAt));
  const repeated=(await one('SELECT public.territory_admin_claim_grant_v2($1) AS v',[first.grant_id])).v;
  assert.equal(repeated.replayed,true);
  assert.equal(repeated.wallet_gems,120);
  assert.equal((await one('SELECT count(*)::integer AS n FROM territory_private.territory_master_license_credit_events_v1')).n,1,
    'Protected red-gem wallet credited exactly once');

  // Cancelling an archived letter cannot silently remint it.
  await sql("DELETE FROM admin_grants WHERE id=$1",[ranks[1].grant_id]);
  await db.exec('SELECT territory_private.arena_top50_rewards_tick_v1()');
  assert.equal((await one('SELECT count(*)::integer AS n FROM admin_grants')).n,countBefore-1);
  assert.equal((await one('SELECT count(*)::integer AS n FROM territory_private.arena_top50_reward_weeks_v1')).n,1);
  for(const role of ['anon','authenticated']) {
    assert.equal((await one("SELECT has_function_privilege($1,'territory_private.arena_top50_rewards_tick_v1()','execute') AS allowed",[role])).allowed,false);
  }
  console.log('Arena TOP-50 auto rewards: 50 ranks, exact client/SQL bot scores, UTC cutoff, 3 elixirs, verified mail and atomic claim, crash rollback, idempotent retry: PASS');
} finally {
  await db.close();
}
