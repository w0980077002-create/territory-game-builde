-- Owner-authorized test equipment. Ordinary heroes remain capped at their own level.
-- No player records or inventory are rewritten by this migration.
-- A grant is authorized only by the service-role RPC called from the existing owner-authenticated admin API.
CREATE TABLE IF NOT EXISTS territory_private.owner_test_gear_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  slot text NOT NULL CHECK (slot IN ('helmet','amulet','armor','weapon','shield','ring','boots')),
  equipment_id text NOT NULL CHECK (length(equipment_id) BETWEEN 1 AND 160),
  target_level integer NOT NULL CHECK (target_level BETWEEN 1 AND 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, slot)
);
ALTER TABLE territory_private.owner_test_gear_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.owner_test_gear_v1 FROM PUBLIC, anon, authenticated;

-- The trusted server, not a client-side JSON marker, decides whether an exception exists.
CREATE OR REPLACE FUNCTION territory_private.owner_cap_item_v1(
  p_item jsonb, p_hero integer, p_player uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog'
AS $owner$
DECLARE
  v_approved integer;
  v_slot text;
  v_id text;
  v_item jsonb;
  v_stats jsonb;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN RETURN p_item; END IF;
  v_slot := p_item->>'slot';
  v_id := p_item->>'id';
  -- The marker is display-only. It has no authority without the private row.
  v_item := p_item - 'adminTestLevel';
  SELECT a.target_level INTO v_approved
    FROM territory_private.owner_test_gear_v1 a
   WHERE a.player_id=p_player AND a.slot=v_slot AND a.equipment_id=v_id;
  IF v_approved IS NULL THEN
    RETURN territory_private.cap_overlevel_item_20261018(v_item,p_hero);
  END IF;
  v_item := jsonb_set(v_item,'{level}',to_jsonb(v_approved),true);
  -- Noncatalogue boss gear must follow its fixed, balanced level curve.
  IF v_item->>'name'='Клинок победителя' AND v_slot='weapon' THEN
    v_stats:=jsonb_build_object('attack',10+v_approved*3,'defense',0,'hp',0);
    v_item:=v_item||v_stats||jsonb_build_object('baseLevel',v_approved,'baseStats',v_stats,'upgradeCount',0);
  ELSIF v_item->>'name'='Доспех воина' AND v_slot='armor' THEN
    v_stats:=jsonb_build_object('attack',0,'defense',5+v_approved*2,'hp',20+v_approved*5);
    v_item:=v_item||v_stats||jsonb_build_object('baseLevel',v_approved,'baseStats',v_stats,'upgradeCount',0);
  END IF;
  -- Reapply existing stat ceilings and balance. Low-level catalog items need
  -- the same proportional scaling as ordinary level-capped epic equipment.
  v_item:=public.territory_normalize_gear_v4(v_item);
  IF (v_slot='weapon' AND v_item->>'name'='Героический меч' AND v_approved<5)
    OR (v_slot='ring' AND v_item->>'name'='Кольцо силы' AND v_approved<5)
    OR (v_slot='weapon' AND v_item->>'name'='Клинок рыцаря' AND v_approved<3)
    OR (v_slot='amulet' AND v_item->>'name'='Амулет ворона' AND v_approved<3)
    OR (v_slot='armor' AND v_item->>'name'='Латные доспехи' AND v_approved<3)
    OR (v_slot='shield' AND v_item->>'name'='Дубовый щит' AND v_approved<2)
    OR (v_slot='boots' AND v_item->>'name'='Сапоги скорости' AND v_approved<2) THEN
    v_item:=territory_private.cap_overlevel_item_20261018(v_item,v_approved);
  END IF;
  RETURN v_item||jsonb_build_object('adminTestLevel',true);
END;
$owner$;

CREATE OR REPLACE FUNCTION territory_private.owner_cap_state_v1(
  p_state jsonb,p_hero integer,p_player uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog'
AS $owner$
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
        THEN territory_private.owner_cap_item_v1(e.value,p_hero,p_player)
        ELSE e.value END),'{}'::jsonb)
      INTO v_equipped FROM jsonb_each(v_state#>'{player,equipped}') e;
    v_state:=jsonb_set(v_state,'{player,equipped}',v_equipped);
  END IF;
  IF jsonb_typeof(v_state->'inventory')='array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(x.value->'equipment')='object'
        THEN jsonb_set(x.value,'{equipment}',
          territory_private.owner_cap_item_v1(x.value->'equipment',p_hero,p_player))
        ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
    INTO v_inventory FROM jsonb_array_elements(v_state->'inventory') WITH ORDINALITY x(value,ord);
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory);
  END IF;
  IF jsonb_typeof(v_state->'belt')='array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(x.value->'equipment')='object'
        THEN jsonb_set(x.value,'{equipment}',
          territory_private.owner_cap_item_v1(x.value->'equipment',p_hero,p_player))
        ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
    INTO v_belt FROM jsonb_array_elements(v_state->'belt') WITH ORDINALITY x(value,ord);
    v_state:=jsonb_set(v_state,'{belt}',v_belt);
  END IF;
  RETURN v_state;
