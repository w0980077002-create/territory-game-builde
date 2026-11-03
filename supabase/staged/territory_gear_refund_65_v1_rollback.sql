-- Safe reversible disablement of staged #253. Player data and any existing
-- refund receipts are deliberately RETAINED for audit and possible re-enable.
-- This does not revoke/refund previously credited player materials.
DROP TRIGGER IF EXISTS territory_capture_forge_spend_65_v1 ON public.players;
DROP FUNCTION IF EXISTS territory_private.capture_forge_spend_65_v1();
DROP FUNCTION IF EXISTS public.territory_forge_refund_quote_65_v1(text);
DROP FUNCTION IF EXISTS public.territory_inventory_recycle_refund_65_v1(text,timestamptz);
-- DO NOT DROP territory_private.forge_upgrade_receipts_65_v1.
