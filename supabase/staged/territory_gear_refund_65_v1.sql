-- TERRITORY #253 — staged, opt-in 65% refund of SERVER-ATTESTED forge spending.
-- NEVER backfill from client upgradeCount/level: historic per-item spend is not proven.
-- Existing salvage v1 / base +1 quota remain unchanged. Apply only after PG17/JWT/RLS review.
CREATE SCHEMA IF NOT EXISTS territory_private;

CREATE TABLE IF NOT EXISTS territory_private.forge_upgrade_receipts_65_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  upgrade_to integer NOT NULL CHECK (upgrade_to BETWEEN 2 AND 500),
  material_cost integer NOT NULL CHECK (material_cost BETWEEN 1 AND 200),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  refunded_at timestamptz,
  PRIMARY KEY(player_id,item_id,upgrade_to)
);
REVOKE ALL ON territory_private.forge_upgrade_receipts_65_v1 FROM PUBLIC,anon,authenticated;
ALTER TABLE territory_private.forge_upgrade_receipts_65_v1 ENABLE ROW LEVEL SECURITY;

-- Record a successful forge increase only when the NEW row proves that the
-- player spent exactly the canonical forge cost on one unchanged item.
-- Existing local forge attempts are still written through the save CAS path.
CREATE OR REPLACE FUNCTION territory_private.capture_forge_spend_65_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $$
DECLARE
  old_items jsonb;
  new_items jsonb;
  item jsonb;
  previous_item jsonb;
  candidate jsonb := NULL;
  old_level integer;
  new_level integer;
  cost_gold integer;
  cost_mat integer;
  match_count integer;
  candidates integer := 0;
  old_gold bigint;
  new_gold bigint;
  old_mat bigint;
  new_mat bigint;
