-- Disable batch salvage #253 without touching ANY player, ledger, or refunded materials.
DROP FUNCTION IF EXISTS public.territory_inventory_batch_salvage_253(text[],timestamptz);
DROP FUNCTION IF EXISTS public.territory_inventory_batch_quote_253();
DROP FUNCTION IF EXISTS territory_private.batch_salvage_candidate_253(uuid,jsonb);
