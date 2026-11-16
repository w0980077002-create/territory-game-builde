-- TERRITORY #366 LIVE metadata snapshot, read-only extracted 2026-11-16.
-- DO NOT DEPLOY; ONLY apply to disposable local PostgreSQL 17/PGlite test database.
-- Exact pg_get_functiondef and pg_get_triggerdef from production; 11 enabled non-internal
-- public.players triggers. No live player rows, UUIDs, or credentials.
-- If current live md5 or trigger set differs at deployment, refresh clone before GO.
-- arena_guard_live_belt_v1_trg | territory_private.arena_guard_live_belt_v1() | md5=b61158946c7bc78411996168bc04cd71
CREATE OR REPLACE FUNCTION territory_private.arena_guard_live_belt_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_room uuid;
  v_slot integer;
  v_prior jsonb;
  v_after jsonb;
  v_kind text;
  v_qty integer;
  v_changes integer := 0;
  v_effect jsonb;
BEGIN
  IF NEW.game_state->'belt' IS NOT DISTINCT FROM OLD.game_state->'belt' THEN RETURN NEW; END IF;
  SELECT ap.room_id INTO v_room FROM public.arena_participants ap
  JOIN public.arena_rooms r ON r.id=ap.room_id
  WHERE ap.user_id=OLD.id AND ap.left_at IS NULL AND r.status='active' LIMIT 1;
  IF v_room IS NULL THEN RETURN NEW; END IF;
  IF pg_catalog.jsonb_typeof(OLD.game_state->'belt') <> 'array'
    OR pg_catalog.jsonb_typeof(NEW.game_state->'belt') <> 'array'
    OR pg_catalog.jsonb_array_length(OLD.game_state->'belt') <> 7
    OR pg_catalog.jsonb_array_length(NEW.game_state->'belt') <> 7
    OR NEW.game_state->'inventory' IS DISTINCT FROM OLD.game_state->'inventory'
  THEN RAISE EXCEPTION 'arena_live_belt_locked'; END IF;
  FOR v_slot IN 0..6 LOOP
    v_prior := OLD.game_state->'belt'->v_slot;
    v_after := NEW.game_state->'belt'->v_slot;
    IF v_prior IS NOT DISTINCT FROM v_after THEN CONTINUE; END IF;
    v_changes := v_changes+1;
    IF v_changes > 1 OR pg_catalog.jsonb_typeof(v_prior) <> 'object'
       OR (v_prior->>'qty') !~ '^[1-5]$'
    THEN RAISE EXCEPTION 'arena_live_belt_locked'; END IF;
    v_qty := (v_prior->>'qty')::integer;
    IF NOT ((v_qty=1 AND v_after='null'::jsonb)
      OR (v_qty>1 AND v_after=pg_catalog.jsonb_set(v_prior,'{qty}',pg_catalog.to_jsonb(v_qty-1))))
    THEN RAISE EXCEPTION 'arena_live_belt_locked'; END IF;
    v_effect := v_prior->'effect';
    v_kind := CASE
      WHEN v_prior->>'arenaEffect'='time' THEN 'time'
      WHEN v_prior->>'arenaEffect'='adrenaline' THEN 'adrenaline'
      WHEN v_effect->>'stat'='hp' AND (v_effect->>'value') ~ '^[0-9]{1,4}$'
        AND (v_effect->>'value')::integer >=150 THEN 'heal_large'
      WHEN v_effect->>'stat'='hp' THEN 'heal_small'
      WHEN v_effect->>'stat'='attack' THEN 'attack'
      WHEN v_effect->>'stat'='defense' THEN 'defense'
      WHEN v_effect->>'stat'='critChance' THEN 'crit'
      ELSE NULL END;
  END LOOP;
  IF v_changes <> 1 OR v_kind IS NULL OR NOT EXISTS (
    SELECT 1 FROM territory_private.arena_consumable_usage_v1 u
    WHERE u.player_id=OLD.id AND u.room_id=v_room AND u.item_kind=v_kind
      AND u.xmin::text=pg_catalog.pg_current_xact_id()::text
  ) THEN RAISE EXCEPTION 'arena_live_belt_locked'; END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER arena_guard_live_belt_v1_trg BEFORE UPDATE OF game_state ON public.players FOR EACH ROW EXECUTE FUNCTION territory_private.arena_guard_live_belt_v1();