END;
$owner$;

-- Keep the original trigger name and the normalizer unchanged; only replace its private cap path.
CREATE OR REPLACE FUNCTION public.territory_gear_guard_v4()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $owner$
DECLARE v_stats jsonb;
BEGIN
  IF NEW.game_state IS NULL THEN RETURN NEW; END IF;
  NEW.game_state:=territory_private.owner_cap_state_v1(
    public.territory_normalize_state_v4(NEW.game_state),NEW.level,NEW.id);
  v_stats:=public.territory_gear_recompute_columns_v4(NEW.game_state);
  IF v_stats<>'{}'::jsonb THEN
    NEW.attack:=(v_stats->>'attack')::integer;
    NEW.defense:=(v_stats->>'defense')::integer;
    NEW.max_hp:=(v_stats->>'max_hp')::integer;
    NEW.crit_chance:=(v_stats->>'crit_chance')::integer;
  END IF;
  RETURN NEW;
END;
$owner$;

-- Single atomic operation: approve one exact equipped item and create the normal
-- player heartbeat grant. No admin credential or service key ever goes to the client.
CREATE OR REPLACE FUNCTION public.territory_owner_authorize_test_gear_v1(
  p_player uuid,p_slot text,p_level integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $owner$
DECLARE
  v_state jsonb;
  v_item jsonb;
  v_item_id text;
  v_grant uuid;
BEGIN
  IF p_player IS NULL
    OR p_slot NOT IN ('helmet','amulet','armor','weapon','shield','ring','boots')
    OR p_level IS NULL OR p_level NOT BETWEEN 1 AND 500
  THEN RAISE EXCEPTION 'invalid_test_equipment_request'; END IF;
  SELECT game_state INTO v_state FROM public.players
    WHERE id=p_player FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_player_missing'; END IF;
  v_item:=v_state#>ARRAY['player','equipped',p_slot];
  IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
    OR v_item->>'slot' IS DISTINCT FROM p_slot
  THEN RAISE EXCEPTION 'admin_equipment_missing'; END IF;
  v_item_id:=v_item->>'id';
  IF v_item_id IS NULL OR length(v_item_id) NOT BETWEEN 1 AND 160
  THEN RAISE EXCEPTION 'admin_equipment_missing'; END IF;

  INSERT INTO territory_private.owner_test_gear_v1
    (player_id,slot,equipment_id,target_level)
  VALUES (p_player,p_slot,v_item_id,p_level)
  ON CONFLICT(player_id,slot) DO UPDATE SET
    equipment_id=excluded.equipment_id,
    target_level=excluded.target_level,updated_at=now();

  INSERT INTO public.admin_grants(player_id,kind,payload)
  VALUES(p_player,'adjust',
    jsonb_build_object(
      'equipLevels',jsonb_build_object(p_slot,p_level),
      'adminTestLevel',true,
      'adminTestGearId',v_item_id))
  RETURNING id INTO v_grant;

  RETURN jsonb_build_object('grantId',v_grant,'itemName',v_item->>'name',
                           'level',p_level,'slot',p_slot);
END;
$owner$;

-- Explicitly revoke by default: only the server's service-role key may issue test authorizations.
REVOKE ALL ON FUNCTION territory_private.owner_cap_item_v1(jsonb,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION territory_private.owner_cap_state_v1(jsonb,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.territory_owner_authorize_test_gear_v1(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_owner_authorize_test_gear_v1(uuid,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.territory_gear_guard_v4() FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public.territory_owner_authorize_test_gear_v1(uuid,text,integer) IS
  'Owner-authenticated admin API only: authorize a single existing equipped item for controlled test levels through 500.';
