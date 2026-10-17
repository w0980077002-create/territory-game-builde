-- TERRITORY one-time inventory clean-up preparation.
-- PRIVATE, non-exposed functions. Nothing is removed by this file.
CREATE SCHEMA IF NOT EXISTS territory_private;

CREATE OR REPLACE FUNCTION territory_private.inventory_power_v1(eq jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog'
AS $$
 SELECT
   4 * COALESCE(CASE WHEN jsonb_typeof(eq->'attack')='number' THEN (eq->>'attack')::numeric END, 0) +
   3 * COALESCE(CASE WHEN jsonb_typeof(eq->'defense')='number' THEN (eq->>'defense')::numeric END, 0) +
   0.10 * COALESCE(CASE WHEN jsonb_typeof(eq->'hp')='number' THEN (eq->>'hp')::numeric END, 0) +
   12 * COALESCE(CASE WHEN jsonb_typeof(eq->'critChance')='number' THEN (eq->>'critChance')::numeric END, 0);
$$;

-- Protect forged, unknown/custom, malformed or stacked equipment.
-- Only canonical shop gear and ordinary unmodified boss loot may be recycled.
CREATE OR REPLACE FUNCTION territory_private.inventory_protected_v1(item jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog'
AS $$
DECLARE e jsonb := item->'equipment';
DECLARE s text := e->>'slot';
BEGIN
  IF item->>'type' IS DISTINCT FROM 'equipment' OR jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RETURN true; END IF;
  IF s NOT IN ('helmet','amulet','armor','weapon','shield','ring','boots') OR s IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(e->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(e->'name') IS DISTINCT FROM 'string' THEN RETURN true; END IF;
  IF (e->>'level') !~ '^[0-9]{1,7}$' THEN RETURN true; END IF;
  IF jsonb_typeof(item->'qty') IS DISTINCT FROM 'number' OR (item->>'qty')::numeric <> 1 THEN RETURN true; END IF;
  IF (e->>'upgradeCount') ~ '^[0-9]{1,7}$' AND (e->>'upgradeCount')::numeric > 0 THEN RETURN true; END IF;
  IF (e->>'baseLevel') ~ '^[0-9]{1,7}$' AND (e->>'level')::numeric > (e->>'baseLevel')::numeric THEN RETURN true; END IF;
  IF (e->>'id') LIKE 'loot_%' AND
     ((e->>'name' = 'Клинок победителя' AND s='weapon') OR
      (e->>'name' = 'Доспех воина' AND s='armor')) THEN RETURN false; END IF;
  IF (e->>'name', s, e->>'rarity') IN (
      ('Меч воина','weapon','common'),('Клинок рыцаря','weapon','rare'),
      ('Героический меч','weapon','epic'),('Кожаная броня','armor','common'),
      ('Латные доспехи','armor','rare'),('Железный шлем','helmet','common'),
      ('Сапоги скорости','boots','rare'),('Кольцо силы','ring','epic'),
      ('Дубовый щит','shield','common'),('Амулет ворона','amulet','rare')
  ) THEN RETURN false; END IF;
  RETURN true;
END;
$$;

-- Retain ALL equipped items unchanged (these live outside inventory).
-- Retain all non-equipment items and forged/unique items.
-- Of ordinary spare gear, retain only ONE best per slot if it beats the worn
-- item; if no item is worn in that slot, retain the best candidate.
CREATE OR REPLACE FUNCTION territory_private.trim_inventory_v1(state jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog'
AS $$
DECLARE
  item jsonb; e jsonb; worn jsonb;
  slot text; pos bigint;
  power numeric; old_power numeric; best_positions jsonb := '{}'::jsonb;
  best_scores jsonb := '{}'::jsonb;
  kept jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(state) IS DISTINCT FROM 'object'
      OR jsonb_typeof(state->'inventory') IS DISTINCT FROM 'array'
      OR jsonb_typeof(state->'player'->'equipped') IS DISTINCT FROM 'object'
  THEN RETURN state; END IF;
  FOR item, pos IN SELECT value, ordinality FROM jsonb_array_elements(state->'inventory') WITH ORDINALITY LOOP
    IF item->>'type' IS DISTINCT FROM 'equipment' OR
       territory_private.inventory_protected_v1(item) THEN CONTINUE; END IF;
    e := item->'equipment';
    slot := e->>'slot';
    worn := state #> ARRAY['player', 'equipped', slot];
    power := territory_private.inventory_power_v1(e);
    IF jsonb_typeof(worn) = 'object' AND
       power <= territory_private.inventory_power_v1(worn) THEN CONTINUE; END IF;
    IF best_positions ? slot THEN
      old_power := (best_scores->>slot)::numeric;
      IF power <= old_power THEN CONTINUE; END IF;
    END IF;
    best_positions := best_positions || jsonb_build_object(slot, pos);
    best_scores := best_scores || jsonb_build_object(slot, power);
  END LOOP;
  FOR item, pos IN SELECT value, ordinality FROM jsonb_array_elements(state->'inventory') WITH ORDINALITY LOOP
    IF item->>'type' IS DISTINCT FROM 'equipment' OR
       territory_private.inventory_protected_v1(item) OR
       best_positions->>(item->'equipment'->>'slot') = pos::text
    THEN kept := kept || jsonb_build_array(item); END IF;
  END LOOP;
  RETURN jsonb_set(state,'{inventory}',kept) || jsonb_build_object('inventoryCleanupVersion',1);
END;
$$;

-- A pre-cleanup cached tab must NOT replay an entire old inventory.
-- This is in addition to the existing updated_at compare-and-swap save guard.
CREATE OR REPLACE FUNCTION territory_private.inventory_cleanup_save_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF OLD.game_state->>'inventoryCleanupVersion' = '1'
      AND NEW.game_state->>'inventoryCleanupVersion' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'territory_stale_inventory_cleanup_snapshot';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS territory_inventory_cleanup_guard_v1 ON public.players;
CREATE TRIGGER territory_inventory_cleanup_guard_v1
BEFORE UPDATE OF game_state ON public.players FOR EACH ROW
EXECUTE FUNCTION territory_private.inventory_cleanup_save_guard_v1();

REVOKE ALL ON FUNCTION territory_private.inventory_power_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION territory_private.inventory_protected_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION territory_private.trim_inventory_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION territory_private.inventory_cleanup_save_guard_v1() FROM PUBLIC, anon, authenticated;