-- territory_capture_forge_spend_65_v1 | territory_private.capture_forge_spend_65_v1() | md5=ae03e07a6770a400713cccca00a22c44
CREATE OR REPLACE FUNCTION territory_private.capture_forge_spend_65_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    OR NEW.gold >= OLD.gold OR NEW.forge_materials >= OLD.forge_materials
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
END $function$;
CREATE TRIGGER territory_capture_forge_spend_65_v1 AFTER UPDATE OF game_state ON public.players FOR EACH ROW EXECUTE FUNCTION territory_private.capture_forge_spend_65_v1();

-- territory_economy_audit_after_v1 | territory_economy_audit_trigger_v1() | md5=7ba019abd3d7e1d4c30811abaaa825db
CREATE OR REPLACE FUNCTION public.territory_economy_audit_trigger_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_stones_old bigint;v_stones_new bigint;v_bought_old integer;v_bought_new integer;
 v_chapter_old integer;v_chapter_new integer;v_alert text:=NULL;
BEGIN
 IF (OLD.game_state->>'battleStones') ~ '^[0-9]{1,10}$'
 THEN v_stones_old:=(OLD.game_state->>'battleStones')::bigint;END IF;
 IF (NEW.game_state->>'battleStones') ~ '^[0-9]{1,10}$'
 THEN v_stones_new:=(NEW.game_state->>'battleStones')::bigint;END IF;
 IF (OLD.game_state->>'dailyStonesBought') ~ '^[0-9]{1,2}$'
 THEN v_bought_old:=(OLD.game_state->>'dailyStonesBought')::integer;END IF;
 IF (NEW.game_state->>'dailyStonesBought') ~ '^[0-9]{1,2}$'
 THEN v_bought_new:=(NEW.game_state->>'dailyStonesBought')::integer;END IF;
 IF (OLD.game_state->>'currentChapter') ~ '^[0-9]{1,9}$'
 THEN v_chapter_old:=(OLD.game_state->>'currentChapter')::integer;END IF;
 IF (NEW.game_state->>'currentChapter') ~ '^[0-9]{1,9}$'
 THEN v_chapter_new:=(NEW.game_state->>'currentChapter')::integer;END IF;
 IF NEW.gold IS DISTINCT FROM OLD.gold OR NEW.gems IS DISTINCT FROM OLD.gems
 OR NEW.level IS DISTINCT FROM OLD.level
 OR v_stones_new IS DISTINCT FROM v_stones_old
 OR v_bought_new IS DISTINCT FROM v_bought_old
 OR v_chapter_new IS DISTINCT FROM v_chapter_old THEN
  IF NEW.gems>OLD.gems+500 THEN v_alert:='large_gem_gain';
  ELSIF NEW.gold>OLD.gold+250000 THEN v_alert:='large_gold_gain';
  ELSIF v_stones_old IS NOT NULL AND v_stones_new>v_stones_old+25 THEN v_alert:='large_stone_gain';
  ELSIF NEW.level>OLD.level+5 THEN v_alert:='large_level_jump';END IF;
  INSERT INTO public.territory_economy_audit_v1(
  player_id,actor_id,gold_old,gold_new,gems_old,gems_new,level_old,level_new,
  stones_old,stones_new,bought_old,bought_new,chapter_old,chapter_new,suspicious,reason)
  VALUES(NEW.id,auth.uid(),OLD.gold,NEW.gold,OLD.gems,NEW.gems,OLD.level,NEW.level,
  v_stones_old,v_stones_new,v_bought_old,v_bought_new,v_chapter_old,v_chapter_new,
  v_alert IS NOT NULL,v_alert);
 END IF;
 RETURN NULL;
