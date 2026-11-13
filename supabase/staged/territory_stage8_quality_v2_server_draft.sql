-- TERRITORY Stage8 quality version v2 — ATOMIC STAGED DRAFT.
-- DO NOT APPLY BEFORE PGlite + Android Telegram WebView acceptance.
-- Preserves all existing recipes, items, receipts, player data, wallets, VIP,
-- old item ownership and historical forge outcomes. The only changed live
-- behavior when intentionally applied is quality of NEW mw_* items.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Verify the exact live 97 recipe structure before changing a function.
DO $preflight$
DECLARE v_count integer;v_new integer;
BEGIN
 SELECT count(*),count(*) FILTER (WHERE id LIKE 'mw_%')
 INTO v_count,v_new FROM public.territory_profession_stage8_catalog;
 IF v_count<>97 OR v_new<>25
 THEN RAISE EXCEPTION 'quality_v2_requires_exact_stage8_catalog_%_%',v_count,v_new; END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION territory_private.territory_mastery_quality_pct_v2(
  p_mastery integer, p_has_master_license boolean
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = 'pg_catalog'
AS $quality$
BEGIN
  IF p_mastery IS NULL OR p_mastery NOT BETWEEN 1 AND 300
    OR p_has_master_license IS NULL
    THEN RAISE EXCEPTION 'invalid_mastery_or_license'; END IF;
  RETURN CASE
    WHEN p_mastery >= 300 AND p_has_master_license THEN 160
    WHEN p_mastery >= 250 THEN 130
    WHEN p_mastery >= 200 THEN 110
    WHEN p_mastery >= 150 THEN 90
    WHEN p_mastery >= 100 THEN 70
    WHEN p_mastery >= 50 THEN 50
    WHEN p_mastery >= 25 THEN 35
    ELSE 20 END;
END
$quality$;
REVOKE ALL ON FUNCTION territory_private.territory_mastery_quality_pct_v2(integer,boolean)
  FROM PUBLIC,anon,authenticated;
-- QUALITY HELPER BEGIN
-- Safe, read-only live-compatible item preview. Uses the same baseline and rounding
-- as scripts/professions/stage8-model.mjs. No RLS bypass or client input for power.
CREATE OR REPLACE FUNCTION territory_private.territory_stage8_quality_item_v2(
 p_recipe text,p_mastery integer,p_has_license boolean,p_max_item_level integer DEFAULT 61)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $quality_item$
DECLARE
 v_required integer; v_output jsonb; v_eq jsonb;v_slot text;v_rarity text;
 v_initial_level integer;v_level integer;v_max_level integer;v_pct integer;
 v_shop jsonb;v_shop_at_level numeric;v_growth numeric;
 v_craft_power numeric;v_shop_power numeric;v_stat text;v_raw numeric;
 v_target numeric;v_cap numeric;v_stats jsonb;v_equipment jsonb;v_block text;
 v_score numeric;
BEGIN
 IF p_recipe IS NULL OR p_recipe !~ '^mw_[a-z0-9_]+$' OR p_mastery NOT BETWEEN 1 AND 300
   OR p_has_license IS NULL OR p_max_item_level NOT BETWEEN 1 AND 61
 THEN RAISE EXCEPTION 'quality_invalid_request'; END IF;
 SELECT required_level,item_output INTO v_required,v_output
 FROM public.territory_profession_stage8_catalog
 WHERE id=p_recipe AND kind='item' AND item_output->>'type'='equipment';
 IF NOT FOUND THEN RAISE EXCEPTION 'quality_recipe_not_found'; END IF;
 v_pct:=territory_private.territory_mastery_quality_pct_v2(p_mastery,p_has_license);
 IF p_mastery<v_required OR (v_required=300 AND NOT p_has_license)
 THEN RETURN jsonb_build_object('status','locked','quality_pct',v_pct); END IF;
 v_eq:=v_output->'equipment';
 IF jsonb_typeof(v_eq)<>'object' OR (v_eq->>'level') !~ '^[1-9][0-9]{0,2}$'
 THEN RAISE EXCEPTION 'quality_invalid_recipe'; END IF;
 v_slot:=v_eq->>'slot';v_rarity:=v_eq->>'rarity';
 v_initial_level:=(v_eq->>'level')::int;
 v_max_level:=p_max_item_level;
 IF v_initial_level>v_max_level
 THEN RETURN jsonb_build_object('status','blocked','reason','item_level_above_cap','quality_pct',v_pct); END IF;
 v_craft_power:=CASE v_rarity WHEN 'common' THEN 1 WHEN 'rare' THEN 1.15
   WHEN 'epic' THEN 1.35 WHEN 'legendary' THEN 1.6 ELSE NULL END;
 IF v_craft_power IS NULL THEN RAISE EXCEPTION 'quality_invalid_rarity'; END IF;
 FOR v_level IN v_initial_level..v_max_level LOOP
   -- Prefer the highest eligible shop rarity, then existing at this level,
   -- then the strongest item measured by canonical combat-weighted stats.
   SELECT x.val,x.power INTO v_shop,v_shop_power
   FROM (
     SELECT s.value val,
       CASE s.value->>'rarity' WHEN 'common' THEN 1::numeric WHEN 'rare' THEN 1.15
         WHEN 'epic' THEN 1.35 WHEN 'legendary' THEN 1.6 END power,
       CASE WHEN (s.value->>'level')::int<=v_level THEN 1 ELSE 0 END eligible,
       (
        COALESCE((s.value->>'attack')::numeric,0)*5+
        COALESCE((s.value->>'defense')::numeric,0)*5+
        COALESCE((s.value->>'hp')::numeric,0)+
        COALESCE((s.value->>'critChance')::numeric,0)*10+
        (v_level-(s.value->>'level')::int)*(
          COALESCE((s.value#>>'{growth,attack}')::numeric,0)*5+
          COALESCE((s.value#>>'{growth,defense}')::numeric,0)*5+
          COALESCE((s.value#>>'{growth,hp}')::numeric,0))
       ) score
     FROM jsonb_array_elements($shops$[{"id":"shop_weapon_warrior_eq","slot":"weapon","rarity":"common","level":1,"attack":8,"growth":{"attack":1,"defense":0,"hp":0}},{"id":"shop_weapon_knight_eq","slot":"weapon","rarity":"rare","level":3,"attack":18,"critChance":3,"growth":{"attack":1.5,"defense":0,"hp":0}},{"id":"shop_weapon_hero_eq","slot":"weapon","rarity":"rare","level":5,"attack":22,"critChance":4,"growth":{"attack":1.5,"defense":0,"hp":0}},{"id":"shop_armor_leather_eq","slot":"armor","rarity":"common","level":1,"defense":5,"hp":30,"growth":{"attack":0,"defense":0.25,"hp":1}},{"id":"shop_armor_plate_eq","slot":"armor","rarity":"rare","level":3,"defense":12,"hp":80,"growth":{"attack":0,"defense":0.5,"hp":1.5}},{"id":"shop_helmet_iron_eq","slot":"helmet","rarity":"common","level":1,"defense":3,"hp":20,"growth":{"attack":0,"defense":0.25,"hp":0.5}},{"id":"shop_boots_swift_eq","slot":"boots","rarity":"rare","level":2,"defense":4,"hp":40,"critChance":2,"growth":{"attack":0,"defense":0.25,"hp":1}},{"id":"shop_ring_power_eq","slot":"ring","rarity":"rare","level":5,"attack":10,"critChance":3,"growth":{"attack":0.5,"defense":0,"hp":0}},{"id":"shop_shield_oak_eq","slot":"shield","rarity":"common","level":2,"defense":5,"hp":25,"growth":{"attack":0,"defense":0.5,"hp":0.5}},{"id":"shop_amulet_raven_eq","slot":"amulet","rarity":"rare","level":3,"attack":6,"critChance":3,"growth":{"attack":0.5,"defense":0,"hp":0}},{"id":"historic_shop_hero","slot":"weapon","rarity":"epic","level":5,"attack":35,"critChance":8,"growth":{"attack":2,"defense":0,"hp":0}},{"id":"historic_shop_ring","slot":"ring","rarity":"epic","level":5,"attack":15,"critChance":5,"growth":{"attack":0.75,"defense":0,"hp":0}}]$shops$::jsonb) s
     WHERE s.value->>'slot'=v_slot
       AND NOT (v_rarity='legendary' AND s.value->>'id' IN ('historic_shop_hero','historic_shop_ring'))
       AND (CASE s.value->>'rarity' WHEN 'common' THEN 1::numeric WHEN 'rare' THEN 1.15
         WHEN 'epic' THEN 1.35 WHEN 'legendary' THEN 1.6 END)<=v_craft_power
   ) x ORDER BY x.power DESC,x.eligible DESC,x.score DESC,x.val->>'id' LIMIT 1;
   IF v_shop IS NULL THEN RAISE EXCEPTION 'quality_missing_shop_baseline'; END IF;
   v_stats:='{}'::jsonb;v_block:=NULL;
   FOREACH v_stat IN ARRAY ARRAY['attack','defense','hp','critChance'] LOOP
     IF jsonb_typeof(v_eq->v_stat) IS DISTINCT FROM 'number' THEN CONTINUE; END IF;
     IF jsonb_typeof(v_shop->v_stat) IS DISTINCT FROM 'number'
     THEN v_block:=v_stat||'_missing_shop_reference';EXIT; END IF;
     v_growth:=CASE v_stat WHEN 'critChance' THEN 0
       ELSE COALESCE((v_shop->'growth'->>v_stat)::numeric,0) END;
     v_shop_at_level:=CASE v_stat WHEN 'critChance' THEN (v_shop->>v_stat)::numeric
       ELSE greatest(0,(v_shop->>v_stat)::numeric+
         round(v_growth*(v_level-(v_shop->>'level')::int))) END;
     v_raw:=(v_eq->>v_stat)::numeric;
     v_target:=greatest(v_raw,ceil(v_shop_at_level*v_craft_power/v_shop_power*(1+v_pct::numeric/100)));
     v_cap:=CASE v_stat
       WHEN 'attack' THEN CASE WHEN v_slot='weapon' THEN 40+6*v_level
         WHEN v_slot IN ('ring','amulet') THEN 20+4*v_level ELSE 10+2*v_level END
       WHEN 'defense' THEN CASE WHEN v_slot IN ('armor','shield','helmet','boots')
         THEN 10+5*v_level ELSE 10+3*v_level END
       WHEN 'hp' THEN CASE WHEN v_slot='armor' THEN 50+12*v_level
         WHEN v_slot IN ('boots','shield','helmet') THEN 40+10*v_level
         ELSE 25+5*v_level END
       ELSE 25 END;
     IF v_target>v_cap THEN v_block:=v_stat||'_exceeds_safe_cap';EXIT; END IF;
     v_stats:=jsonb_set(v_stats,ARRAY[v_stat],to_jsonb(v_target::int),true);
   END LOOP;
   IF v_block IS NULL THEN
     v_equipment:=v_eq||v_stats||jsonb_build_object(
       'level',v_level,'baseLevel',v_level,'baseStats',v_stats,
       'upgradeCount',0,'qualityVersion','mastery-v2',
       'masteryQualityPct',v_pct,'craftedMastery',p_mastery);
     v_output:=v_output||jsonb_build_object(
       'equipment',v_equipment,'masteryQualityPct',v_pct,
       'qualityVersion','mastery-v2',
       'description','Мастерское изделие: +'||v_pct||
         '% к магазинному эталону с учётом редкости. Мастерство изготовителя '||
         p_mastery||'. Уровень вещи '||v_level||'.');
     RETURN jsonb_build_object('status','ready','quality_pct',v_pct,
       'baseline_shop_id',v_shop->>'id','item_output',v_output,'item_level',v_level);
   END IF;
 END LOOP;
 RETURN jsonb_build_object('status','blocked','reason','safe_stat_caps',
   'quality_pct',v_pct,'detail',v_block);
END
$quality_item$;
REVOKE ALL ON FUNCTION territory_private.territory_stage8_quality_item_v2(text,integer,boolean,integer)
 FROM PUBLIC,anon,authenticated;
-- QUALITY HELPER END

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
  v_item_output jsonb;
  v_quality jsonb;
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
  -- Live catalogue is immutable. Quality is minted only from the verified
  -- database mastery/license snapshot BEFORE XP, material debit or item mint.
  v_item_output:=v_recipe.item_output;
  IF v_recipe.kind='item' AND p_recipe LIKE 'mw_%' THEN
    v_quality:=territory_private.territory_stage8_quality_item_v2(
      p_recipe,v_progress.mastery_level,COALESCE(v_license,false),61);
    IF v_quality->>'status' IS DISTINCT FROM 'ready' THEN
      RAISE EXCEPTION 'masterwork_quality_unavailable';
    END IF;
    v_item_output:=v_quality->'item_output';
  END IF;

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
    IF v_item_output IS NULL THEN RAISE EXCEPTION 'invalid_catalog'; END IF;
    -- Permanent consumables: preserve the live no-expiry behavior introduced
    -- before this v2 draft. Legacy expired receipts remain historical data.
    -- v_expires_at intentionally stays NULL for new items of every type.
    INSERT INTO public.territory_profession_stage8_items(player_id,recipe_id,item_output,expires_at)
      VALUES(v_uid,p_recipe,v_item_output,v_expires_at) RETURNING item_id INTO v_item;
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
    'kind',v_recipe.kind,'item_id',v_item,'item_output',v_item_output,
    'expires_at',v_expires_at,'mastery_level',v_level,'mastery_xp',v_xp,
    'daily_xp_used',CASE WHEN v_test_mode THEN 0 ELSE v_used+v_recipe.mastery_xp END);
  INSERT INTO public.territory_profession_stage8_receipts(player_id,operation_id,recipe_id,result)
    VALUES(v_uid,p_operation,p_recipe,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_execute(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_execute(text,uuid) TO authenticated, service_role;


-- Read-only authenticated batch preview: one response for all 25 masterworks.
-- Return no information about other users, no keys or wallet details.
CREATE OR REPLACE FUNCTION public.territory_profession_stage8_quality_previews()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $quality_previews$
DECLARE v_uid uuid:=(SELECT auth.uid());v_prof text;v_mastery integer;v_license boolean;
 v_items jsonb:='{}'::jsonb;v_recipe record;v_preview jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.players WHERE id=v_uid AND banned=false)
 THEN RAISE EXCEPTION 'player_unavailable'; END IF;
 SELECT p.profession,p.mastery_level,u.master_license INTO v_prof,v_mastery,v_license
 FROM public.territory_profession_stage8_progress p
 JOIN public.territory_profession_unlocks u ON u.player_id=p.player_id
   AND u.profession=p.profession
 WHERE p.player_id=v_uid AND p.verified=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'mastery_not_reconciled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_release WHERE id=1 AND enabled)
 THEN RAISE EXCEPTION 'craft_not_enabled'; END IF;
 FOR v_recipe IN SELECT id FROM public.territory_profession_stage8_catalog
   WHERE profession=v_prof AND kind='item' AND id LIKE 'mw_%' ORDER BY id LOOP
   v_preview:=territory_private.territory_stage8_quality_item_v2(
     v_recipe.id,v_mastery,COALESCE(v_license,false),61);
   v_items:=jsonb_set(v_items,ARRAY[v_recipe.id],v_preview,true);
 END LOOP;
 RETURN jsonb_build_object('success',true,'quality_version','mastery-v2',
   'mastery_level',v_mastery,'master_license',COALESCE(v_license,false),'previews',v_items);
END
$quality_previews$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_quality_previews()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_quality_previews()
 TO authenticated,service_role;

COMMIT;
