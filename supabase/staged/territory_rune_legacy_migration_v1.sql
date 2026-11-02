-- REVIEW ONLY. Requires the rune ledger and verified combat profiles. Never run on production.
-- No legacy data or ownership is changed; ambiguous/unverified selections are refused.
BEGIN;
CREATE TABLE IF NOT EXISTS territory_private.rune_migrations_v1 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id),
 operation_id uuid NOT NULL UNIQUE,
 profile_version integer NOT NULL,
 legacy_loadout jsonb NOT NULL,
 new_slots jsonb NOT NULL,
 receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE territory_private.rune_migrations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.rune_migrations_v1 FROM PUBLIC,anon,authenticated,service_role;

-- Must be invoked by the service after the owner has been authenticated.
-- Dry run and commit both examine the same verified profile and server ledger.
-- Player lock serializes with rune saves, admin adjustments and combat commits.
CREATE OR REPLACE FUNCTION public.territory_runes_legacy_migrate_v1(
 p_player uuid,p_operation uuid,p_profile_version integer,p_apply boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $migrate$
DECLARE profile territory_private.combat_profiles_v1%ROWTYPE;
 prior territory_private.rune_migrations_v1%ROWTYPE;
 skills jsonb; skill jsonb; runes jsonb; selected jsonb; choices jsonb;
 names text[]:=ARRAY['shield_wall','axe_storm','hawk_shot','frost_oath','battle_chant',
 'runic_bolt','rune_snare','quickstep','fire_net','ancestral_surge','blood_rush',
 'forest_awakening','storm_judgement','winter_breaker','wolf_king'];
 seen text[]:=ARRAY[]::text[]; skill_id text; chosen_rune text; expected_slot text;
 position integer; rank_num numeric; verified_rank integer; result jsonb;
BEGIN
 IF p_player IS NULL OR p_profile_version IS NULL OR p_profile_version<0 OR p_apply IS NULL
   OR (p_apply AND p_operation IS NULL) THEN RAISE EXCEPTION 'rune_migration_invalid_request'; END IF;
 PERFORM 1 FROM public.players WHERE id=p_player AND NOT coalesce(banned,false) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'rune_account_unavailable'; END IF;
 IF p_apply THEN
   SELECT * INTO prior FROM territory_private.rune_migrations_v1 WHERE player_id=p_player;
   IF FOUND THEN
     IF prior.operation_id IS DISTINCT FROM p_operation OR prior.profile_version<>p_profile_version
       THEN RAISE EXCEPTION 'rune_migration_already_done'; END IF;
     RETURN prior.receipt;
   END IF;
 END IF;
 SELECT * INTO profile FROM territory_private.combat_profiles_v1 WHERE player_id=p_player FOR UPDATE;
 IF NOT FOUND OR NOT profile.verified THEN RAISE EXCEPTION 'rune_migration_profile_unverified'; END IF;
 IF profile.version<>p_profile_version THEN RAISE EXCEPTION 'rune_migration_profile_changed'; END IF;
 IF EXISTS (SELECT 1 FROM territory_private.rune_loadouts_v1 WHERE player_id=p_player)
   THEN RAISE EXCEPTION 'rune_migration_existing_loadout'; END IF;
 skills:=profile.fighter#>'{loadout,skills}';
 IF jsonb_typeof(skills) IS DISTINCT FROM 'array' OR jsonb_array_length(skills)>15
   THEN RAISE EXCEPTION 'rune_migration_invalid_legacy'; END IF;
 SELECT jsonb_agg(jsonb_build_object('slotId',slot_id,'runeId',NULL) ORDER BY slot_id)
   INTO choices FROM (SELECT DISTINCT c.slot_id FROM territory_private.rune_catalog_v1 c) s;
 FOR skill IN SELECT value FROM jsonb_array_elements(skills) LOOP
   IF jsonb_typeof(skill) IS DISTINCT FROM 'object' OR jsonb_typeof(skill->'skillId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(skill->'runes') IS DISTINCT FROM 'array'
     THEN RAISE EXCEPTION 'rune_migration_invalid_legacy'; END IF;
   skill_id:=skill->>'skillId';
   IF skill_id=ANY(seen) THEN RAISE EXCEPTION 'rune_migration_duplicate_skill'; END IF;
   seen:=array_append(seen,skill_id); runes:=skill->'runes';
   IF jsonb_array_length(runes)>1 THEN RAISE EXCEPTION 'rune_migration_ambiguous'; END IF;
   IF jsonb_array_length(runes)=0 THEN CONTINUE; END IF;
   position:=array_position(names,skill_id); selected:=runes->0;
   IF position IS NULL OR jsonb_typeof(selected) IS DISTINCT FROM 'object'
      OR jsonb_typeof(selected->'runeId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(selected->'level') IS DISTINCT FROM 'number'
     THEN RAISE EXCEPTION 'rune_migration_invalid_legacy'; END IF;
   chosen_rune:=selected->>'runeId'; rank_num:=(selected->>'level')::numeric;
   IF rank_num<>trunc(rank_num) OR rank_num<1 OR rank_num>3
     THEN RAISE EXCEPTION 'rune_migration_invalid_legacy'; END IF;
   expected_slot:='rune_slot_'||lpad(position::text,2,'0');
   SELECT o.level INTO verified_rank FROM territory_private.rune_catalog_v1 c
    JOIN territory_private.rune_ownership_v1 o ON o.rune_id=c.rune_id
    WHERE o.player_id=p_player AND c.slot_id=expected_slot AND c.rune_id=chosen_rune;
   IF NOT FOUND OR verified_rank<>rank_num THEN RAISE EXCEPTION 'rune_migration_unverified_rank'; END IF;
   choices:=jsonb_set(choices,ARRAY[(position-1)::text,'runeId'],to_jsonb(chosen_rune));
 END LOOP;
 result:=jsonb_build_object('playerId',p_player,'profileVersion',profile.version,
   'legacyLoadout',profile.fighter->'loadout','slots',choices,'applied',p_apply,'operationId',p_operation);
 IF p_apply THEN
   INSERT INTO territory_private.rune_loadouts_v1(player_id,revision,slots) VALUES(p_player,1,choices);
   INSERT INTO territory_private.rune_migrations_v1(player_id,operation_id,profile_version,legacy_loadout,new_slots,receipt)
    VALUES(p_player,p_operation,profile.version,profile.fighter->'loadout',choices,result);
 END IF;
 RETURN result;
END $migrate$;
REVOKE ALL ON FUNCTION public.territory_runes_legacy_migrate_v1(uuid,uuid,integer,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.territory_runes_legacy_migrate_v1(uuid,uuid,integer,boolean) TO service_role;
COMMIT;