END;
$function$;
CREATE TRIGGER territory_economy_audit_after_v1 AFTER UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION territory_economy_audit_trigger_v1();

-- territory_economy_guard_before_v1 | territory_economy_guard_v1() | md5=a67b564acce6e099c8d09bdef8bcc70d
CREATE OR REPLACE FUNCTION public.territory_economy_guard_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 v_state jsonb:=NEW.game_state; v_p jsonb:=v_state->'player';
 v_gold numeric; v_gems numeric; v_level numeric; v_stones numeric; v_bought numeric;
BEGIN
 IF NEW.game_state IS DISTINCT FROM OLD.game_state THEN
  IF pg_catalog.jsonb_typeof(v_state) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(v_p) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'territory_invalid_game_state'; END IF;
  IF pg_catalog.jsonb_typeof(v_p->'gold') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(v_p->'gems') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(v_p->'level') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(v_state->'battleStones') IS DISTINCT FROM 'number'
  THEN RAISE EXCEPTION 'territory_invalid_wallet_type'; END IF;
  v_gold:=(v_p->>'gold')::numeric;
  v_gems:=(v_p->>'gems')::numeric;
  v_level:=(v_p->>'level')::numeric;
  v_stones:=(v_state->>'battleStones')::numeric;
  IF v_gold IS DISTINCT FROM NEW.gold OR v_gems IS DISTINCT FROM NEW.gems
    OR v_level IS DISTINCT FROM NEW.level OR v_stones NOT BETWEEN 0 AND 2147483647
    OR pg_catalog.trunc(v_stones)<>v_stones
  THEN RAISE EXCEPTION 'territory_wallet_snapshot_mismatch'; END IF;
  IF v_state ? 'dailyStonesBought' THEN
    IF pg_catalog.jsonb_typeof(v_state->'dailyStonesBought') IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'territory_invalid_stone_counter'; END IF;
    v_bought:=(v_state->>'dailyStonesBought')::numeric;
    IF v_bought NOT BETWEEN 0 AND 25 OR pg_catalog.trunc(v_bought)<>v_bought
    THEN RAISE EXCEPTION 'territory_invalid_stone_counter'; END IF;
  END IF;
 END IF;
 IF NEW.game_state IS DISTINCT FROM OLD.game_state OR NEW.gold IS DISTINCT FROM OLD.gold
   OR NEW.gems IS DISTINCT FROM OLD.gems OR NEW.level IS DISTINCT FROM OLD.level THEN
  NEW.updated_at:=GREATEST(pg_catalog.clock_timestamp(),OLD.updated_at+interval '1 microsecond');
 END IF;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER territory_economy_guard_before_v1 BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION territory_economy_guard_v1();

-- territory_forge_material_permanent_20261109 | territory_private.keep_forge_materials_permanent_20261109() | md5=ea98728c1d3f3108058b7e4411169404
CREATE OR REPLACE FUNCTION territory_private.keep_forge_materials_permanent_20261109()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  balance integer;
  permanent_lots jsonb;
BEGIN
  IF NEW.game_state IS NULL OR jsonb_typeof(NEW.game_state) IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;
  balance := greatest(coalesce(NEW.forge_materials, 0), 0);
  permanent_lots := CASE WHEN balance > 0
    THEN jsonb_build_array(jsonb_build_object(
      'qty', balance, 'expiresAt', '9999-12-31T23:59:59.000Z'))
    ELSE '[]'::jsonb END;
  IF NEW.game_state->'forgeMaterialBatches' IS DISTINCT FROM permanent_lots THEN
    NEW.game_state := jsonb_set(NEW.game_state, '{forgeMaterialBatches}', permanent_lots, true);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER territory_forge_material_permanent_20261109 BEFORE INSERT OR UPDATE OF game_state, forge_materials ON public.players FOR EACH ROW EXECUTE FUNCTION territory_private.keep_forge_materials_permanent_20261109();

