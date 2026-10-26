-- TERRITORY 1.0: incremental Stage8 item lifecycle. STAGING ONLY.
-- Install AFTER existing Stage8 backend; never reinstall its tables/catalogue.
-- Does not enable Stage8, alter historical items, or change progression/economy.
BEGIN;
ALTER TABLE public.territory_profession_stage8_items
  ADD COLUMN IF NOT EXISTS equipped_slot text CHECK(equipped_slot IN ('helmet','amulet','armor','weapon','shield','ring','boots')),
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;
CREATE INDEX IF NOT EXISTS territory_stage8_active_item_owner_idx
  ON public.territory_profession_stage8_items(player_id,created_at,item_id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS territory_stage8_one_item_per_slot
  ON public.territory_profession_stage8_items(player_id,equipped_slot)
  WHERE equipped_slot IS NOT NULL AND removed_at IS NULL;

-- One projection is shared by writes and the legacy save guard. Legacy items
-- stay byte-for-byte intact; server UUIDs and their copies are always rebuilt.
CREATE OR REPLACE FUNCTION territory_private.stage8_project_items(p_state jsonb,p_player uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_state jsonb:=p_state; v_inv jsonb; v_worn jsonb; v_item record; v_id text; v_belt jsonb:='[]'::jsonb; v_entry jsonb; v_owned record; v_belt_ids text[]:=ARRAY[]::text[];
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_items WHERE player_id=p_player)
    AND p_state::text NOT LIKE '%stage8_%' AND p_state::text NOT LIKE '%serverItemId%'
    THEN RETURN p_state; END IF;
  IF pg_catalog.jsonb_typeof(p_state->'player') IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'invalid_existing_save'; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb) INTO v_inv
  FROM pg_catalog.jsonb_array_elements(COALESCE(p_state->'inventory','[]'::jsonb)) WITH ORDINALITY e(value,ordinality)
  WHERE pg_catalog.left(COALESCE(e.value->>'id',''),7)<>'stage8_' AND e.value->>'serverItemId' IS NULL;
  SELECT COALESCE(pg_catalog.jsonb_object_agg(e.key,e.value),'{}'::jsonb) INTO v_worn
  FROM pg_catalog.jsonb_each(COALESCE(p_state#>'{player,equipped}','{}'::jsonb)) e
  WHERE pg_catalog.left(COALESCE(e.value->>'id',''),7)<>'stage8_';
  IF pg_catalog.jsonb_typeof(p_state->'belt')='array' THEN
    FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(p_state->'belt') LOOP
      IF v_entry->>'serverItemId' IS NOT NULL OR pg_catalog.left(COALESCE(v_entry->>'id',''),7)='stage8_' THEN
        SELECT * INTO v_owned FROM public.territory_profession_stage8_items
          WHERE player_id=p_player AND removed_at IS NULL AND equipped_slot IS NULL
          AND item_id::text=COALESCE(v_entry->>'serverItemId',pg_catalog.substr(v_entry->>'id',8))
          AND item_output->>'type' IN ('potion','elixir')
          AND expires_at>pg_catalog.statement_timestamp();
        IF FOUND AND NOT (v_owned.item_id::text=ANY(v_belt_ids)) THEN
          v_belt_ids:=pg_catalog.array_append(v_belt_ids,v_owned.item_id::text);
          v_belt:=v_belt||pg_catalog.jsonb_build_array(v_owned.item_output||pg_catalog.jsonb_build_object(
            'id','stage8_'||v_owned.item_id::text,'serverItemId',v_owned.item_id::text,'qty',1,'expiresAt',v_owned.expires_at));
        ELSE v_belt:=v_belt||'[null]'::jsonb; END IF;
      ELSE v_belt:=v_belt||pg_catalog.jsonb_build_array(v_entry); END IF;
    END LOOP;
  END IF;
  FOR v_item IN SELECT * FROM public.territory_profession_stage8_items
    WHERE player_id=p_player AND removed_at IS NULL
      AND (expires_at IS NULL OR expires_at>pg_catalog.statement_timestamp())
    ORDER BY created_at,item_id LOOP
    v_id:='stage8_'||v_item.item_id::text;
    IF v_item.equipped_slot IS NOT NULL THEN
      v_worn:=v_worn||pg_catalog.jsonb_build_object(v_item.equipped_slot,
        v_item.item_output->'equipment'||pg_catalog.jsonb_build_object('id',v_id));
    ELSIF NOT (v_item.item_id::text=ANY(v_belt_ids)) THEN
      v_inv:=v_inv||pg_catalog.jsonb_build_array(v_item.item_output||
        pg_catalog.jsonb_build_object('id',v_id,'serverItemId',v_item.item_id::text,'qty',1,'expiresAt',v_item.expires_at)||
        CASE WHEN v_item.item_output->>'type'='equipment' THEN
          pg_catalog.jsonb_build_object('equipment',v_item.item_output->'equipment'||pg_catalog.jsonb_build_object('id',v_id))
        ELSE '{}'::jsonb END);
    END IF;
  END LOOP;
  v_state:=pg_catalog.jsonb_set(v_state,'{inventory}',v_inv,true);
  v_state:=pg_catalog.jsonb_set(v_state,'{player,equipped}',v_worn,true);
  IF pg_catalog.jsonb_typeof(p_state->'belt')='array' THEN
    v_state:=pg_catalog.jsonb_set(v_state,'{belt}',v_belt,true);
  END IF;
  RETURN v_state;
END $$;
REVOKE ALL ON FUNCTION territory_private.stage8_project_items(jsonb,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION territory_private.stage8_guard_item_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  NEW.game_state:=territory_private.stage8_project_items(NEW.game_state,NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION territory_private.stage8_guard_item_projection() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zz_stage8_item_projection ON public.players;
CREATE TRIGGER zz_stage8_item_projection BEFORE UPDATE OF game_state ON public.players
FOR EACH ROW EXECUTE FUNCTION territory_private.stage8_guard_item_projection();

CREATE OR REPLACE FUNCTION public.territory_profession_stage8_item_action(p_item uuid,p_action text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid:=(SELECT auth.uid()); v_prior public.territory_profession_stage8_receipts%ROWTYPE;
  v_item public.territory_profession_stage8_items%ROWTYPE; v_player public.players%ROWTYPE;
  v_state jsonb; v_equipped jsonb; v_old jsonb; v_inventory jsonb; v_slot text;
  v_result jsonb; v_eq jsonb; v_base jsonb; v_base_eq jsonb; v_growth jsonb;
  v_level integer; v_count integer; v_gold integer; v_cost integer; v_need integer;
  v_batches jsonb; v_after_batches jsonb:='[]'::jsonb; v_batch jsonb; v_take integer;
  v_balance integer:=0; v_tracked bigint:=0; v_qty integer; v_now timestamptz; v_upgraded boolean:=false;
  v_key text; v_effect jsonb; v_requested uuid:=p_item;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF p_item IS NULL OR p_operation IS NULL OR p_action IS NULL
    OR p_action NOT IN ('equip','unequip','upgrade','recycle','discard','consume')
    THEN RAISE EXCEPTION 'invalid_request'; END IF;
  -- Same lock as gather, craft and progression: both devices serialize.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text),7724);
  SELECT * INTO v_prior FROM public.territory_profession_stage8_receipts
    WHERE player_id=v_uid AND operation_id=p_operation;
  IF FOUND THEN
    IF v_prior.result->>'action' IS DISTINCT FROM p_action
      OR v_prior.result->>'item_id' IS DISTINCT FROM p_item::text
      THEN RAISE EXCEPTION 'operation_id_conflict'; END IF;
    RETURN v_prior.result;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_release WHERE id=1 AND enabled)
    THEN RAISE EXCEPTION 'profession_stage8_disabled'; END IF;
  IF NOT public.territory_profession_stage8_economy_ready()
    THEN RAISE EXCEPTION 'economy_not_server_authoritative'; END IF;
  SELECT * INTO v_player FROM public.players WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND OR v_player.banned THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_progress WHERE player_id=v_uid AND verified)
    THEN RAISE EXCEPTION 'mastery_not_reconciled'; END IF;
  SELECT * INTO v_item FROM public.territory_profession_stage8_items
    WHERE item_id=p_item AND player_id=v_uid AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_unavailable'; END IF;
  v_now:=pg_catalog.clock_timestamp();
  IF v_item.expires_at IS NOT NULL AND v_item.expires_at<=v_now THEN RAISE EXCEPTION 'item_expired'; END IF;
  v_state:=v_player.game_state;
  IF pg_catalog.jsonb_typeof(v_state->'player') IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'invalid_existing_save'; END IF;
  v_equipped:=COALESCE(v_state#>'{player,equipped}','{}'::jsonb);
  v_inventory:=COALESCE(v_state->'inventory','[]'::jsonb);
  v_eq:=v_item.item_output->'equipment'; v_slot:=v_eq->>'slot';
  IF p_action IN ('equip','unequip','upgrade','recycle') AND v_item.item_output->>'type'<>'equipment'
    THEN RAISE EXCEPTION 'equipment_required'; END IF;
  IF p_action='equip' THEN
    IF v_slot IS NULL OR v_slot NOT IN ('helmet','amulet','armor','weapon','shield','ring','boots')
      THEN RAISE EXCEPTION 'invalid_catalog'; END IF;
    IF v_item.equipped_slot IS NOT NULL THEN RAISE EXCEPTION 'item_already_equipped'; END IF;
    v_old:=v_equipped->v_slot;
    IF v_old IS NOT NULL AND v_old<>'null'::jsonb AND pg_catalog.left(COALESCE(v_old->>'id',''),7)<>'stage8_' THEN
      -- Preserve the exact historical worn object when swapping to crafted gear.
      IF COALESCE(v_old->>'id','')='' THEN RAISE EXCEPTION 'invalid_existing_equipment'; END IF;
      v_inventory:=v_inventory||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id',v_old->>'id','name',v_old->>'name','icon',v_old->>'icon','type','equipment',
        'rarity',v_old->>'rarity','description','Снятая экипировка','qty',1,'equipment',v_old));
    END IF;
    UPDATE public.territory_profession_stage8_items SET equipped_slot=NULL
      WHERE player_id=v_uid AND equipped_slot=v_slot AND removed_at IS NULL;
    UPDATE public.territory_profession_stage8_items SET equipped_slot=v_slot WHERE item_id=v_item.item_id;
    v_equipped:=v_equipped-v_slot;
  ELSIF p_action='unequip' THEN
    IF v_item.equipped_slot IS NULL THEN RAISE EXCEPTION 'item_not_equipped'; END IF;
    v_equipped:=v_equipped-v_item.equipped_slot;
    UPDATE public.territory_profession_stage8_items SET equipped_slot=NULL WHERE item_id=v_item.item_id;
  ELSIF p_action IN ('recycle','discard') THEN
    IF v_item.equipped_slot IS NOT NULL THEN RAISE EXCEPTION 'item_equipped'; END IF;
    -- Existing rules only reward ordinary unmodified boss loot. Crafted gear
    -- has no approved salvage payout, so disposal cannot manufacture currency.
    UPDATE public.territory_profession_stage8_items SET removed_at=v_now WHERE item_id=v_item.item_id;
  ELSIF p_action='consume' THEN
    IF v_item.item_output->>'type' NOT IN ('elixir','potion') THEN RAISE EXCEPTION 'consumable_required'; END IF;
    -- A requested later batch can never skip older stock of the SAME recipe.
    SELECT * INTO v_item FROM public.territory_profession_stage8_items
      WHERE player_id=v_uid AND recipe_id=v_item.recipe_id AND removed_at IS NULL AND expires_at>v_now
      ORDER BY expires_at,created_at,item_id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'item_expired'; END IF;
    v_effect:=v_item.item_output->'effect';
    IF v_effect IS NULL THEN RAISE EXCEPTION 'invalid_catalog'; END IF;
    UPDATE public.territory_profession_stage8_items SET removed_at=v_now WHERE item_id=v_item.item_id;
  ELSIF p_action='upgrade' THEN
    v_level:=(v_eq->>'level')::integer;
    IF v_level<1 OR v_level>=LEAST(COALESCE((v_state#>>'{player,level}')::integer,1),500)
      THEN RAISE EXCEPTION 'hero_level_required'; END IF;
    v_gold:=50+v_level*30; v_cost:=1+v_level/3; v_need:=v_cost;
    IF v_player.gold<v_gold THEN RAISE EXCEPTION 'insufficient_gold'; END IF;
    v_batches:=v_state->'forgeMaterialBatches';
    IF v_batches IS NULL THEN
      -- Same one-time seven-day grace as existing legacy material migration.
      v_batches:=pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('qty',
        COALESCE(v_player.forge_materials,0),'expiresAt',v_now+interval '7 days'));
    END IF;
    IF pg_catalog.jsonb_typeof(v_batches)<>'array' THEN RAISE EXCEPTION 'invalid_material_batches'; END IF;
    FOR v_batch IN SELECT value FROM pg_catalog.jsonb_array_elements(v_batches) LOOP
      IF v_batch->>'qty' IS NULL OR (v_batch->>'qty') !~ '^[0-9]{1,10}$'
        OR v_batch->>'expiresAt' IS NULL THEN RAISE EXCEPTION 'invalid_material_batches'; END IF;
      v_tracked:=v_tracked+(v_batch->>'qty')::bigint;
      PERFORM (v_batch->>'expiresAt')::timestamptz;
    END LOOP;
    IF v_tracked>COALESCE(v_player.forge_materials,0) THEN RAISE EXCEPTION 'invalid_material_batches'; END IF;
    IF v_tracked<COALESCE(v_player.forge_materials,0) THEN
      -- Existing server rewards may predate lot tracking; preserve those units
      -- with the same seven-day first-observation grace as the installed game.
      v_batches:=v_batches||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'qty',v_player.forge_materials-v_tracked,'expiresAt',v_now+interval '7 days'));
    END IF;
    FOR v_batch IN SELECT value FROM pg_catalog.jsonb_array_elements(v_batches)
      ORDER BY (value->>'expiresAt')::timestamptz LOOP
      v_qty:=(v_batch->>'qty')::integer;
      IF v_qty<0 THEN RAISE EXCEPTION 'invalid_material_batches'; END IF;
      IF (v_batch->>'expiresAt')::timestamptz<=v_now THEN CONTINUE; END IF;
      v_balance:=v_balance+v_qty;
      v_take:=LEAST(v_qty,v_need); v_need:=v_need-v_take;
      IF v_qty>v_take THEN v_after_batches:=v_after_batches||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_set(v_batch,'{qty}',pg_catalog.to_jsonb(v_qty-v_take))); END IF;
    END LOOP;
    IF v_balance>COALESCE(v_player.forge_materials,0) THEN RAISE EXCEPTION 'invalid_material_batches'; END IF;
    IF v_need>0 THEN RAISE EXCEPTION 'insufficient_forge_materials'; END IF;
    v_upgraded:=pg_catalog.random()<GREATEST(0.5,0.9-v_level*0.05);
    IF v_upgraded THEN
      SELECT item_output->'equipment' INTO v_base_eq FROM public.territory_profession_stage8_catalog WHERE id=v_item.recipe_id;
      v_count:=v_level-(v_base_eq->>'level')::integer+1;
      v_base:=v_base_eq-'slot'-'rarity'-'level'-'name'-'icon';
      SELECT growth INTO v_growth FROM territory_private.stage8_forge_growth
        WHERE slot=v_slot AND rarity=v_eq->>'rarity';
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_catalog'; END IF;
      v_eq:=v_eq||pg_catalog.jsonb_build_object('level',v_level+1,'baseLevel',(v_base_eq->>'level')::integer,
        'upgradeCount',v_count,'baseStats',v_base);
      FOREACH v_key IN ARRAY ARRAY['attack','defense','hp'] LOOP
        IF v_base ? v_key AND (v_base->>v_key)::numeric>0 THEN v_eq:=v_eq||pg_catalog.jsonb_build_object(v_key,
          (v_base->>v_key)::numeric+pg_catalog.round((v_growth->>v_key)::numeric*v_count)); END IF;
      END LOOP;
      UPDATE public.territory_profession_stage8_items SET item_output=pg_catalog.jsonb_set(item_output,'{equipment}',v_eq)
        WHERE item_id=v_item.item_id;
    END IF;
    v_state:=pg_catalog.jsonb_set(v_state,'{forgeMaterialBatches}',v_after_batches,true);
    v_state:=pg_catalog.jsonb_set(v_state,'{forgeMaterials}',pg_catalog.to_jsonb(v_balance-v_cost),true);
    v_state:=pg_catalog.jsonb_set(v_state,'{player,gold}',pg_catalog.to_jsonb(v_player.gold-v_gold),true);
  END IF;
  v_state:=pg_catalog.jsonb_set(v_state,'{inventory}',v_inventory,true);
  v_state:=pg_catalog.jsonb_set(v_state,'{player,equipped}',v_equipped,true);
  v_state:=territory_private.stage8_project_items(v_state,v_uid);
  UPDATE public.players SET game_state=v_state,
    gold=gold-CASE WHEN p_action='upgrade' THEN v_gold ELSE 0 END,
    forge_materials=CASE WHEN p_action='upgrade' THEN v_balance-v_cost ELSE forge_materials END,
    updated_at=GREATEST(pg_catalog.clock_timestamp(),updated_at+interval '1 microsecond')
    WHERE id=v_uid RETURNING * INTO v_player;
  SELECT * INTO v_item FROM public.territory_profession_stage8_items WHERE item_id=v_item.item_id;
  v_result:=pg_catalog.jsonb_build_object('success',true,'action',p_action,'item_id',v_requested,
    'consumed_item_id',CASE WHEN p_action='consume' THEN v_item.item_id ELSE NULL END,
    'item_output',v_item.item_output,'equipped_slot',v_item.equipped_slot,'removed',v_item.removed_at IS NOT NULL,
    'upgraded',v_upgraded,'effect',v_effect,'awarded',0,'game_state',v_player.game_state,
    'updated_at',v_player.updated_at,'gold',v_player.gold,'gems',v_player.gems,'forge_materials',v_player.forge_materials);
  INSERT INTO public.territory_profession_stage8_receipts(player_id,operation_id,recipe_id,result)
    VALUES(v_uid,p_operation,v_item.recipe_id,v_result);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_item_action(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_item_action(uuid,text,uuid) TO authenticated,service_role;

-- Canonical linear growth, copied mechanically from equipmentBalance.ts.
CREATE TABLE IF NOT EXISTS territory_private.stage8_forge_growth(slot text NOT NULL,rarity text NOT NULL,growth jsonb NOT NULL,PRIMARY KEY(slot,rarity));
ALTER TABLE territory_private.stage8_forge_growth ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.stage8_forge_growth FROM PUBLIC,anon,authenticated;
INSERT INTO territory_private.stage8_forge_growth(slot,rarity,growth) VALUES
('weapon','common','{"attack": 1.0, "defense": 0.0, "hp": 0.0}'::jsonb),
('weapon','rare','{"attack": 1.5, "defense": 0.0, "hp": 0.0}'::jsonb),
('weapon','epic','{"attack": 2.0, "defense": 0.0, "hp": 0.0}'::jsonb),
('weapon','legendary','{"attack": 3.0, "defense": 0.0, "hp": 0.0}'::jsonb),
('ring','common','{"attack": 0.5, "defense": 0.0, "hp": 0.5}'::jsonb),
('ring','rare','{"attack": 0.5, "defense": 0.25, "hp": 0.75}'::jsonb),
('ring','epic','{"attack": 0.75, "defense": 0.5, "hp": 1.0}'::jsonb),
('ring','legendary','{"attack": 1.0, "defense": 0.5, "hp": 1.5}'::jsonb),
('amulet','common','{"attack": 0.25, "defense": 0.0, "hp": 0.5}'::jsonb),
('amulet','rare','{"attack": 0.5, "defense": 0.25, "hp": 0.75}'::jsonb),
('amulet','epic','{"attack": 0.75, "defense": 0.5, "hp": 1.0}'::jsonb),
('amulet','legendary','{"attack": 1.0, "defense": 0.5, "hp": 1.5}'::jsonb),
('armor','common','{"attack": 0.0, "defense": 0.25, "hp": 1.0}'::jsonb),
('armor','rare','{"attack": 0.0, "defense": 0.5, "hp": 1.5}'::jsonb),
('armor','epic','{"attack": 0.0, "defense": 0.75, "hp": 2.0}'::jsonb),
('armor','legendary','{"attack": 0.0, "defense": 1.0, "hp": 3.0}'::jsonb),
('helmet','common','{"attack": 0.0, "defense": 0.25, "hp": 0.5}'::jsonb),
('helmet','rare','{"attack": 0.0, "defense": 0.25, "hp": 0.75}'::jsonb),
('helmet','epic','{"attack": 0.0, "defense": 0.5, "hp": 1.0}'::jsonb),
('helmet','legendary','{"attack": 0.0, "defense": 0.5, "hp": 1.5}'::jsonb),
('shield','common','{"attack": 0.0, "defense": 0.5, "hp": 0.5}'::jsonb),
('shield','rare','{"attack": 0.0, "defense": 0.5, "hp": 0.75}'::jsonb),
('shield','epic','{"attack": 0.0, "defense": 0.75, "hp": 1.0}'::jsonb),
('shield','legendary','{"attack": 0.0, "defense": 1.0, "hp": 1.5}'::jsonb),
('boots','common','{"attack": 0.0, "defense": 0.25, "hp": 0.5}'::jsonb),
('boots','rare','{"attack": 0.0, "defense": 0.25, "hp": 1.0}'::jsonb),
('boots','epic','{"attack": 0.0, "defense": 0.5, "hp": 1.5}'::jsonb),
('boots','legendary','{"attack": 0.0, "defense": 0.5, "hp": 2.0}'::jsonb)
ON CONFLICT(slot,rarity) DO NOTHING;

CREATE OR REPLACE FUNCTION public.territory_profession_stage8_inventory()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_items jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.territory_profession_stage8_release WHERE id=1 AND enabled)
    THEN RAISE EXCEPTION 'profession_stage8_disabled'; END IF;
  IF NOT public.territory_profession_stage8_economy_ready()
    THEN RAISE EXCEPTION 'economy_not_server_authoritative'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id=v_uid AND banned=false)
    THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.territory_profession_stage8_progress
    WHERE player_id=v_uid AND verified=true) THEN RAISE EXCEPTION 'mastery_not_reconciled'; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('item_id',i.item_id,'recipe_id',i.recipe_id,
      'item_output',i.item_output,'expires_at',i.expires_at,'equipped_slot',i.equipped_slot)
    ORDER BY i.created_at,i.item_id),'[]'::jsonb) INTO v_items
  FROM public.territory_profession_stage8_items i
  WHERE i.player_id=v_uid AND i.removed_at IS NULL AND (i.expires_at IS NULL OR i.expires_at>pg_catalog.clock_timestamp());
  RETURN pg_catalog.jsonb_build_object('success',true,'items',v_items);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_inventory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_inventory() TO authenticated, service_role;


