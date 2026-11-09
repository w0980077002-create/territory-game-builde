-- TERRITORY: Forge materials are permanent. This is a backward-compatible
-- server adapter for legacy RPCs that require forgeMaterialBatches.
-- NEVER delete old material quantities or rewrite other player progress.
-- 9999-12-31 is a non-gameplay sentinel, not an expiration date.
CREATE OR REPLACE FUNCTION territory_private.keep_forge_materials_permanent_20261109()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
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

DROP TRIGGER IF EXISTS territory_forge_material_permanent_20261109 ON public.players;
CREATE TRIGGER territory_forge_material_permanent_20261109
BEFORE INSERT OR UPDATE OF game_state, forge_materials ON public.players
FOR EACH ROW
EXECUTE FUNCTION territory_private.keep_forge_materials_permanent_20261109();

-- Snapshot every field other than the legacy material lots and timestamp.
-- If ANY gameplay value or authoritative material balance changes during the
-- backfill, abort the transaction instead of silently altering a player's save.
CREATE TEMP TABLE territory_forge_material_before_20261109 ON COMMIT DROP AS
SELECT id, game_state - 'forgeMaterialBatches' AS other_game_state,
  to_jsonb(p) - 'game_state' - 'updated_at' AS other_columns
FROM public.players p WHERE jsonb_typeof(game_state) = 'object';

UPDATE public.players p
SET game_state = game_state
WHERE jsonb_typeof(p.game_state) = 'object'
  AND p.game_state->'forgeMaterialBatches' IS DISTINCT FROM
    (CASE WHEN coalesce(p.forge_materials, 0) > 0
      THEN jsonb_build_array(jsonb_build_object(
        'qty', p.forge_materials, 'expiresAt', '9999-12-31T23:59:59.000Z'))
      ELSE '[]'::jsonb END);

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM territory_forge_material_before_20261109 b
    JOIN public.players p ON p.id = b.id
    WHERE p.game_state - 'forgeMaterialBatches' IS DISTINCT FROM b.other_game_state
       OR (to_jsonb(p) - 'game_state' - 'updated_at') IS DISTINCT FROM b.other_columns
  ) THEN
    RAISE EXCEPTION 'permanent_forge_migration_changed_player_progress';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.players p
    WHERE jsonb_typeof(p.game_state) = 'object'
      AND p.game_state->'forgeMaterialBatches' IS DISTINCT FROM
        (CASE WHEN coalesce(p.forge_materials, 0) > 0
          THEN jsonb_build_array(jsonb_build_object(
            'qty', p.forge_materials, 'expiresAt', '9999-12-31T23:59:59.000Z'))
          ELSE '[]'::jsonb END)
  ) THEN
    RAISE EXCEPTION 'permanent_forge_migration_wallet_not_reconciled';
  END IF;
END;
$verify$;