-- territory_gear_guard_before_v4 | territory_gear_guard_v4() | md5=93ed0f0c1f16a0f56923fe8c590f9a2f
CREATE OR REPLACE FUNCTION public.territory_gear_guard_v4()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_stats jsonb; v_managed record;
  v_att int; v_def int; v_hp int; v_crit int;
BEGIN
  IF NEW.game_state IS NULL THEN RETURN NEW; END IF;
  NEW.game_state:=territory_private.owner_cap_state_v1(
    public.territory_normalize_state_v4(
      territory_private.normalize_legacy_rare_state_20261108(NEW.game_state)),
    NEW.level,NEW.id);
  v_stats:=public.territory_gear_recompute_columns_v4(NEW.game_state);
  IF v_stats<>'{}'::jsonb THEN
    NEW.attack:=(v_stats->>'attack')::integer;
    NEW.defense:=(v_stats->>'defense')::integer;
    NEW.max_hp:=(v_stats->>'max_hp')::integer;
    NEW.crit_chance:=(v_stats->>'crit_chance')::integer;
  END IF;
  -- Real players retain the existing gear/level balance. Only ten
  -- owner-registered synthetic testers may have explicit combat overrides.
  SELECT attack_override,defense_override,hp_override,crit_override
    INTO v_managed FROM territory_private.owner_test_bots_v1 WHERE player_id=NEW.id;
  IF FOUND THEN
    -- Only these ten owner test profiles can carry manually chosen base stats.
    -- Equipped gear always adds actual canonical bonuses on top of that base.
    SELECT coalesce(sum(coalesce((gear.value->>'attack')::int,0)),0),
           coalesce(sum(coalesce((gear.value->>'defense')::int,0)),0),
           coalesce(sum(coalesce((gear.value->>'hp')::int,0)),0),
           coalesce(sum(coalesce((gear.value->>'critChance')::int,0)),0)
      INTO v_att,v_def,v_hp,v_crit
    FROM jsonb_each(CASE WHEN jsonb_typeof(NEW.game_state#>'{player,equipped}')='object'
      THEN NEW.game_state#>'{player,equipped}' ELSE '{}'::jsonb END) gear
    WHERE jsonb_typeof(gear.value)='object';
    NEW.attack:=least(2147483647,greatest(1,coalesce(v_managed.attack_override,NEW.attack-v_att))+v_att);
    NEW.defense:=least(2147483647,greatest(0,coalesce(v_managed.defense_override,NEW.defense-v_def))+v_def);
    NEW.max_hp:=least(2147483647,greatest(1,coalesce(v_managed.hp_override,NEW.max_hp-v_hp))+v_hp);
    NEW.crit_chance:=least(75,greatest(0,coalesce(v_managed.crit_override,NEW.crit_chance-v_crit))+v_crit);
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER territory_gear_guard_before_v4 BEFORE INSERT OR UPDATE OF game_state, attack, defense, max_hp, crit_chance ON public.players FOR EACH ROW EXECUTE FUNCTION territory_gear_guard_v4();

-- territory_hcrafted_masterwork_before_20261113 | territory_private.legacy_crafted_masterwork_save_20261113() | md5=4404915412bf78fb6791f3d0f00c5659
CREATE OR REPLACE FUNCTION territory_private.legacy_crafted_masterwork_save_20261113()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_inventory jsonb; v_equipped jsonb; v_belt jsonb; v_equipped_before jsonb; v_stats jsonb;
BEGIN
 IF NEW.game_state IS NULL OR pg_catalog.jsonb_typeof(NEW.game_state)<>'object'
 OR NOT EXISTS(SELECT 1 FROM territory_private.legacy_crafted_masterwork_ledger_20261113
               WHERE player_id=NEW.id) THEN RETURN NEW; END IF;
 IF pg_catalog.jsonb_typeof(NEW.game_state->'inventory')='array' THEN
   SELECT COALESCE(pg_catalog.jsonb_agg(
      territory_private.legacy_crafted_masterwork_item_20261113(e.value,NEW.id)
      ORDER BY e.ordinality),'[]'::jsonb) INTO v_inventory
   FROM pg_catalog.jsonb_array_elements(NEW.game_state->'inventory')
   WITH ORDINALITY e(value,ordinality);
   NEW.game_state:=pg_catalog.jsonb_set(NEW.game_state,'{inventory}',v_inventory);
 END IF;
 IF pg_catalog.jsonb_typeof(NEW.game_state#>'{player,equipped}')='object' THEN
   v_equipped_before:=NEW.game_state#>'{player,equipped}';
   SELECT COALESCE(pg_catalog.jsonb_object_agg(e.key,
     CASE WHEN pg_catalog.jsonb_typeof(e.value)='object' THEN
       territory_private.legacy_crafted_masterwork_item_20261113(e.value,NEW.id)
     ELSE e.value END),'{}'::jsonb) INTO v_equipped
   FROM pg_catalog.jsonb_each(NEW.game_state#>'{player,equipped}') e;
   NEW.game_state:=pg_catalog.jsonb_set(NEW.game_state,'{player,equipped}',v_equipped);
   -- This specific group has zero synthetic owner-bots; refresh combat
   -- columns only if an equipped legacy piece actually gained stats.
   IF v_equipped IS DISTINCT FROM v_equipped_before THEN
     v_stats:=public.territory_gear_recompute_columns_v4(NEW.game_state);
     IF v_stats<>'{}'::jsonb THEN
       NEW.attack:=(v_stats->>'attack')::integer;
       NEW.defense:=(v_stats->>'defense')::integer;
       NEW.max_hp:=(v_stats->>'max_hp')::integer;
       NEW.crit_chance:=(v_stats->>'crit_chance')::integer;
     END IF;
   END IF;
 END IF;
 IF pg_catalog.jsonb_typeof(NEW.game_state->'belt')='array' THEN
   SELECT COALESCE(pg_catalog.jsonb_agg(
      territory_private.legacy_crafted_masterwork_item_20261113(e.value,NEW.id)
      ORDER BY e.ordinality),'[]'::jsonb) INTO v_belt
   FROM pg_catalog.jsonb_array_elements(NEW.game_state->'belt')
   WITH ORDINALITY e(value,ordinality);
   NEW.game_state:=pg_catalog.jsonb_set(NEW.game_state,'{belt}',v_belt);
 END IF;
 RETURN NEW;
END $function$;
CREATE TRIGGER territory_hcrafted_masterwork_before_20261113 BEFORE UPDATE OF game_state ON public.players FOR EACH ROW EXECUTE FUNCTION territory_private.legacy_crafted_masterwork_save_20261113();

-- territory_inventory_cleanup_guard_v1 | territory_private.inventory_cleanup_save_guard_v1() | md5=079cd4c81b08fff3e13f30c1616d0b66
CREATE OR REPLACE FUNCTION territory_private.inventory_cleanup_save_guard_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF OLD.game_state->>'inventoryCleanupVersion' = '1'
      AND NEW.game_state->>'inventoryCleanupVersion' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'territory_stale_inventory_cleanup_snapshot';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER territory_inventory_cleanup_guard_v1 BEFORE UPDATE OF game_state ON public.players FOR EACH ROW EXECUTE FUNCTION territory_private.inventory_cleanup_save_guard_v1();

-- territory_referral_after_save_v2 | territory_private.referral_after_save_v2() | md5=f8842b0c043987c62f38687535d109ad
CREATE OR REPLACE FUNCTION territory_private.referral_after_save_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF NEW.game_state IS DISTINCT FROM OLD.game_state
    AND EXISTS(SELECT 1 FROM territory_private.referral_invites_v1
      WHERE invited_id=NEW.id AND qualified_at IS NULL)
 THEN PERFORM territory_private.referral_try_qualify_v2(NEW.id); END IF;
 RETURN NEW;
END $function$;
CREATE TRIGGER territory_referral_after_save_v2 AFTER UPDATE OF game_state ON public.players FOR EACH ROW EXECUTE FUNCTION territory_private.referral_after_save_v2();

-- territory_reserve_trial_chest_v1 | territory_private.reserve_trial_chest_v1() | md5=4c6a5ed828a1c50781c1141d41ac9597
CREATE OR REPLACE FUNCTION territory_private.reserve_trial_chest_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE floor_no integer; tier_name text;
BEGIN
 IF NEW.game_state IS NOT DISTINCT FROM OLD.game_state
    OR pg_catalog.jsonb_typeof(OLD.game_state->'trialLevel') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(NEW.game_state->'trialLevel') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(NEW.game_state->'trialChestClaims') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(NEW.game_state->'trialChestUnopenedFloors') IS DISTINCT FROM 'array'
 THEN RETURN NEW; END IF;
 floor_no := (OLD.game_state->>'trialLevel')::integer;
 IF floor_no NOT BETWEEN 1 AND 10000
   OR (NEW.game_state->>'trialLevel')::integer <> floor_no + 1
   OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
       coalesce(OLD.game_state->'trialChestClaims','[]'::jsonb)) v WHERE v.value = floor_no::text)
   OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
       NEW.game_state->'trialChestClaims') v WHERE v.value = floor_no::text)
   OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
       coalesce(OLD.game_state->'trialChestUnopenedFloors','[]'::jsonb)) v WHERE v.value = floor_no::text)
   OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
       NEW.game_state->'trialChestUnopenedFloors') v WHERE v.value = floor_no::text)
 THEN RETURN NEW; END IF;
 tier_name := CASE WHEN floor_no % 25 = 0 THEN 'legendary'
                   WHEN floor_no % 10 = 0 THEN 'guardian'
                   WHEN floor_no % 5 = 0 THEN 'explorer'
                   ELSE 'common' END;
 INSERT INTO territory_private.trial_chest_v1(player_id,floor,tier)
 VALUES (NEW.id,floor_no,tier_name) ON CONFLICT DO NOTHING;
 RETURN NEW;
