-- TERRITORY 1.0 owner test gear: deterministic stats when raising OR lowering
-- an equipped item's level. STAGED: deploy only with reviewed admin tests.
-- The installation changes functions only; it does not rewrite player saves.

BEGIN;

-- A canonical item receipt is needed on EVERY later save, not only the instant
-- admin RPC. Otherwise an older open Telegram tab can overwrite adjusted stats.
ALTER TABLE territory_private.owner_test_gear_v1
  ADD COLUMN IF NOT EXISTS approved_equipment jsonb;

CREATE OR REPLACE FUNCTION territory_private.owner_cap_item_v1(
  p_item jsonb, p_hero integer, p_player uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_approved integer;
  v_saved jsonb;
  v_slot text;
  v_id text;
  v_item jsonb;
  v_stats jsonb;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN RETURN p_item; END IF;
  v_slot:=p_item->>'slot';
  v_id:=p_item->>'id';
  v_item:=p_item-'adminTestLevel';
  SELECT a.target_level,a.approved_equipment INTO v_approved,v_saved
  FROM territory_private.owner_test_gear_v1 a
  WHERE a.player_id=p_player AND a.slot=v_slot AND a.equipment_id=v_id;
  IF v_approved IS NULL THEN
    RETURN territory_private.cap_overlevel_item_20261018(v_item,p_hero);
  END IF;

  IF jsonb_typeof(v_saved)='object'
    AND v_saved->>'id'=v_id AND v_saved->>'slot'=v_slot
    AND v_saved->>'level'=v_approved::text
    AND v_saved->'adminTestLevel'='true'::jsonb
  THEN RETURN v_saved; END IF;

  -- Compatibility for existing approvals made before the receipt column.
  v_item:=jsonb_set(v_item,'{level}',to_jsonb(v_approved),true);
  IF v_item->>'name'='Клинок победителя' AND v_slot='weapon' THEN
    v_stats:=jsonb_build_object('attack',10+v_approved*3,'defense',0,'hp',0);
    v_item:=v_item||v_stats||jsonb_build_object('baseLevel',v_approved,'baseStats',v_stats,'upgradeCount',0);
  ELSIF v_item->>'name'='Доспех воина' AND v_slot='armor' THEN
    v_stats:=jsonb_build_object('attack',0,'defense',5+v_approved*2,'hp',20+v_approved*5);
    v_item:=v_item||v_stats||jsonb_build_object('baseLevel',v_approved,'baseStats',v_stats,'upgradeCount',0);
  END IF;
  v_item:=public.territory_normalize_gear_v4(v_item);
  RETURN territory_private.cap_overlevel_item_20261018(v_item,v_approved)||
    jsonb_build_object('adminTestLevel',true);
END;
$function$;

REVOKE ALL ON FUNCTION territory_private.owner_cap_item_v1(jsonb,integer,uuid)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION territory_private.owner_relevel_item_v2(
  p_item jsonb, p_level integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_item jsonb;
  v_result jsonb;
  v_name text;
  v_slot text;
  v_rarity text;
  v_old_level integer;
  v_base_level integer;
  v_base jsonb;
  v_stats jsonb;
  v_growth jsonb;
  v_key text;
  v_value numeric;
  v_step numeric;
  v_ratio numeric;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object'
    OR p_level IS NULL OR p_level NOT BETWEEN 1 AND 500
    OR (p_item->>'level') !~ '^[0-9]{1,7}$'
  THEN RAISE EXCEPTION 'admin_equipment_invalid_level'; END IF;

  -- Validate the original item at its ORIGINAL level before releveling it.
  -- Normalizing only after replacing level would destroy custom gear's baseline.
  v_item := public.territory_normalize_gear_v4(p_item);
  v_name := v_item->>'name';
  v_slot := v_item->>'slot';
  v_rarity := v_item->>'rarity';
  v_old_level := (v_item->>'level')::integer;
  IF v_slot NOT IN ('weapon','armor','helmet','boots','shield','ring','amulet')
    OR v_rarity NOT IN ('common','rare','epic','legendary')
  THEN RAISE EXCEPTION 'admin_equipment_invalid_type'; END IF;

  v_result := jsonb_set(v_item,'{level}',to_jsonb(p_level),true);

  -- Boss loot is created from the chapter curve, never by scaling the old roll.
  IF v_name='Клинок победителя' AND v_slot='weapon' THEN
    v_stats := jsonb_build_object('attack',10+3*p_level,'defense',0,'hp',0);
    RETURN public.territory_normalize_gear_v4(v_result||v_stats||
      jsonb_build_object('baseLevel',p_level,'baseStats',v_stats,'upgradeCount',0));
  ELSIF v_name='Доспех воина' AND v_slot='armor' THEN
    v_stats := jsonb_build_object('attack',0,'defense',5+2*p_level,'hp',20+5*p_level);
    RETURN public.territory_normalize_gear_v4(v_result||v_stats||
      jsonb_build_object('baseLevel',p_level,'baseStats',v_stats,'upgradeCount',0));
  END IF;

  -- Catalog gear already has a canonical stat formula. Below its starting
  -- level the existing hero-level cap applies proportional base stats.
  IF (v_name,v_slot,v_rarity) IN (
    ('Меч воина','weapon','common'),('Клинок рыцаря','weapon','rare'),
    ('Героический меч','weapon','epic'),('Кожаная броня','armor','common'),
    ('Латные доспехи','armor','rare'),('Железный шлем','helmet','common'),
    ('Сапоги скорости','boots','rare'),('Кольцо силы','ring','epic'),
    ('Дубовый щит','shield','common'),('Амулет ворона','amulet','rare')
  ) THEN
    RETURN territory_private.cap_overlevel_item_20261018(
      public.territory_normalize_gear_v4(v_result),p_level);
  END IF;

  -- The same fixed per-slot/per-rarity upgrade steps as equipmentBalance.ts.
  -- Recomputing from immutable baseStats avoids compounding old rounded stats.
  v_growth := CASE v_slot
    WHEN 'weapon' THEN CASE v_rarity WHEN 'common' THEN '{"attack":1}'::jsonb
      WHEN 'rare' THEN '{"attack":1.5}'::jsonb WHEN 'epic' THEN '{"attack":2}'::jsonb
      ELSE '{"attack":3}'::jsonb END
    WHEN 'ring' THEN CASE v_rarity WHEN 'common' THEN '{"attack":0.5,"hp":0.5}'::jsonb
      WHEN 'rare' THEN '{"attack":0.5,"defense":0.25,"hp":0.75}'::jsonb
      WHEN 'epic' THEN '{"attack":0.75,"defense":0.5,"hp":1}'::jsonb
      ELSE '{"attack":1,"defense":0.5,"hp":1.5}'::jsonb END
    WHEN 'amulet' THEN CASE v_rarity WHEN 'common' THEN '{"attack":0.25,"hp":0.5}'::jsonb
      WHEN 'rare' THEN '{"attack":0.5,"defense":0.25,"hp":0.75}'::jsonb
      WHEN 'epic' THEN '{"attack":0.75,"defense":0.5,"hp":1}'::jsonb
      ELSE '{"attack":1,"defense":0.5,"hp":1.5}'::jsonb END
    WHEN 'armor' THEN CASE v_rarity WHEN 'common' THEN '{"defense":0.25,"hp":1}'::jsonb
      WHEN 'rare' THEN '{"defense":0.5,"hp":1.5}'::jsonb
      WHEN 'epic' THEN '{"defense":0.75,"hp":2}'::jsonb
      ELSE '{"defense":1,"hp":3}'::jsonb END
    WHEN 'helmet' THEN CASE v_rarity WHEN 'common' THEN '{"defense":0.25,"hp":0.5}'::jsonb
      WHEN 'rare' THEN '{"defense":0.25,"hp":0.75}'::jsonb
      WHEN 'epic' THEN '{"defense":0.5,"hp":1}'::jsonb
      ELSE '{"defense":0.5,"hp":1.5}'::jsonb END
    WHEN 'shield' THEN CASE v_rarity WHEN 'common' THEN '{"defense":0.5,"hp":0.5}'::jsonb
      WHEN 'rare' THEN '{"defense":0.5,"hp":0.75}'::jsonb
      WHEN 'epic' THEN '{"defense":0.75,"hp":1}'::jsonb
      ELSE '{"defense":1,"hp":1.5}'::jsonb END
    ELSE CASE v_rarity WHEN 'common' THEN '{"defense":0.25,"hp":0.5}'::jsonb
      WHEN 'rare' THEN '{"defense":0.25,"hp":1}'::jsonb
      WHEN 'epic' THEN '{"defense":0.5,"hp":1.5}'::jsonb
      ELSE '{"defense":0.5,"hp":2}'::jsonb END
  END;

  v_base_level := CASE WHEN (v_item->>'baseLevel') ~ '^[0-9]{1,3}$'
    THEN least(v_old_level,greatest(1,(v_item->>'baseLevel')::integer))
    ELSE v_old_level END;
  v_base := CASE WHEN jsonb_typeof(v_item->'baseStats')='object'
    THEN v_item->'baseStats'
    ELSE jsonb_strip_nulls(jsonb_build_object(
      'attack',v_item->'attack','defense',v_item->'defense',
      'hp',v_item->'hp','critChance',v_item->'critChance')) END;

  v_stats := '{}'::jsonb;
  IF p_level < v_base_level THEN
    -- Historical bespoke gear has no lower-level template. Keep its identity,
    -- reduce actual strength in proportion, and reset the forge baseline.
    v_ratio := p_level::numeric / greatest(1,v_old_level);
    FOREACH v_key IN ARRAY ARRAY['attack','defense','hp','critChance'] LOOP
      IF jsonb_typeof(v_item->v_key)='number' THEN
        v_value := greatest(0,floor((v_item->>v_key)::numeric*v_ratio));
        IF v_key='critChance' THEN v_value := least(25,v_value); END IF;
        v_stats := v_stats||jsonb_build_object(v_key,v_value);
      END IF;
    END LOOP;
    v_base_level := p_level;
    v_base := v_stats;
  ELSE
    FOREACH v_key IN ARRAY ARRAY['attack','defense','hp','critChance'] LOOP
      IF jsonb_typeof(v_base->v_key)='number' THEN
        v_value := (v_base->>v_key)::numeric;
        v_step := coalesce((v_growth->>v_key)::numeric,0);
        IF v_key <> 'critChance' AND v_value>0 THEN
          v_value := v_value+round(v_step*(p_level-v_base_level));
        END IF;
        v_stats := v_stats||jsonb_build_object(v_key,greatest(0,v_value));
      END IF;
    END LOOP;
  END IF;

  v_result := v_result-'attack'-'defense'-'hp'-'critChance'||v_stats||
    jsonb_build_object('baseLevel',v_base_level,'baseStats',v_base,
      'upgradeCount',p_level-v_base_level);
  -- Server-level slot ceilings still apply to any noncatalogue equipment.
  RETURN public.territory_normalize_gear_v4(v_result);
END;
$function$;

REVOKE ALL ON FUNCTION territory_private.owner_relevel_item_v2(jsonb,integer)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_owner_apply_test_gear_v2(
  p_player uuid, p_slot text, p_level integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_grant jsonb;
  v_item jsonb;
  v_relevelled jsonb;
  v_combat jsonb;
  v_grant_id uuid;
BEGIN
  -- Authorization locks the player row, binds approval to ONE existing item ID
  -- and creates the one-time client synchronization grant in this transaction.
  v_grant := public.territory_owner_authorize_test_gear_v1(p_player,p_slot,p_level);
  v_grant_id := (v_grant->>'grantId')::uuid;
  -- The same item can be adjusted repeatedly. Clear the previous snapshot so
  -- the trigger cannot override the new stats with yesterday's approval.
  UPDATE territory_private.owner_test_gear_v1
    SET approved_equipment=NULL
    WHERE player_id=p_player AND slot=p_slot;
  SELECT game_state#>ARRAY['player','equipped',p_slot] INTO v_item
    FROM public.players WHERE id=p_player FOR UPDATE;
  v_relevelled := territory_private.owner_relevel_item_v2(v_item,p_level);

  -- Write the WHOLE stat-adjusted item. Updating only its `level` first caused
  -- the BEFORE UPDATE normalizer to lose custom gear's old baseline and stats.
  UPDATE public.players
    SET game_state=jsonb_set(game_state,ARRAY['player','equipped',p_slot],
      v_relevelled,false)
  WHERE id=p_player
  RETURNING game_state#>ARRAY['player','equipped',p_slot],
    jsonb_build_object('attack',attack,'defense',defense,'hp',max_hp,
                      'critChance',crit_chance)
    INTO v_item,v_combat;

  IF v_item IS NULL OR (v_item->>'level')::integer IS DISTINCT FROM p_level
    OR v_item->>'adminTestLevel' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'admin_test_gear_apply_failed'; END IF;

  UPDATE territory_private.owner_test_gear_v1
    SET approved_equipment=v_item
    WHERE player_id=p_player AND slot=p_slot
      AND equipment_id=v_item->>'id' AND target_level=p_level;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_test_gear_approval_missing'; END IF;

  UPDATE public.admin_grants
    SET payload=payload||jsonb_build_object('adminTestEquipment',v_item)
  WHERE id=v_grant_id AND player_id=p_player AND claimed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_test_gear_grant_missing'; END IF;

  RETURN v_grant||jsonb_build_object('applied',true,
    'gear',jsonb_build_object('level',(v_item->>'level')::integer,
      'attack',coalesce((v_item->>'attack')::numeric,0),
      'defense',coalesce((v_item->>'defense')::numeric,0),
      'hp',coalesce((v_item->>'hp')::numeric,0),
      'critChance',coalesce((v_item->>'critChance')::numeric,0)),
    'combat',v_combat);
END;
$function$;

REVOKE ALL ON FUNCTION public.territory_owner_apply_test_gear_v2(uuid,text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_owner_apply_test_gear_v2(uuid,text,integer)
  TO service_role;

COMMIT;
