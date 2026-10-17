import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const A='10000000-0000-0000-0000-000000000001', B='10000000-0000-0000-0000-000000000002';
const sample=name=>({player:{name,gold:100,gems:7,redGems:0,level:3},inventory:[],forgeMaterials:1,battleStones:10});
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const as=async(id)=>{await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);};
const rpc=async(name,args=[],casts=[])=>{
 const params=args.map((_,i)=>'$'+(i+1)+(casts[i]?'::'+casts[i]:'')).join(',');
 return (await q('SELECT public.'+name+'('+params+') AS result',args))[0].result;
};
try{
 await db.exec([
 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;',
 'CREATE SCHEMA auth; CREATE SCHEMA territory_private;',
 "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';",
 'CREATE TABLE public.players(id uuid PRIMARY KEY,banned boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),gold integer NOT NULL DEFAULT 100,gems integer NOT NULL DEFAULT 7,game_state jsonb);',
 "CREATE FUNCTION public.fixture_revision() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF OLD.game_state IS DISTINCT FROM NEW.game_state THEN NEW.updated_at:=GREATEST(clock_timestamp(),OLD.updated_at+interval ''1 microsecond''); END IF; RETURN NEW; END';",
 'CREATE TRIGGER hall_revision BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.fixture_revision();'
 ].join('\n'));
 await q('INSERT INTO public.players(id,game_state) VALUES($1,$2)',[A,sample('Alpha')]);
 await q('INSERT INTO public.players(id,game_state) VALUES($1,$2)',[B,sample('Beta')]);
 await db.exec(readFileSync('supabase/migrations/20261017_game_hall_five_v1.sql','utf8'));
 for(const fn of ['territory_hall_status_v1()','territory_hall_daily_v1()','territory_hall_start_v1(text)','territory_hall_finish_v1(uuid,integer)','territory_hall_claim_v1(timestamp with time zone)']){
  assert.equal((await q("SELECT has_function_privilege('anon',$1,'execute') AS result",[fn]))[0].result,false,'anon cannot call '+fn);
 }
 assert.equal((await q("SELECT has_table_privilege('authenticated','territory_private.hall_accounts_v1','UPDATE') AS result"))[0].result,false);
 assert.equal((await q("SELECT has_table_privilege('authenticated','territory_private.hall_sessions_v1','SELECT') AS result"))[0].result,false);
 await as(A);
 let first=await rpc('territory_hall_status_v1');
 assert.equal(first.tickets,4);assert.equal(first.points,0);assert.equal(first.pending_gold,0);
 assert.equal(first.free_ready,true);
 assert.equal((await rpc('territory_hall_daily_v1')).tickets,6);
 await assert.rejects(rpc('territory_hall_daily_v1'),/hall_daily_already_claimed/);
 await assert.rejects(rpc('territory_hall_start_v1',['bogus']),/hall_unknown_game/);
 let earned=0;
 for(const game of ['monopoly','dice','tower','targets','treasury']){
  const started=await rpc('territory_hall_start_v1',[game]);
  assert.equal(started.game,game);assert.equal(started.resumed,false);
  assert.equal(Object.hasOwn(started,'correct_answer'),false);
  assert.equal(Object.hasOwn(started.question,'correct_answer'),false);
  assert.equal((await rpc('territory_hall_status_v1')).active.game,game);
  const again=await rpc('territory_hall_start_v1',['monopoly']);
  assert.equal(again.token,started.token,'ongoing games resume without double ticket charge');
  const secret=(await q('SELECT correct_answer FROM territory_private.hall_sessions_v1 WHERE player_id=$1',[A]))[0].correct_answer;
  const win=await rpc('territory_hall_finish_v1',[started.token,secret],['uuid','integer']);
  assert.equal(win.won,true);assert.ok(win.earned_gold<=160);earned+=win.earned_gold;
  await assert.rejects(rpc('territory_hall_finish_v1',[started.token,secret],['uuid','integer']),/hall_ticket_used_or_missing/);
 }
 let state=await rpc('territory_hall_status_v1');
 assert.equal(state.tickets,1);assert.equal(state.played,5);assert.equal(state.wins,5);
 assert.equal(state.points,50);assert.equal(state.pending_gold,earned);assert.equal(state.active,null);
 const old=(await q('SELECT updated_at,gold FROM public.players WHERE id=$1',[A]))[0];
 assert.equal(old.gold,100,'pending gold must not affect player wallet');
 await assert.rejects(rpc('territory_hall_claim_v1',[new Date(0).toISOString()],['timestamptz']),/hall_reload_save/);
 const credit=await rpc('territory_hall_claim_v1',[old.updated_at],['timestamptz']);
 assert.equal(credit.awarded,earned);assert.equal(credit.wallet_gold,100+earned);
 assert.equal(credit.game_state.player.gold,100+earned);assert.equal(credit.game_state.player.redGems,0);
 state=await rpc('territory_hall_status_v1');
 assert.equal(state.pending_gold,0);assert.equal(state.claimed_gold,earned);
 await assert.rejects(rpc('territory_hall_claim_v1',[credit.updated_at],['timestamptz']),/hall_nothing_to_claim/);
 const last=await rpc('territory_hall_start_v1',['treasury']);
 const answer=(await q('SELECT correct_answer FROM territory_private.hall_sessions_v1 WHERE player_id=$1',[A]))[0].correct_answer;
 const failed=await rpc('territory_hall_finish_v1',[last.token,(answer+1)%3],['uuid','integer']);
 assert.equal(failed.won,false);assert.equal(failed.earned_gold,0);assert.equal(failed.points,2);
 assert.equal((await rpc('territory_hall_status_v1')).tickets,0);
 await assert.rejects(rpc('territory_hall_start_v1',['monopoly']),/hall_no_tickets/);
 await as(B);
 assert.equal((await rpc('territory_hall_status_v1')).tickets,4);
 await assert.rejects(rpc('territory_hall_finish_v1',[last.token,answer],['uuid','integer']),/hall_ticket_used_or_missing/);
 await as(A);
 await q("UPDATE territory_private.hall_accounts_v1 SET daily_day=(now() AT TIME ZONE 'UTC')::date,daily_gold=995,tickets=1 WHERE player_id=$1",[A]);
 const capped=await rpc('territory_hall_start_v1',['monopoly']);
 const cap=await rpc('territory_hall_finish_v1',[capped.token,0],['uuid','integer']);
 assert.equal(cap.earned_gold,5,'daily gold limit');
 assert.equal((await rpc('territory_hall_status_v1')).daily_remaining,0);
 console.log('Game Hall PASS: 5 games, persistent tickets, daily gift, validated rewards, wallet revision, no double claims, account isolation and daily gold cap.');
}finally{await db.close();}
