// Offline PostgreSQL lifecycle tests; never connects to production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA territory_private; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE players(id uuid PRIMARY KEY,display_name text,telegram_id bigint,banned boolean DEFAULT false,
 gold integer NOT NULL DEFAULT 0,gems integer NOT NULL DEFAULT 0,forge_materials integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 game_state jsonb NOT NULL DEFAULT '{"player":{"gold":0,"gems":0,"redGems":0,"equipped":{}},"inventory":[],"battleStones":0,"forgeMaterials":0}');
 CREATE TABLE public.territory_profession_unlocks(player_id uuid PRIMARY KEY REFERENCES players(id),profession text,master_license boolean DEFAULT false);
 CREATE TABLE territory_private.referral_claim_cursor_v1(player_id uuid PRIMARY KEY REFERENCES players(id),red_paid integer DEFAULT 0);
 CREATE TABLE admin_audit_log(action text,details jsonb);
 CREATE TABLE arena_weekly_wins_v1(room_id uuid DEFAULT gen_random_uuid(),player_id uuid,won_at timestamptz,PRIMARY KEY(room_id,player_id));
 CREATE TABLE arena_rooms(id uuid PRIMARY KEY,status text,winner_team integer,finished_at timestamptz);
 CREATE TABLE arena_participants(room_id uuid,user_id uuid,is_bot boolean,team integer);
 CREATE TABLE admin_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_id uuid REFERENCES players(id),kind text,subject text,body text,payload jsonb,claimed_at timestamptz);`);
 await db.query('INSERT INTO players(id,display_name,telegram_id) VALUES($1,\'Alice\',1),($2,\'Bob\',2)',[a,b]);
 await db.exec(readFileSync('supabase/staged/territory_master_license_shop_v1.sql','utf8'));
 await db.exec(readFileSync('supabase/staged/20261026_admin_claim_atomic_v2.sql','utf8'));
 await db.exec(readFileSync('supabase/staged/territory_weekly_seasons_v1.sql','utf8'));
 await db.exec(readFileSync('supabase/staged/territory_weekly_seasons_admin_v1.sql','utf8'));
 await db.exec('SELECT territory_private.weekly_season_tick_v1()');
 assert.equal((await one('SELECT count(*)::int AS n FROM territory_private.weekly_seasons_v1')).n,0,'disabled default');
 await db.exec("UPDATE territory_private.weekly_season_config_v1 SET enabled=true");
 await assert.rejects(db.exec('SELECT territory_private.weekly_season_tick_v1()'),/season_prizes_required/);
 await db.exec("UPDATE territory_private.weekly_season_config_v1 SET enabled=false");
 await db.exec(readFileSync('supabase/staged/territory_weekly_seasons_activate_v1.sql','utf8'));
 const approved=[{gold:3000,gems:90},{gold:2000,gems:65},{gold:1500,gems:45},...Array.from({length:2},()=>({gold:1000,gems:30})),...Array.from({length:5},()=>({gold:500,gems:15}))];
 assert.equal((await one('SELECT count(*)::int AS n FROM territory_private.weekly_seasons_v1')).n,1);
 // Fixtures model two missed cron weeks. Real tick uses only server time.
 await db.exec(`INSERT INTO territory_private.weekly_seasons_v1(week,starts_at,ends_at,prizes)
 SELECT week-7,(week-7)::timestamp AT TIME ZONE 'Europe/Kyiv',starts_at,prizes FROM territory_private.weekly_seasons_v1`);
 await db.query(`INSERT INTO arena_weekly_wins_v1(player_id,won_at)
 SELECT $1::uuid,starts_at+interval '1 hour' FROM territory_private.weekly_seasons_v1 WHERE ends_at<=now()
 UNION ALL SELECT $1::uuid,starts_at+interval '2 hours' FROM territory_private.weekly_seasons_v1 WHERE ends_at<=now()
 UNION ALL SELECT $2::uuid,starts_at+interval '3 hours' FROM territory_private.weekly_seasons_v1 WHERE ends_at<=now()`,[a,b]);
 await db.exec(`CREATE FUNCTION fail_bob_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.player_id='22222222-2222-4222-8222-222222222222' THEN RAISE EXCEPTION 'test_delivery_failure'; END IF;
 RETURN NEW; END $$;
 CREATE TRIGGER fail_bob BEFORE INSERT ON admin_grants FOR EACH ROW EXECUTE FUNCTION fail_bob_grant()`);
 await assert.rejects(db.exec('SELECT territory_private.weekly_season_tick_v1()'),/test_delivery_failure/);
 assert.equal((await one('SELECT count(*)::int AS n FROM admin_grants')).n,0,'partial delivery rolls back');
 assert.equal((await one('SELECT count(*)::int AS n FROM territory_private.weekly_season_results_v1')).n,0);
 await db.exec('DROP TRIGGER fail_bob ON admin_grants');
 await db.exec('SELECT territory_private.weekly_season_tick_v1()');
 assert.equal((await one('SELECT count(*)::int AS n FROM admin_grants')).n,2);
 const result=(await db.query('SELECT player_id,rank,points,reward FROM territory_private.weekly_season_results_v1 ORDER BY rank')).rows;
 assert.deepEqual(result.map(r=>[r.player_id,r.rank,r.points,r.reward]),[[a,1,2,{gold:3000,gems:90}],[b,2,1,{gold:2000,gems:65}]]);
 await db.exec('SELECT territory_private.weekly_season_tick_v1(); SELECT territory_private.weekly_season_tick_v1()');
 assert.equal((await one('SELECT count(*)::int AS n FROM admin_grants')).n,2,'retry must never duplicate prizes');
 // Existing owner cancel_pending may delete an unclaimed season mail.
 // Keep immutable results/history; cancellation must not cause reissuance.
 const cancelled=(await one('SELECT grant_id FROM territory_private.weekly_season_results_v1 WHERE player_id=$1',[b])).grant_id;
 await db.query('DELETE FROM admin_grants WHERE id=$1 AND claimed_at IS NULL',[cancelled]);
 assert.equal((await one('SELECT grant_id FROM territory_private.weekly_season_results_v1 WHERE player_id=$1',[b])).grant_id,null);
 await db.exec('SELECT territory_private.weekly_season_tick_v1()');
 assert.equal((await one('SELECT count(*)::int AS n FROM admin_grants')).n,1,'cancelled season reward must never reissue');
 assert.deepEqual((await one('SELECT reward FROM territory_private.weekly_season_results_v1 WHERE player_id=$1',[b])).reward,{gold:2000,gems:65});
 await db.query("SELECT set_config('test.uid',$1,false)",[a]);
 const status=(await one('SELECT territory_season_status_v1() AS v')).v;
 assert.equal(status.enabled,true);assert.equal(status.history.length,2);assert.deepEqual(status.prizes,approved);
 assert.equal(status.my_points,0,'closed scores never leak into next week');
 await db.query("INSERT INTO arena_weekly_wins_v1(player_id,won_at) VALUES($1,now())",[a]);
 assert.equal((await one('SELECT territory_season_status_v1() AS v')).v.my_points,1);
 // Real mail claim, real protected red-wallet trigger: no stub RPC.
 const gift=(await one('SELECT grant_id FROM territory_private.weekly_season_results_v1 WHERE player_id=$1',[a])).grant_id;
 const before=(await one('SELECT updated_at FROM players WHERE id=$1',[a])).updated_at;
 const first=(await one('SELECT territory_admin_claim_grant_v2($1) AS v',[gift])).v;
 assert.deepEqual([first.success,first.replayed,first.wallet_gold,first.wallet_gems],[true,false,3000,90]);
 assert.equal(first.game_state.player.gold,3000);assert.equal(first.game_state.player.gems,90);
 assert.equal((await one('SELECT gold FROM players WHERE id=$1',[a])).gold,3000,'reopen reads durable gold');
 assert.equal((await one('SELECT count(*)::int AS n FROM players WHERE id=$1 AND updated_at=$2',[a,before])).n,0,'stale save version invalidated');
 const repeated=await Promise.all([one('SELECT territory_admin_claim_grant_v2($1) AS v',[gift]),one('SELECT territory_admin_claim_grant_v2($1) AS v',[gift])]);
 assert(repeated.every(r=>r.v.replayed&&r.v.wallet_gold===3000&&r.v.wallet_gems===90));
 assert.equal((await one('SELECT count(*)::int AS n FROM territory_private.territory_master_license_credit_events_v1')).n,0,'no red-wallet credit for gold/gems prizes');
 await db.query("SELECT set_config('test.uid',$1,false)",[b]);
 await assert.rejects(db.query('SELECT territory_admin_claim_grant_v2($1)',[gift]),/admin_grant_missing/);
 await db.query("SELECT set_config('test.uid',$1,false)",[a]);
 // Owner edits future catalog with CAS and idempotency; live promised prizes stay immutable.
 const operation='aaaaaaaa-aaaa-4aaa-8aaa-111111111111';
 const future=[{gold:4000,gems:90},...approved.slice(1)];
 const edit=async(id=operation,revision=1,prizes=future)=>(await one('SELECT territory_season_admin_prizes_v1($1,$2,$3::jsonb) AS v',[id,revision,JSON.stringify(prizes)])).v;
 const changed=await edit();assert.equal(changed.revision,2);assert.deepEqual(changed.prizes,future);
 assert.deepEqual(changed.current_prizes,approved,'owner cannot rewrite current prizes');
 assert.equal((await edit()).replayed,true);
 assert.equal((await one('SELECT count(*)::int AS n FROM admin_audit_log')).n,1,'retry does not duplicate audit');
 await assert.rejects(edit('aaaaaaaa-aaaa-4aaa-8aaa-222222222222'),/season_config_changed/);
 await assert.rejects(edit(operation,1,approved),/season_operation_collision/);
 for(const invalid of [[{gold:-1}],[{gold:0}],[{gold:1.5}],[{gold:'5'}],[{redGems:1}],[],[{gold:2147483648}]]) {
   await assert.rejects(edit('aaaaaaaa-aaaa-4aaa-8aaa-222222222222',2,invalid),/season_invalid_prize|season_prizes_required/);
 }
 // Replaying the activation file cannot reset owner edits.
 await db.exec(readFileSync('supabase/staged/territory_weekly_seasons_activate_v1.sql','utf8'));
 assert.deepEqual((await one('SELECT territory_season_admin_status_v1() AS v')).v.prizes,future);
 for(const role of ['anon','authenticated']) {
   for(const signature of ['territory_season_admin_status_v1()','territory_season_admin_prizes_v1(uuid,integer,jsonb)']) {
     assert.equal((await one("SELECT has_function_privilege($1,$2,'execute') AS v",[role,signature])).v,false);
   }
 }
 // All ten approved prize places and non-prize ranks, using real mail claims.
 await db.exec(`INSERT INTO territory_private.weekly_seasons_v1(week,starts_at,ends_at,prizes)
 SELECT week-14,(week-14)::timestamp AT TIME ZONE 'Europe/Kyiv',
 (week-7)::timestamp AT TIME ZONE 'Europe/Kyiv',prizes
 FROM territory_private.weekly_seasons_v1 WHERE ends_at>now()`);
 const twelve=Array.from({length:12},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
 for(const [i,id] of twelve.entries()) {
   await db.query('INSERT INTO players(id,display_name,telegram_id) VALUES($1,$2,$3)',[id,`Warrior ${i+1}`,100+i]);
   await db.query(`INSERT INTO arena_weekly_wins_v1(player_id,won_at)
     SELECT $1::uuid,starts_at+interval '1 hour' FROM territory_private.weekly_seasons_v1,
       generate_series(1,$2::integer) WHERE week=(SELECT min(week) FROM territory_private.weekly_seasons_v1)`,[id,12-i]);
 }
 await db.exec('SELECT territory_private.weekly_season_tick_v1()');
 const podium=(await db.query('SELECT player_id,rank,reward,grant_id FROM territory_private.weekly_season_results_v1 WHERE player_id=ANY($1::uuid[]) ORDER BY rank',[twelve])).rows;
 assert.equal(podium.length,12);
 for(const [i,result] of podium.entries()) {
   assert.equal(result.player_id,twelve[i]);
   assert.deepEqual(result.reward,approved[i]??{});
   if(i<10) {
     assert(result.grant_id);await db.query("SELECT set_config('test.uid',$1,false)",[result.player_id]);
     const claimed=(await one('SELECT territory_admin_claim_grant_v2($1) AS v',[result.grant_id])).v;
     assert.deepEqual([claimed.wallet_gold,claimed.wallet_gems],[approved[i].gold,approved[i].gems]);
     assert.equal((await one('SELECT territory_admin_claim_grant_v2($1) AS v',[result.grant_id])).v.replayed,true);
   } else assert.equal(result.grant_id,null);
 }
 // Real capture trigger: a backdated room timestamp cannot append an old-week score.
 const captureSQL=readFileSync('supabase/staged/territory_weekly_seasons_capture_v1.sql','utf8');
 const tickSQL=readFileSync('supabase/staged/territory_weekly_seasons_v1.sql','utf8');
 assert(captureSQL.includes('pg_advisory_xact_lock(14601,701)'));
 assert(tickSQL.includes('pg_try_advisory_xact_lock(14601,701)'));
 assert(captureSQL.indexOf('PERFORM pg_advisory_xact_lock')<captureSQL.indexOf('v_recorded_at:=clock_timestamp()'));
 assert(!/COALESCE\(NEW\.finished_at|v_recorded_at:=now\(\)/.test(captureSQL));
 await db.exec(captureSQL);
 await db.exec(`CREATE TRIGGER capture AFTER UPDATE OF status ON arena_rooms FOR EACH ROW
 WHEN(OLD.status IS DISTINCT FROM NEW.status AND NEW.status='finished') EXECUTE FUNCTION arena_weekly_capture_v1()`);
 const room='bbbbbbbb-bbbb-4bbb-8bbb-111111111111';
 await db.query("INSERT INTO arena_rooms VALUES($1,'active',1,now()-interval '14 days')",[room]);
 await db.query('INSERT INTO arena_participants VALUES($1,$2,false,1),($1,$3,false,2),($1,$3,true,1)',[room,a,b]);
 const priorWins=(await one("SELECT jsonb_agg(to_jsonb(w) ORDER BY room_id,player_id) AS v FROM arena_weekly_wins_v1 w")).v;
 await db.exec('BEGIN');
 await new Promise(resolve=>setTimeout(resolve,25));
 await db.query("UPDATE arena_rooms SET status='finished' WHERE id=$1",[room]);
 assert.equal((await one("SELECT won_at>now()+interval '10 milliseconds' AS later FROM arena_weekly_wins_v1 WHERE room_id=$1",[room])).later,true,'capture uses recording clock after transaction start');
 await db.exec('COMMIT');
 assert.deepEqual((await one('SELECT jsonb_agg(to_jsonb(w) ORDER BY room_id,player_id) AS v FROM arena_weekly_wins_v1 w WHERE room_id<>$1',[room])).v,priorWins,'existing verified wins untouched');
 const recorded=await one("SELECT player_id,won_at>=now()-interval '1 minute' AS fresh FROM arena_weekly_wins_v1 WHERE room_id=$1",[room]);
 assert.equal(recorded.player_id,a);assert.equal(recorded.fresh,true,'server recording time, not finished_at or old transaction clock');
 assert.equal((await one('SELECT count(*)::int AS n FROM arena_weekly_wins_v1 WHERE room_id=$1',[room])).n,1,'bots and losing players excluded');
 await db.query("UPDATE arena_rooms SET status='finished' WHERE id=$1",[room]);
 assert.equal((await one('SELECT count(*)::int AS n FROM arena_weekly_wins_v1 WHERE room_id=$1',[room])).n,1,'replayed room completion does not duplicate score');
 await db.exec('SELECT territory_private.weekly_season_tick_v1()');
 assert.equal((await one('SELECT count(*)::int AS n FROM territory_private.weekly_season_results_v1 WHERE player_id=$1',[a])).n,1,'old standings remain finalized');
 await db.query("SELECT set_config('test.uid',$1,false)",[a]);
 await db.query('UPDATE players SET banned=true WHERE id=$1',[a]);
 await assert.rejects(db.exec('SELECT territory_season_status_v1()'),/season_verified_login_required/);
 assert.equal((await one("SELECT has_function_privilege('authenticated','territory_private.weekly_season_tick_v1()','execute') AS v")).v,false);
 assert.equal((await one("SELECT has_function_privilege('anon','territory_season_status_v1()','execute') AS v")).v,false);
 // Kyiv DST: calendar week length is 167/169 hours, not a hardcoded 168.
 for(const [day,hours] of [['2026-03-29',167],['2026-10-25',169]]) {
  assert.equal(Number((await one(`SELECT extract(epoch FROM (($1::date+7)::timestamp AT TIME ZONE 'Europe/Kyiv')-($1::date::timestamp AT TIME ZONE 'Europe/Kyiv'))/3600 AS h`,[day])).h),hours);
 }
 console.log('Weekly seasons PASS: approved top10, real atomic mail+red-wallet trigger, durable receipts, retry/rollback, owner future edits, verified scoring, rollover/history, ACL, DST');
} finally {await db.close();}
