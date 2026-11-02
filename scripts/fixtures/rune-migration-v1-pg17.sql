-- Runs only after rune-ledger-v1-pg17.sql on a disposable database.
\set ON_ERROR_STOP on
CREATE TABLE territory_private.combat_profiles_v1 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id),version integer NOT NULL,
 verified boolean NOT NULL,fighter jsonb NOT NULL
);
INSERT INTO public.players(id,game_state) VALUES
 ('10000000-0000-4000-8000-000000000003','{"vip":8,"gold":100}'),
 ('10000000-0000-4000-8000-000000000004','{}');
INSERT INTO territory_private.combat_profiles_v1 VALUES
 ('10000000-0000-4000-8000-000000000002',7,true,
  '{"loadout":{"skills":[{"skillId":"shield_wall","level":1,"runes":[{"runeId":"shield_wall_r1","level":2}]}],"passives":[]}}'),
 ('10000000-0000-4000-8000-000000000003',2,true,
  '{"loadout":{"skills":[{"skillId":"shield_wall","level":1,"runes":[{"runeId":"shield_wall_r1","level":2},{"runeId":"shield_wall_r2","level":1}]}],"passives":[]}}'),
 ('10000000-0000-4000-8000-000000000004',1,true,
  '{"loadout":{"skills":[{"skillId":"shield_wall","level":1,"runes":[{"runeId":"shield_wall_r1","level":1}]}],"passives":[]}}');
\ir ../../supabase/staged/territory_rune_legacy_migration_v1.sql
SET ROLE service_role;
SELECT public.territory_runes_admin_set_level_v1('10000000-0000-4000-8000-000000000002','shield_wall_r1',2,'20000000-0000-4000-8000-000000000009','fixture evidence');
DO $test$ DECLARE preview jsonb; first_receipt jsonb; replay jsonb; BEGIN
 IF has_function_privilege('authenticated','public.territory_runes_legacy_migrate_v1(uuid,uuid,integer,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'client_can_migrate'; END IF;
 preview:=public.territory_runes_legacy_migrate_v1('10000000-0000-4000-8000-000000000002',NULL,7,false);
 IF preview#>>'{slots,0,runeId}'<>'shield_wall_r1' OR (preview->>'applied')::boolean
 THEN RAISE EXCEPTION 'migration_preview_failed'; END IF;
 BEGIN
   PERFORM public.territory_runes_legacy_migrate_v1('10000000-0000-4000-8000-000000000003',NULL,2,false);
   RAISE EXCEPTION 'expected_ambiguous_rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'rune_migration_ambiguous' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.territory_runes_legacy_migrate_v1('10000000-0000-4000-8000-000000000004',NULL,1,false);
   RAISE EXCEPTION 'expected_ownership_rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'rune_migration_unverified_rank' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.territory_runes_legacy_migrate_v1('10000000-0000-4000-8000-000000000002',NULL,6,false);
   RAISE EXCEPTION 'expected_profile_rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'rune_migration_profile_changed' THEN RAISE; END IF; END;
 first_receipt:=public.territory_runes_legacy_migrate_v1('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000010',7,true);
 replay:=public.territory_runes_legacy_migrate_v1('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000010',7,true);
 IF first_receipt<>replay OR NOT (first_receipt->>'applied')::boolean THEN RAISE EXCEPTION 'migration_replay_failed'; END IF;
END $test$;
RESET ROLE;
DO $test$ BEGIN
 IF (SELECT fighter#>>'{loadout,skills,0,runes,0,runeId}' FROM territory_private.combat_profiles_v1 WHERE player_id='10000000-0000-4000-8000-000000000002')<>'shield_wall_r1'
 OR (SELECT game_state FROM public.players WHERE id='10000000-0000-4000-8000-000000000003')<>'{"vip":8,"gold":100}'::jsonb
 OR EXISTS(SELECT 1 FROM territory_private.rune_loadouts_v1 WHERE player_id='10000000-0000-4000-8000-000000000003')
 THEN RAISE EXCEPTION 'migration_changed_legacy'; END IF;
END $test$;
\echo 'PASS: legacy rune dry run, conflict refusal, idempotent migration, unchanged legacy data'
