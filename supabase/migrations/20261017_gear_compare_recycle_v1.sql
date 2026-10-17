-- TERRITORY: server-confirmed equipment disposal. No bulk deletion.
-- One ordinary unmodified boss drop converts to one forge material, max 3 UTC/day.
-- Manual discard has no reward and no daily limit.
CREATE SCHEMA IF NOT EXISTS territory_private;
CREATE TABLE IF NOT EXISTS territory_private.equipment_salvage_daily_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  salvage_day date NOT NULL,
  awarded integer NOT NULL DEFAULT 0 CHECK(awarded BETWEEN 0 AND 3),
  PRIMARY KEY(player_id,salvage_day)
);
REVOKE ALL ON territory_private.equipment_salvage_daily_v1 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_inventory_recycle_v1(
  p_item text, p_action text, p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_player uuid := auth.uid();
  v_row public.players%ROWTYPE;
  v_item jsonb;
  v_eq jsonb;
  v_matches integer;
  v_next jsonb;
  v_array jsonb;
  v_day date := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  v_used integer := 0;
  v_mat bigint;
BEGIN
  IF v_player IS NULL THEN RAISE EXCEPTION 'recycle_auth_required'; END IF;
  IF p_action NOT IN ('discard','salvage') OR p_action IS NULL OR
    p_item IS NULL OR length(p_item) NOT BETWEEN 3 AND 150 OR p_expected IS NULL
  THEN RAISE EXCEPTION 'recycle_invalid_request'; END IF;

  SELECT * INTO v_row FROM public.players WHERE id=v_player FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'recycle_player_missing'; END IF;
  IF v_row.updated_at <> p_expected THEN RAISE EXCEPTION 'recycle_conflict_reload'; END IF;
  IF jsonb_typeof(v_row.game_state->'inventory') IS DISTINCT FROM 'array'
    OR v_row.game_state->>'inventoryCleanupVersion' IS DISTINCT FROM '1'
  THEN RAISE EXCEPTION 'recycle_save_not_ready'; END IF;

  SELECT count(*), min(value::text)::jsonb INTO v_matches,v_item
    FROM jsonb_array_elements(v_row.game_state->'inventory') AS i(value)
    WHERE i.value->>'id'=p_item;
  IF v_matches<>1 THEN RAISE EXCEPTION 'recycle_item_missing_or_duplicate'; END IF;
  v_eq := v_item->'equipment';
  IF v_item->>'type' IS DISTINCT FROM 'equipment'
     OR jsonb_typeof(v_eq) IS DISTINCT FROM 'object'
     OR v_item->>'qty' IS DISTINCT FROM '1'
  THEN RAISE EXCEPTION 'recycle_not_spare_equipment'; END IF;

  v_mat := CASE WHEN (v_row.game_state->>'forgeMaterials') ~ '^[0-9]{1,10}$'
    THEN (v_row.game_state->>'forgeMaterials')::bigint ELSE -1 END;
  IF v_mat<0 OR v_mat>2147483646 THEN RAISE EXCEPTION 'recycle_invalid_material_balance'; END IF;

  IF p_action='salvage' THEN
    IF NOT (
      v_eq->>'id' LIKE 'loot_%'
      AND ((v_eq->>'name'='Клинок победителя' AND v_eq->>'slot'='weapon')
        OR (v_eq->>'name'='Доспех воина' AND v_eq->>'slot'='armor'))
      AND v_eq->>'rarity' IN ('common','rare','epic','legendary')
      AND v_eq->>'level' ~ '^[1-9][0-9]{0,5}$'
      AND v_eq->>'baseLevel' ~ '^[1-9][0-9]{0,5}$'
      AND v_eq->>'level'=v_eq->>'baseLevel'
      AND v_eq->>'upgradeCount'='0'
    ) THEN RAISE EXCEPTION 'recycle_only_unforged_boss_loot'; END IF;
    INSERT INTO territory_private.equipment_salvage_daily_v1(player_id,salvage_day,awarded)
      VALUES(v_player,v_day,0) ON CONFLICT DO NOTHING;
    SELECT awarded INTO v_used FROM territory_private.equipment_salvage_daily_v1
      WHERE player_id=v_player AND salvage_day=v_day FOR UPDATE;
    IF v_used>=3 THEN RAISE EXCEPTION 'recycle_daily_limit_3'; END IF;
  END IF;

  SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO v_array
    FROM jsonb_array_elements(v_row.game_state->'inventory') WITH ORDINALITY
    WHERE value->>'id' IS DISTINCT FROM p_item;
  v_next := jsonb_set(v_row.game_state,'{inventory}',v_array);
  IF p_action='salvage' THEN
    v_next := jsonb_set(v_next,'{forgeMaterials}',to_jsonb(v_mat+1));
  END IF;

  UPDATE public.players
     SET game_state=v_next,
         forge_materials=(v_mat+CASE WHEN p_action='salvage' THEN 1 ELSE 0 END)::integer
     WHERE id=v_player RETURNING * INTO v_row;
  IF p_action='salvage' THEN
    UPDATE territory_private.equipment_salvage_daily_v1
      SET awarded=awarded+1 WHERE player_id=v_player AND salvage_day=v_day;
    v_used:=v_used+1;
  END IF;
  RETURN jsonb_build_object('success',true,'action',p_action,'item_id',p_item,
    'awarded',CASE WHEN p_action='salvage' THEN 1 ELSE 0 END,
    'remaining_today',3-v_used,'game_state',v_row.game_state,
    'updated_at',v_row.updated_at,'gold',v_row.gold,'gems',v_row.gems);
END
$$;
REVOKE ALL ON FUNCTION public.territory_inventory_recycle_v1(text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_inventory_recycle_v1(text,text,timestamptz) TO authenticated;
