-- TERRITORY production hotfix 2026-11-17: exact owner-registered Stage8 material saves.
-- Fixes #547: two legitimate "Набор ремесленника" entries were rejected by
-- the prior gear-only inventory branch as stage8_invalid_mirror.
-- Applied to live wmyrdpbwlkzsktnhookx; captured here from the verified live definition.
-- No player writes, item deletion, economic changes, or grant changes.
-- Equipment protections, historical audits and all existing guards remain intact.
-- Restore from predecessor supabase/staged/territory_stage8_preservation_v3.sql if needed.
CREATE OR REPLACE FUNCTION territory_private.stage8_preserve_state_v3(p_state jsonb, p_hero integer, p_player uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      -- Accept a genuine material only if it exactly matches this owner's registry record.
      -- Equipment and forged Stage8 IDs continue through the existing strict checks.
      IF v_entry.item->>'type'='material'
        AND NOT(v_entry.item ? 'equipment')
        AND EXISTS (
          SELECT 1 FROM public.territory_profession_stage8_items i
          WHERE i.player_id=p_player
            AND 'stage8_'||i.item_id::text=v_id
            AND i.item_output->>'type'='material'
            AND v_entry.item=(i.item_output || jsonb_build_object('id',v_id,'qty',1))
        )
      THEN
        v_bag:=v_bag||jsonb_build_array(v_entry.item);
        CONTINUE;
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
END $function$

