-- Emergency rollback for ADDITIVE r4 masterworks ONLY, not a player wipe.
-- REQUIRES ZERO crafted masterwork items/receipts. Otherwise REFUSE rollback
-- and keep the catalogs intact so players retain their server-owned gear.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE v_new integer;
BEGIN
  IF EXISTS(SELECT 1 FROM public.territory_profession_stage8_items
            WHERE recipe_id LIKE 'mw_%')
    OR EXISTS(SELECT 1 FROM public.territory_profession_stage8_receipts
            WHERE recipe_id LIKE 'mw_%')
  THEN RAISE EXCEPTION 'masterwork_owned_items_or_receipts_exist_refuse_rollback'; END IF;
  SELECT count(*) INTO v_new FROM public.territory_profession_stage8_catalog
    WHERE id LIKE 'mw_%';
  IF v_new<>25 THEN RAISE EXCEPTION 'unexpected_masterwork_catalog_count_%',v_new; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_release
    WHERE id=1 AND enabled=true AND version='profession-stage8-draft-20261025-r2')
  THEN RAISE EXCEPTION 'refuse_rollback_without_live_r2'; END IF;
END $$;
DELETE FROM public.territory_profession_stage8_catalog WHERE id LIKE 'mw_%';
DROP FUNCTION IF EXISTS public.territory_profession_masterworks_ready();
DO $$
BEGIN
 IF (SELECT count(*) FROM public.territory_profession_stage8_catalog)<>72
 THEN RAISE EXCEPTION 'masterwork_rollback_old_72_not_preserved'; END IF;
END $$;
COMMIT;
-- Never delete user inventory, receipts, player progress, VIP or wallets.
