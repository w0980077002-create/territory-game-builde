import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const daySql=read('supabase/migrations/20261110014000_mortarion_reward_days_v1.sql');
const statusSql=read('supabase/migrations/20261110015000_mortarion_reward_status_v1.sql');
const claimSql=read('supabase/migrations/20261110015500_mortarion_reward_claim_v1.sql');
const ui=read('src/components/MortarionRewardPanel.tsx');
const raid=read('src/components/MortarionBossScreen.tsx');
const api=read('src/game/mortarionRewards.ts');
const profile=read('src/components/HeroShowcase.tsx');

assert.match(daySql,/AFTER INSERT OR UPDATE OF total_hits/);
assert.match(daySql,/hit_days=ARRAY\[1\]/);
assert.match(daySql,/NEW\.last_hit_at/);
assert.doesNotMatch(daySql,/owner_test_bots_v1|auto_mortarion/,'all legitimate participants must be counted');
assert.match(claimSql,/SECURITY DEFINER SET search_path=''/);
assert.match(claimSql,/FOR NO KEY UPDATE/);
assert.match(claimSql,/FOR SHARE/);
assert.match(claimSql,/mortarion_rewards_reload_required/);
assert.match(claimSql,/mortarion_reward_receipts_v1/);
assert.match(claimSql,/v_rank BETWEEN 1 AND 3/);
assert.match(claimSql,/v_heart:=[\s\S]*0\.003/);
assert.match(claimSql,/v_stone:=[\s\S]*0\.0005/);
assert.doesNotMatch(claimSql,/redGems|UPDATE public\.territory_mortarion_2026\b|DELETE FROM public\.players/);
assert.match(raid,/getMortarionRewardStatus/);
assert.match(raid,/MortarionRewardPanel/);
assert.match(ui,/data-testid="mortarion-rewards"/);
assert.match(ui,/data-testid="mortarion-claim-reward"/);
assert.match(api,/protectFortuneSave/);
assert.match(api,/acceptMonopolyClaimReceipt/);
assert.match(profile,/mortarionHonor/);

const db=new PGlite();
async function run(sql) { await db.exec(sql); }
async function query(sql,args=[]) {return (await db.query(sql,args)).rows;}
await run([
 'CREATE ROLE anon;',
 'CREATE ROLE authenticated;',
 'CREATE ROLE service_role;',
 'CREATE SCHEMA IF NOT EXISTS territory_private;',
 'CREATE SCHEMA IF NOT EXISTS auth;',
 "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;",
 'CREATE TABLE public.players (id uuid PRIMARY KEY, display_name text, level integer NOT NULL DEFAULT 1, banned boolean NOT NULL DEFAULT false, gold integer NOT NULL DEFAULT 0, gems integer NOT NULL DEFAULT 0, forge_materials integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), game_state jsonb NOT NULL);',
 'CREATE TABLE public.territory_mortarion_2026(id text PRIMARY KEY,max_hp bigint NOT NULL,hp bigint NOT NULL,enabled boolean NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());',
 'CREATE TABLE public.territory_mortarion_2026_players(event_id text NOT NULL,player_id uuid NOT NULL,total_damage bigint NOT NULL DEFAULT 0,total_hits integer NOT NULL DEFAULT 0,hour_started_at timestamptz,hits_in_hour integer NOT NULL DEFAULT 0,last_hit_at timestamptz,PRIMARY KEY(event_id,player_id));',
].join('\n'));
await run(daySql);
await run(statusSql);
await run(claimSql);

