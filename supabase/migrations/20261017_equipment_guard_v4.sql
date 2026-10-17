-- TERRITORY equipment safety, 2026-10-17. BACKUP WAS TAKEN FIRST:
-- territory_private.gear_pre_normalize_20261017 (43 complete records).
-- Safe to run repeatedly. No deletion or reallocation of levels, wallet, gear or wins.
--
-- Important: the client still sends a complete game_state; normalization MUST happen
-- on the server on EVERY write, otherwise a stale tab can restore million-stat gear.

CREATE OR REPLACE FUNCTION public.territory_normalize_gear_v4(eq jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_name text; v_slot text; v_rarity text; v_level int;
  v_template record; v_found boolean := false;
  v_base jsonb := '{}'::jsonb;
  v_attack numeric; v_defense numeric; v_hp numeric; v_crit numeric;
  v_attack_limit numeric; v_defense_limit numeric; v_hp_limit numeric;
  v_result jsonb; v_oldbase jsonb;
  v_changed boolean := false;
BEGIN
  IF jsonb_typeof(eq) IS DISTINCT FROM 'object' THEN RETURN eq; END IF;
  v_name := eq->>'name'; v_slot := eq->>'slot'; v_rarity := eq->>'rarity';
  v_level := greatest(1, least(500,
    CASE WHEN (eq->>'level') ~ '^[0-9]{1,7}$' THEN (eq->>'level')::integer ELSE 1 END));
  v_result := eq;
  -- Source of truth: src/game/equipmentCatalog.ts + src/game/equipmentBalance.ts.
  -- baseLevel, base atk/def/hp/crit, per-upgrade growth atk/def/hp.
  SELECT * INTO v_template FROM (VALUES
    ('Меч воина','weapon','common',1,8::numeric,NULL::numeric,NULL::numeric,NULL::numeric,1::numeric,0::numeric,0::numeric),
    ('Клинок рыцаря','weapon','rare',3,18::numeric,NULL::numeric,NULL::numeric,3::numeric,1.5::numeric,0::numeric,0::numeric),
    ('Героический меч','weapon','epic',5,35::numeric,NULL::numeric,NULL::numeric,8::numeric,2::numeric,0::numeric,0::numeric),
    ('Кожаная броня','armor','common',1,NULL::numeric,5::numeric,30::numeric,NULL::numeric,0::numeric,0.25::numeric,1::numeric),
    ('Латные доспехи','armor','rare',3,NULL::numeric,12::numeric,80::numeric,NULL::numeric,0::numeric,0.5::numeric,1.5::numeric),
    ('Железный шлем','helmet','common',1,NULL::numeric,3::numeric,20::numeric,NULL::numeric,0::numeric,0.25::numeric,0.5::numeric),
    ('Сапоги скорости','boots','rare',2,NULL::numeric,4::numeric,40::numeric,2::numeric,0::numeric,0.25::numeric,1::numeric),
    ('Кольцо силы','ring','epic',5,15::numeric,NULL::numeric,NULL::numeric,5::numeric,0.75::numeric,0.5::numeric,1::numeric),
    ('Дубовый щит','shield','common',2,NULL::numeric,5::numeric,25::numeric,NULL::numeric,0::numeric,0.5::numeric,0.5::numeric),
    ('Амулет ворона','amulet','rare',3,6::numeric,NULL::numeric,NULL::numeric,3::numeric,0.5::numeric,0.25::numeric,0.75::numeric)
  ) AS t(name,slot,rarity,base_level,base_attack,base_defense,base_hp,base_crit,g_attack,g_defense,g_hp)
  WHERE t.name=v_name AND t.slot=v_slot AND t.rarity=v_rarity LIMIT 1;
  v_found := FOUND;
  IF v_found THEN
    -- Rebuild all familiar store items on the linear forge curve; same item,
    -- same displayed level/rarity/id, but never old exponential multipliers.
    -- Do not introduce nonexistent stats (e.g. attack on boots).
    v_result := v_result - 'attack' - 'defense' - 'hp' - 'critChance'
      - 'baseStats' - 'baseLevel' - 'upgradeCount';
    IF v_template.base_attack IS NOT NULL THEN
      v_base := v_base || jsonb_build_object('attack',v_template.base_attack);
      v_result := v_result || jsonb_build_object('attack',
        v_template.base_attack + round(v_template.g_attack * greatest(0,v_level-v_template.base_level)));
    END IF;
    IF v_template.base_defense IS NOT NULL THEN
      v_base := v_base || jsonb_build_object('defense',v_template.base_defense);
      v_result := v_result || jsonb_build_object('defense',
        v_template.base_defense + round(v_template.g_defense * greatest(0,v_level-v_template.base_level)));
    END IF;
    IF v_template.base_hp IS NOT NULL THEN
      v_base := v_base || jsonb_build_object('hp',v_template.base_hp);
      v_result := v_result || jsonb_build_object('hp',
        v_template.base_hp + round(v_template.g_hp * greatest(0,v_level-v_template.base_level)));
    END IF;
    IF v_template.base_crit IS NOT NULL THEN
      v_base := v_base || jsonb_build_object('critChance',v_template.base_crit);
      v_result := v_result || jsonb_build_object('critChance',v_template.base_crit);
    END IF;
    v_result := v_result || jsonb_build_object('baseLevel',v_template.base_level,
      'baseStats',v_base,'upgradeCount',greatest(0,v_level-v_template.base_level));
    RETURN v_result;
  END IF;

  -- Uncatalogued items (legitimate boss drops or custom gear) are preserved
  -- unless above GENEROUS level/slot-based ceilings. Also clamp poisoned
  -- baseStats, which could otherwise reintroduce a huge forge result.
  v_attack_limit := CASE WHEN v_slot='weapon' THEN 40+6*v_level
     WHEN v_slot IN ('ring','amulet') THEN 20+4*v_level ELSE 10+2*v_level END;
  v_defense_limit := CASE WHEN v_slot IN ('armor','shield','helmet','boots') THEN 10+5*v_level ELSE 10+3*v_level END;
  v_hp_limit := CASE WHEN v_slot='armor' THEN 50+12*v_level
     WHEN v_slot IN ('boots','shield','helmet') THEN 40+10*v_level ELSE 25+5*v_level END;
  v_attack := CASE WHEN jsonb_typeof(eq->'attack')='number' THEN greatest(0,least((eq->>'attack')::numeric,v_attack_limit)) ELSE NULL END;
  v_defense := CASE WHEN jsonb_typeof(eq->'defense')='number' THEN greatest(0,least((eq->>'defense')::numeric,v_defense_limit)) ELSE NULL END;
  v_hp := CASE WHEN jsonb_typeof(eq->'hp')='number' THEN greatest(0,least((eq->>'hp')::numeric,v_hp_limit)) ELSE NULL END;
  v_crit := CASE WHEN jsonb_typeof(eq->'critChance')='number' THEN greatest(0,least((eq->>'critChance')::numeric,25)) ELSE NULL END;
  IF v_attack IS NOT NULL THEN v_result := jsonb_set(v_result,'{attack}',to_jsonb(v_attack)); END IF;
  IF v_defense IS NOT NULL THEN v_result := jsonb_set(v_result,'{defense}',to_jsonb(v_defense)); END IF;
  IF v_hp IS NOT NULL THEN v_result := jsonb_set(v_result,'{hp}',to_jsonb(v_hp)); END IF;
  IF v_crit IS NOT NULL THEN v_result := jsonb_set(v_result,'{critChance}',to_jsonb(v_crit)); END IF;
  v_changed := (v_result IS DISTINCT FROM eq);
  v_oldbase := eq->'baseStats';
  IF jsonb_typeof(v_oldbase)='object' AND (
      coalesce((v_oldbase->>'attack')::numeric,0)>v_attack_limit OR
      coalesce((v_oldbase->>'defense')::numeric,0)>v_defense_limit OR
      coalesce((v_oldbase->>'hp')::numeric,0)>v_hp_limit OR
      coalesce((v_oldbase->>'critChance')::numeric,0)>25) THEN
    v_changed := true;
  END IF;
  IF v_changed THEN
    v_base := '{}'::jsonb;
    IF v_attack IS NOT NULL THEN v_base := v_base || jsonb_build_object('attack',v_attack); END IF;
    IF v_defense IS NOT NULL THEN v_base := v_base || jsonb_build_object('defense',v_defense); END IF;
    IF v_hp IS NOT NULL THEN v_base := v_base || jsonb_build_object('hp',v_hp); END IF;
    IF v_crit IS NOT NULL THEN v_base := v_base || jsonb_build_object('critChance',v_crit); END IF;
    v_result := v_result || jsonb_build_object('baseLevel',v_level,'baseStats',v_base,'upgradeCount',0);
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.territory_normalize_state_v4(input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_state jsonb:=input; v_player jsonb; v_eq jsonb; v_inventory jsonb; v_belt jsonb;
BEGIN
  IF jsonb_typeof(v_state) IS DISTINCT FROM 'object'
   OR jsonb_typeof(v_state->'player') IS DISTINCT FROM 'object' THEN RETURN input; END IF;
  v_player:=v_state->'player';
  IF jsonb_typeof(v_player->'equipped')='object' THEN
    SELECT coalesce(jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='object'
      THEN public.territory_normalize_gear_v4(e.value) ELSE e.value END),'{}'::jsonb)
    INTO v_eq FROM jsonb_each(v_player->'equipped') e;
    v_player:=jsonb_set(v_player,'{equipped}',v_eq);
  END IF;
  IF jsonb_typeof(v_state->'inventory')='array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(x.value->'equipment')='object'
        THEN jsonb_set(x.value,'{equipment}',public.territory_normalize_gear_v4(x.value->'equipment'))
        ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
    INTO v_inventory FROM jsonb_array_elements(v_state->'inventory') WITH ORDINALITY x(value,ord);
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory);
  END IF;
  IF jsonb_typeof(v_state->'belt')='array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(x.value->'equipment')='object'
        THEN jsonb_set(x.value,'{equipment}',public.territory_normalize_gear_v4(x.value->'equipment'))
        ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
    INTO v_belt FROM jsonb_array_elements(v_state->'belt') WITH ORDINALITY x(value,ord);
    v_state:=jsonb_set(v_state,'{belt}',v_belt);
  END IF;
  -- Legitimate baseline stats are determined by player level, not client data.
  -- Level itself is NOT changed; this prevents forged base stats restoring damage.
  v_player:=jsonb_set(v_player,'{stats}',
    coalesce(v_player->'stats','{}'::jsonb) || jsonb_build_object(
      'maxHp',100+20*greatest(0,least(500,coalesce((v_player->>'level')::int,1))-1),
      'hp',100+20*greatest(0,least(500,coalesce((v_player->>'level')::int,1))-1),
      'attack',20+5*greatest(0,least(500,coalesce((v_player->>'level')::int,1))-1),
      'defense',5+2*greatest(0,least(500,coalesce((v_player->>'level')::int,1))-1),
      'critChance',5,'critDamage',50));
  v_state:=jsonb_set(v_state,'{player}',v_player);
  v_state:=jsonb_set(v_state,'{balanceVersion}','4'::jsonb,true);
  RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.territory_gear_recompute_columns_v4(input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog'
AS $$
DECLARE v_eq jsonb; v_base jsonb; v_att numeric; v_def numeric; v_hp numeric; v_crit numeric;
BEGIN
 IF jsonb_typeof(input->'player') IS DISTINCT FROM 'object' THEN RETURN '{}'::jsonb; END IF;
 v_base:=input->'player'->'stats';
 SELECT coalesce(sum(coalesce((x.value->>'attack')::numeric,0)),0),
        coalesce(sum(coalesce((x.value->>'defense')::numeric,0)),0),
        coalesce(sum(coalesce((x.value->>'hp')::numeric,0)),0),
        coalesce(sum(coalesce((x.value->>'critChance')::numeric,0)),0)
 INTO v_att,v_def,v_hp,v_crit
 FROM jsonb_each(coalesce(input->'player'->'equipped','{}'::jsonb)) x
 WHERE jsonb_typeof(x.value)='object';
 RETURN jsonb_build_object(
   'attack',least(2147483647,coalesce((v_base->>'attack')::numeric,20)+v_att)::int,
   'defense',least(2147483647,coalesce((v_base->>'defense')::numeric,5)+v_def)::int,
   'max_hp',least(2147483647,coalesce((v_base->>'maxHp')::numeric,100)+v_hp)::int,
   'crit_chance',least(75,coalesce((v_base->>'critChance')::numeric,5)+v_crit)::int);
END;
$$;

CREATE OR REPLACE FUNCTION public.territory_gear_guard_v4()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
DECLARE v_stats jsonb;
BEGIN
  IF NEW.game_state IS NULL THEN RETURN NEW; END IF;
  -- Also correct direct attempts to write a forged attack/HP/defense snapshot
  -- while leaving game_state unchanged; do not trust client summary columns.
  NEW.game_state:=public.territory_normalize_state_v4(NEW.game_state);
  v_stats:=public.territory_gear_recompute_columns_v4(NEW.game_state);
  IF v_stats<>'{}'::jsonb THEN
    NEW.attack:=(v_stats->>'attack')::integer;
    NEW.defense:=(v_stats->>'defense')::integer;
    NEW.max_hp:=(v_stats->>'max_hp')::integer;
    NEW.crit_chance:=(v_stats->>'crit_chance')::integer;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS territory_gear_guard_before_v4 ON public.players;
CREATE TRIGGER territory_gear_guard_before_v4
BEFORE INSERT OR UPDATE OF game_state, attack, defense, max_hp, crit_chance ON public.players
FOR EACH ROW EXECUTE FUNCTION public.territory_gear_guard_v4();

REVOKE ALL ON FUNCTION public.territory_normalize_gear_v4(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.territory_normalize_state_v4(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.territory_gear_recompute_columns_v4(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.territory_gear_guard_v4() FROM PUBLIC;
COMMENT ON FUNCTION public.territory_gear_guard_v4() IS 'Normalizes all equipped and inventory gear on INSERT/UPDATE before snapshot persists; prevents reverting to exponential stats.';
