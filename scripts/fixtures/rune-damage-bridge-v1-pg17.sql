-- Disposable PostgreSQL 17 only. Run after rune-effects-v1-pg17.sql.
-- Validates a deterministic server-only damage bridge, NOT live combat.
\set ON_ERROR_STOP on
\ir ../../supabase/staged/territory_rune_damage_bridge_v1.sql

DO $test$
DECLARE pve integer; guarded integer; arena integer;
BEGIN
 IF has_function_privilege('authenticated',
   'public.territory_runes_resolve_damage_v1(uuid,uuid,uuid,text,integer,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'rune_damage_client_execute_exposed'; END IF;
END $test$;
SET ROLE service_role;
DO $test$
DECLARE pve integer; guarded integer; arena integer; pve_replayed integer;
BEGIN
 pve:=public.territory_runes_resolve_damage_v1(
  '10000000-0000-4000-8000-000000000001',NULL,
  '40000000-0000-4000-8000-000000000004','pve',1000,false);
 IF pve<>1030 THEN RAISE EXCEPTION 'rune_pve_damage_wrong: %',pve; END IF;
 guarded:=public.territory_runes_resolve_damage_v1(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000004','pve',1000,true);
 IF guarded<>1005 THEN RAISE EXCEPTION 'rune_guard_damage_wrong: %',guarded; END IF;
 arena:=public.territory_runes_resolve_damage_v1(
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000006','arena',1000,true);
 IF arena<>998 THEN RAISE EXCEPTION 'rune_arena_damage_wrong: %',arena; END IF;
 pve_replayed:=public.territory_runes_resolve_damage_v1(
  '10000000-0000-4000-8000-000000000001',NULL,
  '40000000-0000-4000-8000-000000000004','pve',1000,false);
 IF pve_replayed<>pve THEN RAISE EXCEPTION 'rune_damage_changed_after_revoke'; END IF;
 IF public.territory_runes_resolve_damage_v1(
  '10000000-0000-4000-8000-000000000001',NULL,
  '40000000-0000-4000-8000-000000000004','pve',0,false)<>0
 THEN RAISE EXCEPTION 'rune_zero_damage_modified'; END IF;
 BEGIN
  PERFORM public.territory_runes_resolve_damage_v1(
   '10000000-0000-4000-8000-000000000002',NULL,
   '40000000-0000-4000-8000-000000000004','pve',1000,false);
  RAISE EXCEPTION 'expected_missing_snapshot';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'rune_effect_snapshot_missing' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.territory_runes_resolve_damage_v1(
   '10000000-0000-4000-8000-000000000001',NULL,
   '40000000-0000-4000-8000-000000000004','pve',-1,false);
  RAISE EXCEPTION 'expected_negative_damage_rejection';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'rune_damage_invalid_request' THEN RAISE; END IF;
 END;
END $test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT game_state FROM public.players
     WHERE id='10000000-0000-4000-8000-000000000001')
   <> '{"vip":7,"gold":50,"runes":"legacy"}'::jsonb
 THEN RAISE EXCEPTION 'rune_damage_mutated_legacy_save'; END IF;
END $test$;
\echo 'PASS: pinned PvE and Arena damage math, guarded hit, replay, privacy and legacy save (PG17 staged)'
