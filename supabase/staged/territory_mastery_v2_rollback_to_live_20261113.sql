-- Restore the exactly observed live crafting function before mastery-v2 release.
-- Use only to safely stop minting NEW v2 items; NEVER modify already-issued items.
-- Observed 2026-11-13: md5(pg_get_functiondef)=43eeae4066b3620670ffcdcb1d295e17
BEGIN;
CREATE OR REPLACE FUNCTION public.territory_profession_stage8_execute(p_recipe text, p_operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    IF v_receipt.recipe_id<>p_recipe THEN RAISE EXCEPTION 'operation_id_conflict'; END IF;
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
    -- Permanent crafted consumables: v_expires_at remains NULL.
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
$function$

REVOKE ALL ON FUNCTION public.territory_profession_stage8_execute(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_execute(text,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_quality_previews() FROM PUBLIC,anon,authenticated;
COMMIT;
