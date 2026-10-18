-- Permanent production safeguard for TERRITORY. Already installed on 2026-10-18.
-- Every player save caps worn, bag and belt equipment level to NEW.level;
-- authentic item identity, player level, wallet, achievements and inventory count remain intact.
-- IMPORTANT: main server gear guard must run AFTER its existing v4 normalization.
-- Idempotent on redeployment; no player UPDATE in this migration.

CREATE OR REPLACE FUNCTION territory_private.cap_overlevel_item_20261018(p_item jsonb, p_hero_level integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_old_level integer;
  v_level integer := greatest(1,least(500,coalesce(p_hero_level,1)));
  v_target integer;
  v_name text;
  v_slot text;
  v_rarity text;
  v_catalog_base integer;
  v_ratio numeric;
  v_item jsonb;
  v_stats jsonb;
  v_key text;
  v_value numeric;
BEGIN
 IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN RETURN p_item; END IF;
 IF (p_item->>'level') !~ '^[0-9]{1,6}$' THEN RETURN p_item; END IF;
 v_old_level:=(p_item->>'level')::integer;
 v_target:=least(v_level,v_old_level);
 v_name:=p_item->>'name';
 v_slot:=p_item->>'slot';
 v_rarity:=p_item->>'rarity';

 v_catalog_base:=CASE
   WHEN (v_name,v_slot,v_rarity) IN (('Меч воина','weapon','common'),('Кожаная броня','armor','common'),('Железный шлем','helmet','common')) THEN 1
   WHEN (v_name,v_slot,v_rarity) IN (('Дубовый щит','shield','common'),('Сапоги скорости','boots','rare')) THEN 2
   WHEN (v_name,v_slot,v_rarity) IN (('Клинок рыцаря','weapon','rare'),('Латные доспехи','armor','rare'),('Амулет ворона','amulet','rare')) THEN 3
   WHEN (v_name,v_slot,v_rarity) IN (('Героический меч','weapon','epic'),('Кольцо силы','ring','epic')) THEN 5
   ELSE NULL END;

 -- Every other normal-level piece remains byte-for-byte unchanged.
 IF v_old_level <= v_level AND (v_catalog_base IS NULL OR v_old_level>=v_catalog_base)
 THEN RETURN p_item; END IF;

 v_item:=jsonb_set(p_item,'{level}',to_jsonb(v_target),true);

 IF v_catalog_base IS NOT NULL THEN
   v_item:=public.territory_normalize_gear_v4(v_item);
   -- A level-1 hero buying a level-5 epic must NOT receive level-5 stats.
   -- Server normalizer builds canonical catalog stats; proportionally cap below template minimum.
   IF v_target < v_catalog_base THEN
     v_ratio:=v_target::numeric / v_catalog_base;
     v_stats:='{}'::jsonb;
     FOREACH v_key IN ARRAY ARRAY['attack','defense','hp','critChance'] LOOP
       IF jsonb_typeof(v_item->v_key)='number' THEN
         v_value:=greatest(0,round((v_item->>v_key)::numeric*v_ratio));
         v_item:=jsonb_set(v_item,ARRAY[v_key],to_jsonb(v_value),true);
         v_stats:=v_stats||jsonb_build_object(v_key,v_value);
       END IF;
     END LOOP;
     v_item:=v_item||jsonb_build_object(
       'baseLevel',v_target,'baseStats',v_stats,'upgradeCount',0);
   END IF;
   RETURN v_item;
 END IF;

 IF v_name='Клинок победителя' AND v_slot='weapon' THEN
   v_stats:=jsonb_build_object('attack',10+v_target*3,'defense',0,'hp',0);
   v_item:=v_item||v_stats;
 ELSIF v_name='Доспех воина' AND v_slot='armor' THEN
   v_stats:=jsonb_build_object('attack',0,'defense',5+v_target*2,'hp',20+v_target*5);
   v_item:=v_item||v_stats;
 ELSE
   -- Unknown custom equipment: scale stats rather than leaving inflated values.
   v_ratio:=v_target::numeric/greatest(1,v_old_level);
   v_stats:='{}'::jsonb;
   FOREACH v_key IN ARRAY ARRAY['attack','defense','hp','critChance'] LOOP
     IF jsonb_typeof(p_item->v_key)='number' THEN
       v_value:=greatest(0,round((p_item->>v_key)::numeric*v_ratio));
       v_item:=jsonb_set(v_item,ARRAY[v_key],to_jsonb(v_value),true);
       v_stats:=v_stats||jsonb_build_object(v_key,v_value);
     END IF;
   END LOOP;
 END IF;
 v_item:=v_item||jsonb_build_object(
   'baseLevel',v_target,'baseStats',v_stats,'upgradeCount',0);
 -- Reapply canonical per-slot ceilings, including any unusual custom stats.
 RETURN public.territory_normalize_gear_v4(v_item);
END;
$function$


CREATE OR REPLACE FUNCTION territory_private.cap_overlevel_state_20261018(p_state jsonb, p_hero_level integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
 v_state jsonb:=p_state;
 v_equipped jsonb;
 v_inventory jsonb;
 v_belt jsonb;
BEGIN
 IF jsonb_typeof(v_state) IS DISTINCT FROM 'object'
 OR jsonb_typeof(v_state->'player') IS DISTINCT FROM 'object' THEN
  RETURN p_state;
 END IF;
 IF jsonb_typeof(v_state#>'{player,equipped}')='object' THEN
  SELECT coalesce(jsonb_object_agg(e.key,
    CASE WHEN jsonb_typeof(e.value)='object'
    THEN territory_private.cap_overlevel_item_20261018(e.value,p_hero_level)
    ELSE e.value END),'{}'::jsonb)
  INTO v_equipped FROM jsonb_each(v_state#>'{player,equipped}') e;
  v_state:=jsonb_set(v_state,'{player,equipped}',v_equipped);
 END IF;
 IF jsonb_typeof(v_state->'inventory')='array' THEN
  SELECT coalesce(jsonb_agg(
    CASE WHEN jsonb_typeof(x.value->'equipment')='object'
    THEN jsonb_set(x.value,'{equipment}',territory_private.cap_overlevel_item_20261018(x.value->'equipment',p_hero_level))
    ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
  INTO v_inventory
  FROM jsonb_array_elements(v_state->'inventory') WITH ORDINALITY x(value,ord);
  v_state:=jsonb_set(v_state,'{inventory}',v_inventory);
 END IF;
 IF jsonb_typeof(v_state->'belt')='array' THEN
  SELECT coalesce(jsonb_agg(
    CASE WHEN jsonb_typeof(x.value->'equipment')='object'
    THEN jsonb_set(x.value,'{equipment}',territory_private.cap_overlevel_item_20261018(x.value->'equipment',p_hero_level))
    ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
  INTO v_belt
  FROM jsonb_array_elements(v_state->'belt') WITH ORDINALITY x(value,ord);
  v_state:=jsonb_set(v_state,'{belt}',v_belt);
 END IF;
 RETURN v_state;
END;
$function$


CREATE OR REPLACE FUNCTION public.territory_gear_guard_v4()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_stats jsonb;
BEGIN
  IF NEW.game_state IS NULL THEN RETURN NEW; END IF;
  NEW.game_state:=territory_private.cap_overlevel_state_20261018(
    public.territory_normalize_state_v4(NEW.game_state),NEW.level);
  v_stats:=public.territory_gear_recompute_columns_v4(NEW.game_state);
  IF v_stats<>'{}'::jsonb THEN
    NEW.attack:=(v_stats->>'attack')::integer;
    NEW.defense:=(v_stats->>'defense')::integer;
    NEW.max_hp:=(v_stats->>'max_hp')::integer;
    NEW.crit_chance:=(v_stats->>'crit_chance')::integer;
  END IF;
  RETURN NEW;
END;
$function$


DROP TRIGGER IF EXISTS territory_gear_guard_before_v4 ON public.players;
CREATE TRIGGER territory_gear_guard_before_v4
BEFORE INSERT OR UPDATE OF game_state, attack, defense, max_hp, crit_chance ON public.players
FOR EACH ROW EXECUTE FUNCTION public.territory_gear_guard_v4();
REVOKE ALL ON FUNCTION territory_private.cap_overlevel_item_20261018(jsonb,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION territory_private.cap_overlevel_state_20261018(jsonb,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.territory_gear_guard_v4() FROM PUBLIC;
COMMENT ON FUNCTION public.territory_gear_guard_v4() IS
 'Always normalize gear and cap it to hero level before recomputing combat stats.';
