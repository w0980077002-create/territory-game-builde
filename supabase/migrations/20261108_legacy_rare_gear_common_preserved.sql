-- TERRITORY 2026-11-08: historical boss loot rarity normalization.
-- No items or balances are updated by this DDL; player backup is stored separately.
-- Existing common and already-rare loot are deliberately excluded.
-- Bought epic shop equipment is NOT subject to migration.
CREATE OR REPLACE FUNCTION territory_private.normalize_legacy_rare_gear_20261108(eq jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog'
AS $rare_gear$
DECLARE
 v_level integer;
 v_base integer;
 v_steps integer;
 v_base_stats jsonb;
 v_changed jsonb;
 v_attack numeric;
 v_defense numeric;
 v_hp numeric;
 v_crit numeric;
 v_is_weapon boolean;
 v_is_armor boolean;
BEGIN
 IF jsonb_typeof(eq) IS DISTINCT FROM 'object' THEN RETURN eq; END IF;
 IF (eq->>'level') !~ '^[1-9][0-9]{0,2}$' THEN RETURN eq; END IF;
 v_level:=(eq->>'level')::integer;
 IF v_level>500 THEN RETURN eq; END IF;
 v_is_weapon:=(eq->>'name'='Клинок победителя' AND eq->>'slot'='weapon');
 v_is_armor:=(eq->>'name'='Доспех воина' AND eq->>'slot'='armor');

 IF eq->>'id' LIKE 'loot_%' AND (v_is_weapon OR v_is_armor)
   AND (eq->>'rarity' IN ('epic','legendary') OR eq->'legacyRarityBalanced'='true'::jsonb)
 THEN
   IF (eq->>'baseLevel') ~ '^[1-9][0-9]{0,2}$' THEN
     v_base:=greatest(1,least(v_level,(eq->>'baseLevel')::integer));
   ELSIF (eq->>'upgradeCount') ~ '^[0-9]{1,3}$' THEN
     v_base:=greatest(1,v_level-(eq->>'upgradeCount')::integer);
   ELSE
     v_base:=v_level;
   END IF;
   v_steps:=v_level-v_base;
   IF v_is_weapon THEN
     v_attack:=greatest(1,18+round(1.5*(v_base-3)));
     v_base_stats:=jsonb_build_object('attack',v_attack);
     v_changed:=jsonb_build_object('attack',v_attack+round(1.5*v_steps));
   ELSE
     v_defense:=greatest(1,12+round(0.5*(v_base-3)));
     v_hp:=greatest(1,80+round(1.5*(v_base-3)));
     v_base_stats:=jsonb_build_object('defense',v_defense,'hp',v_hp);
     v_changed:=jsonb_build_object('defense',v_defense+round(0.5*v_steps),
       'hp',v_hp+round(1.5*v_steps));
   END IF;
   RETURN eq || jsonb_build_object('rarity','rare','baseLevel',v_base,
       'baseStats',v_base_stats,'upgradeCount',v_steps,
       'legacyRarityBalanced',true) || v_changed;
 END IF;

 -- Only NEW rare shop offers are normalized. Previously purchased epic
 -- shop equipment keeps its epic rarity and full historic stats.
 IF eq->>'rarity'='rare'
   AND ((eq->>'name'='Героический меч' AND eq->>'slot'='weapon')
     OR (eq->>'name'='Кольцо силы' AND eq->>'slot'='ring'))
 THEN
   IF eq->>'slot'='weapon' THEN
     v_attack:=22;
     v_crit:=4;
   ELSE
     v_attack:=10;
     v_crit:=3;
   END IF;
   IF v_level<5 THEN
     v_attack:=round(v_attack*v_level/5.0);
     v_crit:=round(v_crit*v_level/5.0);
     v_base:=v_level;
     v_steps:=0;
   ELSE
     v_base:=5;
     v_steps:=v_level-5;
   END IF;
   v_base_stats:=jsonb_build_object('attack',v_attack,'critChance',v_crit);
   v_attack:=v_attack + round(
     CASE WHEN eq->>'slot'='weapon' THEN 1.5 ELSE 0.5 END *v_steps);
   RETURN eq || jsonb_build_object('rarity','rare','attack',v_attack,
      'critChance',v_crit,'baseLevel',v_base,'baseStats',v_base_stats,
      'upgradeCount',v_steps);
 END IF;
 RETURN eq;
END
$rare_gear$;

CREATE OR REPLACE FUNCTION territory_private.normalize_legacy_rare_item_20261108(item jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog'
AS $rare_item$
DECLARE v_before jsonb; v_after jsonb; v_result jsonb;
BEGIN
 IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'equipment') IS DISTINCT FROM 'object'
 THEN RETURN item; END IF;
 v_before:=item->'equipment';
 v_after:=territory_private.normalize_legacy_rare_gear_20261108(v_before);
 IF v_after=v_before THEN RETURN item; END IF;
 v_result:=jsonb_set(item,'{equipment}',v_after);
 v_result:=jsonb_set(v_result,'{rarity}',to_jsonb(v_after->>'rarity'),true);
 IF item->>'description' ~ '^Уровень [0-9]+ · (epic|legendary)$' THEN
   v_result:=jsonb_set(v_result,'{description}',to_jsonb('Уровень '||(v_after->>'level')||' · rare'),true);
 END IF;
 RETURN v_result;
END
$rare_item$;

CREATE OR REPLACE FUNCTION territory_private.normalize_legacy_rare_state_20261108(input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog'
AS $rare_state$
DECLARE
 v_state jsonb:=input; v_equipped jsonb; v_inventory jsonb; v_belt jsonb;
BEGIN
 IF jsonb_typeof(v_state) IS DISTINCT FROM 'object'
   OR jsonb_typeof(v_state->'player') IS DISTINCT FROM 'object'
 THEN RETURN input; END IF;
 IF jsonb_typeof(v_state#>'{player,equipped}')='object' THEN
   SELECT coalesce(jsonb_object_agg(e.key,
     CASE WHEN jsonb_typeof(e.value)='object'
       THEN territory_private.normalize_legacy_rare_gear_20261108(e.value)
       ELSE e.value END),'{}'::jsonb)
   INTO v_equipped FROM jsonb_each(v_state#>'{player,equipped}') e;
   v_state:=jsonb_set(v_state,'{player,equipped}',v_equipped);
 END IF;
 IF jsonb_typeof(v_state->'inventory')='array' THEN
   SELECT coalesce(jsonb_agg(territory_private.normalize_legacy_rare_item_20261108(a.value)
     ORDER BY a.ord),'[]'::jsonb)
   INTO v_inventory FROM jsonb_array_elements(v_state->'inventory') WITH ORDINALITY a(value,ord);
   v_state:=jsonb_set(v_state,'{inventory}',v_inventory);
 END IF;
 IF jsonb_typeof(v_state->'belt')='array' THEN
   SELECT coalesce(jsonb_agg(
     CASE WHEN jsonb_typeof(a.value)='object'
       THEN territory_private.normalize_legacy_rare_item_20261108(a.value)
       ELSE a.value END ORDER BY a.ord),'[]'::jsonb)
   INTO v_belt FROM jsonb_array_elements(v_state->'belt') WITH ORDINALITY a(value,ord);
   v_state:=jsonb_set(v_state,'{belt}',v_belt);
 END IF;
 RETURN v_state;
END
$rare_state$;

-- Preserve the original hero-level cap, owner-only test overrides, canonical
-- server stat recalculation, and all server security rules.
CREATE OR REPLACE FUNCTION public.territory_gear_guard_v4()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $rare_guard$
DECLARE v_stats jsonb;
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
  RETURN NEW;
END
$rare_guard$;
REVOKE ALL ON FUNCTION territory_private.normalize_legacy_rare_gear_20261108(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION territory_private.normalize_legacy_rare_item_20261108(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION territory_private.normalize_legacy_rare_state_20261108(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.territory_gear_guard_v4() FROM PUBLIC,anon,authenticated;
