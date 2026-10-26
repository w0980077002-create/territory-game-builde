/** Full progression against real staged RPCs in disposable PostgreSQL (PGlite).
 * The owner-only training grant avoids hundreds of wall-clock days in a test;
 * a separate ordinary account proves that the production 300 XP/day cap stays.
 * Wallet fixtures are test data, not a replacement gather-claim implementation.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {PROFESSION_TRACKS, STAGE8_RECIPES, practiceFor, masteryXpToNext, totalXpForLevel} from './professions/stage8-model.mjs';
const db=new PGlite();
const sql=async(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');
const one=async(query,args=[]) => (await db.query(query,args)).rows[0];
const owner=async()=>db.exec('RESET ROLE');
const as=async(id)=>{await owner();await db.query("SELECT set_config('test.uid',$1,false)",[id]);await db.exec('SET ROLE authenticated');};
const execute=async(recipe,operation=randomUUID())=>(await one('SELECT public.territory_profession_stage8_execute($1,$2::uuid) result',[recipe,operation])).result;
try {
 await db.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth;CREATE SCHEMA territory_private;
 CREATE FUNCTION auth.uid() RETURNS uuid STABLE LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE public.players(id uuid PRIMARY KEY,telegram_id bigint,banned boolean NOT NULL DEFAULT false,
 gold int NOT NULL DEFAULT 0,gems int NOT NULL DEFAULT 1500,forge_materials int NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),game_state jsonb NOT NULL DEFAULT '{"player":{"redGems":75},"keep":"legacy-compatible"}');
 CREATE TABLE public.territory_profession_unlocks(player_id uuid PRIMARY KEY REFERENCES public.players(id),profession text NOT NULL,master_license boolean NOT NULL DEFAULT false);
 CREATE TABLE public.territory_resource_wallet(player_id uuid REFERENCES public.players(id),resource_id text,quantity bigint CHECK(quantity>=0),PRIMARY KEY(player_id,resource_id));
 CREATE TABLE public.territory_gather_jobs(player_id uuid PRIMARY KEY REFERENCES public.players(id),resource_id text NOT NULL,started_at timestamptz NOT NULL,finishes_at timestamptz NOT NULL);
 CREATE TABLE public.admin_grants(id uuid PRIMARY KEY,player_id uuid REFERENCES public.players(id),payload jsonb,claimed_at timestamptz);
 CREATE TABLE territory_private.referral_claim_cursor_v1(player_id uuid PRIMARY KEY REFERENCES public.players(id),red_paid integer NOT NULL DEFAULT 0);`);
 const foundation=await sql('supabase/migrations/20261013211739_economy_revision_and_professions.sql');
 await db.exec(foundation.slice(foundation.indexOf('CREATE OR REPLACE FUNCTION public.territory_gather_start'),foundation.lastIndexOf('COMMIT;')));
 await db.exec(await sql('supabase/staged/territory_profession_stage8_backend.sql'));
 await db.exec(await sql('supabase/staged/territory_profession_stage8_lifecycle.sql'));
 await db.exec("UPDATE public.territory_profession_stage8_release SET enabled=true,cutover_at=clock_timestamp()-interval '1 second' WHERE id=1");
 const ids=PROFESSION_TRACKS.map(()=>randomUUID()),ordinary=randomUUID();
 for(const [index,id] of [...ids,ordinary].entries()) await db.query('INSERT INTO public.players(id,telegram_id) VALUES($1,$2)',[id,100001+index]);
 await db.exec(await sql('supabase/staged/territory_master_license_shop_v1.sql'));
 let operations=0,crafted=0;
 for(const [index,track] of PROFESSION_TRACKS.entries()) {
  const id=ids[index];await as(id);
  const purchaseId=randomUUID();
  const buy=async()=>(await one('SELECT public.territory_profession_stage8_purchase($1,$2::uuid) result',[track.id,purchaseId])).result;
  const gathered=(await one("SELECT public.territory_gather_start('gather-ore') result")).result;assert.equal(gathered.success,true);
  assert.equal((await one("SELECT public.territory_gather_start('gather-herb') result")).result.error,'already_gathering');
  await owner();assert.equal(Number((await one('SELECT extract(epoch FROM finishes_at-started_at)::int seconds FROM public.territory_gather_jobs WHERE player_id=$1',[id])).seconds),14400);await as(id);
  const bought=await buy();assert.equal(bought.success,true);assert.deepEqual(await buy(),bought);
  for(const locked of STAGE8_RECIPES.filter(r=>r.profession===track.id&&r.requiredLevel>1&&r.requiredLevel<300)) await assert.rejects(execute(locked.id),/mastery_too_low/,'Every level requirement is enforced server-side');
  const foreign=STAGE8_RECIPES.find(r=>r.profession!==track.id&&r.requiredLevel===1);
  await assert.rejects(execute(foreign.id),/profession_not_unlocked/);
  await assert.rejects(execute(practiceFor(track.id,1).id),/insufficient_resources/,'No training reward or receipt without resources');
  await owner();
  await db.query("INSERT INTO territory_private.territory_profession_stage8_test_access(player_id,verified_telegram_id,expires_at,purpose) VALUES($1,$2,clock_timestamp()+interval '1 hour','Offline complete progression test')",[id,100001+index]);
  for(const resource of ['gather-ore','gather-wood','gather-hide','gather-herb','gather-crystal']) await db.query('INSERT INTO public.territory_resource_wallet VALUES($1,$2,100000)',[id,resource]);
  await as(id);
  let level=1,xp=0,totalXp=0;
  const checked=new Set();
  while(level<300) {
   const practice=practiceFor(track.id,level),operation=randomUUID();
   const receipt=await execute(practice.id,operation);operations++;
   totalXp+=practice.masteryXp;xp+=practice.masteryXp;
   while(level<300&&xp>=masteryXpToNext(level)){xp-=masteryXpToNext(level);level++;}
   if(level===300)xp=0;
   assert.equal(receipt.mastery_level,level,`${track.id}: every RPC must match exact level threshold`);
   assert.equal(receipt.mastery_xp,xp);assert.equal(receipt.item_id,null);
   if(operations%25===0) assert.deepEqual(await execute(practice.id,operation),receipt,'Lost responses/restarts replay training without duplicate debit or XP');
   for(const recipe of STAGE8_RECIPES.filter(r=>r.profession===track.id&&r.kind==='item'&&r.requiredLevel<300&&!checked.has(r.id)&&r.requiredLevel<=level)) {
    const made=await execute(recipe.id);operations++;crafted++;checked.add(recipe.id);
    assert.ok(made.item_id);assert.deepEqual(made.item_output,recipe.output);
    totalXp+=recipe.masteryXp;xp+=recipe.masteryXp;
    while(level<300&&xp>=masteryXpToNext(level)){xp-=masteryXpToNext(level);level++;}
    if(level===300)xp=0;
    assert.equal(made.mastery_level,level);assert.equal(made.mastery_xp,xp);
   }
  }
  assert.ok(totalXp>=totalXpForLevel(300));
  const prestige=STAGE8_RECIPES.filter(r=>r.profession===track.id&&r.requiredLevel===300);
  for(const recipe of prestige) await assert.rejects(execute(recipe.id),/master_license_required/);
  await owner();const stamp=(await one('SELECT updated_at FROM public.players WHERE id=$1',[id])).updated_at;
  await as(id);const licenseOperation=randomUUID();
  const license=async()=>(await one('SELECT public.territory_master_license_shop_buy_v1($1::uuid,$2::timestamptz) result',[licenseOperation,stamp])).result;
  const licensed=await license();assert.equal(licensed.price,50);assert.equal(licensed.red_balance,25);assert.equal((await license()).replayed,true);
  for(const recipe of prestige){const made=await execute(recipe.id);crafted++;assert.ok(made.item_id);assert.equal(made.mastery_level,300);assert.equal(made.mastery_xp,0);}
  await owner();
  const player=await one('SELECT gems,game_state FROM public.players WHERE id=$1',[id]);assert.equal(player.gems,500);assert.equal(player.game_state.keep,'legacy-compatible');assert.equal(player.game_state.player.redGems,25);
  assert.equal((await one('SELECT count(*)::int count FROM public.territory_profession_stage8_daily_xp WHERE player_id=$1 AND xp_used>0',[id])).count,0,'Owner tests never consume real daily XP');
  console.log(`Progression SQL PASS: ${track.id} level 1→300, every unlocked recipe (${checked.size+prestige.length}), exactly-once purchase/training, permanent 50-red-gem license.`);
 }
 await as(ordinary);await one("SELECT public.territory_profession_stage8_purchase('smith',$1::uuid)",[randomUUID()]);
 await owner();await db.query("INSERT INTO public.territory_resource_wallet VALUES($1,'gather-ore',100)",[ordinary]);await as(ordinary);
 for(let i=0;i<10;i++)await execute('s8_smith_practice_1');
 await assert.rejects(execute('s8_smith_practice_1'),/daily_mastery_xp_limit/);
 await owner();assert.equal((await one('SELECT quantity::int quantity FROM public.territory_resource_wallet WHERE player_id=$1',[ordinary])).quantity,90);
 assert.equal((await one('SELECT max(mastery_level)::int level FROM public.territory_profession_stage8_progress')).level,300);
 console.log(`Full progression SQL PASS: five professions, ${operations} progression/crafting RPCs, ${crafted} real items; ordinary daily XP cap unchanged. Four-hour single gather jobs verified; fixture wallets, gather claims excluded.`);
} finally {await db.close();}