BEGIN
  IF NEW.game_state IS NOT DISTINCT FROM OLD.game_state
    OR NEW.gold IS NULL OR OLD.gold IS NULL
    OR NEW.forge_materials IS NULL OR OLD.forge_materials IS NULL
    OR NEW.gold>=OLD.gold OR NEW.forge_materials>=OLD.forge_materials
  THEN RETURN NULL; END IF;
  IF jsonb_typeof(OLD.game_state->'inventory') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.game_state->'inventory') IS DISTINCT FROM 'array'
    OR jsonb_typeof(OLD.game_state->'player'->'equipped') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW.game_state->'player'->'equipped') IS DISTINCT FROM 'object'
  THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(value->'equipment'),'[]'::jsonb) INTO old_items
  FROM jsonb_array_elements(OLD.game_state->'inventory')
  WHERE jsonb_typeof(value->'equipment')='object';
  SELECT old_items || coalesce(jsonb_agg(value),'[]'::jsonb) INTO old_items
  FROM jsonb_each(OLD.game_state->'player'->'equipped')
  WHERE jsonb_typeof(value)='object';
  SELECT coalesce(jsonb_agg(value->'equipment'),'[]'::jsonb) INTO new_items
  FROM jsonb_array_elements(NEW.game_state->'inventory')
  WHERE jsonb_typeof(value->'equipment')='object';
  SELECT new_items || coalesce(jsonb_agg(value),'[]'::jsonb) INTO new_items
  FROM jsonb_each(NEW.game_state->'player'->'equipped')
  WHERE jsonb_typeof(value)='object';

  FOR item IN SELECT value FROM jsonb_array_elements(new_items)
  LOOP
    IF item->>'id' IS NULL OR (item->>'level') !~ '^[1-9][0-9]{0,2}$'
      OR (item->>'upgradeCount') !~ '^[0-9]{1,3}$' THEN CONTINUE; END IF;
    SELECT count(*), min(value::text)::jsonb INTO match_count, previous_item
      FROM jsonb_array_elements(old_items)
      WHERE value->>'id'=item->>'id';
    IF match_count<>1 THEN CONTINUE; END IF;
    SELECT count(*) INTO match_count FROM jsonb_array_elements(new_items)
      WHERE value->>'id'=item->>'id';
    IF match_count<>1 OR (previous_item->>'level') !~ '^[1-9][0-9]{0,2}$'
      OR (previous_item->>'upgradeCount') !~ '^[0-9]{1,3}$' THEN CONTINUE; END IF;

    old_level:=(previous_item->>'level')::integer;
    new_level:=(item->>'level')::integer;
    IF new_level<>old_level+1 OR new_level>500
      OR (item->>'upgradeCount')::integer<>(previous_item->>'upgradeCount')::integer+1
    THEN CONTINUE; END IF;
    candidates:=candidates+1;
    IF candidates>1 THEN RETURN NULL; END IF;
    IF item->>'slot' IS DISTINCT FROM previous_item->>'slot'
      OR item->>'name' IS DISTINCT FROM previous_item->>'name'
      OR item->>'rarity' IS DISTINCT FROM previous_item->>'rarity'
      OR item->>'baseLevel' IS DISTINCT FROM previous_item->>'baseLevel'
      OR item->'baseStats' IS DISTINCT FROM previous_item->'baseStats'
      OR item->>'adminTestLevel' = 'true'
    THEN RETURN NULL; END IF;
    candidate:=item;
  END LOOP;

  IF candidates<>1 OR candidate IS NULL THEN RETURN NULL; END IF;
  old_level:=(candidate->>'level')::integer-1;
  cost_gold:=50+old_level*30;
  cost_mat:=1+old_level/3;
  IF (OLD.game_state->'player'->>'gold') !~ '^[0-9]{1,10}$'
    OR (NEW.game_state->'player'->>'gold') !~ '^[0-9]{1,10}$'
    OR (OLD.game_state->>'forgeMaterials') !~ '^[0-9]{1,10}$'
    OR (NEW.game_state->>'forgeMaterials') !~ '^[0-9]{1,10}$'
  THEN RETURN NULL; END IF;
  old_gold:=(OLD.game_state->'player'->>'gold')::bigint;
  new_gold:=(NEW.game_state->'player'->>'gold')::bigint;
  old_mat:=(OLD.game_state->>'forgeMaterials')::bigint;
  new_mat:=(NEW.game_state->>'forgeMaterials')::bigint;
  IF old_gold-new_gold<>cost_gold OR old_mat-new_mat<>cost_mat
    OR NEW.gold<>new_gold OR NEW.forge_materials<>new_mat
  THEN RETURN NULL; END IF;

  -- A reused/previously refunded item ID must never mint a second refund.
  IF EXISTS (SELECT 1 FROM territory_private.forge_upgrade_receipts_65_v1
      WHERE player_id=NEW.id AND item_id=candidate->>'id' AND refunded_at IS NOT NULL)
  THEN RETURN NULL; END IF;
  INSERT INTO territory_private.forge_upgrade_receipts_65_v1
    (player_id,item_id,upgrade_to,material_cost)
  VALUES (NEW.id,candidate->>'id',(candidate->>'level')::integer,cost_mat)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION territory_private.capture_forge_spend_65_v1() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS territory_capture_forge_spend_65_v1 ON public.players;
CREATE TRIGGER territory_capture_forge_spend_65_v1
AFTER UPDATE OF game_state ON public.players
FOR EACH ROW EXECUTE FUNCTION territory_private.capture_forge_spend_65_v1();

