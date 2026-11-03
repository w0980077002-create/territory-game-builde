-- TERRITORY #253: all-or-nothing multi-item salvage; no legacy estimates.
-- Depends on the verified, already installed 65% forge receipt ledger.
-- No changes to old inventory, wallet, or existing single-item RPCs.
CREATE OR REPLACE FUNCTION territory_private.batch_salvage_candidate_253(p_player uuid,p_item jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE
  eq jsonb:=p_item->'equipment';
  candidate_id text:=p_item->>'id';
  invested bigint;
  last_level integer;
  reward bigint;
BEGIN
  IF p_player IS NULL OR candidate_id IS NULL OR length(candidate_id) NOT BETWEEN 3 AND 150
    OR p_item->>'type' IS DISTINCT FROM 'equipment'
    OR p_item->>'qty' IS DISTINCT FROM '1'
    OR jsonb_typeof(eq) IS DISTINCT FROM 'object'
    OR eq->>'id' IS DISTINCT FROM candidate_id
    OR eq->>'rarity' NOT IN ('common','rare')
    OR p_item->>'rarity' IS DISTINCT FROM eq->>'rarity'
    OR p_item->>'name' IS DISTINCT FROM eq->>'name'
    OR eq->>'adminTestLevel'='true'
  THEN RETURN NULL; END IF;
  -- Existing daily salvage rules, restricted to non-valuable common/rare gear.
  IF eq->>'id' LIKE 'loot_%'
    AND ((eq->>'name'='Клинок победителя' AND eq->>'slot'='weapon')
      OR (eq->>'name'='Доспех воина' AND eq->>'slot'='armor'))
    AND eq->>'level' ~ '^[1-9][0-9]{0,2}$'
    AND eq->>'baseLevel'=eq->>'level'
    AND eq->>'upgradeCount'='0'
  THEN RETURN jsonb_build_object('item_id',candidate_id,'kind','base',
    'awarded',1,'spent_verified',0); END IF;

  -- A batch must never include seasonal, admin or unknown-source equipment.
  -- Only the 10 regular shop templates and the 2 ordinary boss drops qualify.
  IF eq->>'name' NOT IN (
    'Клинок победителя','Доспех воина',
    'Меч воина','Клинок рыцаря','Героический меч',
    'Кожаная броня','Латные доспехи','Железный шлем',
    'Сапоги скорости','Кольцо силы','Дубовый щит','Амулет ворона'
  ) OR item_id ~* '(halloween|event|season|founder|gift|mail|special|pumpkin|admin)'
  THEN RETURN NULL; END IF;
  SELECT coalesce(sum(material_cost),0), max(upgrade_to)
    INTO invested,last_level
    FROM territory_private.forge_upgrade_receipts_65_v1
    WHERE player_id=p_player AND item_id=candidate_id AND refunded_at IS NULL;
  IF invested<1 OR last_level IS NULL OR eq->>'level' !~ '^[1-9][0-9]{0,2}$'
    OR (eq->>'level')::integer<>last_level
  THEN RETURN NULL; END IF;
  reward:=floor(invested*0.65)::bigint;
  IF reward<1 THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('item_id',candidate_id,'kind','refunded',
    'awarded',reward,'spent_verified',invested);
END $$;
REVOKE ALL ON FUNCTION territory_private.batch_salvage_candidate_253(uuid,jsonb)
  FROM PUBLIC,anon,authenticated;

-- Snapshot costs for owner only, not an authorization to spend materials.
CREATE OR REPLACE FUNCTION public.territory_inventory_batch_quote_253()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE
  player_id uuid:=auth.uid();
  profile public.players%ROWTYPE;
  item jsonb;
  entry jsonb;
  result jsonb:='[]'::jsonb;
  used integer:=0;
BEGIN
  IF player_id IS NULL THEN RAISE EXCEPTION 'batch_auth_required'; END IF;
  SELECT * INTO profile FROM public.players WHERE id=player_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch_player_missing'; END IF;
  IF jsonb_typeof(profile.game_state->'inventory') IS DISTINCT FROM 'array'
    OR profile.game_state->>'inventoryCleanupVersion' IS DISTINCT FROM '1'
  THEN RETURN jsonb_build_object('ready',false,'eligible','[]'::jsonb); END IF;

  SELECT awarded INTO used FROM territory_private.equipment_salvage_daily_v1
    WHERE equipment_salvage_daily_v1.player_id = auth.uid() AND salvage_day=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  used:=coalesce(used,0);
  -- Never promise a refund before existing dated material lots are reconciled.
  IF jsonb_typeof(profile.game_state->'forgeMaterialBatches') IS DISTINCT FROM 'array'
    OR (profile.game_state->>'forgeMaterials') !~ '^[0-9]{1,10}
  LOOP
    IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(profile.game_state->'player'->'equipped','{}'::jsonb))
      WHERE value->>'id'=item->>'id') THEN CONTINUE; END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(profile.game_state->'inventory')
      WHERE value->>'id'=item->>'id')<>1 THEN CONTINUE; END IF;
    entry:=territory_private.batch_salvage_candidate_253(player_id,item);
    IF entry IS NULL THEN CONTINUE; END IF;
    -- Quote can show all eligible gear; caller selects up to 10 in a single operation.
    result:=result || jsonb_build_array(entry);
  END LOOP;
  RETURN jsonb_build_object('ready',true,'eligible',result,
    'remaining_today',greatest(0,3-used),'updated_at',profile.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.territory_inventory_batch_quote_253() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_inventory_batch_quote_253() TO authenticated;

-- The entire batch is validated under one player-row lock. Any invalid item
-- rejects the WHOLE transaction; partial deletion or partial credit is impossible.
CREATE OR REPLACE FUNCTION public.territory_inventory_batch_salvage_253(
  p_ids text[],p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE
  player_id uuid:=auth.uid();
  profile public.players%ROWTYPE;
  state jsonb;
  item jsonb;
  entry jsonb;
  receipts jsonb:='[]'::jsonb;
  material_lots jsonb;
  remaining bigint;
  tracked bigint;
  credited bigint:=0;
  base_count integer:=0;
  refunded_ids text[]:=ARRAY[]::text[];
  user_id text;
  day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  quota integer:=0;
  next_inventory jsonb;
  got integer;
BEGIN
  IF player_id IS NULL THEN RAISE EXCEPTION 'batch_auth_required'; END IF;
  IF p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 10 OR p_expected IS NULL
    OR EXISTS(SELECT 1 FROM unnest(p_ids) AS item(id)
      WHERE item.id IS NULL OR length(item.id) NOT BETWEEN 3 AND 150)
    OR (SELECT count(DISTINCT v) FROM unnest(p_ids) AS t(v))<>cardinality(p_ids)
  THEN RAISE EXCEPTION 'batch_invalid_request'; END IF;
  SELECT * INTO profile FROM public.players WHERE id=player_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch_player_missing'; END IF;
  IF profile.updated_at<>p_expected THEN RAISE EXCEPTION 'batch_conflict_reload'; END IF;
  state:=profile.game_state;
  IF jsonb_typeof(state->'inventory') IS DISTINCT FROM 'array'
    OR state->>'inventoryCleanupVersion' IS DISTINCT FROM '1'
    OR jsonb_typeof(state->'player'->'equipped') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'batch_save_not_ready'; END IF;
  IF (state->>'forgeMaterials') !~ '^[0-9]{1,10}$'
  THEN RAISE EXCEPTION 'batch_invalid_material_balance'; END IF;
  remaining:=(state->>'forgeMaterials')::bigint;
  IF remaining<>profile.forge_materials OR remaining>2147483647
  THEN RAISE EXCEPTION 'batch_material_column_mismatch'; END IF;

  material_lots:=state->'forgeMaterialBatches';
  IF jsonb_typeof(material_lots) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'batch_material_lots_untracked'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(material_lots) AS lot(value)
    WHERE lot.value->>'qty' IS NULL
      OR lot.value->>'qty' !~ '^[1-9][0-9]{0,8}$'
      OR lot.value->>'expiresAt' IS NULL
      OR (lot.value->>'expiresAt')::timestamptz<=clock_timestamp())
  THEN RAISE EXCEPTION 'batch_material_lots_invalid'; END IF;
  SELECT coalesce(sum((value->>'qty')::bigint),0) INTO tracked
    FROM jsonb_array_elements(material_lots);
  IF tracked<>remaining THEN RAISE EXCEPTION 'batch_material_lots_mismatch'; END IF;

  FOREACH user_id IN ARRAY p_ids LOOP
    SELECT count(*),min(value::text)::jsonb INTO got,item
      FROM jsonb_array_elements(state->'inventory') WHERE value->>'id'=user_id;
    IF got<>1 THEN RAISE EXCEPTION 'batch_item_missing_or_duplicate'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(state->'player'->'equipped')
        WHERE value->>'id'=user_id)
    THEN RAISE EXCEPTION 'batch_item_worn'; END IF;
    entry:=territory_private.batch_salvage_candidate_253(player_id,item);
    IF entry IS NULL THEN RAISE EXCEPTION 'batch_item_unverified'; END IF;
    credited:=credited+(entry->>'awarded')::bigint;
    IF entry->>'kind'='base' THEN
      base_count:=base_count+1;
    ELSE
      refunded_ids:=array_append(refunded_ids,user_id);
    END IF;
    receipts:=receipts||jsonb_build_array(entry);
  END LOOP;
  IF credited<1 OR credited+remaining>2147483647
  THEN RAISE EXCEPTION 'batch_refund_overflow'; END IF;

  IF base_count>0 THEN
    INSERT INTO territory_private.equipment_salvage_daily_v1
      (player_id,salvage_day,awarded) VALUES(player_id,day,0)
      ON CONFLICT DO NOTHING;
    SELECT awarded INTO quota FROM territory_private.equipment_salvage_daily_v1
      WHERE equipment_salvage_daily_v1.player_id = auth.uid() AND salvage_day=day FOR UPDATE;
    IF quota+base_count>3 THEN RAISE EXCEPTION 'batch_daily_limit_3'; END IF;
  ELSE
    SELECT awarded INTO quota FROM territory_private.equipment_salvage_daily_v1
      WHERE equipment_salvage_daily_v1.player_id = auth.uid() AND salvage_day=day;
    quota:=coalesce(quota,0);
  END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb)
  INTO next_inventory FROM jsonb_array_elements(state->'inventory') WITH ORDINALITY
    WHERE NOT(value->>'id'=ANY(p_ids));
  state:=jsonb_set(state,'{inventory}',next_inventory);
  state:=jsonb_set(state,'{forgeMaterials}',to_jsonb(remaining+credited));
  state:=jsonb_set(state,'{forgeMaterialBatches}',
    material_lots || jsonb_build_array(jsonb_build_object(
      'qty',credited,'expiresAt',
      to_char((clock_timestamp() AT TIME ZONE 'UTC')+interval '7 days',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));

  UPDATE public.players SET game_state=state,forge_materials=(remaining+credited)::integer
    WHERE id=player_id RETURNING * INTO profile;
  IF cardinality(refunded_ids)>0 THEN
    UPDATE territory_private.forge_upgrade_receipts_65_v1 SET refunded_at=clock_timestamp()
      WHERE forge_upgrade_receipts_65_v1.player_id = auth.uid() AND item_id=ANY(refunded_ids) AND refunded_at IS NULL;
    GET DIAGNOSTICS got=ROW_COUNT;
    IF got<cardinality(refunded_ids) THEN RAISE EXCEPTION 'batch_ledger_conflict'; END IF;
  END IF;
  IF base_count>0 THEN
    UPDATE territory_private.equipment_salvage_daily_v1 SET awarded=awarded+base_count
      WHERE equipment_salvage_daily_v1.player_id = auth.uid() AND salvage_day=day;
  END IF;
  RETURN jsonb_build_object('success',true,'action','batch_salvage',
    'awarded',credited,'removed',receipts,'remaining_today',3-quota-base_count,
    'updated_at',profile.updated_at,'game_state',profile.game_state,
    'gold',profile.gold,'gems',profile.gems);
END $$;
REVOKE ALL ON FUNCTION public.territory_inventory_batch_salvage_253(text[],timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_inventory_batch_salvage_253(text[],timestamptz) TO authenticated;

    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(profile.game_state->'forgeMaterialBatches','[]'::jsonb)) AS lot(value)
      WHERE lot.value->>'qty' IS NULL
        OR lot.value->>'qty' !~ '^[1-9][0-9]{0,8}
  LOOP
    IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(profile.game_state->'player'->'equipped','{}'::jsonb))
      WHERE value->>'id'=item->>'id') THEN CONTINUE; END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(profile.game_state->'inventory')
      WHERE value->>'id'=item->>'id')<>1 THEN CONTINUE; END IF;
    entry:=territory_private.batch_salvage_candidate_253(player_id,item);
    IF entry IS NULL THEN CONTINUE; END IF;
    -- Quote can show all eligible gear; caller selects up to 10 in a single operation.
    result:=result || jsonb_build_array(entry);
  END LOOP;
  RETURN jsonb_build_object('ready',true,'eligible',result,
    'remaining_today',greatest(0,3-used),'updated_at',profile.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.territory_inventory_batch_quote_253() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_inventory_batch_quote_253() TO authenticated;

-- The entire batch is validated under one player-row lock. Any invalid item
-- rejects the WHOLE transaction; partial deletion or partial credit is impossible.
CREATE OR REPLACE FUNCTION public.territory_inventory_batch_salvage_253(
  p_ids text[],p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE
  player_id uuid:=auth.uid();
  profile public.players%ROWTYPE;
  state jsonb;
  item jsonb;
  entry jsonb;
  receipts jsonb:='[]'::jsonb;
  material_lots jsonb;
  remaining bigint;
  tracked bigint;
  credited bigint:=0;
  base_count integer:=0;
  refunded_ids text[]:=ARRAY[]::text[];
  user_id text;
  day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  quota integer:=0;
  next_inventory jsonb;
  got integer;
BEGIN
  IF player_id IS NULL THEN RAISE EXCEPTION 'batch_auth_required'; END IF;
  IF p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 10 OR p_expected IS NULL
    OR EXISTS(SELECT 1 FROM unnest(p_ids) AS item(id)
      WHERE item.id IS NULL OR length(item.id) NOT BETWEEN 3 AND 150)
    OR (SELECT count(DISTINCT v) FROM unnest(p_ids) AS t(v))<>cardinality(p_ids)
  THEN RAISE EXCEPTION 'batch_invalid_request'; END IF;
  SELECT * INTO profile FROM public.players WHERE id=player_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch_player_missing'; END IF;
  IF profile.updated_at<>p_expected THEN RAISE EXCEPTION 'batch_conflict_reload'; END IF;
  state:=profile.game_state;
  IF jsonb_typeof(state->'inventory') IS DISTINCT FROM 'array'
    OR state->>'inventoryCleanupVersion' IS DISTINCT FROM '1'
    OR jsonb_typeof(state->'player'->'equipped') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'batch_save_not_ready'; END IF;
  IF (state->>'forgeMaterials') !~ '^[0-9]{1,10}$'
  THEN RAISE EXCEPTION 'batch_invalid_material_balance'; END IF;
  remaining:=(state->>'forgeMaterials')::bigint;
  IF remaining<>profile.forge_materials OR remaining>2147483647
  THEN RAISE EXCEPTION 'batch_material_column_mismatch'; END IF;

  material_lots:=state->'forgeMaterialBatches';
  IF jsonb_typeof(material_lots) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'batch_material_lots_untracked'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(material_lots) AS lot(value)
    WHERE lot.value->>'qty' IS NULL
      OR lot.value->>'qty' !~ '^[1-9][0-9]{0,8}$'
      OR lot.value->>'expiresAt' IS NULL
      OR (lot.value->>'expiresAt')::timestamptz<=clock_timestamp())
  THEN RAISE EXCEPTION 'batch_material_lots_invalid'; END IF;
  SELECT coalesce(sum((value->>'qty')::bigint),0) INTO tracked
    FROM jsonb_array_elements(material_lots);
  IF tracked<>remaining THEN RAISE EXCEPTION 'batch_material_lots_mismatch'; END IF;

  FOREACH user_id IN ARRAY p_ids LOOP
    SELECT count(*),min(value::text)::jsonb INTO got,item
      FROM jsonb_array_elements(state->'inventory') WHERE value->>'id'=user_id;
    IF got<>1 THEN RAISE EXCEPTION 'batch_item_missing_or_duplicate'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(state->'player'->'equipped')
        WHERE value->>'id'=user_id)
    THEN RAISE EXCEPTION 'batch_item_worn'; END IF;
    entry:=territory_private.batch_salvage_candidate_253(player_id,item);
    IF entry IS NULL THEN RAISE EXCEPTION 'batch_item_unverified'; END IF;
    credited:=credited+(entry->>'awarded')::bigint;
    IF entry->>'kind'='base' THEN
      base_count:=base_count+1;
    ELSE
      refunded_ids:=array_append(refunded_ids,user_id);
    END IF;
    receipts:=receipts||jsonb_build_array(entry);
  END LOOP;
  IF credited<1 OR credited+remaining>2147483647
  THEN RAISE EXCEPTION 'batch_refund_overflow'; END IF;

  IF base_count>0 THEN
    INSERT INTO territory_private.equipment_salvage_daily_v1
      (player_id,salvage_day,awarded) VALUES(player_id,day,0)
      ON CONFLICT DO NOTHING;
    SELECT awarded INTO quota FROM territory_private.equipment_salvage_daily_v1
      WHERE equipment_salvage_daily_v1.player_id = auth.uid() AND salvage_day=day FOR UPDATE;
    IF quota+base_count>3 THEN RAISE EXCEPTION 'batch_daily_limit_3'; END IF;
  ELSE
    SELECT awarded INTO quota FROM territory_private.equipment_salvage_daily_v1
      WHERE equipment_salvage_daily_v1.player_id = auth.uid() AND salvage_day=day;
    quota:=coalesce(quota,0);
  END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb)
  INTO next_inventory FROM jsonb_array_elements(state->'inventory') WITH ORDINALITY
    WHERE NOT(value->>'id'=ANY(p_ids));
  state:=jsonb_set(state,'{inventory}',next_inventory);
  state:=jsonb_set(state,'{forgeMaterials}',to_jsonb(remaining+credited));
  state:=jsonb_set(state,'{forgeMaterialBatches}',
    material_lots || jsonb_build_array(jsonb_build_object(
      'qty',credited,'expiresAt',
      to_char((clock_timestamp() AT TIME ZONE 'UTC')+interval '7 days',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));

  UPDATE public.players SET game_state=state,forge_materials=(remaining+credited)::integer
    WHERE id=player_id RETURNING * INTO profile;
  IF cardinality(refunded_ids)>0 THEN
    UPDATE territory_private.forge_upgrade_receipts_65_v1 SET refunded_at=clock_timestamp()
      WHERE forge_upgrade_receipts_65_v1.player_id = auth.uid() AND item_id=ANY(refunded_ids) AND refunded_at IS NULL;
    GET DIAGNOSTICS got=ROW_COUNT;
    IF got<cardinality(refunded_ids) THEN RAISE EXCEPTION 'batch_ledger_conflict'; END IF;
  END IF;
  IF base_count>0 THEN
    UPDATE territory_private.equipment_salvage_daily_v1 SET awarded=awarded+base_count
      WHERE equipment_salvage_daily_v1.player_id = auth.uid() AND salvage_day=day;
  END IF;
  RETURN jsonb_build_object('success',true,'action','batch_salvage',
    'awarded',credited,'removed',receipts,'remaining_today',3-quota-base_count,
    'updated_at',profile.updated_at,'game_state',profile.game_state,
    'gold',profile.gold,'gems',profile.gems);
END $$;
REVOKE ALL ON FUNCTION public.territory_inventory_batch_salvage_253(text[],timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_inventory_batch_salvage_253(text[],timestamptz) TO authenticated;

        OR lot.value->>'expiresAt' IS NULL
        OR (lot.value->>'expiresAt')::timestamptz <= clock_timestamp()
    )
  THEN RETURN jsonb_build_object('ready',false,'eligible','[]'::jsonb); END IF;
  IF (SELECT coalesce(sum((value->>'qty')::bigint),0)
    FROM jsonb_array_elements(profile.game_state->'forgeMaterialBatches'))
    <> (profile.game_state->>'forgeMaterials')::bigint
  THEN RETURN jsonb_build_object('ready',false,'eligible','[]'::jsonb); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(profile.game_state->'inventory')
  LOOP
    IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(profile.game_state->'player'->'equipped','{}'::jsonb))
      WHERE value->>'id'=item->>'id') THEN CONTINUE; END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(profile.game_state->'inventory')
      WHERE value->>'id'=item->>'id')<>1 THEN CONTINUE; END IF;
    entry:=territory_private.batch_salvage_candidate_253(player_id,item);
    IF entry IS NULL THEN CONTINUE; END IF;
    -- Quote can show all eligible gear; caller selects up to 10 in a single operation.
    result:=result || jsonb_build_array(entry);
  END LOOP;
  RETURN jsonb_build_object('ready',true,'eligible',result,
    'remaining_today',greatest(0,3-used),'updated_at',profile.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.territory_inventory_batch_quote_253() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_inventory_batch_quote_253() TO authenticated;

-- The entire batch is validated under one player-row lock. Any invalid item
-- rejects the WHOLE transaction; partial deletion or partial credit is impossible.
CREATE OR REPLACE FUNCTION public.territory_inventory_batch_salvage_253(
  p_ids text[],p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE
  player_id uuid:=auth.uid();
  profile public.players%ROWTYPE;
  state jsonb;
  item jsonb;
  entry jsonb;
  receipts jsonb:='[]'::jsonb;
  material_lots jsonb;
  remaining bigint;
  tracked bigint;
  credited bigint:=0;
  base_count integer:=0;
  refunded_ids text[]:=ARRAY[]::text[];
  user_id text;
  day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  quota integer:=0;
  next_inventory jsonb;
  got integer;
BEGIN
  IF player_id IS NULL THEN RAISE EXCEPTION 'batch_auth_required'; END IF;
  IF p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 10 OR p_expected IS NULL
    OR EXISTS(SELECT 1 FROM unnest(p_ids) AS item(id)
      WHERE item.id IS NULL OR length(item.id) NOT BETWEEN 3 AND 150)
    OR (SELECT count(DISTINCT v) FROM unnest(p_ids) AS t(v))<>cardinality(p_ids)
  THEN RAISE EXCEPTION 'batch_invalid_request'; END IF;
  SELECT * INTO profile FROM public.players WHERE id=player_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch_player_missing'; END IF;
  IF profile.updated_at<>p_expected THEN RAISE EXCEPTION 'batch_conflict_reload'; END IF;
  state:=profile.game_state;
  IF jsonb_typeof(state->'inventory') IS DISTINCT FROM 'array'
    OR state->>'inventoryCleanupVersion' IS DISTINCT FROM '1'
    OR jsonb_typeof(state->'player'->'equipped') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'batch_save_not_ready'; END IF;
  IF (state->>'forgeMaterials') !~ '^[0-9]{1,10}$'
  THEN RAISE EXCEPTION 'batch_invalid_material_balance'; END IF;
  remaining:=(state->>'forgeMaterials')::bigint;
  IF remaining<>profile.forge_materials OR remaining>2147483647
  THEN RAISE EXCEPTION 'batch_material_column_mismatch'; END IF;

  material_lots:=state->'forgeMaterialBatches';
  IF jsonb_typeof(material_lots) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'batch_material_lots_untracked'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(material_lots) AS lot(value)
    WHERE lot.value->>'qty' IS NULL
      OR lot.value->>'qty' !~ '^[1-9][0-9]{0,8}$'
      OR lot.value->>'expiresAt' IS NULL
      OR (lot.value->>'expiresAt')::timestamptz<=clock_timestamp())
  THEN RAISE EXCEPTION 'batch_material_lots_invalid'; END IF;
  SELECT coalesce(sum((value->>'qty')::bigint),0) INTO tracked
    FROM jsonb_array_elements(material_lots);
  IF tracked<>remaining THEN RAISE EXCEPTION 'batch_material_lots_mismatch'; END IF;

  FOREACH user_id IN ARRAY p_ids LOOP
    SELECT count(*),min(value::text)::jsonb INTO got,item
      FROM jsonb_array_elements(state->'inventory') WHERE value->>'id'=user_id;
    IF got<>1 THEN RAISE EXCEPTION 'batch_item_missing_or_duplicate'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(state->'player'->'equipped')
        WHERE value->>'id'=user_id)
    THEN RAISE EXCEPTION 'batch_item_worn'; END IF;
    entry:=territory_private.batch_salvage_candidate_253(player_id,item);
    IF entry IS NULL THEN RAISE EXCEPTION 'batch_item_unverified'; END IF;
    credited:=credited+(entry->>'awarded')::bigint;
    IF entry->>'kind'='base' THEN
      base_count:=base_count+1;
    ELSE
      refunded_ids:=array_append(refunded_ids,user_id);
    END IF;
    receipts:=receipts||jsonb_build_array(entry);
  END LOOP;
  IF credited<1 OR credited+remaining>2147483647
  THEN RAISE EXCEPTION 'batch_refund_overflow'; END IF;

  IF base_count>0 THEN
    INSERT INTO territory_private.equipment_salvage_daily_v1
      (player_id,salvage_day,awarded) VALUES(player_id,day,0)
      ON CONFLICT DO NOTHING;
    SELECT awarded INTO quota FROM territory_private.equipment_salvage_daily_v1
      WHERE equipment_salvage_daily_v1.player_id = auth.uid() AND salvage_day=day FOR UPDATE;
    IF quota+base_count>3 THEN RAISE EXCEPTION 'batch_daily_limit_3'; END IF;
  ELSE
    SELECT awarded INTO quota FROM territory_private.equipment_salvage_daily_v1
      WHERE equipment_salvage_daily_v1.player_id = auth.uid() AND salvage_day=day;
    quota:=coalesce(quota,0);
  END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb)
  INTO next_inventory FROM jsonb_array_elements(state->'inventory') WITH ORDINALITY
    WHERE NOT(value->>'id'=ANY(p_ids));
  state:=jsonb_set(state,'{inventory}',next_inventory);
  state:=jsonb_set(state,'{forgeMaterials}',to_jsonb(remaining+credited));
  state:=jsonb_set(state,'{forgeMaterialBatches}',
    material_lots || jsonb_build_array(jsonb_build_object(
      'qty',credited,'expiresAt',
      to_char((clock_timestamp() AT TIME ZONE 'UTC')+interval '7 days',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));

  UPDATE public.players SET game_state=state,forge_materials=(remaining+credited)::integer
    WHERE id=player_id RETURNING * INTO profile;
  IF cardinality(refunded_ids)>0 THEN
    UPDATE territory_private.forge_upgrade_receipts_65_v1 SET refunded_at=clock_timestamp()
      WHERE forge_upgrade_receipts_65_v1.player_id = auth.uid() AND item_id=ANY(refunded_ids) AND refunded_at IS NULL;
    GET DIAGNOSTICS got=ROW_COUNT;
    IF got<cardinality(refunded_ids) THEN RAISE EXCEPTION 'batch_ledger_conflict'; END IF;
  END IF;
  IF base_count>0 THEN
    UPDATE territory_private.equipment_salvage_daily_v1 SET awarded=awarded+base_count
      WHERE equipment_salvage_daily_v1.player_id = auth.uid() AND salvage_day=day;
  END IF;
  RETURN jsonb_build_object('success',true,'action','batch_salvage',
    'awarded',credited,'removed',receipts,'remaining_today',3-quota-base_count,
    'updated_at',profile.updated_at,'game_state',profile.game_state,
    'gold',profile.gold,'gems',profile.gems);
END $$;
REVOKE ALL ON FUNCTION public.territory_inventory_batch_salvage_253(text[],timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_inventory_batch_salvage_253(text[],timestamptz) TO authenticated;
