import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const inviter=id(1);
const template=()=>({balanceVersion:4,inventoryCleanupVersion:1,player:{name:'Hero',level:1,gold:100,gems:10,redGems:0,equipped:{}},
 inventory:[],belt:[],forgeMaterials:0,battleStones:10,followers:[],currentChapter:1,chapterWins:0, trialLevel:1});
const q=async(text,params=[])=> (await db.query(text,params)).rows;
const by=async(user)=> (await q('SELECT * FROM public.players WHERE id=$1',[user]))[0];
const as=async(user)=>{await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);};
const status=async()=> (await q('SELECT public.territory_referral_status_v1() AS data'))[0].data;
const claim=async(rev)=> (await q('SELECT public.territory_referral_claim_v1($1::timestamptz) AS data',[rev]))[0].data;
try {
 await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
   'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
 CREATE TABLE public.players(
   id uuid PRIMARY KEY,
   telegram_id bigint UNIQUE,
   created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
   updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
   banned boolean NOT NULL DEFAULT false,
   gold integer NOT NULL DEFAULT 100,
   gems integer NOT NULL DEFAULT 10,
   forge_materials integer NOT NULL DEFAULT 0,
   game_state jsonb
 );
 CREATE FUNCTION public.fixture_timestamp() RETURNS trigger LANGUAGE plpgsql AS
   'BEGIN IF OLD.game_state IS DISTINCT FROM NEW.game_state THEN
    NEW.updated_at:=GREATEST(clock_timestamp(),OLD.updated_at+interval ''1 microsecond'');
    END IF;RETURN NEW;END';
 CREATE TRIGGER fixture_timestamp BEFORE UPDATE ON public.players
 FOR EACH ROW EXECUTE FUNCTION public.fixture_timestamp();
 `);
 await q('INSERT INTO public.players(id,telegram_id,game_state) VALUES ($1,111,$2)',[inviter,template()]);
 const others=[2,3,4,5,6];
 for(const n of others)await q('INSERT INTO public.players(id,telegram_id,game_state) VALUES ($1,$2,$3)',[id(n),100+n,template()]);
 await db.exec(readFileSync('supabase/migrations/20261017_founders_referrals_v1.sql','utf8'));
 assert.equal((await q("SELECT has_function_privilege('anon','public.territory_referral_attach_v1(uuid,text)','execute') AS allowed"))[0].allowed,false);
 assert.equal((await q("SELECT has_function_privilege('authenticated','public.territory_referral_qualify_v1(uuid,bigint,bigint)','execute') AS allowed"))[0].allowed,false);
 await as(inviter);
 const owner=await status();
 assert.ok(owner.founder_number>=1);
 assert.match(owner.code,/^[0-9a-f]{14}$/);
 const code='ref_'+owner.code;
 const bind=async(player,codeString)=> (await q('SELECT public.territory_referral_attach_v1($1,$2) AS result',[player,codeString]))[0].result;
 assert.equal(await bind(inviter,code),false,'self-referrals never register');
 assert.equal(await bind(id(2),'ref_invalid'),false,'malformed invitation not registered');
 for(const n of others)assert.equal(await bind(id(n),code),true);
 assert.equal(await bind(id(2),code),true,'idempotent same owner, no additional credits');
 assert.equal((await status()).registered,5);
 assert.equal((await status()).qualified,0);
 await as(id(2));
 assert.equal((await status()).sealed_chests,0,'no instant credit or chest');
 assert.equal((await q('SELECT public.territory_referral_qualify_v1($1,$2,$3) AS value',[id(2),102,Math.floor(Date.now()/1000)]))[0].value,false,'wait 24 hours');
 await q("UPDATE territory_private.referral_invites_v1 SET created_at=clock_timestamp()-interval '2 days'");
 const fresh=Math.floor(Date.now()/1000);
 assert.equal((await q('SELECT public.territory_referral_qualify_v1($1,$2,$3) AS value',[id(2),102,fresh-40000]))[0].value,false,'old signed auth cannot qualify');
 assert.equal((await q('SELECT public.territory_referral_qualify_v1($1,$2,$3) AS value',[id(2),999,fresh]))[0].value,false,'different Telegram identity cannot qualify');
 for(const n of others){
  assert.equal((await q('SELECT public.territory_referral_qualify_v1($1,$2,$3) AS value',[id(n),100+n,fresh]))[0].value,true);
  assert.equal((await q('SELECT public.territory_referral_qualify_v1($1,$2,$3) AS value',[id(n),100+n,fresh]))[0].value,false);
 }
 await as(inviter);
 const ready=await status();
 assert.equal(ready.qualified,5);assert.equal(ready.sealed_chests,5);
 assert.equal(ready.red_fragments,0);assert.equal(ready.red_pending,1);assert.equal(ready.red_earned_tenths,10);
 const initial=await by(inviter);
 const receipt=await claim(initial.updated_at);
 assert.equal(receipt.gold,12500);
 assert.equal(receipt.gems,60);
 assert.equal(receipt.stones,5);
 assert.equal(receipt.materials,10);
 assert.equal(receipt.red_gems,1,'five fifths make exactly one integer red gem');
 const after=await by(inviter);
 assert.equal(after.gold,12600);assert.equal(after.gems,70);
 assert.equal(after.game_state.player.redGems,1);assert.equal(after.game_state.forgeMaterials,10);
 assert.equal(after.game_state.battleStones,15);
 assert.equal((await status()).sealed_chests,5);
 assert.equal((await status()).red_pending,0);
 await assert.rejects(claim(after.updated_at),/referral_nothing_to_claim/,'no repeat grant');
 await assert.rejects(claim(initial.updated_at),/referral_reload_save/,'stale token never pays');
 await as(id(2));
 const welcome=await claim((await by(id(2))).updated_at);
 assert.equal(welcome.gold,600);assert.equal(welcome.stones,3);assert.equal(welcome.welcome_elixirs,2);
 assert.equal((await by(id(2))).game_state.inventory.filter(x=>x.id==='ref_founder_welcome_elixir').length,1);
 await assert.rejects(claim((await by(id(2))).updated_at),/referral_nothing_to_claim/);
 assert.equal((await q('SELECT count(*)::int AS n FROM territory_private.referral_chests_v1'))[0].n,5);
 console.log('Founder referrals PASS: Telegram-only attribution, 24h gate, sealed chests, 0.2 red shards, integer conversion, welcome gift, exact-once claiming, wallet CAS.');
} finally { await db.close(); }