-- Quote is owner-scoped and READ ONLY. No client-supplied costs are accepted.
CREATE OR REPLACE FUNCTION public.territory_forge_refund_quote_65_v1(p_item text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $$
DECLARE
  user_id uuid := auth.uid();
  row_state jsonb;
  eq jsonb;
  matched integer;
  spent bigint := 0;
  last_level integer;
BEGIN
  IF user_id IS NULL THEN RAISE EXCEPTION 'refund_auth_required'; END IF;
  IF p_item IS NULL OR length(p_item) NOT BETWEEN 3 AND 150
  THEN RAISE EXCEPTION 'refund_invalid_item'; END IF;
  SELECT game_state INTO row_state FROM public.players WHERE id=user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_player_missing'; END IF;
  SELECT count(*), min((value->'equipment')::text)::jsonb INTO matched,eq
    FROM jsonb_array_elements(coalesce(row_state->'inventory','[]'::jsonb))
    WHERE value->>'id'=p_item AND value->>'type'='equipment'
      AND jsonb_typeof(value->'equipment')='object';
  IF matched<>1 THEN RETURN jsonb_build_object('eligible',false,'item_id',p_item,'spent_verified',0,'refund',0); END IF;
  SELECT coalesce(sum(material_cost),0), max(upgrade_to) INTO spent,last_level
    FROM territory_private.forge_upgrade_receipts_65_v1
    WHERE player_id=user_id AND item_id=p_item AND refunded_at IS NULL;
  IF spent=0 OR (eq->>'level') !~ '^[1-9][0-9]{0,2}$'
    OR (eq->>'level')::integer<>last_level
    OR eq->>'adminTestLevel'='true'
    OR jsonb_typeof(row_state->'forgeMaterialBatches') IS DISTINCT FROM 'array'
  THEN RETURN jsonb_build_object('eligible',false,'item_id',p_item,'spent_verified',0,'refund',0); END IF;
  RETURN jsonb_build_object('eligible',true,'item_id',p_item,
    'spent_verified',spent,'refund',floor(spent*65.0/100)::bigint);
END $$;
REVOKE ALL ON FUNCTION public.territory_forge_refund_quote_65_v1(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_forge_refund_quote_65_v1(text) TO authenticated;

-- Fully atomic consume/refund; the 3/day base +1 quota is NOT touched.
-- Exactly one spare, never worn, never admin-test, never speculative legacy credit.
CREATE OR REPLACE FUNCTION public.territory_inventory_recycle_refund_65_v1(
  p_item text,p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $$
DECLARE
  user_id uuid:=auth.uid();
  row_record public.players%ROWTYPE;
  state jsonb;
  item jsonb;
  eq jsonb;
  matched integer;
  spent bigint:=0;
  refund bigint;
  last_level integer;
  balance bigint;
  items jsonb;
  batches jsonb;
  tracked bigint;
  remaining integer:=3;
BEGIN
  IF user_id IS NULL THEN RAISE EXCEPTION 'refund_auth_required'; END IF;
  IF p_item IS NULL OR length(p_item) NOT BETWEEN 3 AND 150 OR p_expected IS NULL
  THEN RAISE EXCEPTION 'refund_invalid_request'; END IF;
  SELECT * INTO row_record FROM public.players WHERE id=user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_player_missing'; END IF;
  IF row_record.updated_at<>p_expected THEN RAISE EXCEPTION 'refund_conflict_reload'; END IF;
  state:=row_record.game_state;
  IF state->>'inventoryCleanupVersion' IS DISTINCT FROM '1'
    OR jsonb_typeof(state->'inventory') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'refund_save_not_ready'; END IF;
  SELECT count(*), min(value::text)::jsonb INTO matched,item
  FROM jsonb_array_elements(state->'inventory')
  WHERE value->>'id'=p_item;
  IF matched<>1 OR item->>'type' IS DISTINCT FROM 'equipment' OR item->>'qty' IS DISTINCT FROM '1'
    OR jsonb_typeof(item->'equipment') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'refund_item_invalid'; END IF;
  eq:=item->'equipment';
  IF eq->>'adminTestLevel'='true' OR eq->>'id'<>p_item
    OR eq->>'rarity' NOT IN ('common','rare','epic','legendary')
  THEN RAISE EXCEPTION 'refund_untrusted_item'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(state->'player'->'equipped','{}'::jsonb))
      WHERE value->>'id'=p_item)
  THEN RAISE EXCEPTION 'refund_worn_item'; END IF;

  SELECT coalesce(sum(material_cost),0),max(upgrade_to)
    INTO spent,last_level FROM territory_private.forge_upgrade_receipts_65_v1
    WHERE player_id=user_id AND item_id=p_item AND refunded_at IS NULL;
  IF spent<1 OR (eq->>'level') !~ '^[1-9][0-9]{0,2}$'
    OR (eq->>'level')::integer<>last_level
  THEN RAISE EXCEPTION 'refund_history_unverified'; END IF;
  IF (state->>'forgeMaterials') !~ '^[0-9]{1,10}$'
  THEN RAISE EXCEPTION 'refund_invalid_material_balance'; END IF;
  balance:=(state->>'forgeMaterials')::bigint;
  refund:=floor(spent*65.0/100)::bigint;
  IF refund<1 OR balance+refund>2147483647
  THEN RAISE EXCEPTION 'refund_invalid_amount'; END IF;

  SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb)
    INTO items FROM jsonb_array_elements(state->'inventory') WITH ORDINALITY
    WHERE value->>'id' IS DISTINCT FROM p_item;
  state:=jsonb_set(state,'{inventory}',items);
  state:=jsonb_set(state,'{forgeMaterials}',to_jsonb(balance+refund));

  -- Preserve all previously dated material lots; add a fresh, independently
  -- expiring 7-day receipt without refreshing any older lot's expiration.
  batches:=state->'forgeMaterialBatches';
  -- Fail closed when the material wallet is still in legacy format. Otherwise
  -- reconciling later could restart the expiry of materials the player already owned.
  IF jsonb_typeof(batches) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'refund_material_batches_unverified';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(batches) AS batch(value)
    WHERE batch.value->>'qty' !~ '^[1-9][0-9]{0,8}
    batches || jsonb_build_array(jsonb_build_object('qty',refund,
      'expiresAt',to_char((clock_timestamp() AT TIME ZONE 'UTC')+interval '7 days',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));
  UPDATE public.players SET game_state=state,forge_materials=(balance+refund)::integer
  WHERE id=user_id RETURNING * INTO row_record;
  UPDATE territory_private.forge_upgrade_receipts_65_v1
    SET refunded_at=clock_timestamp()
    WHERE player_id=user_id AND item_id=p_item AND refunded_at IS NULL;
  SELECT 3-awarded INTO remaining FROM territory_private.equipment_salvage_daily_v1
    WHERE player_id=user_id AND salvage_day=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  RETURN jsonb_build_object('success',true,'action','salvage','item_id',p_item,
    'spent_verified',spent,'awarded',refund,'remaining_today',coalesce(remaining,3),
    'game_state',row_record.game_state,'updated_at',row_record.updated_at,
    'gold',row_record.gold,'gems',row_record.gems);
END $$;
REVOKE ALL ON FUNCTION public.territory_inventory_recycle_refund_65_v1(text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_inventory_recycle_refund_65_v1(text,timestamptz) TO authenticated;

      OR batch.value->>'expiresAt' IS NULL
      OR (batch.value->>'expiresAt')::timestamptz <= clock_timestamp()
  ) THEN RAISE EXCEPTION 'refund_material_batches_invalid_or_expired'; END IF;
  SELECT coalesce(sum((value->>'qty')::bigint),0) INTO tracked
    FROM jsonb_array_elements(batches);
  IF tracked<>balance THEN RAISE EXCEPTION 'refund_material_batches_balance_mismatch'; END IF;
  state:=jsonb_set(state,'{forgeMaterialBatches}',
    batches || jsonb_build_array(jsonb_build_object('qty',refund,
      'expiresAt',to_char((clock_timestamp() AT TIME ZONE 'UTC')+interval '7 days',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));
  UPDATE public.players SET game_state=state,forge_materials=(balance+refund)::integer
  WHERE id=user_id RETURNING * INTO row_record;
  UPDATE territory_private.forge_upgrade_receipts_65_v1
    SET refunded_at=clock_timestamp()
    WHERE player_id=user_id AND item_id=p_item AND refunded_at IS NULL;
  SELECT 3-awarded INTO remaining FROM territory_private.equipment_salvage_daily_v1
    WHERE player_id=user_id AND salvage_day=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  RETURN jsonb_build_object('success',true,'action','salvage','item_id',p_item,
    'spent_verified',spent,'awarded',refund,'remaining_today',coalesce(remaining,3),
    'game_state',row_record.game_state,'updated_at',row_record.updated_at,
    'gold',row_record.gold,'gems',row_record.gems);
END $$;
REVOKE ALL ON FUNCTION public.territory_inventory_recycle_refund_65_v1(text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_inventory_recycle_refund_65_v1(text,timestamptz) TO authenticated;
