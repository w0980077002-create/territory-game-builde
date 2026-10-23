-- Narrow production-ready permission reduction. No player data is changed.
-- Verified 2026-10-21: current React client uses players.game_state; Telegram
-- signup initializes player_inventory using server-side service_role.
-- DO NOT revoke the player game_state write path in this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
DO $preflight$
BEGIN
 IF to_regclass('public.player_inventory') IS NULL THEN
  RAISE EXCEPTION 'territory_player_inventory_missing';
 END IF;
 IF EXISTS (
   SELECT 1 FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','territory_private')
     AND p.prosrc ILIKE '%player_inventory%'
 ) THEN
  RAISE EXCEPTION 'territory_inventory_function_dependency_requires_review';
 END IF;
END $preflight$;

-- Old client direct writes to this legacy inventory table are unnecessary.
-- Keep authenticated own-inventory SELECT and existing RLS policies.
REVOKE ALL ON TABLE public.player_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.player_inventory TO authenticated;
COMMIT;

-- Reversible if unexpectedly required by a legacy client:
-- GRANT INSERT, UPDATE, DELETE ON TABLE public.player_inventory TO authenticated;
-- Original broad privileges of anon/auth must NOT be restored casually.
