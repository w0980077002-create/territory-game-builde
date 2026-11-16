-- TERRITORY #366: server-authoritative Stage8 forge.
-- Apply only after PG17 integration tests and production preflight. Never remove
-- client fail-closed behavior until this RPC has been installed successfully.
-- Old registry items and player snapshots are not mass-migrated.
CREATE TABLE IF NOT EXISTS territory_private.stage8_forge_receipts_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  item_id uuid NOT NULL,
  expected_level integer NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY(player_id,operation_id)
);
ALTER TABLE territory_private.stage8_forge_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.stage8_forge_receipts_v1 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_stage8_forge_v1(
  p_item uuid, p_expected_level integer, p_operation uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $forge$
DECLARE
  v_uid uuid:=auth.uid();
  v_player public.players%ROWTYPE;
  v_item public.territory_profession_stage8_items%ROWTYPE;
  v_prior territory_private.stage8_forge_receipts_v1%ROWTYPE;
  v_state jsonb;
  v_gear jsonb;
  v_after jsonb;
  v_base jsonb;
  v_output jsonb;
  v_mirror jsonb;
  v_id text;
  v_slot text;
  v_rarity text;
  v_base_level integer;
  v_level integer;
  v_steps integer;
  v_position integer;
  v_found integer;
  v_equipped_count integer;
  v_equipped_key text;
  v_cost_gold integer;
  v_cost_mat integer;
  v_gold integer;
  v_mat integer;
  v_attack_growth numeric:=0;
  v_def_growth numeric:=0;
  v_hp_growth numeric:=0;
  v_key text;
  v_growth numeric;
  v_success boolean;
  v_result jsonb;
  v_chance numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'stage8_forge_not_authenticated'; END IF;
  IF public.territory_stage8_forge_ready_v1() IS DISTINCT FROM true
    THEN RAISE EXCEPTION 'stage8_forge_save_guard_inactive'; END IF;
  IF p_item IS NULL OR p_operation IS NULL OR p_expected_level IS NULL OR p_expected_level NOT BETWEEN 1 AND 499
  THEN RAISE EXCEPTION 'stage8_forge_bad_request'; END IF;

  -- Stable lock order: owner -> operation -> item, across retries/devices.
  SELECT * INTO v_player FROM public.players WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND OR v_player.banned THEN RAISE EXCEPTION 'stage8_forge_player_unavailable'; END IF;
  SELECT * INTO v_prior FROM territory_private.stage8_forge_receipts_v1
  WHERE player_id=v_uid AND operation_id=p_operation;
  IF FOUND THEN
    IF v_prior.item_id<>p_item OR v_prior.expected_level<>p_expected_level
    THEN RAISE EXCEPTION 'stage8_forge_operation_conflict'; END IF;
    RETURN v_prior.result
      || pg_catalog.jsonb_build_object(
        'replayed',true,'updated_at',v_player.updated_at,
        'wallet_gold',v_player.gold,'wallet_gems',v_player.gems,
        'game_state',v_player.game_state);
  END IF;

  SELECT * INTO v_item FROM public.territory_profession_stage8_items
  WHERE item_id=p_item AND player_id=v_uid FOR UPDATE;
  IF NOT FOUND OR v_item.item_output->>'type'<>'equipment'
    OR pg_catalog.jsonb_typeof(v_item.item_output->'equipment')<>'object'
  THEN RAISE EXCEPTION 'stage8_forge_item_not_owned'; END IF;
  -- A frozen historical UUID cannot be forged from the stale registry
  -- level, even when the caller guesses p_expected_level=registry level.
  IF EXISTS(SELECT 1 FROM territory_private.stage8_historical_quarantine_v1 q
      WHERE q.item_id=p_item AND q.player_id=v_uid)
    THEN RAISE EXCEPTION 'stage8_historical_item_forge_on_hold'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(
    CASE WHEN pg_catalog.jsonb_typeof(v_player.game_state->'inventory')='array'
      THEN v_player.game_state->'inventory' ELSE '[]'::jsonb END) x(value)
    WHERE pg_catalog.left(x.value->>'id',4)='inv_'
      AND x.value#>>'{equipment,id}'='stage8_'||p_item::text)
  THEN RAISE EXCEPTION 'stage8_legacy_alias_forge_on_hold'; END IF;
  v_gear:=v_item.item_output->'equipment';
  v_id:='stage8_'||p_item::text;
  IF (v_gear->>'level') IS NULL OR (v_gear->>'level') !~ '^[1-9][0-9]{0,2}$'
  THEN RAISE EXCEPTION 'stage8_forge_bad_registry'; END IF;
  v_level:=(v_gear->>'level')::integer;
  IF pg_catalog.jsonb_typeof(v_gear->'baseStats')='object'
    AND (v_gear->>'baseLevel') ~ '^[1-9][0-9]{0,2}$'
    AND (v_gear->>'upgradeCount') ~ '^[0-9]{1,3}$'
  THEN
    v_base:=v_gear->'baseStats';
    v_base_level:=(v_gear->>'baseLevel')::integer;
  ELSIF NOT (v_gear ? 'baseStats' OR v_gear ? 'baseLevel'
    OR v_gear ? 'upgradeCount') THEN
    -- Older Stage8 registry items have no immutable baseStats. Establish a
    -- baseline from the SERVER registry's actual stats and current level.
    -- Divergent client mirrors still fail below; never trust them as authority.
    v_base:='{}'::jsonb;
    FOREACH v_key IN ARRAY ARRAY['attack','defense','hp','critChance'] LOOP
      IF pg_catalog.jsonb_typeof(v_gear->v_key)='number' THEN
        v_base:=v_base||pg_catalog.jsonb_build_object(v_key,v_gear->v_key);
      END IF;
    END LOOP;
    IF v_base='{}'::jsonb THEN RAISE EXCEPTION 'stage8_forge_bad_registry'; END IF;
    v_base_level:=v_level;
    v_gear:=v_gear||pg_catalog.jsonb_build_object(
      'baseStats',v_base,'baseLevel',v_level,'upgradeCount',0);
  ELSE
    RAISE EXCEPTION 'stage8_forge_partial_registry';
  END IF;
  IF v_level<>p_expected_level OR v_level>=v_player.level OR v_level>=500
    OR v_base_level>v_level
    OR (v_gear->>'upgradeCount')::integer <> v_level-v_base_level
  THEN RAISE EXCEPTION 'stage8_forge_level_conflict'; END IF;
  v_slot:=v_gear->>'slot';
  v_rarity:=v_gear->>'rarity';
  IF v_slot IS NULL OR v_rarity IS NULL
    OR v_slot NOT IN('weapon','ring','amulet','armor','helmet','shield','boots')
    OR v_rarity NOT IN('common','rare','epic','legendary')
    OR v_gear->>'name' IS DISTINCT FROM v_item.item_output->>'name'
    OR v_rarity IS DISTINCT FROM v_item.item_output->>'rarity'
  THEN RAISE EXCEPTION 'stage8_forge_invalid_gear'; END IF;

  v_state:=v_player.game_state;
  IF pg_catalog.jsonb_typeof(v_state->'inventory') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(v_state#>'{player,equipped}') IS DISTINCT FROM 'object'
    OR (v_state#>>'{player,gold}')::integer IS DISTINCT FROM v_player.gold
    OR (v_state->>'forgeMaterials')::integer IS DISTINCT FROM v_player.forge_materials
  THEN RAISE EXCEPTION 'stage8_forge_save_unavailable'; END IF;
  SELECT pg_catalog.count(*),pg_catalog.min(x.ordinality)::integer-1
  INTO v_found,v_position
  FROM pg_catalog.jsonb_array_elements(v_state->'inventory') WITH ORDINALITY x(value,ordinality)
  WHERE x.value->>'id'=v_id;
  SELECT pg_catalog.count(*),pg_catalog.min(e.key)
  INTO v_equipped_count,v_equipped_key
  FROM pg_catalog.jsonb_each(v_state#>'{player,equipped}') e
  WHERE e.value->>'id'=v_id;
  IF v_found+v_equipped_count<>1
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(
          CASE WHEN pg_catalog.jsonb_typeof(v_state->'belt')='array'
            THEN v_state->'belt' ELSE '[]'::jsonb END) b
        WHERE b.value->>'id'=v_id OR b.value#>>'{equipment,id}'=v_id)>0
  THEN RAISE EXCEPTION 'stage8_forge_mirror_missing_or_duplicate'; END IF;
  IF v_found=1 THEN
    v_mirror:=v_state#>ARRAY['inventory',v_position::text,'equipment'];
  ELSE
    v_mirror:=v_state#>ARRAY['player','equipped',v_equipped_key];
  END IF;
  IF pg_catalog.jsonb_typeof(v_mirror)<>'object'
    OR (v_mirror->>'level')::integer<>v_level
    OR v_mirror->>'slot' IS DISTINCT FROM v_slot
    OR v_mirror->>'rarity' IS DISTINCT FROM v_rarity
  THEN RAISE EXCEPTION 'stage8_forge_reconcile_required'; END IF;

  v_cost_gold:=50+v_level*30;
  v_cost_mat:=1+v_level/3;
  IF v_player.gold IS NULL OR v_player.forge_materials IS NULL
    OR v_player.gold<v_cost_gold OR v_player.forge_materials<v_cost_mat
  THEN RAISE EXCEPTION 'stage8_forge_insufficient_resources'; END IF;
  v_gold:=v_player.gold-v_cost_gold;
  v_mat:=v_player.forge_materials-v_cost_mat;
  v_chance:=greatest(0.5::numeric,0.9::numeric-v_level*0.05::numeric);
  v_success:=pg_catalog.random()<v_chance;
  v_steps:=v_level+1-v_base_level;

  -- Same linear forge curve as equipmentBalance.ts / FORGE_STAT_GROWTH.
  -- Per-stat value starts from immutable crafted baseStats, never shop stats.
  v_attack_growth:=CASE v_slot
    WHEN 'weapon' THEN CASE v_rarity WHEN 'common' THEN 1 WHEN 'rare' THEN 1.5 WHEN 'epic' THEN 2 ELSE 3 END
    WHEN 'ring' THEN CASE v_rarity WHEN 'common' THEN 0.5 WHEN 'rare' THEN 0.5 WHEN 'epic' THEN 0.75 ELSE 1 END
    WHEN 'amulet' THEN CASE v_rarity WHEN 'common' THEN 0.25 WHEN 'rare' THEN 0.5 WHEN 'epic' THEN 0.75 ELSE 1 END
    ELSE 0 END;
  v_def_growth:=CASE v_slot
    WHEN 'ring' THEN CASE v_rarity WHEN 'common' THEN 0 WHEN 'rare' THEN 0.25 WHEN 'epic' THEN 0.5 ELSE 0.5 END
    WHEN 'amulet' THEN CASE v_rarity WHEN 'common' THEN 0 WHEN 'rare' THEN 0.25 WHEN 'epic' THEN 0.5 ELSE 0.5 END
    WHEN 'armor' THEN CASE v_rarity WHEN 'common' THEN 0.25 WHEN 'rare' THEN 0.5 WHEN 'epic' THEN 0.75 ELSE 1 END
    WHEN 'helmet' THEN CASE v_rarity WHEN 'common' THEN 0.25 WHEN 'rare' THEN 0.25 WHEN 'epic' THEN 0.5 ELSE 0.5 END
    WHEN 'shield' THEN CASE v_rarity WHEN 'common' THEN 0.5 WHEN 'rare' THEN 0.5 WHEN 'epic' THEN 0.75 ELSE 1 END
    WHEN 'boots' THEN CASE v_rarity WHEN 'common' THEN 0.25 WHEN 'rare' THEN 0.25 WHEN 'epic' THEN 0.5 ELSE 0.5 END
    ELSE 0 END;
  v_hp_growth:=CASE v_slot
    WHEN 'ring' THEN CASE v_rarity WHEN 'common' THEN 0.5 WHEN 'rare' THEN 0.75 WHEN 'epic' THEN 1 ELSE 1.5 END
    WHEN 'amulet' THEN CASE v_rarity WHEN 'common' THEN 0.5 WHEN 'rare' THEN 0.75 WHEN 'epic' THEN 1 ELSE 1.5 END
    WHEN 'armor' THEN CASE v_rarity WHEN 'common' THEN 1 WHEN 'rare' THEN 1.5 WHEN 'epic' THEN 2 ELSE 3 END
    WHEN 'helmet' THEN CASE v_rarity WHEN 'common' THEN 0.5 WHEN 'rare' THEN 0.75 WHEN 'epic' THEN 1 ELSE 1.5 END
    WHEN 'shield' THEN CASE v_rarity WHEN 'common' THEN 0.5 WHEN 'rare' THEN 0.75 WHEN 'epic' THEN 1 ELSE 1.5 END
    WHEN 'boots' THEN CASE v_rarity WHEN 'common' THEN 0.5 WHEN 'rare' THEN 1 WHEN 'epic' THEN 1.5 ELSE 2 END
    ELSE 0 END;

  IF v_success THEN
    v_after:=v_gear||pg_catalog.jsonb_build_object('level',v_level+1,'upgradeCount',v_steps);
    FOREACH v_key IN ARRAY ARRAY['attack','defense','hp'] LOOP
      IF pg_catalog.jsonb_typeof(v_base->v_key)='number' THEN
        v_growth:=CASE v_key WHEN 'attack' THEN v_attack_growth
          WHEN 'defense' THEN v_def_growth ELSE v_hp_growth END;
        v_after:=pg_catalog.jsonb_set(v_after,ARRAY[v_key],
          pg_catalog.to_jsonb(CASE WHEN (v_base->>v_key)::numeric<=0
            THEN (v_base->>v_key)::numeric
            ELSE (v_base->>v_key)::numeric+pg_catalog.round(v_growth*v_steps) END),true);
      END IF;
    END LOOP;
    IF pg_catalog.jsonb_typeof(v_base->'critChance')='number' THEN
      v_after:=pg_catalog.jsonb_set(v_after,'{critChance}',v_base->'critChance',true);
    END IF;
    -- Registry baseStats are trusted server state. The save guard preserves
    -- their curve; legacy shop ceilings must not rewrite certified quality.
    v_output:=pg_catalog.jsonb_set(v_item.item_output,'{equipment}',v_after,true);
    IF pg_catalog.jsonb_typeof(v_item.item_output->'description')='string' THEN
      v_output:=pg_catalog.jsonb_set(v_output,'{description}',
        pg_catalog.to_jsonb(pg_catalog.replace(
          v_item.item_output->>'description',
          'Уровень вещи '||v_level||'.',
          'Уровень вещи '||(v_level+1)||'.')),true);
    END IF;
    UPDATE public.territory_profession_stage8_items
      SET item_output=v_output WHERE item_id=p_item AND player_id=v_uid;
    v_after:=v_after||pg_catalog.jsonb_build_object('id',v_id);
    IF v_found=1 THEN
      v_state:=pg_catalog.jsonb_set(v_state,
        ARRAY['inventory',v_position::text,'equipment'],v_after,false);
      v_state:=pg_catalog.jsonb_set(v_state,
        ARRAY['inventory',v_position::text,'description'],
        pg_catalog.to_jsonb(pg_catalog.replace(
          v_state#>>ARRAY['inventory',v_position::text,'description'],
          'Уровень вещи '||v_level||'.','Уровень вещи '||(v_level+1)||'.')),true);
    ELSE
      v_state:=pg_catalog.jsonb_set(v_state,
        ARRAY['player','equipped',v_equipped_key],v_after,false);
    END IF;
  ELSE
    -- Failed rolls retain the exact registry record, including legacy gear
    -- whose immutable baseline is established only on a successful upgrade.
    v_after:=territory_private.stage8_verified_gear_v2(
      (v_item.item_output->'equipment')||pg_catalog.jsonb_build_object('id',v_id),v_uid);
  END IF;
  v_state:=pg_catalog.jsonb_set(v_state,'{player,gold}',pg_catalog.to_jsonb(v_gold),true);
  v_state:=pg_catalog.jsonb_set(v_state,'{forgeMaterials}',pg_catalog.to_jsonb(v_mat),true);
  UPDATE public.players SET gold=v_gold,forge_materials=v_mat,game_state=v_state
    WHERE id=v_uid RETURNING * INTO v_player;

  IF v_player.gold IS DISTINCT FROM v_gold OR v_player.forge_materials IS DISTINCT FROM v_mat
    OR (v_player.game_state#>>'{player,gold}')::integer IS DISTINCT FROM v_gold
    OR (v_player.game_state->>'forgeMaterials')::integer IS DISTINCT FROM v_mat
  THEN RAISE EXCEPTION 'stage8_forge_save_not_committed'; END IF;
  IF v_found=1 THEN
    SELECT x.value->'equipment' INTO v_mirror
      FROM pg_catalog.jsonb_array_elements(v_player.game_state->'inventory') x
      WHERE x.value->>'id'=v_id;
  ELSE
    v_mirror:=v_player.game_state#>ARRAY['player','equipped',v_equipped_key];
  END IF;
  IF v_mirror IS DISTINCT FROM v_after
  THEN RAISE EXCEPTION 'stage8_forge_result_normalized'; END IF;
  v_result:=pg_catalog.jsonb_build_object(
    'success',true,'replayed',false,'item_id',p_item,'level_before',v_level,
    'level_after',CASE WHEN v_success THEN v_level+1 ELSE v_level END,
    'upgraded',v_success,'cost_gold',v_cost_gold,'cost_materials',v_cost_mat);
  INSERT INTO territory_private.stage8_forge_receipts_v1
    (player_id,operation_id,item_id,expected_level,result)
  VALUES(v_uid,p_operation,p_item,p_expected_level,v_result);
  RETURN v_result||pg_catalog.jsonb_build_object(
    'updated_at',v_player.updated_at,'wallet_gold',v_player.gold,
    'wallet_gems',v_player.gems,'game_state',v_player.game_state);
END $forge$;

REVOKE ALL ON FUNCTION public.territory_stage8_forge_v1(uuid,integer,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_stage8_forge_v1(uuid,integer,uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.territory_stage8_forge_ready_v1()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'pg_catalog'
AS $ready$
  SELECT coalesce(auth.uid() IS NOT NULL
    AND position('territory_private.stage8_preserve_state_v3(NEW.game_state,NEW.level,NEW.id)'
      IN pg_get_functiondef(to_regprocedure('public.territory_gear_guard_v4()')))>0
    AND position('territory_private.stage8_verified_gear_v2(p_item,p_player)'
      IN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='territory_private' AND p.proname='owner_cap_item_v1'
          AND p.pronargs=3 AND p.proargtypes[0]='jsonb'::regtype
          AND p.proargtypes[1]='integer'::regtype AND p.proargtypes[2]='uuid'::regtype))>0,false);
$ready$;
REVOKE ALL ON FUNCTION public.territory_stage8_forge_ready_v1()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_stage8_forge_ready_v1()
  TO authenticated;