const bot='00000000-0000-4000-8000-000000000001';
const human='00000000-0000-4000-8000-000000000002';
const newcomer='00000000-0000-4000-8000-000000000003';
const state=(name)=>({
 player:{name,level:61,gold:1000,gems:100,redGems:0,energy:5,maxEnergy:10},
 inventory:[],forgeMaterials:10,battleStones:7
});
for (const [id,name] of [[bot,'Managed tester'],[human,'Human player'],[newcomer,'Late participant']]) {
 await query('INSERT INTO public.players(id,display_name,gold,gems,forge_materials,game_state) VALUES($1,$2,1000,100,10,$3::jsonb)',[id,name,JSON.stringify(state(name))]);
}
await run("INSERT INTO public.territory_mortarion_2026(id,max_hp,hp,enabled,starts_at,ends_at,updated_at) VALUES('mortarion_2026',100000000,90000000,true,now()-interval '5 days',now()+interval '1 day',now())");
await query("INSERT INTO public.territory_mortarion_2026_players(event_id,player_id,total_damage,total_hits,last_hit_at,hit_days) VALUES('mortarion_2026',$1,500000,15,now()-interval '1 day',ARRAY[1,2,3,4,5]),('mortarion_2026',$2,250000,2,now()-interval '1 day',ARRAY[1,2])",[bot,human]);
await query("SELECT set_config('request.jwt.claim.sub',$1,false)",[bot]);
const ongoing=(await query('SELECT public.territory_mortarion_reward_status_v1() AS s'))[0].s;
assert.equal(ongoing.totalHits,15);
assert.equal(ongoing.activeDays,5);
assert.equal(ongoing.claimed,false);
assert.equal(ongoing.canClaim,false);
await assert.rejects(query('SELECT public.territory_mortarion_reward_claim_v1(now())'),/mortarion_rewards_not_final/);

await run("UPDATE public.territory_mortarion_2026 SET ends_at=now()-interval '1 second'");
const botBefore=(await query('SELECT updated_at,gold,gems FROM public.players WHERE id=$1',[bot]))[0];
const b=(await query('SELECT public.territory_mortarion_reward_claim_v1((SELECT updated_at FROM public.players WHERE id=$1)) AS r',[bot]))[0].r;
assert.equal(b.success,true);
assert.equal(b.already_claimed,false);
assert.equal(b.receipt.place,1,'automated tester is eligible for real top-1 rewards');
assert.equal(b.receipt.tier,'legendary');
assert.equal(b.receipt.title,'Повелитель душ');
assert.equal(b.receipt.gold,1200);
assert.equal(b.receipt.gems,24);
assert.equal(b.game_state.mortarionHonor.frame,'mortarion_lord');
assert.equal(b.game_state.player.gold,2200);
assert.equal(b.game_state.player.gems,124);
assert.equal(b.game_state.player.redGems,0);

const repeated=(await query('SELECT public.territory_mortarion_reward_claim_v1(now()) AS r'))[0].r;
assert.equal(repeated.already_claimed,true,'repeated claim returns original receipt');
assert.deepEqual(repeated.receipt,b.receipt);
const botAfter=(await query('SELECT gold,gems FROM public.players WHERE id=$1',[bot]))[0];
assert.equal(botAfter.gold,2200,'replay must not pay twice');
assert.equal(botAfter.gems,124);

await query("SELECT set_config('request.jwt.claim.sub',$1,false)",[human]);
const hBefore=(await query('SELECT updated_at FROM public.players WHERE id=$1',[human]))[0];
const h=(await query('SELECT public.territory_mortarion_reward_claim_v1((SELECT updated_at FROM public.players WHERE id=$1)) AS r',[human]))[0].r;
assert.equal(h.receipt.place,2);
assert.equal(h.receipt.tier,'hunter','rank 2 has an upgraded chest');
assert.equal(h.receipt.fragment,true,'top 2 always receives blueprint fragment');
assert.equal(h.receipt.frame,'mortarion_conqueror');
assert.equal(h.receipt.gold,500);
assert.equal(h.game_state.mortarionHonor.title,'Покоритель тьмы');

const count=(await query('SELECT count(*)::integer AS c FROM territory_private.mortarion_reward_receipts_v1'))[0].c;
assert.equal(count,2,'two receipts exactly for two real participant identities');
await query("INSERT INTO public.territory_mortarion_2026_players(event_id,player_id,total_damage,total_hits,hit_days) VALUES('mortarion_2026',$1,0,0,ARRAY[]::integer[])",[newcomer]);
await query("UPDATE public.territory_mortarion_2026_players SET total_hits=1,last_hit_at=(SELECT starts_at+interval '2 days' FROM public.territory_mortarion_2026 WHERE id='mortarion_2026') WHERE player_id=$1",[newcomer]);
const tracked=(await query('SELECT hit_days FROM public.territory_mortarion_2026_players WHERE player_id=$1',[newcomer]))[0].hit_days;
assert.deepEqual(tracked,[3],'human and tester hits use identical 24h day-credit trigger');
await db.close();
console.log('MORTARION REWARDS PASS: tier progression, tester TOP1, human TOP2, exact wallet, no duplicates, and live day trigger');
