-- #366 PREPARATION ONLY. No player writes, trigger changes or public transfer API.
-- Install on a disposable copy first. Activation is a separate explicit artifact.
BEGIN;
CREATE OR REPLACE FUNCTION territory_private.stage8_preserve_state_v3(
  p_state jsonb,p_hero integer,p_player uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path TO ''
AS $preserve$
DECLARE
  v_state jsonb:=p_state;
  v_clean jsonb;
  v_bag jsonb:='[]';
  v_equipped jsonb;
  v_seen text[]:=ARRAY[]::text[];
  v_entry record;
  v_registry record;
  v_eq jsonb;
  v_id text;
  v_slot text;
  v_old jsonb;
  v_key text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_items i
    WHERE i.player_id=p_player AND i.item_output->>'type'='equipment')
    AND position('"stage8_' IN coalesce(p_state::text,''))=0 THEN
    RETURN territory_private.owner_cap_state_v1(public.territory_normalize_state_v4(
      territory_private.normalize_legacy_rare_state_20261108(p_state)),p_hero,p_player);
  END IF;
  IF p_player IS NULL OR p_hero IS NULL THEN RAISE EXCEPTION 'stage8_invalid_owner'; END IF;
  IF jsonb_typeof(v_state) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_state->'inventory') IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_state#>'{player,equipped}') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'stage8_invalid_save_shape'; END IF;
  v_equipped:=v_state#>'{player,equipped}';
  -- Check committed evidence BEFORE any normalization or replacement. Old
  -- client-only improvements cannot be adopted or destroyed without receipts.
  SELECT game_state INTO v_old FROM public.players WHERE id=p_player;
  FOR v_entry IN
    SELECT x.value->'equipment' AS eq FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(v_old->'inventory')='array' THEN v_old->'inventory' ELSE '[]' END) x
    UNION ALL SELECT e.value FROM jsonb_each(
      CASE WHEN jsonb_typeof(v_old#>'{player,equipped}')='object' THEN v_old#>'{player,equipped}' ELSE '{}' END) e
  LOOP
    IF left(v_entry.eq->>'id',7)='stage8_' THEN
      -- Ignore an old owner's mirror AFTER an authorized registry transfer.
      IF EXISTS(SELECT 1 FROM public.territory_profession_stage8_items i
        WHERE 'stage8_'||i.item_id::text=v_entry.eq->>'id' AND i.player_id=p_player) THEN
        v_eq:=territory_private.stage8_verified_gear_v2(v_entry.eq,p_player);
        IF v_entry.eq->>'level'=v_eq->>'level' THEN
          FOREACH v_key IN ARRAY ARRAY['upgradeCount','baseLevel','baseStats','rarity','slot',
            'attack','defense','hp','critChance','qualityVersion','masteryQualityPct','history'] LOOP
            IF v_entry.eq->v_key IS DISTINCT FROM v_eq->v_key THEN
              RAISE EXCEPTION 'stage8_reconciliation_required';
            END IF;
          END LOOP;
        END IF;
      END IF;
    END IF;
  END LOOP;
  -- Remove Stage8 gear from the legacy normalizer's input. The ID grants no
  -- bypass: each referenced UUID MUST first pass the owner-only registry lookup.
  FOR v_entry IN SELECT x.value AS item FROM jsonb_array_elements(v_state->'inventory') x LOOP
    v_id:=v_entry.item->>'id';
    IF left(v_id,7)='stage8_' OR left(v_entry.item#>>'{equipment,id}',7)='stage8_' THEN
      -- Non-equipment Stage8 consumables retain their existing consumption path.
      IF v_entry.item->>'type' IN ('potion','elixir') AND NOT(v_entry.item ? 'equipment')
        AND NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_items i
          WHERE 'stage8_'||i.item_id::text=v_id AND i.item_output->>'type'='equipment') THEN
        v_bag:=v_bag||jsonb_build_array(v_entry.item); CONTINUE;
      END IF;
      -- Legacy inv_* wrappers have TWO distinct cases:
      -- (A) A preexisting extra alias alongside the canonical registry item:
      --     preserve exact committed bytes, never silently delete the alias.
      -- (B) A newly created sole display wrapper during normal unequip:
      --     accept as ONE reference and restore the canonical Stage8 item.
      -- Never allow a new second alias or duplicate ownership.
      IF left(v_id,4)='inv_' AND left(v_entry.item#>>'{equipment,id}',7)='stage8_' THEN
        IF v_entry.item->>'type' IS DISTINCT FROM 'equipment'
          OR v_entry.item->'qty' IS DISTINCT FROM '1'::jsonb
          THEN RAISE EXCEPTION 'stage8_unapproved_legacy_alias'; END IF;
        v_eq:=territory_private.stage8_verified_gear_v2(v_entry.item->'equipment',p_player);
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(v_old->'inventory')='array'
              THEN v_old->'inventory' ELSE '[]'::jsonb END) prior
          WHERE prior.value->>'id'=v_id AND prior.value=v_entry.item) THEN
          -- Exact known historical alias, verified server equipment.
          IF v_eq IS DISTINCT FROM v_entry.item->'equipment'
            THEN RAISE EXCEPTION 'stage8_legacy_alias_modified'; END IF;
          v_bag:=v_bag||jsonb_build_array(v_entry.item);
          CONTINUE;
        END IF;
        -- Fresh sole wrapper is an ordinary unequip, not a new item copy.
        -- It may replace only ONE representation of the same UUID.
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(v_old->'inventory')='array'
              THEN v_old->'inventory' ELSE '[]'::jsonb END) old_alias
          WHERE left(old_alias.value->>'id',4)='inv_'
            AND old_alias.value#>>'{equipment,id}'=v_entry.item#>>'{equipment,id}')
          OR (SELECT count(*) FROM jsonb_array_elements(v_state->'inventory') incoming
              WHERE incoming.value->>'id'=v_entry.item#>>'{equipment,id}'
                OR incoming.value#>>'{equipment,id}'=v_entry.item#>>'{equipment,id}')<>1
          OR EXISTS(SELECT 1 FROM jsonb_each(v_equipped) e
              WHERE e.value->>'id'=v_entry.item#>>'{equipment,id}')
        THEN RAISE EXCEPTION 'stage8_unapproved_legacy_alias'; END IF;
        v_id:=v_entry.item#>>'{equipment,id}';
        IF v_id=ANY(v_seen) THEN RAISE EXCEPTION 'stage8_duplicate_item'; END IF;
        v_seen:=array_append(v_seen,v_id);
        CONTINUE;
      END IF;
      IF left(v_id,7)<>'stage8_' AND left(v_entry.item#>>'{equipment,id}',7)='stage8_' THEN
        RAISE EXCEPTION 'stage8_unapproved_legacy_alias';
      END IF;
      IF v_id IS DISTINCT FROM v_entry.item#>>'{equipment,id}'
        OR v_entry.item->'qty' IS DISTINCT FROM '1'::jsonb
      THEN RAISE EXCEPTION 'stage8_invalid_mirror'; END IF;
      v_eq:=territory_private.stage8_verified_gear_v2(v_entry.item->'equipment',p_player);
      IF v_eq IS NULL THEN RAISE EXCEPTION 'stage8_invalid_mirror'; END IF;
      IF v_id=ANY(v_seen) THEN RAISE EXCEPTION 'stage8_duplicate_item'; END IF;
      v_seen:=array_append(v_seen,v_id);
    ELSE v_bag:=v_bag||jsonb_build_array(v_entry.item); END IF;
  END LOOP;
  FOR v_entry IN SELECT e.key,e.value FROM jsonb_each(v_equipped) e LOOP
    v_id:=v_entry.value->>'id';
    IF left(v_id,7)='stage8_' THEN
      v_eq:=territory_private.stage8_verified_gear_v2(v_entry.value,p_player);
      IF v_id=ANY(v_seen) THEN RAISE EXCEPTION 'stage8_duplicate_item'; END IF;
      IF (v_eq->>'level')::integer>p_hero OR v_eq->>'slot' IS DISTINCT FROM v_entry.key
        THEN RAISE EXCEPTION 'stage8_cannot_equip'; END IF;
      v_seen:=array_append(v_seen,v_id);
      v_equipped:=jsonb_set(v_equipped,ARRAY[v_entry.key],'null');
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(v_state->'belt')='array' THEN v_state->'belt' ELSE '[]' END) b
    WHERE left(b.value->>'id',7)='stage8_' AND (b.value ? 'equipment'
      OR EXISTS(SELECT 1 FROM public.territory_profession_stage8_items i
        WHERE 'stage8_'||i.item_id::text=b.value->>'id' AND i.item_output->>'type'='equipment'))
      OR left(b.value#>>'{equipment,id}',7)='stage8_')
  THEN RAISE EXCEPTION 'stage8_gear_in_belt'; END IF;
  v_clean:=jsonb_set(jsonb_set(v_state,'{inventory}',v_bag),'{player,equipped}',v_equipped);
  v_clean:=territory_private.owner_cap_state_v1(public.territory_normalize_state_v4(
    territory_private.normalize_legacy_rare_state_20261108(v_clean)),p_hero,p_player);
  -- A stale device may omit one of the TWO historical inv_* wrappers.
  -- Restore exact committed bytes rather than losing an apparent second
  -- inventory entry. No new alias can enter because old must already contain
  -- the exact item, and its inner equipment UUID must match the registry.
  FOR v_entry IN SELECT x.value AS item FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(v_old->'inventory')='array' THEN v_old->'inventory' ELSE '[]'::jsonb END) x
    WHERE left(x.value->>'id',4)='inv_'
      AND left(x.value#>>'{equipment,id}',7)='stage8_'
  LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_clean->'inventory') x
      WHERE x.value->>'id'=v_entry.item->>'id') THEN
      IF v_entry.item->>'type' IS DISTINCT FROM 'equipment'
        OR v_entry.item->'qty' IS DISTINCT FROM '1'::jsonb
        OR (SELECT count(*) FROM jsonb_array_elements(v_old->'inventory') x
          WHERE x.value->>'id'=v_entry.item->>'id')<>1
        THEN RAISE EXCEPTION 'stage8_legacy_alias_invalid_old_state'; END IF;
      v_eq:=territory_private.stage8_verified_gear_v2(v_entry.item->'equipment',p_player);
      IF v_eq IS DISTINCT FROM v_entry.item->'equipment'
        THEN RAISE EXCEPTION 'stage8_legacy_alias_reconcile_required'; END IF;
      v_clean:=jsonb_set(v_clean,'{inventory}',(v_clean->'inventory')||jsonb_build_array(v_entry.item));
    END IF;
  END LOOP;
  -- Registry gear is persistent ownership, not a disposable save field. Restore
  -- omissions from stale devices; never let deleting a mirror delete an item.
  FOR v_registry IN SELECT i.item_id,i.item_output FROM public.territory_profession_stage8_items i
    WHERE i.player_id=p_player AND i.item_output->>'type'='equipment' ORDER BY i.item_id
  LOOP
    v_id:='stage8_'||v_registry.item_id::text;
    v_eq:=territory_private.stage8_verified_gear_v2(
      (v_registry.item_output->'equipment')||jsonb_build_object('id',v_id),p_player);
    v_slot:=NULL;
    SELECT e.key INTO v_slot FROM jsonb_each(p_state#>'{player,equipped}') e WHERE e.value->>'id'=v_id;
    IF v_slot IS NOT NULL THEN
      v_clean:=jsonb_set(v_clean,ARRAY['player','equipped',v_slot],v_eq);
    ELSE
      v_clean:=jsonb_set(v_clean,'{inventory}',(v_clean->'inventory')||jsonb_build_array(
        v_registry.item_output||jsonb_build_object('id',v_id,'qty',1,'equipment',v_eq)));
    END IF;
  END LOOP;
  RETURN v_clean;
END $preserve$;
REVOKE ALL ON FUNCTION territory_private.stage8_preserve_state_v3(jsonb,integer,uuid)
 FROM PUBLIC,anon,authenticated;

-- A receipt-backed INTERNAL handoff, not an auction or a payment operation.
-- The caller must already have authorized the business operation. Never grant
-- this helper to a client. Lock order: both players sorted -> registry item.
CREATE TABLE territory_private.stage8_handoffs_v3(
  operation_id uuid PRIMARY KEY, item_id uuid NOT NULL, from_player uuid NOT NULL,
  to_player uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE territory_private.stage8_handoffs_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.stage8_handoffs_v3 FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION territory_private.stage8_handoff_v3(
  p_item uuid,p_from uuid,p_to uuid,p_operation uuid
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $handoff$
DECLARE v_prior territory_private.stage8_handoffs_v3%ROWTYPE; v_output jsonb; v_count integer;
BEGIN
  IF position('territory_private.stage8_preserve_state_v3(NEW.game_state,NEW.level,NEW.id)'
    IN pg_get_functiondef(to_regprocedure('public.territory_gear_guard_v4()'))) IS NULL
    OR position('territory_private.stage8_preserve_state_v3(NEW.game_state,NEW.level,NEW.id)'
    IN pg_get_functiondef(to_regprocedure('public.territory_gear_guard_v4()')))=0
    THEN RAISE EXCEPTION 'stage8_handoff_save_guard_inactive'; END IF;
  IF p_item IS NULL OR p_from IS NULL OR p_to IS NULL OR p_operation IS NULL OR p_from=p_to
    THEN RAISE EXCEPTION 'stage8_bad_handoff'; END IF;
  PERFORM 1 FROM public.players WHERE id IN(p_from,p_to) ORDER BY id FOR UPDATE;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>2 THEN RAISE EXCEPTION 'stage8_player_missing'; END IF;
  -- Serialize operation keys even when misused with a different owner pair.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation::text,366));
  SELECT * INTO v_prior FROM territory_private.stage8_handoffs_v3 WHERE operation_id=p_operation;
  IF FOUND THEN
    IF v_prior.item_id IS DISTINCT FROM p_item OR v_prior.from_player IS DISTINCT FROM p_from
      OR v_prior.to_player IS DISTINCT FROM p_to THEN RAISE EXCEPTION 'stage8_operation_conflict'; END IF;
    RETURN; -- A replay never reclaims an item after another resale.
  END IF;
  SELECT item_output INTO v_output FROM public.territory_profession_stage8_items
    WHERE item_id=p_item AND player_id=p_from FOR UPDATE;
  IF NOT FOUND OR v_output->>'type' IS DISTINCT FROM 'equipment'
    THEN RAISE EXCEPTION 'stage8_item_not_owned'; END IF;
  IF EXISTS(SELECT 1 FROM territory_private.stage8_historical_quarantine_v1 q
    WHERE q.item_id=p_item AND q.player_id=p_from)
    THEN RAISE EXCEPTION 'stage8_historical_item_transfer_on_hold'; END IF;
  IF EXISTS(SELECT 1 FROM public.players p
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.game_state->'inventory')='array'
        THEN p.game_state->'inventory' ELSE '[]'::jsonb END) x(value)
    WHERE p.id=p_from AND left(x.value->>'id',4)='inv_'
      AND x.value#>>'{equipment,id}'='stage8_'||p_item::text)
  THEN RAISE EXCEPTION 'stage8_legacy_alias_transfer_on_hold'; END IF;
  -- Check provenance while still owned by the sender. Reject equipped sales.
  PERFORM territory_private.stage8_preserve_state_v3(game_state,level,id)
    FROM public.players WHERE id=p_from;
  IF EXISTS(SELECT 1 FROM public.players p CROSS JOIN LATERAL jsonb_each(p.game_state#>'{player,equipped}') e
    WHERE p.id=p_from AND e.value->>'id'='stage8_'||p_item::text)
    THEN RAISE EXCEPTION 'stage8_equipped_handoff'; END IF;
  UPDATE public.territory_profession_stage8_items SET player_id=p_to WHERE item_id=p_item AND player_id=p_from;
  -- Remove only the sender's exact mirror. The activated save guard restores
  -- receiver gear from the registry in the same transaction.
  UPDATE public.players SET game_state=jsonb_set(game_state,'{inventory}',
    (SELECT coalesce(jsonb_agg(x.value ORDER BY x.ord),'[]'::jsonb)
      FROM jsonb_array_elements(game_state->'inventory') WITH ORDINALITY x(value,ord)
      WHERE x.value->>'id' IS DISTINCT FROM 'stage8_'||p_item::text
        AND x.value#>>'{equipment,id}' IS DISTINCT FROM 'stage8_'||p_item::text)),updated_at=clock_timestamp()
    WHERE id=p_from;
  UPDATE public.players SET game_state=territory_private.stage8_preserve_state_v3(game_state,level,id),
    updated_at=clock_timestamp() WHERE id=p_to;
  INSERT INTO territory_private.stage8_handoffs_v3(operation_id,item_id,from_player,to_player)
    VALUES(p_operation,p_item,p_from,p_to);
END $handoff$;
REVOKE ALL ON FUNCTION territory_private.stage8_handoff_v3(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
COMMIT;
