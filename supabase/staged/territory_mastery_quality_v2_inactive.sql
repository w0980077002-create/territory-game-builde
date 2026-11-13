-- TERRITORY mastery-quality v2 — STAGED / NOT APPLIED TO PRODUCTION.
-- Owner-approved 13 Nov 2026. No edits to players, wallets, gear, receipts,
-- catalogues, triggers, forge, RLS or public RPCs.
-- Do not execute on live until full versioned crafting-quality release is reviewed.

BEGIN;
CREATE SCHEMA IF NOT EXISTS territory_private;
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
COMMIT;

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