-- Craft and item actions share UUID namespace; cross-kind reuse is rejected.
CREATE OR REPLACE FUNCTION public.territory_profession_stage8_execute(p_recipe text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_recipe public.territory_profession_stage8_catalog%ROWTYPE;
  v_progress public.territory_profession_stage8_progress%ROWTYPE;
  v_receipt public.territory_profession_stage8_receipts%ROWTYPE;
  v_license boolean := false;
  v_resource record;
  v_available bigint;
  v_level integer;
  v_xp integer;
  v_threshold integer;
  v_day date := (clock_timestamp() AT TIME ZONE 'Europe/Kyiv')::date;
  v_used integer;
  v_test_mode boolean := false;
  v_item uuid;
  v_expires_at timestamptz;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF p_recipe IS NULL OR length(p_recipe) NOT BETWEEN 1 AND 90
      OR p_recipe !~ '^[a-z0-9_]+$' OR p_operation IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  -- Shared with the existing gather/craft economy. Serializes both devices.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text),7724);
  SELECT * INTO v_receipt FROM public.territory_profession_stage8_receipts
    WHERE player_id=v_uid AND operation_id=p_operation;
  IF FOUND THEN
    IF v_receipt.result ? 'action' OR v_receipt.recipe_id<>p_recipe THEN RAISE EXCEPTION 'operation_id_conflict'; END IF;
    RETURN v_receipt.result;
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_release WHERE id=1 AND enabled)
    THEN RAISE EXCEPTION 'craft_not_enabled'; END IF;
  IF NOT public.territory_profession_stage8_economy_ready()
    THEN RAISE EXCEPTION 'economy_not_server_authoritative'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_uid AND banned=false)
    THEN RAISE EXCEPTION 'player_unavailable'; END IF;

  SELECT * INTO v_recipe FROM public.territory_profession_stage8_catalog WHERE id=p_recipe;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_recipe'; END IF;
  SELECT * INTO v_progress FROM public.territory_profession_stage8_progress
    WHERE player_id=v_uid FOR UPDATE;
  IF NOT FOUND OR NOT v_progress.verified THEN RAISE EXCEPTION 'mastery_not_reconciled'; END IF;
  SELECT u.master_license INTO v_license FROM public.territory_profession_unlocks u
    WHERE u.player_id=v_uid AND u.profession=v_progress.profession;
  IF NOT FOUND OR v_recipe.profession<>v_progress.profession THEN
    RAISE EXCEPTION 'profession_not_unlocked';
  END IF;
  IF v_recipe.required_level=300 AND NOT COALESCE(v_license,false)
    THEN RAISE EXCEPTION 'master_license_required'; END IF;
  IF v_progress.mastery_level<v_recipe.required_level THEN RAISE EXCEPTION 'mastery_too_low'; END IF;

  -- The daily journal and operation receipt commit in the SAME transaction.
  INSERT INTO public.territory_profession_stage8_daily_xp(player_id,local_day,xp_used)
    VALUES(v_uid,v_day,0) ON CONFLICT(player_id,local_day) DO NOTHING;
  SELECT xp_used INTO v_used FROM public.territory_profession_stage8_daily_xp
    WHERE player_id=v_uid AND local_day=v_day FOR UPDATE;
  SELECT EXISTS(SELECT 1
    FROM territory_private.territory_profession_stage8_test_access t
    JOIN public.players p ON p.id=t.player_id AND p.telegram_id=t.verified_telegram_id
    WHERE t.player_id=v_uid AND t.expires_at>clock_timestamp()) INTO v_test_mode;
  IF v_test_mode THEN v_used:=0;
  ELSIF v_used+v_recipe.mastery_xp>300 THEN RAISE EXCEPTION 'daily_mastery_xp_limit'; END IF;

  -- Validate and sum each ingredient before debiting anything. Resource IDs
  -- come solely from the protected catalogue, never from client parameters.
  IF v_recipe.ingredients IS NULL OR jsonb_typeof(v_recipe.ingredients)<>'array'
      OR jsonb_array_length(v_recipe.ingredients) NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'invalid_catalog';
  END IF;
  FOR v_resource IN
    SELECT value->>'id' AS resource_id,SUM((value->>'qty')::bigint) AS qty
    FROM pg_catalog.jsonb_array_elements(v_recipe.ingredients) AS e(value)
    GROUP BY value->>'id' ORDER BY value->>'id'
  LOOP
    IF v_resource.resource_id NOT IN ('gather-ore','gather-wood','gather-hide','gather-herb','gather-crystal')
       OR v_resource.qty NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'invalid_catalog'; END IF;
    SELECT quantity INTO v_available FROM public.territory_resource_wallet
      WHERE player_id=v_uid AND resource_id=v_resource.resource_id FOR UPDATE;
    IF COALESCE(v_available,0)<v_resource.qty THEN RAISE EXCEPTION 'insufficient_resources'; END IF;
  END LOOP;

  FOR v_resource IN
    SELECT value->>'id' AS resource_id,SUM((value->>'qty')::bigint) AS qty
    FROM pg_catalog.jsonb_array_elements(v_recipe.ingredients) AS e(value)
    GROUP BY value->>'id' ORDER BY value->>'id'
  LOOP
    UPDATE public.territory_resource_wallet SET quantity=quantity-v_resource.qty
      WHERE player_id=v_uid AND resource_id=v_resource.resource_id AND quantity>=v_resource.qty;
    IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_resources'; END IF;
  END LOOP;

  -- Training spends resources for XP and never mints an inventory item.
  IF v_recipe.kind='item' THEN
    IF v_recipe.item_output IS NULL THEN RAISE EXCEPTION 'invalid_catalog'; END IF;
    IF v_recipe.item_output->>'type' IN ('elixir','potion')
      THEN v_expires_at:=clock_timestamp()+INTERVAL '7 days'; END IF;
    INSERT INTO public.territory_profession_stage8_items(player_id,recipe_id,item_output,expires_at)
      VALUES(v_uid,p_recipe,v_recipe.item_output,v_expires_at) RETURNING item_id INTO v_item;
  ELSIF v_recipe.kind<>'practice' OR v_recipe.item_output IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_catalog';
  END IF;

  -- XP table is versioned server data. Existing legacy levels are not reset.
  v_level:=v_progress.mastery_level;
  v_xp:=v_progress.mastery_xp+v_recipe.mastery_xp;
  WHILE v_level<300 LOOP
    SELECT xp_to_next INTO v_threshold FROM public.territory_profession_stage8_bands
      WHERE v_level BETWEEN from_level AND to_level;
    IF NOT FOUND OR v_threshold<1 THEN RAISE EXCEPTION 'invalid_mastery_band'; END IF;
    EXIT WHEN v_xp<v_threshold;
    v_xp:=v_xp-v_threshold;
    v_level:=v_level+1;
  END LOOP;
  IF v_level=300 THEN v_xp:=0; END IF;
  UPDATE public.territory_profession_stage8_progress
    SET mastery_level=v_level,mastery_xp=v_xp,updated_at=clock_timestamp()
    WHERE player_id=v_uid;
  IF NOT v_test_mode THEN
    UPDATE public.territory_profession_stage8_daily_xp
      SET xp_used=xp_used+v_recipe.mastery_xp
      WHERE player_id=v_uid AND local_day=v_day;
  END IF;

  v_result:=jsonb_build_object('success',true,'recipe_id',p_recipe,
    'kind',v_recipe.kind,'item_id',v_item,'item_output',v_recipe.item_output,
    'expires_at',v_expires_at,'mastery_level',v_level,'mastery_xp',v_xp,
    'daily_xp_used',CASE WHEN v_test_mode THEN 0 ELSE v_used+v_recipe.mastery_xp END);
  INSERT INTO public.territory_profession_stage8_receipts(player_id,operation_id,recipe_id,result)
    VALUES(v_uid,p_operation,p_recipe,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_execute(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_execute(text,uuid) TO authenticated, service_role;


COMMIT;
