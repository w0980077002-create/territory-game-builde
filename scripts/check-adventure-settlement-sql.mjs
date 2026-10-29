import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const player='10000000-0000-4000-8000-000000000001';
const sid=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const save={player:{gold:50,xp:90,level:1,xpToNext:100,maxEnergy:20,stats:{hp:100,maxHp:100,attack:20,defense:5},equipped:{weapon:{id:'old'}}},inventory:[{id:'old'}],vip:7,redGems:45,achievements:[{id:'old'}]};
try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA territory_private;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.test_uid',true),'')::uuid $$;
 CREATE TABLE public.players(id uuid primary key,banned bool default false,game_state jsonb,gold int,gems int,xp int,level int,max_energy int,updated_at timestamptz default clock_timestamp());
 CREATE TABLE territory_private.combat_encounters_v1(encounter_id text primary key,stage int,mode text,enabled bool);
 CREATE TABLE territory_private.combat_sessions_v1(session_id uuid primary key,player_id uuid references public.players(id),encounter_id text references territory_private.combat_encounters_v1(encounter_id),state jsonb);
 GRANT USAGE ON SCHEMA territory_private TO service_role;
 GRANT SELECT,UPDATE ON public.players TO service_role;
 GRANT SELECT,UPDATE ON territory_private.combat_encounters_v1,territory_private.combat_sessions_v1 TO service_role;`);
 await query('INSERT INTO players(id,game_state,gold,gems,xp,level,max_energy) VALUES($1,$2,50,9,90,1,20)',[player,save]);
 await db.exec(readFileSync('supabase/staged/territory_v1_adventure_settlement.sql','utf8'));
 assert.deepEqual((await query('SELECT game_state FROM players WHERE id=$1',[player]))[0].game_state,save,'installation must not alter players');
 await db.exec(`INSERT INTO territory_private.combat_encounters_v1 VALUES ('s1',1,'pve',true),('s2',2,'pve',true),('s10',10,'boss',true);
 INSERT INTO territory_private.adventure_rewards_v1(stage,encounter_id,enabled,gold,xp,approval_reference) VALUES(1,'s1',true,15,20,'test only'),(2,'s2',true,30,40,'test only'),(10,'s10',true,40,40,'test only');`);
 await db.exec('SET ROLE anon'); await assert.rejects(query('SELECT public.territory_adventure_progress_v1()'),/permission denied/); await db.exec('RESET ROLE');
 await query("SELECT set_config('request.test_uid',$1,false)",[player]); await db.exec('SET ROLE authenticated');
 assert.deepEqual((await query('SELECT public.territory_adventure_progress_v1() r'))[0].r,{completed_stage:0,unlocked_stage:1});
 await assert.rejects(query('SELECT * FROM territory_private.adventure_progress_v1'),/permission denied/); await db.exec('RESET ROLE');
 const check=(stage)=>query('SELECT territory_private.adventure_check_start_v1($1,$2)',[player,stage]);
 await check('s1'); await assert.rejects(check('s2'),/adventure_stage_locked/);
 await query(`INSERT INTO territory_private.combat_sessions_v1 VALUES ($1,$2,'s1','{"status":"hero_won"}'),($3,$2,'s2','{"status":"enemy_won"}')`,[sid(1),player,sid(2)]);
 const settle=async(id)=>(await query('SELECT territory_private.adventure_settle_v1($1,$2) receipt',[player,id]))[0].receipt;
 const first=await settle(sid(1)); assert.equal(first.reward.gold,15); assert.equal(first.reward.xp,20);
 assert.equal(first.unlocked_stage,2); assert.equal(first.completed_stage,1);
 await db.exec('SET ROLE authenticated'); assert.deepEqual((await query('SELECT public.territory_adventure_progress_v1() r'))[0].r,{completed_stage:1,unlocked_stage:2}); await db.exec('RESET ROLE');
 assert.equal(first.game_state.player.level,2); assert.equal(first.game_state.player.xp,10); assert.equal(first.game_state.player.gold,65);
 assert.deepEqual(first.game_state.inventory,save.inventory); assert.deepEqual(first.game_state.player.equipped,save.player.equipped); assert.equal(first.game_state.vip,7); assert.equal(first.game_state.redGems,45);
 assert.deepEqual(await settle(sid(1)),first,'exact replay returns stored receipt');
 await check('s2'); await assert.rejects(check('s1'),/adventure_stage_locked/);
 const loss=await settle(sid(2)); assert.equal(loss.reward.gold,0); assert.equal(loss.reward.xp,0); assert.equal(loss.unlocked_stage,2);
 assert.deepEqual((await query('SELECT game_state FROM players WHERE id=$1',[player]))[0].game_state,first.game_state);
 await assert.rejects(check('s10'),/adventure_stage_locked/);
 await query(`INSERT INTO territory_private.combat_sessions_v1 VALUES ($1,$2,'s2','{"status":"hero_won"}')`,[sid(3),player]);
 await qTamper();
 async function qTamper(){
   await query(`UPDATE public.players SET game_state=jsonb_set(game_state,'{player,xpToNext}','1'::jsonb) WHERE id=$1`,[player]);
   await assert.rejects(settle(sid(3)),/adventure_save_needs_reconciliation/);
   const row=(await query('SELECT gold,xp FROM players WHERE id=$1',[player]))[0]; assert.equal(row.gold,65); assert.equal(row.xp,10);
   await query(`UPDATE public.players SET game_state=jsonb_set(game_state,'{player,xpToNext}',to_jsonb(114)) WHERE id=$1`,[player]);
 }

 await db.exec(`UPDATE territory_private.adventure_rewards_v1 SET items='[{"id":"unapproved"}]' WHERE stage=2`);
 await assert.rejects(check('s2'),/adventure_reward_not_ready/);
 console.log('Adventure settlement PGlite PASS: old save preserved, level/XP/gold existing wallet, replay, loss, stage lock, unapproved items blocked.');
} finally {await db.close();}
