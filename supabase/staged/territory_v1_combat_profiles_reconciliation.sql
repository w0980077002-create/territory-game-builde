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
  evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) > 0),
  reviewed_by text NOT NULL CHECK(length(btrim(reviewed_by)) > 0),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS combat_profile_attestation_player_v1
  ON territory_private.combat_profile_attestations_v1(player_id, reviewed_at DESC);

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

-- The profile must be tied to the exact reviewed source snapshot. Full snapshot
-- equality is intentionally conservative: benign save changes can require a
-- new review until a narrower, server-authoritative revision exists.
CREATE OR REPLACE FUNCTION territory_private.combat_profile_is_current_v1(p_player uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players p
    JOIN territory_private.combat_profiles_v1 h ON h.player_id=p.id
    JOIN territory_private.combat_profile_attestations_v1 a
      ON a.attestation_id::text=h.approval_reference AND a.player_id=p.id
    WHERE p.id=p_player AND NOT coalesce(p.banned,false) AND h.verified
      AND a.revoked_at IS NULL AND a.source_game_state IS NOT DISTINCT FROM p.game_state
      AND a.source_player_level=p.level
      AND (h.fighter - 'loadout') = (a.fighter - 'loadout')
      AND h.equipped_item_ids = a.equipped_item_ids
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
    THEN
      reason := 'invalid_reviewed_projection';
    ELSE
      stat_value := (a.fighter#>>'{ownership,heroLevel}')::numeric;
      IF stat_value < 1 OR stat_value > 2147483647 OR stat_value <> trunc(stat_value)
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
            equipped_item_ids=a.equipped_item_ids,approval_reference=a.attestation_id::text,
            version=version+1,updated_at=clock_timestamp()
            WHERE player_id=p_player RETURNING * INTO h;
        ELSE
          INSERT INTO territory_private.combat_profiles_v1(player_id,verified,fighter,equipped_item_ids,approval_reference)
            VALUES(p_player,true,a.fighter,a.equipped_item_ids,a.attestation_id::text) RETURNING * INTO h;
        END IF;
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

-- Edge calls this in a separate transaction so a queued review survives a
-- later rejected combat request. It cannot be invoked by app users directly.
CREATE OR REPLACE FUNCTION public.territory_combat_prepare_profile_v1(p_player uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT territory_private.prepare_combat_profile_v1(p_player);
$$;

REVOKE ALL ON FUNCTION territory_private.combat_profile_is_current_v1(uuid),
  territory_private.prepare_combat_profile_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.combat_profile_is_current_v1(uuid),
  territory_private.prepare_combat_profile_v1(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.territory_combat_prepare_profile_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_combat_prepare_profile_v1(uuid) TO service_role;
COMMIT;
