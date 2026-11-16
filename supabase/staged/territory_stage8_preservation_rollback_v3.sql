-- Quiesce writers first. A fail-closed hold prevents the restored legacy
-- normalizer from touching Stage8 gear. Do not remove the hold manually.
-- This restores CODE ONLY. It never reverses ownership, receipts or upgrades.
BEGIN;
LOCK TABLE public.players IN SHARE ROW EXCLUSIVE MODE;
DO $rollback$
DECLARE v_backup record;
BEGIN
  FOR v_backup IN SELECT * FROM territory_private.stage8_guard_backup_v3 ORDER BY signature LOOP
    IF pg_get_functiondef(v_backup.signature::regprocedure) IS DISTINCT FROM v_backup.activated_definition
      THEN RAISE EXCEPTION 'stage8_guard_changed_after_activation'; END IF;
    EXECUTE v_backup.definition;
  END LOOP;
END $rollback$;
-- A code rollback must not reintroduce silent corruption on the next login.
CREATE OR REPLACE FUNCTION territory_private.stage8_hold_v3() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $hold$
BEGIN
  IF EXISTS(SELECT 1 FROM public.territory_profession_stage8_items i
    WHERE i.player_id=NEW.id AND i.item_output->>'type'='equipment')
    OR position('"stage8_' IN coalesce(NEW.game_state::text,''))>0
    THEN RAISE EXCEPTION 'stage8_maintenance_hold'; END IF;
  RETURN NEW;
END $hold$;
REVOKE ALL ON FUNCTION territory_private.stage8_hold_v3() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER aaa_stage8_maintenance_hold_v3 BEFORE INSERT OR UPDATE OF game_state, attack, defense, max_hp, crit_chance ON public.players
FOR EACH ROW EXECUTE FUNCTION territory_private.stage8_hold_v3();
DROP TABLE territory_private.stage8_guard_backup_v3;
COMMIT;
