-- Run AFTER rune-ledger-v1-pg17.sql in the SAME disposable PostgreSQL 17 DB.
\set ON_ERROR_STOP on
\ir ../../supabase/staged/territory_rune_battle_snapshot_v1.sql

DO $assert$
BEGIN
 IF has_function_privilege('authenticated',
   'public.territory_runes_pin_battle_v1(uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'rune_battle_snapshot_exposed_to_player'; END IF;
 IF has_table_privilege('authenticated',
   'territory_private.rune_battle_snapshots_v1','SELECT')
 THEN RAISE EXCEPTION 'rune_battle_snapshot_table_exposed'; END IF;
END $assert$;

-- The prior ledger fixture left player 1 with revision 2 and no owned runes.
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r1',2,
 '30000000-0000-4000-8000-000000000001','synthetic-snapshot-test');
RESET ROLE;
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
SELECT public.territory_runes_save_v1(
 '30000000-0000-4000-8000-000000000002',2,public.test_rune_choices('shield_wall_r1'));
RESET ROLE;

SET ROLE service_role;
DO $assert$
DECLARE original jsonb; replay jsonb; other jsonb;
BEGIN
 original:=public.territory_runes_pin_battle_v1(
   '10000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001','pve');
 IF original->>'schema'<>'territory-rune-battle-snapshot/1'
   OR original->>'revision'<>'3'
   OR jsonb_array_length(original->'slots')<>15
   OR original#>>'{slots,0,runeId}'<>'shield_wall_r1'
   OR original#>>'{slots,0,level}'<>'2'
   OR original#>>'{slots,1,level}'<>'0'
 THEN RAISE EXCEPTION 'rune_battle_initial_snapshot_invalid: %',original; END IF;
 replay:=public.territory_runes_pin_battle_v1(
   '10000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001','pve');
 IF replay<>original THEN RAISE EXCEPTION 'rune_battle_replay_changed'; END IF;
 BEGIN
   PERFORM public.territory_runes_pin_battle_v1(
     '10000000-0000-4000-8000-000000000001',
     '40000000-0000-4000-8000-000000000001','arena');
   RAISE EXCEPTION 'expected_battle_kind_rejection';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'rune_battle_reused' THEN RAISE; END IF;
 END;
 other:=public.territory_runes_pin_battle_v1(
   '10000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000002','arena');
 IF other->>'revision'<>'0' OR other#>>'{slots,0,level}'<>'0'
 THEN RAISE EXCEPTION 'rune_battle_other_player_leak'; END IF;
END $assert$;
RESET ROLE;

SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
SELECT public.territory_runes_save_v1(
 '30000000-0000-4000-8000-000000000003',3,public.test_rune_choices(NULL));
RESET ROLE;
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r1',0,
 '30000000-0000-4000-8000-000000000004','synthetic-snapshot-test');
DO $assert$
DECLARE old jsonb; fresh jsonb;
BEGIN
 old:=public.territory_runes_pin_battle_v1(
   '10000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001','pve');
 fresh:=public.territory_runes_pin_battle_v1(
   '10000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000003','pve');
 IF old#>>'{slots,0,runeId}'<>'shield_wall_r1'
   OR old#>>'{slots,0,level}'<>'2'
   OR fresh#>>'{slots,0,level}'<>'0'
   OR fresh->>'revision'<>'4'
 THEN RAISE EXCEPTION 'rune_battle_snapshot_not_immutable'; END IF;
 IF (SELECT count(*) FROM territory_private.rune_battle_snapshots_v1)<>3
 THEN RAISE EXCEPTION 'rune_battle_duplicate_snapshot'; END IF;
 IF (SELECT game_state FROM public.players WHERE id='10000000-0000-4000-8000-000000000001')
   <> '{"vip":7,"gold":50,"runes":"legacy"}'::jsonb
 THEN RAISE EXCEPTION 'rune_battle_changed_legacy_save'; END IF;
END $assert$;
RESET ROLE;
\echo 'PASS: server-only immutable rune snapshots, trusted ranks, revision, replay, privacy, post-save and post-revoke stability (PG17)'
