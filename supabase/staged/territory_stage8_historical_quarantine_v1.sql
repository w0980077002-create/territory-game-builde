-- TERRITORY #366, STAGED ONLY. Owner-approved cutover must quiesce all writers.
-- Immutable, item-scoped evidence lock. Not a grant, forge receipt or item upgrade.
-- No public API, no client upsert, no blind registry rewrite.
CREATE TABLE IF NOT EXISTS territory_private.stage8_historical_quarantine_v1(
  item_id uuid PRIMARY KEY,
  player_id uuid NOT NULL,
  registry_equipment jsonb NOT NULL,
  frozen_equipment jsonb NOT NULL,
  initial_location text NOT NULL CHECK(initial_location IN ('bag','equipped')),
  provenance_status text NOT NULL CHECK(provenance_status IN ('admin_approved','unresolved')),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE territory_private.stage8_historical_quarantine_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.stage8_historical_quarantine_v1 FROM PUBLIC,anon,authenticated;

-- Called only inside the SERIALIZED activation transaction, after locking
-- public.players and public.territory_profession_stage8_items. Expected hashes
-- must be explicitly reviewed, never derived from the client's new save.
-- Returns 0 when there are no historical conflicts (standard PG17 fixture).
CREATE OR REPLACE FUNCTION territory_private.stage8_prepare_historical_quarantine_v1(p_expected jsonb)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path TO ''
AS $quarantine$
DECLARE
  v_rec record;
  v_prior record;
  v_expected jsonb;
  v_digest text;
  v_status text;
  v_count integer:=0;
BEGIN
  IF pg_catalog.jsonb_typeof(p_expected) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_expected)>3
  THEN RAISE EXCEPTION 'stage8_quarantine_bad_approval'; END IF;

  FOR v_rec IN
    WITH registry AS (
      SELECT i.item_id,i.player_id,i.item_output->'equipment' AS registry_gear,
             (i.item_output#>>'{equipment,level}')::integer AS registry_level
      FROM public.territory_profession_stage8_items i
      WHERE i.item_output->>'type'='equipment'
    ), mirrors AS (
      SELECT r.*, 'bag'::text AS location,x.value->'equipment' AS eq
      FROM registry r JOIN public.players p ON p.id=r.player_id
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
        CASE WHEN pg_catalog.jsonb_typeof(p.game_state->'inventory')='array'
          THEN p.game_state->'inventory' ELSE '[]'::jsonb END) x(value)
      WHERE x.value->>'id'='stage8_'||r.item_id::text
      UNION ALL
      SELECT r.*, 'equipped'::text,x.value
      FROM registry r JOIN public.players p ON p.id=r.player_id
      CROSS JOIN LATERAL pg_catalog.jsonb_each(
        CASE WHEN pg_catalog.jsonb_typeof(p.game_state#>'{player,equipped}')='object'
          THEN p.game_state#>'{player,equipped}' ELSE '{}'::jsonb END) x(slot,value)
      WHERE x.value->>'id'='stage8_'||r.item_id::text
    )
    SELECT * FROM mirrors
    WHERE (eq->>'level')~'^[0-9]{1,3}$'
      AND (eq->>'level')::integer>registry_level
    ORDER BY item_id
  LOOP
    v_count:=v_count+1;
    v_digest:=pg_catalog.md5(v_rec.player_id::text||':'||v_rec.item_id::text||':'
      ||v_rec.registry_gear::text||':'||v_rec.eq::text||':'||v_rec.location);
    SELECT z.value INTO v_expected FROM pg_catalog.jsonb_array_elements(p_expected) z(value)
      WHERE z.value->>'fingerprint'=v_digest;
    IF NOT FOUND OR pg_catalog.jsonb_typeof(v_expected) IS DISTINCT FROM 'object'
      THEN RAISE EXCEPTION 'stage8_reconciliation_required'; END IF;
    v_status:=v_expected->>'status';
    IF v_status NOT IN ('admin_approved','unresolved')
      THEN RAISE EXCEPTION 'stage8_quarantine_invalid_status'; END IF;

    IF v_status='admin_approved' AND NOT EXISTS (
      SELECT 1 FROM public.admin_grants a
      JOIN territory_private.owner_test_gear_v1 t
        ON t.player_id=v_rec.player_id
       AND t.equipment_id='stage8_'||v_rec.item_id::text
       AND t.slot=v_rec.eq->>'slot'
       AND t.target_level=(v_rec.eq->>'level')::integer
      WHERE a.player_id=v_rec.player_id
        AND a.kind='adjust' AND a.claimed_at IS NOT NULL
        AND a.payload->>'adminTestGearId'='stage8_'||v_rec.item_id::text
        AND a.payload->'adminTestLevel'='true'::jsonb
        AND a.payload#>>ARRAY['equipLevels',v_rec.eq->>'slot']=v_rec.eq->>'level'
        AND a.payload->'adminTestEquipment'=v_rec.eq
    ) THEN RAISE EXCEPTION 'stage8_admin_evidence_missing'; END IF;

    SELECT * INTO v_prior FROM territory_private.stage8_historical_quarantine_v1
      WHERE item_id=v_rec.item_id FOR UPDATE;
    IF FOUND THEN
      IF v_prior.player_id IS DISTINCT FROM v_rec.player_id
        OR v_prior.registry_equipment IS DISTINCT FROM v_rec.registry_gear
        OR v_prior.frozen_equipment IS DISTINCT FROM v_rec.eq
        OR v_prior.initial_location IS DISTINCT FROM v_rec.location
        OR v_prior.provenance_status IS DISTINCT FROM v_status
      THEN RAISE EXCEPTION 'stage8_quarantine_snapshot_changed'; END IF;
    ELSE
      INSERT INTO territory_private.stage8_historical_quarantine_v1
        (item_id,player_id,registry_equipment,frozen_equipment,initial_location,provenance_status)
      VALUES(v_rec.item_id,v_rec.player_id,v_rec.registry_gear,v_rec.eq,v_rec.location,v_status);
    END IF;
  END LOOP;
  IF v_count<>pg_catalog.jsonb_array_length(p_expected)
    OR (SELECT pg_catalog.count(*) FROM territory_private.stage8_historical_quarantine_v1)<>v_count
  THEN RAISE EXCEPTION 'stage8_reconciliation_required'; END IF;
  RETURN v_count;
END $quarantine$;
REVOKE ALL ON FUNCTION territory_private.stage8_prepare_historical_quarantine_v1(jsonb)
  FROM PUBLIC,anon,authenticated;
