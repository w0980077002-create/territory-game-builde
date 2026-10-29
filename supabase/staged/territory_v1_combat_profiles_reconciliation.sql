-- REVIEW ONLY: install after territory_v1_combat_completion.sql in an isolated DB.
-- An attestation is an operator-reviewed, server-side projection of an existing
-- account, not a copy of player-supplied game_state. There is no client or
-- service-role write path to attestations. An absent or stale attestation fails
-- closed and records a reconciliation request without changing the player.
BEGIN;

CREATE TABLE IF NOT EXISTS territory_private.combat_profile_attestations_v1 (
  attestation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id),
  source_game_state jsonb NOT NULL,
  source_player_level integer NOT NULL,
  fighter jsonb NOT NULL,
  equipped_item_ids uuid[] NOT NULL,
  legacy_equipped_ids text[] NOT NULL DEFAULT '{}'::text[],
  evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) > 0),
  reviewed_by text NOT NULL CHECK(length(btrim(reviewed_by)) > 0),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS combat_profile_attestation_player_v1
  ON territory_private.combat_profile_attestations_v1(player_id, reviewed_at DESC);
-- Preserve legacy non-UUID item keys; gem sockets keep the separate uuid[].
ALTER TABLE territory_private.combat_profile_attestations_v1
 ADD COLUMN IF NOT EXISTS legacy_equipped_ids text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE territory_private.combat_profiles_v1
 ADD COLUMN IF NOT EXISTS legacy_equipped_ids text[] NOT NULL DEFAULT '{}'::text[];

CREATE TABLE IF NOT EXISTS territory_private.combat_profile_reconciliation_v1 (
  player_id uuid PRIMARY KEY REFERENCES public.players(id),
  reason text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE territory_private.combat_profile_attestations_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.combat_profile_reconciliation_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.combat_profile_attestations_v1,
  territory_private.combat_profile_reconciliation_v1 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON territory_private.combat_profile_attestations_v1 TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON territory_private.combat_profile_reconciliation_v1 TO service_role;

-- Only fields capable of affecting combat are compared. These values are not
-- used as authority to construct fighter: that comes from the reviewed record.
-- Server columns are included when present, so changes outside game_state also
-- invalidate the profile. Inventory is deliberately conservative until there
-- is a complete authoritative item registry.
CREATE OR REPLACE FUNCTION territory_private.combat_source_projection_v1(p public.players)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('level',p.level,'stats',p.game_state#>'{player,stats}',
   'equipped',p.game_state#>'{player,equipped}','inventory',p.game_state->'inventory',
   'attack',to_jsonb(p)->'attack','defense',to_jsonb(p)->'defense',
   'max_hp',to_jsonb(p)->'max_hp','crit_chance',to_jsonb(p)->'crit_chance');
$$;
CREATE TABLE IF NOT EXISTS territory_private.combat_profile_sources_v1 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id),
 attestation_id uuid NOT NULL REFERENCES territory_private.combat_profile_attestations_v1(attestation_id),
 projection jsonb NOT NULL,
 fighter jsonb NOT NULL
);
ALTER TABLE territory_private.combat_profile_sources_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.combat_profile_sources_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON territory_private.combat_profile_sources_v1 TO service_role;

