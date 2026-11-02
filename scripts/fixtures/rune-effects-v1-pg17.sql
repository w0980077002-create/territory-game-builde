-- Run after rune-ledger and rune-battle-snapshot fixtures on disposable PG17.
-- Tests REAL SQL effect resolution, not live PvE/Arena battle integration.
\set ON_ERROR_STOP on
\ir ../../supabase/staged/territory_rune_effects_v1.sql

DO $assert$
BEGIN
 IF (SELECT count(*) FROM territory_private.rune_effects_v1)<>45
 THEN RAISE EXCEPTION 'rune_effect_definitions_incomplete'; END IF;
 IF has_function_privilege('authenticated',
   'public.territory_runes_battle_effects_v1(uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'rune_effect_client_can_execute'; END IF;
 IF has_table_privilege('authenticated','territory_private.rune_effects_v1','SELECT')
 THEN RAISE EXCEPTION 'rune_effect_table_exposed'; END IF;
END $assert$;

-- Player 1 starts with rev 4 and no owned runes. Grant two distinct runes,
-- save, pin once, then change loadout and revoke: old battle stays unchanged.
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r1',2,
 '50000000-0000-4000-8000-000000000001','synthetic-effects-test');
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','axe_storm_r1',3,
 '50000000-0000-4000-8000-000000000002','synthetic-effects-test');
RESET ROLE;
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
SELECT public.territory_runes_save_v1(
 '50000000-0000-4000-8000-000000000003',4,
 jsonb_set(public.test_rune_choices('shield_wall_r1'),'{1,runeId}',to_jsonb('axe_storm_r1'::text)));
RESET ROLE;
SET ROLE service_role;
DO $assert$
DECLARE pinned jsonb; effects jsonb;
BEGIN
 pinned:=public.territory_runes_pin_battle_v1(
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000004','pve');
 effects:=public.territory_runes_battle_effects_v1(
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000004','pve');
 IF effects->>'schema'<>'territory-rune-effects/1'
   OR effects->>'revision'<>'5'
   OR jsonb_array_length(effects->'effects')<>2
   OR effects#>>'{totals,guard_absorb_bp}'<>'240'
   OR effects#>>'{totals,damage_bonus_bp}'<>'300'
 THEN RAISE EXCEPTION 'rune_effect_two_slot_calculation_failed: %',effects; END IF;
 IF effects IS DISTINCT FROM public.territory_runes_battle_effects_v1(
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000004','pve')
 THEN RAISE EXCEPTION 'rune_effect_non_deterministic'; END IF;
 BEGIN
  PERFORM public.territory_runes_battle_effects_v1(
   '10000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000004','arena');
  RAISE EXCEPTION 'expected_kind_rejection';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'rune_effect_snapshot_missing' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.territory_runes_battle_effects_v1(
   '10000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000004','pve');
  RAISE EXCEPTION 'expected_other_player_rejection';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'rune_effect_snapshot_missing' THEN RAISE; END IF;
 END;
END $assert$;
RESET ROLE;
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000001';
SELECT public.territory_runes_save_v1(
 '50000000-0000-4000-8000-000000000004',5,public.test_rune_choices(NULL));
RESET ROLE;
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','shield_wall_r1',0,
 '50000000-0000-4000-8000-000000000005','synthetic-effects-test');
SELECT public.territory_runes_admin_set_level_v1(
 '10000000-0000-4000-8000-000000000001','axe_storm_r1',0,
 '50000000-0000-4000-8000-000000000006','synthetic-effects-test');
DO $assert$
DECLARE old jsonb; fresh jsonb;
BEGIN
 old:=public.territory_runes_battle_effects_v1(
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000004','pve');
 IF old#>>'{totals,guard_absorb_bp}'<>'240'
 OR old#>>'{totals,damage_bonus_bp}'<>'300'
 THEN RAISE EXCEPTION 'rune_effect_changed_after_revoke'; END IF;
 PERFORM public.territory_runes_pin_battle_v1(
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000005','pve');
 fresh:=public.territory_runes_battle_effects_v1(
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000005','pve');
 IF jsonb_array_length(fresh->'effects')<>0 OR fresh->'totals'<>'{}'::jsonb
 THEN RAISE EXCEPTION 'rune_effect_new_battle_inherited_old_build'; END IF;
END $assert$;
RESET ROLE;

-- Full 15-slot loadout for player 2: verify all 15 effects on Arena snapshots.
SET ROLE service_role;
DO $grant$
DECLARE rune text;
BEGIN
 FOREACH rune IN ARRAY ARRAY['shield_wall_r1','axe_storm_r1','hawk_shot_r1','frost_oath_r1','battle_chant_r1','runic_bolt_r1','rune_snare_r1','quickstep_r1','fire_net_r1','ancestral_surge_r1','blood_rush_r1','forest_awakening_r1','storm_judgement_r1','winter_breaker_r1','wolf_king_r1'] LOOP
  PERFORM public.territory_runes_admin_set_level_v1(
    '10000000-0000-4000-8000-000000000002',rune,1,
    gen_random_uuid(),'synthetic-effects-test');
 END LOOP;
END $grant$;
RESET ROLE;
SET ROLE authenticated;
SET request.test_uid='10000000-0000-4000-8000-000000000002';
SELECT public.territory_runes_save_v1(
 '50000000-0000-4000-8000-000000000007',0,
 (SELECT jsonb_agg(jsonb_build_object('slotId','rune_slot_'||lpad(i::text,2,'0'),
    'runeId',(ARRAY['shield_wall_r1','axe_storm_r1','hawk_shot_r1','frost_oath_r1','battle_chant_r1','runic_bolt_r1','rune_snare_r1','quickstep_r1','fire_net_r1','ancestral_surge_r1','blood_rush_r1','forest_awakening_r1','storm_judgement_r1','winter_breaker_r1','wolf_king_r1'])[i]) ORDER BY i)
  FROM generate_series(1,15) i));
RESET ROLE;
SET ROLE service_role;
DO $assert$
DECLARE arena jsonb;
BEGIN
 PERFORM public.territory_runes_pin_battle_v1(
  '10000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000006','arena');
 arena:=public.territory_runes_battle_effects_v1(
  '10000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000006','arena');
 IF arena->>'kind'<>'arena' OR jsonb_array_length(arena->'effects')<>15
 OR arena->>'revision'<>'1'
 THEN RAISE EXCEPTION 'rune_effect_full_arena_snapshot_failed: %',arena; END IF;
END $assert$;
RESET ROLE;
DO $assert$
BEGIN
 IF (SELECT game_state FROM public.players WHERE id='10000000-0000-4000-8000-000000000001')
 <> '{"vip":7,"gold":50,"runes":"legacy"}'::jsonb
 THEN RAISE EXCEPTION 'rune_effect_changed_legacy_player'; END IF;
END $assert$;
\echo 'PASS: 45 server effect definitions, immutable pinned PvE and Arena effect resolution, 15-slot loadout, privacy, revoke and replay (PG17)'