END; $function$;
CREATE TRIGGER territory_reserve_trial_chest_v1 AFTER UPDATE OF game_state ON public.players FOR EACH ROW EXECUTE FUNCTION territory_private.reserve_trial_chest_v1();

-- trigger_update_leaderboard | update_leaderboard_entry() | md5=4db01791882f5c35e220936d0c5e6895
CREATE OR REPLACE FUNCTION public.update_leaderboard_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
INSERT INTO leaderboard (player_id, display_name, level, arena_rating, total_battles_won, arena_wins,
photo_url, attack, defense, max_hp, crit_chance)
VALUES (NEW.id, NEW.display_name, NEW.level, NEW.arena_rating, NEW.total_battles_won, NEW.arena_wins,
NEW.photo_url, NEW.attack, NEW.defense, NEW.max_hp, NEW.crit_chance)
ON CONFLICT (player_id) DO UPDATE SET
display_name = EXCLUDED.display_name,
level = EXCLUDED.level,
arena_rating = EXCLUDED.arena_rating,
total_battles_won = EXCLUDED.total_battles_won,
arena_wins = EXCLUDED.arena_wins,
photo_url = EXCLUDED.photo_url,
attack = EXCLUDED.attack,
defense = EXCLUDED.defense,
max_hp = EXCLUDED.max_hp,
crit_chance = EXCLUDED.crit_chance,
updated_at = now()
WHERE (leaderboard.display_name, leaderboard.level, leaderboard.arena_rating,
       leaderboard.total_battles_won, leaderboard.arena_wins, leaderboard.photo_url,
       leaderboard.attack, leaderboard.defense, leaderboard.max_hp, leaderboard.crit_chance)
  IS DISTINCT FROM
      (EXCLUDED.display_name, EXCLUDED.level, EXCLUDED.arena_rating,
       EXCLUDED.total_battles_won, EXCLUDED.arena_wins, EXCLUDED.photo_url,
       EXCLUDED.attack, EXCLUDED.defense, EXCLUDED.max_hp, EXCLUDED.crit_chance);
RETURN NEW;
END;
$function$
CREATE TRIGGER trigger_update_leaderboard AFTER INSERT OR UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION update_leaderboard_entry();
