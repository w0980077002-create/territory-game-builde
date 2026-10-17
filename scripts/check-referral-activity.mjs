import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const as=async(id) => { await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]); };
const sample=name=>({player:{name,level:1,gold:100,gems:10,redGems:0},inventory:[],forgeMaterials:0,battleStones:10});
const rpc=async(fn,args=[]) => (await q('SELECT public.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args))[0].value;
const rounds=JSON.stringify([{attack:'head',blocks:['chest','legs']},{attack:'belly',blocks:['head','legs']}]);
const bossRounds=JSON.stringify([{attack:'head',blocks:['chest','legs']},{attack:'belly',blocks:['head','legs']},{attack:'legs',blocks:['head','chest']}]);
try {
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
 CREATE TABLE public.players (
  id uuid PRIMARY KEY,telegram_id bigint UNIQUE,display_name text,
  banned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  gold integer NOT NULL DEFAULT 100,gems integer NOT NULL DEFAULT 10,
  forge_materials integer NOT NULL DEFAULT 0,game_state jsonb
 );
 CREATE FUNCTION public.fixture_timestamp() RETURNS trigger LANGUAGE plpgsql AS
 'BEGIN IF OLD.game_state IS DISTINCT FROM NEW.game_state THEN
 NEW.updated_at:=GREATEST(clock_timestamp(),OLD.updated_at+interval ''1 microsecond''); END IF;
 RETURN NEW; END';
 CREATE TRIGGER fixture_timestamp BEFORE UPDATE ON public.players
 FOR EACH ROW EXECUTE FUNCTION public.fixture_timestamp();
 `);
 for(const [n,tg,name] of [[1,111,'Founder'],[2,222,'New Viking'],[3,333,'Other']])
  await q('INSERT INTO public.players(id,telegram_id,display_name,game_state) VALUES($1,$2,$3,$4)',
   [uid(n),tg,name,sample(name)]);
 await db.exec(readFileSync('supabase/migrations/20261017_founders_referrals_v1.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261017_referral_activity_level5_10wins_v2.sql','utf8'));
 assert.equal((await q("SELECT has_function_privilege('anon','public.territory_referral_fight_finish_v2(uuid,boolean,jsonb)','EXECUTE') AS b"))[0].b,false);
 assert.equal((await q("SELECT has_function_privilege('authenticated','territory_private.referral_try_qualify_v2(uuid)','EXECUTE') AS b"))[0].b,false);
 await as(uid(1));
 const creator=await rpc('territory_referral_status_v1');
 assert.equal(await rpc('territory_referral_attach_v1',[uid(2),'ref_'+creator.code]),true);
 await as(uid(3));assert.deepEqual(await rpc('territory_referral_friends_v2'),[]);
 await as(uid(1));let roster=await rpc('territory_referral_friends_v2');
 assert.equal(roster.length,1);assert.equal(roster[0].name,'New Viking');
 assert.equal(roster[0].qualified,false);
 assert.equal(Object.hasOwn(roster[0],'telegram_id'),false);
 await as(uid(2));
 assert.equal((await rpc('territory_referral_fight_start_v2',['stage','ch1_enemy_5'])).tracked,false);
 const invalid=await rpc('territory_referral_fight_start_v2',['trial','trial_1']);
 assert.equal(invalid.tracked,true);
 assert.equal((await q("SELECT public.territory_referral_fight_finish_v2($1,true,$2::jsonb) AS x",
  [invalid.ticket,JSON.stringify([{attack:'head',blocks:['head','head']}])]))[0].x.credited,false);
 assert.equal((await q("SELECT public.territory_referral_fight_finish_v2($1,false,'[]'::jsonb) AS x",[invalid.ticket]))[0].x.credited,false);
 for(let n=0;n<10;n++){
  const chapter=n<6?1:2,idx=n<6?n:n-6;
  const enemy='ch'+chapter+'_'+(idx===5?'boss':'enemy_'+idx);
  const started=await rpc('territory_referral_fight_start_v2',['stage',enemy]);
  assert.equal(started.tracked,true,'ticket '+n);
  await q("UPDATE territory_private.referral_fight_tickets_v2 SET started_at=clock_timestamp()-interval '10 seconds' WHERE player_id=$1",[uid(2)]);
  const actions=idx===5?bossRounds:rounds;
  const done=(await q("SELECT public.territory_referral_fight_finish_v2($1,true,$2::jsonb) AS x",[started.ticket,actions]))[0].x;
  assert.equal(done.credited,true,'win '+n);
  assert.equal((await q("SELECT public.territory_referral_fight_finish_v2($1,true,$2::jsonb) AS x",[started.ticket,rounds]))[0].x.credited,false);
  await q("UPDATE territory_private.referral_activity_v2 SET last_win_at=clock_timestamp()-interval '10 seconds' WHERE player_id=$1",[uid(2)]);
  if(n===8){
   assert.equal((await q('SELECT qualified_at FROM territory_private.referral_invites_v1 WHERE invited_id=$1',[uid(2)]))[0].qualified_at,null,
     'Nine battles are not enough even if the player levels quickly');
  }
 }
 // Ten recorded wins without a saved level-5 character must NOT create loot.
 await as(uid(1));
 assert.equal((await rpc('territory_referral_status_v1')).qualified,0,'Cannot trust battles alone');
 await as(uid(2));
 await q("UPDATE public.players SET game_state=jsonb_set(game_state,'{player,level}','5'::jsonb) WHERE id=$1",[uid(2)]);
 assert.ok((await q('SELECT qualified_at FROM territory_private.referral_invites_v1 WHERE invited_id=$1',[uid(2)]))[0].qualified_at,
  'Qualify automatically on the level-5 cloud save; no extra menu visit or login');
 await rpc('territory_referral_status_v1');
 await as(uid(1));
 const state=await rpc('territory_referral_status_v1');
 assert.equal(state.qualified,1,'Ten wins and level five qualify on day one');
 assert.equal(state.sealed_chests,1);
 roster=await rpc('territory_referral_friends_v2');
 assert.equal(roster[0].wins,10);assert.equal(roster[0].level,5);assert.equal(roster[0].qualified,true);
 await as(uid(2));assert.deepEqual(await rpc('territory_referral_friends_v2'),[]);
 console.log('Referral v2 PASS: 5th-level / 10+ recorded PvE battles on first day, no replay, owner-only friend list, single chest.');
} finally {await db.close();}
