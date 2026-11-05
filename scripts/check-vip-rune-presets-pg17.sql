\set ON_ERROR_STOP on
-- Disposable native PostgreSQL 17 only. Never execute on production.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
 'SELECT nullif(current_setting(''request.test_uid'',true),'''')::uuid';
CREATE TABLE public.players (
 id uuid PRIMARY KEY,banned boolean NOT NULL DEFAULT false,
 vip_level integer NOT NULL DEFAULT 0,
 game_state jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO public.players(id,vip_level,game_state) VALUES
 ('10000000-0000-4000-8000-000000000001',3,'{"gold":77,"legacy":"keep"}'),
 ('10000000-0000-4000-8000-000000000002',0,'{"gold":20,"legacy":"keep"}');
CREATE FUNCTION territory_private_fortune_dummy(u uuid) RETURNS integer
 LANGUAGE sql STABLE AS 'SELECT 0';
\i supabase/staged/territory_rune_slots_v1.sql
CREATE FUNCTION territory_private.fortune_vip_v1(u uuid) RETURNS integer
 LANGUAGE sql STABLE AS 'SELECT vip_level FROM public.players WHERE id=u';
\i supabase/staged/20261105_vip_entitlements_v1.sql
\i supabase/staged/20261105_vip_rune_presets_v1.sql

CREATE TABLE public.arena_rooms(id uuid PRIMARY KEY,status text NOT NULL);
CREATE TABLE public.arena_participants(room_id uuid NOT NULL REFERENCES public.arena_rooms(id),
 user_id uuid NOT NULL,left_at timestamptz);
CREATE TABLE territory_private.combat_sessions_v1(player_id uuid NOT NULL,state jsonb NOT NULL);

DO $rights$
BEGIN
 IF has_table_privilege('authenticated','territory_private.vip_rune_presets_v1','SELECT')
 OR has_table_privilege('authenticated','territory_private.vip_rune_preset_receipts_v1','INSERT')
 OR has_function_privilege('anon','public.territory_vip_rune_preset_apply_v1(integer,bigint,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Client has private rune preset or anonymous apply access'; END IF;
END $rights$;
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r1',1,
 '20000000-0000-4000-8000-000000000001','vip-test-owned-r1');
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r2',1,
 '20000000-0000-4000-8000-000000000002','vip-test-owned-r2');
RESET ROLE;

SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
DO $save$
DECLARE j jsonb;
BEGIN
 j:=public.territory_runes_save_v1(
   '20000000-0000-4000-8000-000000000003',0,
   (SELECT jsonb_agg(jsonb_build_object('slotId','rune_slot_'||lpad(i::text,2,'0'),
    'runeId',CASE WHEN i=1 THEN 'shield_wall_r1' ELSE NULL END) ORDER BY i)
    FROM generate_series(1,15)i));
 IF (j->>'revision')::int<>1 THEN RAISE EXCEPTION 'Initial rune save failed'; END IF;
 j:=public.territory_vip_rune_preset_save_v1(1,1);
 IF j->>'preset_no'<>'1' OR jsonb_array_length(j->'slots')<>15
   OR j#>>'{slots,0,runeId}'<>'shield_wall_r1'
 THEN RAISE EXCEPTION 'VIP3 snapshot did not save 15 independent slots: %',j; END IF;
 BEGIN
  PERFORM public.territory_vip_rune_preset_save_v1(2,1);
  RAISE EXCEPTION 'VIP3 obtained VIP6 second preset';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_rune_preset_locked' THEN RAISE; END IF;
 END;
END $save$;
RESET ROLE;

SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
DO $switch$
DECLARE j jsonb;
BEGIN
 j:=public.territory_runes_save_v1(
 '20000000-0000-4000-8000-000000000004',1,
 (SELECT jsonb_agg(jsonb_build_object('slotId','rune_slot_'||lpad(i::text,2,'0'),
  'runeId',CASE WHEN i=1 THEN 'shield_wall_r2' ELSE NULL END) ORDER BY i)
  FROM generate_series(1,15)i));
 IF j->>'revision'<>'2' THEN RAISE EXCEPTION 'Second owned rune did not save'; END IF;
 j:=public.territory_vip_rune_preset_apply_v1(1,2,
   '30000000-0000-4000-8000-000000000001');
 IF j->>'revision'<>'3' OR j#>>'{slots,0,runeId}'<>'shield_wall_r1'
 OR j->>'alreadyApplied'<>'false' THEN
   RAISE EXCEPTION 'Saved VIP preset did not restore the first rune: %',j; END IF;
 j:=public.territory_vip_rune_preset_apply_v1(1,2,
   '30000000-0000-4000-8000-000000000001');
 IF j->>'revision'<>'3' OR j->>'alreadyApplied'<>'true' THEN
   RAISE EXCEPTION 'Replay changed rune revision: %',j; END IF;
 BEGIN
  PERFORM public.territory_vip_rune_preset_apply_v1(1,2,
    '30000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'Stale rune revision accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_rune_revision_conflict' THEN RAISE; END IF;
 END;
END $switch$;
RESET ROLE;

-- Revoke a previously saved rune only after removing it from live build.
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
SELECT public.territory_runes_save_v1(
 '20000000-0000-4000-8000-000000000005',3,
 (SELECT jsonb_agg(jsonb_build_object('slotId','rune_slot_'||lpad(i::text,2,'0'),
  'runeId',CASE WHEN i=1 THEN 'shield_wall_r2' ELSE NULL END) ORDER BY i)
  FROM generate_series(1,15)i));
RESET ROLE;
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r1',0,
 '20000000-0000-4000-8000-000000000006','vip-test-revoke-r1');
RESET ROLE;
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
DO $revoked$
BEGIN
 BEGIN
 PERFORM public.territory_vip_rune_preset_apply_v1(1,4,
   '30000000-0000-4000-8000-000000000003');
 RAISE EXCEPTION 'Revoked rune was resurrected by VIP preset';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_rune_not_owned' THEN RAISE; END IF;
 END;
END $revoked$;
RESET ROLE;
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r1',1,
 '20000000-0000-4000-8000-000000000007','vip-test-restore-r1');
RESET ROLE;

INSERT INTO public.arena_rooms VALUES('40000000-0000-4000-8000-000000000001','active');
INSERT INTO public.arena_participants(room_id,user_id) VALUES
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
DO $arena$
BEGIN
 BEGIN
 PERFORM public.territory_vip_rune_preset_apply_v1(1,4,
  '30000000-0000-4000-8000-000000000004');
 RAISE EXCEPTION 'VIP switched runes during Arena';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_rune_combat_active' THEN RAISE; END IF;
 END;
END $arena$;
RESET ROLE;
DELETE FROM public.arena_participants;
INSERT INTO territory_private.combat_sessions_v1 VALUES
 ('10000000-0000-4000-8000-000000000001','{"status":"fighting"}');
SET ROLE authenticated;
DO $cave$
BEGIN
 BEGIN
 PERFORM public.territory_vip_rune_preset_apply_v1(1,4,
  '30000000-0000-4000-8000-000000000005');
 RAISE EXCEPTION 'VIP switched runes during Cave';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_rune_combat_active' THEN RAISE; END IF;
 END;
END $cave$;
RESET ROLE;
DELETE FROM territory_private.combat_sessions_v1;

SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000002';
DO $foreign$
BEGIN
 BEGIN
 PERFORM public.territory_vip_rune_preset_apply_v1(1,0,
  '30000000-0000-4000-8000-000000000001');
 RAISE EXCEPTION 'Foreign player replayed a VIP rune operation';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_rune_operation_conflict' THEN RAISE; END IF;
 END;
END $foreign$;
RESET ROLE;

INSERT INTO territory_private.vip_entitlement_grants_v1(grant_id,player_id,campaign_key,kind,vip_level,reason)
VALUES('50000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','vip6-preset-test','gift',6,'PG17 synthetic gift');
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
DO $vip6$
DECLARE j jsonb;
BEGIN
 j:=public.territory_vip_rune_preset_save_v1(2,4);
 IF j->>'preset_no'<>'2' OR jsonb_array_length(j->'slots')<>15
 THEN RAISE EXCEPTION 'VIP6 second slot is not server saved'; END IF;
 j:=public.territory_vip_rune_presets_status_v1();
 IF j->>'vip'<>'6' OR jsonb_array_length(j->'presets')<>2
 THEN RAISE EXCEPTION 'VIP6 status did not return both owner presets: %',j; END IF;
END $vip6$;
RESET ROLE;

DO $unchanged$
BEGIN
 IF (SELECT game_state FROM public.players WHERE id='10000000-0000-4000-8000-000000000001')
   <> '{"gold":77,"legacy":"keep"}'::jsonb
 OR (SELECT count(*) FROM territory_private.vip_rune_preset_receipts_v1)<>1
 THEN RAISE EXCEPTION 'Rune presets touched legacy player data or replayed a receipt'; END IF;
END $unchanged$;
SELECT 'VIP runes PG17: 15 slots, VIP3/6, ownership, revoked rune, revision, combat gates and replay PASS' AS verified;
