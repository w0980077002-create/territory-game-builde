-- TERRITORY #366: STAGED, NOT DEPLOYED.
-- Internal, read-only canonical lookup for server-owned crafted equipment.
-- Do not wire into production player-save triggers until the registry-vs-save
-- preflight is clean and the currently divergent items are reconciled.
-- Never infer ownership or a higher level from editable game_state data.
--
-- Returns NULL for all non-Stage8 gear so the established legacy owner cap
-- stays in force. Raises on stolen/unknown/corrupt Stage8 gear rather than
-- accepting forged ownership or silently deleting real upgrades.
CREATE OR REPLACE FUNCTION territory_private.stage8_verified_gear_v2(
  p_item jsonb,
  p_player uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $stage8$
DECLARE
  v_client_id text;
  v_canonical jsonb;
  v_saved_level integer;
  v_canonical_level integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  v_client_id := p_item->>'id';
  IF v_client_id IS NULL OR pg_catalog.left(v_client_id,7) <> 'stage8_' THEN
    RETURN NULL;
  END IF;
  IF p_player IS NULL OR v_client_id !~ '^stage8_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'stage8_invalid_item_reference' USING ERRCODE='23514';
  END IF;
  SELECT i.item_output->'equipment' INTO v_canonical
    FROM public.territory_profession_stage8_items i
   WHERE i.item_id = pg_catalog.substr(v_client_id,8)::uuid
     AND i.player_id = p_player
     AND i.item_output->>'type' = 'equipment';
  IF NOT FOUND OR pg_catalog.jsonb_typeof(v_canonical) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'stage8_item_not_owned' USING ERRCODE='23514';
  END IF;
  IF (p_item->>'level') !~ '^[0-9]{1,3}$'
     OR (v_canonical->>'level') !~ '^[0-9]{1,3}$' THEN
    RAISE EXCEPTION 'stage8_invalid_level' USING ERRCODE='23514';
  END IF;
  v_saved_level := (p_item->>'level')::integer;
  v_canonical_level := (v_canonical->>'level')::integer;
  IF v_saved_level > v_canonical_level THEN
    -- Three historical items presently have upgrades that predate the
    -- server ledger. Never silently replace or trust these levels.
    RAISE EXCEPTION 'stage8_reconciliation_required' USING ERRCODE='23514';
  END IF;
  IF v_saved_level < 1 OR v_canonical_level NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'stage8_invalid_level' USING ERRCODE='23514';
  END IF;
  -- Client-supplied attacks, levels and upgradeCount are NEVER an authority.
  -- Return registry fields verbatim, with exactly the one verified item ID.
  RETURN v_canonical || pg_catalog.jsonb_build_object('id',v_client_id);
END;
$stage8$;

REVOKE ALL ON FUNCTION territory_private.stage8_verified_gear_v2(jsonb,uuid)
  FROM PUBLIC, anon, authenticated;