-- Slot-order makes the migration deterministic; missing IDs are rejected by
-- preparation rather than replaced with fake equipment.
CREATE OR REPLACE FUNCTION territory_private.combat_legacy_equipped_ids_v1(p_state jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $
 SELECT coalesce(array_agg(x.value->>'id' ORDER BY x.key),ARRAY[]::text[])
 FROM jsonb_each(CASE WHEN jsonb_typeof(p_state#>'{player,equipped}')='object'
   THEN p_state#>'{player,equipped}' ELSE '{}'::jsonb END) x
 WHERE x.value <> 'null'::jsonb;
$;
CREATE OR REPLACE FUNCTION territory_private.combat_profile_is_current_v1(p_player uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players p
    JOIN territory_private.combat_profiles_v1 h ON h.player_id=p.id
    JOIN territory_private.combat_profile_attestations_v1 a
      ON a.attestation_id::text=h.approval_reference AND a.player_id=p.id
    JOIN territory_private.combat_profile_sources_v1 src
      ON src.player_id=p.id AND src.attestation_id=a.attestation_id
    WHERE p.id=p_player AND NOT coalesce(p.banned,false) AND h.verified
      AND a.revoked_at IS NULL
      AND src.projection = territory_private.combat_source_projection_v1(p)
      AND (h.fighter - 'loadout') = src.fighter
      AND h.equipped_item_ids = a.equipped_item_ids
      AND h.legacy_equipped_ids = a.legacy_equipped_ids
      AND a.legacy_equipped_ids = territory_private.combat_legacy_equipped_ids_v1(p.game_state)
  );
$$;

CREATE OR REPLACE FUNCTION territory_private.prepare_combat_profile_v1(p_player uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.players%ROWTYPE;
  a territory_private.combat_profile_attestations_v1%ROWTYPE;
  h territory_private.combat_profiles_v1%ROWTYPE;
  reason text;
  stat_key text;
  stat_value numeric;
  has_profile boolean;
BEGIN
  SELECT * INTO p FROM public.players WHERE id=p_player FOR UPDATE;
  IF NOT FOUND OR coalesce(p.banned,false) THEN RAISE EXCEPTION 'combat_account_unavailable'; END IF;
  SELECT * INTO h FROM territory_private.combat_profiles_v1 WHERE player_id=p_player FOR UPDATE;
  has_profile := FOUND;
  IF has_profile THEN
    IF territory_private.combat_profile_is_current_v1(p_player) THEN
      RETURN jsonb_build_object('status','ready','profile_revision',h.version);
    END IF;
    IF EXISTS (SELECT 1 FROM territory_private.combat_sessions_v1
        WHERE player_id=p_player AND state->>'status'='fighting') THEN
      reason := 'active_session';
    END IF;
  END IF;
  IF reason IS NULL THEN
    SELECT * INTO a FROM territory_private.combat_profile_attestations_v1
      WHERE player_id=p_player AND revoked_at IS NULL
        AND source_game_state IS NOT DISTINCT FROM p.game_state
        AND source_player_level=p.level
      ORDER BY reviewed_at DESC,attestation_id DESC LIMIT 1;
    IF NOT FOUND THEN
      reason := 'trusted_projection_missing_or_stale';
    ELSIF jsonb_typeof(a.fighter) IS DISTINCT FROM 'object'
      OR jsonb_typeof(a.fighter->'stats') IS DISTINCT FROM 'object'
      OR jsonb_typeof(a.fighter->'ownership') IS DISTINCT FROM 'object'
      OR jsonb_typeof(a.fighter->'loadout') IS DISTINCT FROM 'object'
      OR jsonb_typeof(a.fighter#>'{loadout,skills}') IS DISTINCT FROM 'array'
      OR jsonb_typeof(a.fighter#>'{loadout,passives}') IS DISTINCT FROM 'array'
      OR jsonb_typeof(a.fighter#>'{ownership,skills}') IS DISTINCT FROM 'object'
      OR jsonb_typeof(a.fighter#>'{ownership,runes}') IS DISTINCT FROM 'object'
      OR jsonb_typeof(a.fighter#>'{ownership,passives}') IS DISTINCT FROM 'object'
      OR jsonb_typeof(a.fighter#>'{ownership,heroLevel}') IS DISTINCT FROM 'number'
      OR array_position(a.equipped_item_ids,NULL) IS NOT NULL
      OR cardinality(a.equipped_item_ids) <> (SELECT count(DISTINCT x) FROM unnest(a.equipped_item_ids) x)
      OR array_position(a.legacy_equipped_ids,NULL) IS NOT NULL
      OR EXISTS (SELECT 1 FROM unnest(a.legacy_equipped_ids) x WHERE btrim(x)='' OR length(x)>256)
      OR cardinality(a.legacy_equipped_ids) <> (SELECT count(DISTINCT x) FROM unnest(a.legacy_equipped_ids) x)
      OR a.legacy_equipped_ids IS DISTINCT FROM territory_private.combat_legacy_equipped_ids_v1(p.game_state)
    THEN
      reason := 'invalid_reviewed_projection';
    ELSE
      stat_value := (a.fighter#>>'{ownership,heroLevel}')::numeric;
      IF stat_value < 1 OR stat_value > 2147483647 OR stat_value <> trunc(stat_value) OR stat_value<>p.level
        THEN reason := 'invalid_reviewed_projection'; END IF;
      FOREACH stat_key IN ARRAY ARRAY['hp','maxHp','attack','defense','critChance','dodgeChance','blockChance'] LOOP
        IF jsonb_typeof(a.fighter->'stats'->stat_key) IS DISTINCT FROM 'number' THEN
          reason := 'invalid_reviewed_projection'; EXIT;
        END IF;
        stat_value := (a.fighter->'stats'->>stat_key)::numeric;
        IF stat_value < 0 OR stat_value > 1000000000
          OR (stat_key IN ('critChance','dodgeChance','blockChance') AND stat_value > 1)
        THEN reason := 'invalid_reviewed_projection'; EXIT; END IF;
      END LOOP;
      IF reason IS NULL AND ((a.fighter#>>'{stats,maxHp}')::numeric < 1 OR
          (a.fighter#>>'{stats,hp}')::numeric > (a.fighter#>>'{stats,maxHp}')::numeric)
      THEN reason := 'invalid_reviewed_projection'; END IF;
      IF reason IS NULL THEN
        IF has_profile THEN
          -- Keep the actual selected build. The service must revalidate it
          -- against the new ownership and catalog before starting combat.
          UPDATE territory_private.combat_profiles_v1 SET
            verified=true,fighter=jsonb_set(a.fighter,'{loadout}',h.fighter->'loadout'),
            equipped_item_ids=a.equipped_item_ids,legacy_equipped_ids=a.legacy_equipped_ids,approval_reference=a.attestation_id::text,
            version=version+1,updated_at=clock_timestamp()
            WHERE player_id=p_player RETURNING * INTO h;
        ELSE
          INSERT INTO territory_private.combat_profiles_v1(player_id,verified,fighter,equipped_item_ids,legacy_equipped_ids,approval_reference)
            VALUES(p_player,true,a.fighter,a.equipped_item_ids,a.legacy_equipped_ids,a.attestation_id::text) RETURNING * INTO h;
        END IF;
        INSERT INTO territory_private.combat_profile_sources_v1(player_id,attestation_id,projection,fighter)
          VALUES(p_player,a.attestation_id,territory_private.combat_source_projection_v1(p),h.fighter-'loadout')
          ON CONFLICT(player_id) DO UPDATE SET attestation_id=excluded.attestation_id,
            projection=excluded.projection,fighter=excluded.fighter;
        DELETE FROM territory_private.combat_profile_reconciliation_v1 WHERE player_id=p_player;
        RETURN jsonb_build_object('status','ready','profile_revision',h.version);
      END IF;
    END IF;
  END IF;
  INSERT INTO territory_private.combat_profile_reconciliation_v1(player_id,reason)
    VALUES(p_player,reason)
    ON CONFLICT(player_id) DO UPDATE SET reason=excluded.reason,updated_at=clock_timestamp();
  RETURN jsonb_build_object('status','reconciliation_required','reason',reason);
END $$;

-- Only called by the trusted settlement transaction after it checked the
-- source before updating players. Never derive ownership or stats from the
-- writable save: apply the established level-up increments to the attested
-- fighter. If triggers change anything unexpected the entire award rolls back.
CREATE OR REPLACE FUNCTION territory_private.combat_refresh_reward_v1(p_player uuid,p_before jsonb,p_old_level integer)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.players%ROWTYPE; h territory_private.combat_profiles_v1%ROWTYPE;
 src territory_private.combat_profile_sources_v1%ROWTYPE; after_projection jsonb;
 expected_stats jsonb; v_fighter jsonb; levels integer; col text; inc integer;
BEGIN
 SELECT * INTO p FROM public.players WHERE id=p_player FOR UPDATE;
 SELECT * INTO h FROM territory_private.combat_profiles_v1 WHERE player_id=p_player FOR UPDATE;
 SELECT * INTO src FROM territory_private.combat_profile_sources_v1 WHERE player_id=p_player FOR UPDATE;
 IF NOT FOUND OR src.projection IS DISTINCT FROM p_before OR NOT h.verified
    OR h.approval_reference IS DISTINCT FROM src.attestation_id::text
    OR h.fighter-'loadout' IS DISTINCT FROM src.fighter
    OR NOT EXISTS(SELECT 1 FROM territory_private.combat_profile_attestations_v1 a
       WHERE a.attestation_id=src.attestation_id AND a.player_id=p_player AND a.revoked_at IS NULL)
    OR (p_before->>'level')::int IS DISTINCT FROM p_old_level
    OR (h.fighter#>>'{ownership,heroLevel}')::int IS DISTINCT FROM p_old_level
 THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
 levels:=p.level-p_old_level;
 IF levels<0 OR p.level>100 THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
 after_projection:=territory_private.combat_source_projection_v1(p);
 IF after_projection->'equipped' IS DISTINCT FROM p_before->'equipped'
    OR after_projection->'inventory' IS DISTINCT FROM p_before->'inventory'
 THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
 expected_stats:=p_before->'stats';
 IF levels>0 THEN
   expected_stats:=jsonb_set(expected_stats,'{maxHp}',to_jsonb((expected_stats->>'maxHp')::numeric+20*levels));
   expected_stats:=jsonb_set(expected_stats,'{hp}',expected_stats->'maxHp');
   expected_stats:=jsonb_set(expected_stats,'{attack}',to_jsonb((expected_stats->>'attack')::numeric+5*levels));
   expected_stats:=jsonb_set(expected_stats,'{defense}',to_jsonb((expected_stats->>'defense')::numeric+2*levels));
 END IF;
 IF after_projection->'stats' IS DISTINCT FROM expected_stats THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
 FOREACH col IN ARRAY ARRAY['attack','defense','max_hp','crit_chance'] LOOP
   inc:=CASE col WHEN 'attack' THEN 5 WHEN 'defense' THEN 2 WHEN 'max_hp' THEN 20 ELSE 0 END;
   IF p_before->col='null'::jsonb THEN
     IF after_projection->col IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
   ELSIF jsonb_typeof(p_before->col)<>'number' OR jsonb_typeof(after_projection->col)<>'number'
      OR (after_projection->>col)::numeric IS DISTINCT FROM (p_before->>col)::numeric + levels*inc
   THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
 END LOOP;
 v_fighter:=h.fighter;
 IF levels>0 THEN
   v_fighter:=jsonb_set(v_fighter,'{stats,maxHp}',to_jsonb((v_fighter#>>'{stats,maxHp}')::numeric+20*levels));
   v_fighter:=jsonb_set(v_fighter,'{stats,hp}',v_fighter#>'{stats,maxHp}');
   v_fighter:=jsonb_set(v_fighter,'{stats,attack}',to_jsonb((v_fighter#>>'{stats,attack}')::numeric+5*levels));
   v_fighter:=jsonb_set(v_fighter,'{stats,defense}',to_jsonb((v_fighter#>>'{stats,defense}')::numeric+2*levels));
   v_fighter:=jsonb_set(v_fighter,'{ownership,heroLevel}',to_jsonb(p.level));
 END IF;
 UPDATE territory_private.combat_profiles_v1 SET fighter=v_fighter,version=version+1,updated_at=clock_timestamp() WHERE player_id=p_player;
 UPDATE territory_private.combat_profile_sources_v1 SET projection=after_projection,fighter=v_fighter-'loadout' WHERE player_id=p_player;
END $$;

-- Edge calls this in a separate transaction so a queued review survives a
-- later rejected combat request. It cannot be invoked by app users directly.
CREATE OR REPLACE FUNCTION public.territory_combat_prepare_profile_v1(p_player uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT territory_private.prepare_combat_profile_v1(p_player);
$$;

REVOKE ALL ON FUNCTION territory_private.combat_legacy_equipped_ids_v1(jsonb),
  territory_private.combat_profile_is_current_v1(uuid),
  territory_private.prepare_combat_profile_v1(uuid),territory_private.combat_source_projection_v1(public.players),
  territory_private.combat_refresh_reward_v1(uuid,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.combat_legacy_equipped_ids_v1(jsonb),
  territory_private.combat_profile_is_current_v1(uuid),
  territory_private.prepare_combat_profile_v1(uuid),territory_private.combat_source_projection_v1(public.players),
  territory_private.combat_refresh_reward_v1(uuid,jsonb,integer) TO service_role;
REVOKE ALL ON FUNCTION public.territory_combat_prepare_profile_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_combat_prepare_profile_v1(uuid) TO service_role;
COMMIT;
