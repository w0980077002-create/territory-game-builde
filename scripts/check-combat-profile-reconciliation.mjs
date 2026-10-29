import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const db = new PGlite();
const a='10000000-0000-4000-8000-000000000001';
const b='10000000-0000-4000-8000-000000000002';
const item='20000000-0000-4000-8000-000000000001';
const fighter={stats:{hp:123,maxHp:150,attack:31,defense:17,critChance:0.2,dodgeChance:0.1,blockChance:0.3},
  ownership:{heroLevel:9,skills:{verified_skill:2},runes:{},passives:{}},
  loadout:{skills:[{skillId:'verified_skill',level:2,runes:[]}],passives:[]}};
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA territory_private;
    CREATE TABLE public.players(id uuid PRIMARY KEY,banned boolean DEFAULT false,level int NOT NULL,game_state jsonb NOT NULL,gold int NOT NULL);
    CREATE TABLE territory_private.combat_profiles_v1(player_id uuid PRIMARY KEY REFERENCES public.players(id),version int NOT NULL DEFAULT 0,verified boolean NOT NULL DEFAULT false,fighter jsonb NOT NULL,equipped_item_ids uuid[] NOT NULL DEFAULT '{}',approval_reference text NOT NULL,updated_at timestamptz DEFAULT now());
    CREATE TABLE territory_private.combat_sessions_v1(player_id uuid NOT NULL,state jsonb NOT NULL);
    GRANT USAGE ON SCHEMA territory_private TO service_role;
    GRANT SELECT, UPDATE ON public.players TO service_role;
    GRANT SELECT, INSERT, UPDATE ON territory_private.combat_profiles_v1 TO service_role;
    GRANT SELECT ON territory_private.combat_sessions_v1 TO service_role;`);
  await query(`INSERT INTO public.players VALUES($1,false,9,$2,1234),($3,false,4,$4,5678)`,[a,{player:{equipped:{weapon:{id:item}},gold:1234},vip:5},b,{player:{equipped:{},gold:5678}}]);
  const before=await query('SELECT * FROM public.players ORDER BY id');
  await db.exec(readFileSync('supabase/staged/territory_v1_combat_profiles_reconciliation.sql','utf8'));
  await db.exec('SET ROLE service_role');
  assert.equal((await query('SELECT territory_private.prepare_combat_profile_v1($1) AS r',[a]))[0].r.reason,'trusted_projection_missing_or_stale');
  assert.equal((await query('SELECT count(*)::int AS n FROM territory_private.combat_profiles_v1'))[0].n,0);
  await assert.rejects(query(`INSERT INTO territory_private.combat_profile_attestations_v1(player_id,source_game_state,source_player_level,fighter,equipped_item_ids,evidence_reference,reviewed_by) VALUES($1,'{}',9,$2,'{}','forged','forged')`,[a,fighter]),/permission denied/);
  await db.exec('RESET ROLE');
  await query(`INSERT INTO territory_private.combat_profile_attestations_v1(player_id,source_game_state,source_player_level,fighter,equipped_item_ids,evidence_reference,reviewed_by)
    SELECT id,game_state,level,$2,ARRAY[$3::uuid],'review case 123','reviewer' FROM public.players WHERE id=$1`,[a,fighter,item]);
  await db.exec('SET ROLE service_role');
  assert.equal((await query('SELECT territory_private.prepare_combat_profile_v1($1) AS r',[a]))[0].r.status,'ready');
  assert.equal((await query('SELECT territory_private.combat_profile_is_current_v1($1) AS current',[a]))[0].current,true);
  const row=(await query('SELECT fighter,equipped_item_ids FROM territory_private.combat_profiles_v1 WHERE player_id=$1',[a]))[0];
  assert.deepEqual(row.fighter,fighter);
  assert.deepEqual(row.equipped_item_ids,[item]);
  await query(`UPDATE territory_private.combat_profiles_v1 SET fighter=jsonb_set(fighter,'{loadout}','{"skills":[],"passives":[]}'::jsonb),version=1 WHERE player_id=$1`,[a]);
  assert.equal((await query('SELECT territory_private.combat_profile_is_current_v1($1) AS current',[a]))[0].current,true,'server loadout updates remain valid');
  await db.exec('RESET ROLE');
  assert.deepEqual(await query('SELECT * FROM public.players ORDER BY id'),before,'no legacy player or currency changes');
  await query(`UPDATE public.players SET game_state=jsonb_set(game_state,'{player,equipped,weapon,id}','"changed"') WHERE id=$1`,[a]);
  await db.exec('SET ROLE service_role');
  assert.equal((await query('SELECT territory_private.combat_profile_is_current_v1($1) AS current',[a]))[0].current,false,'equipment change fails closed');
  assert.equal((await query('SELECT public.territory_combat_prepare_profile_v1($1) AS r',[a]))[0].r.reason,'trusted_projection_missing_or_stale');
  assert.deepEqual((await query('SELECT fighter->\'loadout\' AS loadout FROM territory_private.combat_profiles_v1 WHERE player_id=$1',[a]))[0].loadout,{skills:[],passives:[]},'does not overwrite saved loadout');
  await db.exec('RESET ROLE');
  await query(`INSERT INTO territory_private.combat_profile_attestations_v1(player_id,source_game_state,source_player_level,fighter,equipped_item_ids,evidence_reference,reviewed_by)
    SELECT id,game_state,level,$2,ARRAY[$3::uuid],'review case 124','reviewer' FROM public.players WHERE id=$1`,[a,{...fighter,stats:{...fighter.stats,attack:55}},item]);
  await query(`INSERT INTO territory_private.combat_sessions_v1 VALUES($1,'{"status":"fighting"}')`,[a]);
  await db.exec('SET ROLE service_role');
  assert.equal((await query('SELECT public.territory_combat_prepare_profile_v1($1) AS r',[a]))[0].r.reason,'active_session');
  await db.exec('RESET ROLE');
  await query(`DELETE FROM territory_private.combat_sessions_v1 WHERE player_id=$1`,[a]);
  await db.exec('SET ROLE service_role');
  assert.equal((await query('SELECT public.territory_combat_prepare_profile_v1($1) AS r',[a]))[0].r.profile_revision,2);
  const refreshed=(await query('SELECT fighter,version FROM territory_private.combat_profiles_v1 WHERE player_id=$1',[a]))[0];
  assert.equal(refreshed.fighter.stats.attack,55);
  assert.deepEqual(refreshed.fighter.loadout,{skills:[],passives:[]});
  assert.equal((await query('SELECT territory_private.combat_profile_is_current_v1($1) AS current',[a]))[0].current,true);
  await db.exec('RESET ROLE');
  await query(`INSERT INTO territory_private.combat_profile_attestations_v1(player_id,source_game_state,source_player_level,fighter,equipped_item_ids,evidence_reference,reviewed_by)
    SELECT id,game_state,level,$2,'{}','review case 456','reviewer' FROM public.players WHERE id=$1`,[b,{...fighter,stats:{...fighter.stats,hp:999,maxHp:1}}]);
  await db.exec('SET ROLE service_role');
  assert.equal((await query('SELECT territory_private.prepare_combat_profile_v1($1) AS r',[b]))[0].r.reason,'invalid_reviewed_projection');
  await db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(query('SELECT territory_private.prepare_combat_profile_v1($1)',[a]),/permission denied/);
  console.log('Combat profile reconciliation PASS: reviewed snapshots only, ownership preserved, stale gear blocked, no player mutation.');
} finally { await db.close(); }
