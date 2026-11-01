-- Isolated PG17 fixture for #175. Only run against an empty disposable CI DB.
\set ON_ERROR_STOP on
DO $setup$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN('r','p'))
 THEN RAISE EXCEPTION 'rune_fixture_refuses_nonempty_database'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $setup$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $uid$
 SELECT nullif(current_setting('request.test_uid',true),'')::uuid
$uid$;
CREATE TABLE public.players (
 id uuid PRIMARY KEY,banned boolean NOT NULL DEFAULT false,
 game_state jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO public.players(id,game_state) VALUES
 ('10000000-0000-4000-8000-000000000001','{"vip":7,"gold":50,"runes":"legacy"}'),
 ('10000000-0000-4000-8000-000000000002','{"vip":5,"gold":20,"runes":"legacy"}');
CREATE FUNCTION public.test_rune_choices(p_first text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $choices$
 SELECT jsonb_agg(jsonb_build_object(
  'slotId','rune_slot_'||lpad(i::text,2,'0'),
  'runeId',CASE WHEN i=1 THEN p_first ELSE NULL END) ORDER BY i)
 FROM generate_series(1,15) i
$choices$;
\ir ../../supabase/staged/territory_rune_slots_v1.sql

-- The service role can issue an audited rank, but clients cannot mint.
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r1',2,
 '20000000-0000-4000-8000-000000000001','synthetic-ci-admin');
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r1',2,
 '20000000-0000-4000-8000-000000000001','synthetic-ci-admin');
RESET ROLE;

SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
DO $test$
DECLARE r jsonb; first_receipt jsonb; replay jsonb;
BEGIN
 IF has_function_privilege('authenticated',
 'public.territory_runes_admin_set_level_v1(uuid,text,integer,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'client_can_admin_grant'; END IF;
 IF has_table_privilege('authenticated','territory_private.rune_ownership_v1','INSERT')
 THEN RAISE EXCEPTION 'client_can_write_ownership'; END IF;
 r:=public.territory_runes_status_v1();
 IF r->>'revision'<>'0' OR jsonb_array_length(r->'slots')<>15
   OR jsonb_array_length(r->'owned')<>1 OR r#>>'{owned,0,level}'<>'2'
 THEN RAISE EXCEPTION 'initial_status_failed: %',r; END IF;
 first_receipt:=public.territory_runes_save_v1(
 '20000000-0000-4000-8000-000000000002',0,
 public.test_rune_choices('shield_wall_r1'));
 replay:=public.territory_runes_save_v1(
 '20000000-0000-4000-8000-000000000002',0,
 public.test_rune_choices('shield_wall_r1'));
 IF first_receipt<>replay OR first_receipt->>'revision'<>'1'
 THEN RAISE EXCEPTION 'save_replay_failed'; END IF;
 BEGIN
   PERFORM public.territory_runes_save_v1(
     '20000000-0000-4000-8000-000000000003',0,public.test_rune_choices('shield_wall_r1'));
   RAISE EXCEPTION 'expected_revision_rejection';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'rune_revision_conflict' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.territory_runes_save_v1(
     '20000000-0000-4000-8000-000000000002',0,public.test_rune_choices(NULL));
   RAISE EXCEPTION 'expected_op_rejection';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'rune_operation_reused' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.territory_runes_save_v1(
     '20000000-0000-4000-8000-000000000004',1,public.test_rune_choices('shield_wall_r2'));
   RAISE EXCEPTION 'expected_unowned_rejection';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'rune_not_owned_or_wrong_slot' THEN RAISE; END IF;
 END;
 r:=public.territory_runes_status_v1();
 IF r->>'revision'<>'1' OR r#>>'{slots,0,runeId}'<>'shield_wall_r1'
 THEN RAISE EXCEPTION 'saved_status_failed: %',r; END IF;
END $test$;
RESET ROLE;

-- A service-side revoke cannot silently invalidate an equipped rune.
SET ROLE service_role;
DO $test$
BEGIN
 BEGIN
   PERFORM public.territory_runes_admin_set_level_v1(
    '10000000-0000-4000-8000-000000000001','shield_wall_r1',0,
    '20000000-0000-4000-8000-000000000005','synthetic-ci-admin');
   RAISE EXCEPTION 'expected_equipped_rejection';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'rune_still_equipped' THEN RAISE; END IF;
 END;
END $test$;
RESET ROLE;

SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000002';
DO $test$
DECLARE r jsonb;
BEGIN
 r:=public.territory_runes_status_v1();
 IF r->>'revision'<>'0' OR jsonb_array_length(r->'owned')<>0
 THEN RAISE EXCEPTION 'other_player_leak'; END IF;
 BEGIN
   PERFORM public.territory_runes_save_v1(
    '20000000-0000-4000-8000-000000000006',0,public.test_rune_choices('shield_wall_r1'));
   RAISE EXCEPTION 'expected_foreign_ownership_rejection';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'rune_not_owned_or_wrong_slot' THEN RAISE; END IF;
 END;
END $test$;
RESET ROLE;

SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
SELECT public.territory_runes_save_v1(
 '20000000-0000-4000-8000-000000000007',1,public.test_rune_choices(NULL));
RESET ROLE;
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r1',0,
 '20000000-0000-4000-8000-000000000005','synthetic-ci-admin');
RESET ROLE;

DO $test$
BEGIN
 IF (SELECT count(*) FROM territory_private.rune_operations_v1 WHERE player_id=
 '10000000-0000-4000-8000-000000000001')<>4
 THEN RAISE EXCEPTION 'unexpected_receipt_count'; END IF;
 IF (SELECT game_state FROM public.players WHERE id='10000000-0000-4000-8000-000000000001')
 <> '{"vip":7,"gold":50,"runes":"legacy"}'::jsonb
 THEN RAISE EXCEPTION 'legacy_save_changed'; END IF;
 IF (SELECT count(*) FROM territory_private.rune_ownership_v1)<>0
 THEN RAISE EXCEPTION 'revocation_failed'; END IF;
END $test$;
\echo 'PASS: independent rune ledger, CAS save, replay, ownership, isolation, admin revoke, unchanged legacy save (PG17)'
