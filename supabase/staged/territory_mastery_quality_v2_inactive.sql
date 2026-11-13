-- TERRITORY mastery-quality v2 — STAGED / NOT APPLIED TO PRODUCTION.
-- Owner-approved 13 Nov 2026. No edits to players, wallets, gear, receipts,
-- catalogues, triggers, forge, RLS or public RPCs.
-- Do not execute on live until full versioned crafting-quality release is reviewed.

BEGIN;
CREATE SCHEMA IF NOT EXISTS territory_private;
CREATE OR REPLACE FUNCTION territory_private.territory_mastery_quality_pct_v2(
  p_mastery integer, p_has_master_license boolean
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = 'pg_catalog'
AS $quality$
BEGIN
  IF p_mastery IS NULL OR p_mastery NOT BETWEEN 1 AND 300
    OR p_has_master_license IS NULL
    THEN RAISE EXCEPTION 'invalid_mastery_or_license'; END IF;
  RETURN CASE
    WHEN p_mastery >= 300 AND p_has_master_license THEN 160
    WHEN p_mastery >= 250 THEN 130
    WHEN p_mastery >= 200 THEN 110
    WHEN p_mastery >= 150 THEN 90
    WHEN p_mastery >= 100 THEN 70
    WHEN p_mastery >= 50 THEN 50
    WHEN p_mastery >= 25 THEN 35
    ELSE 20 END;
END
$quality$;
REVOKE ALL ON FUNCTION territory_private.territory_mastery_quality_pct_v2(integer,boolean)
  FROM PUBLIC,anon,authenticated;
COMMIT;
