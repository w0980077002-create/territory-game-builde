-- Disposable DB only; run after rune-ledger fixture. Original functions are exact
-- checked-in Arena implementations, with minimal surrounding fixtures.
\set ON_ERROR_STOP on
CREATE TABLE public.arena_rooms(id uuid PRIMARY KEY,mode text NOT NULL,status text NOT NULL DEFAULT 'waiting',timeout_seconds integer DEFAULT 60,round_no integer DEFAULT 0,round_started_at timestamptz,round_deadline timestamptz,starts_at timestamptz DEFAULT now(),finished_at timestamptz);
CREATE TABLE public.arena_participants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),room_id uuid NOT NULL REFERENCES public.arena_rooms(id),user_id uuid,is_bot boolean NOT NULL DEFAULT false,name text NOT NULL,level int DEFAULT 1,rating int DEFAULT 1000,attack int NOT NULL,defense int NOT NULL,crit_chance int NOT NULL,max_hp int NOT NULL,hp int NOT NULL,team int,kills int DEFAULT 0,damage_dealt int DEFAULT 0,joined_at timestamptz DEFAULT now(),auto boolean DEFAULT false,left_at timestamptz,bot_ready_at timestamptz);
CREATE TABLE public.arena_moves(id bigint GENERATED ALWAYS AS IDENTITY,room_id uuid NOT NULL,round_no int NOT NULL,participant_id uuid NOT NULL,target_id uuid NOT NULL,attack_zone text NOT NULL,block_zones text[] NOT NULL,UNIQUE(room_id,round_no,participant_id));
CREATE FUNCTION public.arena_bots_on() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.arena_msg(uuid,text,text,text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.arena_schedule_bots(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.arena_bot_say(uuid,text[]) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.arena_zone_ru(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
CREATE FUNCTION public.arena_finish(p_room uuid,p_team int) RETURNS void LANGUAGE sql AS $$ UPDATE public.arena_rooms SET status='finished' WHERE id=p_room $$;
\ir rune-arena-original-v1.sql
REVOKE ALL ON FUNCTION public.arena_move(uuid,uuid,text,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_move(uuid,uuid,text,text[]) TO authenticated;
\ir ../../supabase/staged/territory_rune_battle_snapshot_v1.sql
\ir ../../supabase/staged/territory_rune_effects_v1.sql
\ir ../../supabase/staged/territory_rune_damage_bridge_v1.sql
\ir ../../supabase/staged/territory_rune_arena_integration_v1.sql
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1('10000000-0000-4000-8000-000000000001','axe_storm_r1',3,'90000000-0000-4000-8000-000000000001','synthetic arena');
SELECT public.territory_runes_admin_set_level_v1('10000000-0000-4000-8000-000000000001','shield_wall_r1',3,'90000000-0000-4000-8000-000000000002','synthetic arena');
SELECT public.territory_runes_admin_set_level_v1('10000000-0000-4000-8000-000000000001','quickstep_r1',3,'90000000-0000-4000-8000-000000000006','synthetic arena');
SELECT public.territory_runes_admin_set_level_v1('10000000-0000-4000-8000-000000000001','blood_rush_r3',3,'90000000-0000-4000-8000-000000000007','synthetic arena');
RESET ROLE;
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
SELECT public.territory_runes_save_v1('90000000-0000-4000-8000-000000000003',2,
 jsonb_set(jsonb_set(jsonb_set(public.test_rune_choices('shield_wall_r1'),'{1,runeId}',to_jsonb('axe_storm_r1'::text)),
 '{7,runeId}',to_jsonb('quickstep_r1'::text)),'{10,runeId}',to_jsonb('blood_rush_r3'::text)));
RESET ROLE;
INSERT INTO arena_rooms(id,mode) VALUES
 ('41000000-0000-4000-8000-000000000001','duel'),('41000000-0000-4000-8000-000000000002','duel'),('41000000-0000-4000-8000-000000000003','duel'),('41000000-0000-4000-8000-000000000004','duel'),('41000000-0000-4000-8000-000000000005','duel');
INSERT INTO arena_participants(id,room_id,user_id,is_bot,name,attack,defense,crit_chance,max_hp,hp) VALUES
 ('51000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',false,'rune hero',1000,0,0,100000,100000),
 ('51000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001',NULL,true,'bot one',1000,0,0,100000,100000),
 ('51000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',false,'base hero',1000,0,0,100000,100000),
 ('51000000-0000-4000-8000-000000000004','41000000-0000-4000-8000-000000000002',NULL,true,'bot two',1000,0,0,100000,100000),
 ('51000000-0000-4000-8000-000000000005','41000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',false,'rune hero',1000,0,0,100000,100000),
 ('51000000-0000-4000-8000-000000000006','41000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',false,'base hero',1000,0,0,100000,100000),
 ('51000000-0000-4000-8000-000000000007','41000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002',false,'bot lobby',1000,0,0,100000,100000),
 ('51000000-0000-4000-8000-000000000008','41000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001',false,'rune hero',1000,0,0,100000,100000),
 ('51000000-0000-4000-8000-000000000009','41000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002',false,'base hero',1000,0,0,100000,100000);
SELECT public.arena_start_room('41000000-0000-4000-8000-000000000001');
SELECT public.arena_start_room('41000000-0000-4000-8000-000000000002');
SELECT public.arena_start_room('41000000-0000-4000-8000-000000000003');
SELECT public.arena_start_room('41000000-0000-4000-8000-000000000004');
SELECT public.arena_start_room('41000000-0000-4000-8000-000000000005');
DO $assert$ BEGIN
 IF (SELECT count(*) FROM territory_private.rune_arena_fighters_v1)<>10
 OR (SELECT totals->>'damage_bonus_bp' FROM territory_private.rune_arena_fighters_v1 WHERE participant_id='51000000-0000-4000-8000-000000000001')<>'300'
 OR (SELECT totals FROM territory_private.rune_arena_fighters_v1 WHERE participant_id='51000000-0000-4000-8000-000000000002')<>'{}'::jsonb
 THEN RAISE EXCEPTION 'arena_start_snapshot_failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM territory_private.rune_arena_fighters_v1
   WHERE room_id='41000000-0000-4000-8000-000000000004' AND is_bot AND player_id IS NULL
     AND jsonb_array_length(snapshot->'slots')=15 AND totals='{}'::jsonb)
 THEN RAISE EXCEPTION 'arena_generated_bot_snapshot_failed'; END IF;
 IF has_function_privilege('authenticated','territory_private.runes_arena_damage_v1(uuid,uuid,uuid,integer,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'arena_damage_exposed'; END IF;
 IF territory_private.runes_arena_damage_v1('41000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001',1000,true)<>964
 THEN RAISE EXCEPTION 'bot_vs_human_guard_failed'; END IF;
 IF territory_private.runes_arena_chance_v1('41000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001','dodge',6)<>8.4
 OR territory_private.runes_arena_chance_v1('41000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','crit',5)<>7.7
 THEN RAISE EXCEPTION 'arena_rune_chance_failed'; END IF;
 IF territory_private.runes_arena_chance_v1('41000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','crit',150)<>100
 THEN RAISE EXCEPTION 'arena_existing_high_crit_failed'; END IF;
END $assert$;
-- Change the player's selected runes after the rooms start; existing snapshots
-- must retain their original levels and effects in both bot and player fights.
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
SELECT public.territory_runes_save_v1('90000000-0000-4000-8000-000000000004',3,public.test_rune_choices(NULL));
RESET ROLE;
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1('10000000-0000-4000-8000-000000000001','axe_storm_r1',0,'90000000-0000-4000-8000-000000000005','synthetic arena');
RESET ROLE;
UPDATE arena_participants SET team=CASE WHEN id IN ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000005','51000000-0000-4000-8000-000000000008') THEN 1 ELSE 2 END WHERE room_id<>'41000000-0000-4000-8000-000000000004';
INSERT INTO arena_moves(room_id,round_no,participant_id,target_id,attack_zone,block_zones)
SELECT a.room_id,1,a.id,t.id,'chest',ARRAY['head','legs'] FROM arena_participants a JOIN arena_participants t ON t.room_id=a.room_id AND t.team<>a.team WHERE a.room_id IN ('41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000003');
-- Exercise the actual authenticated player entry point, including rejection
-- of a foreign user and a duplicate move before the second player acts.
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000099';
DO $assert$ BEGIN
 BEGIN
  PERFORM public.arena_move('41000000-0000-4000-8000-000000000005','51000000-0000-4000-8000-000000000009','chest',ARRAY['head','legs']);
  RAISE EXCEPTION 'expected_foreign_user_denial';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'not_member' THEN RAISE; END IF; END;
END $assert$;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
SELECT public.arena_move('41000000-0000-4000-8000-000000000005','51000000-0000-4000-8000-000000000009','chest',ARRAY['head','legs']);
DO $assert$ BEGIN
 BEGIN
  PERFORM public.arena_move('41000000-0000-4000-8000-000000000005','51000000-0000-4000-8000-000000000009','chest',ARRAY['head','legs']);
  RAISE EXCEPTION 'expected_duplicate_move_denial';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'already_moved' THEN RAISE; END IF; END;
END $assert$;
SET request.test_uid='10000000-0000-4000-8000-000000000002';
SELECT public.arena_move('41000000-0000-4000-8000-000000000005','51000000-0000-4000-8000-000000000008','chest',ARRAY['head','legs']);
RESET ROLE;
DO $assert$ BEGIN
 IF (SELECT round_no FROM arena_rooms WHERE id='41000000-0000-4000-8000-000000000005')<>2
 THEN RAISE EXCEPTION 'arena_player_rpc_round_failed'; END IF;
END $assert$;
-- A real bot is generated by arena_start_room and makes its own move.
INSERT INTO arena_moves(room_id,round_no,participant_id,target_id,attack_zone,block_zones)
SELECT a.room_id,1,a.id,t.id,'chest',ARRAY['head','legs'] FROM arena_participants a JOIN arena_participants t ON t.room_id=a.room_id AND t.is_bot WHERE a.id='51000000-0000-4000-8000-000000000007';
SELECT public.arena_bot_moves('41000000-0000-4000-8000-000000000004',true);
SELECT public.arena_tick('41000000-0000-4000-8000-000000000004');
DO $assert$ BEGIN
 IF (SELECT round_no FROM arena_rooms WHERE id='41000000-0000-4000-8000-000000000004')<>2
 THEN RAISE EXCEPTION 'arena_generated_bot_round_failed'; END IF;
END $assert$;
SELECT setseed(0.123);
SELECT public.arena_tick('41000000-0000-4000-8000-000000000001');
SELECT setseed(0.123);
SELECT public.arena_tick('41000000-0000-4000-8000-000000000002');
SELECT setseed(0.123);
SELECT public.arena_tick('41000000-0000-4000-8000-000000000003');
DO $assert$ DECLARE buff int; base int; pvp int; BEGIN
 SELECT damage_dealt INTO buff FROM arena_participants WHERE id='51000000-0000-4000-8000-000000000001';
 SELECT damage_dealt INTO base FROM arena_participants WHERE id='51000000-0000-4000-8000-000000000003';
 SELECT damage_dealt INTO pvp FROM arena_participants WHERE id='51000000-0000-4000-8000-000000000005';
 IF base=0 OR buff<>round(base*1.03)::int OR pvp<>buff THEN RAISE EXCEPTION 'arena_real_resolve_failed: % % %',buff,base,pvp; END IF;
 PERFORM public.arena_tick('41000000-0000-4000-8000-000000000001');
 IF (SELECT damage_dealt FROM arena_participants WHERE id='51000000-0000-4000-8000-000000000001')<>buff
 OR (SELECT round_no FROM arena_rooms WHERE id='41000000-0000-4000-8000-000000000001')<>2
 THEN RAISE EXCEPTION 'arena_retry_applied_damage_twice'; END IF;
 IF territory_private.runes_arena_damage_v1('41000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',1000,false)<>1030
 THEN RAISE EXCEPTION 'arena_snapshot_mutated'; END IF;
 BEGIN
  PERFORM territory_private.runes_arena_damage_v1('41000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000002',1000,false);
  RAISE EXCEPTION 'expected_foreign_snapshot_rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'rune_arena_snapshot_missing' THEN RAISE; END IF; END;
END $assert$;
\echo 'PASS: actual Arena start/resolve, player vs bot and player, pinned server effects'
