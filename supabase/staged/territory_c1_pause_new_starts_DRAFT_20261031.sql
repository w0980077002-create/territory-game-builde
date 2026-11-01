-- TERRITORY C1-core: operational rollback phase A / pause new Cave starts only.
-- DRAFT FOR PG17 CLONE TESTING. DO NOT EXECUTE ON PRODUCTION WITHOUT SEPARATE APPROVAL.
-- Requires territory_c1_live_guarded_patch_DRAFT_20261031.sql to have been installed and verified.
-- This does NOT revert SQL functions or Edge; it preserves resume/advance and receipts.
-- Never use combat_config_v1.enabled=false as an emergency rollback while fights exist.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $check$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema='territory_private' AND table_name='combat_config_v1' AND column_name='starts_enabled'
 ) THEN RAISE EXCEPTION 'C1 gate not installed'; END IF;
 IF pg_get_functiondef(to_regprocedure('public.territory_combat_commit_v1(uuid,jsonb,jsonb,jsonb)'))
   NOT LIKE '%combat_starts_paused%' THEN
   RAISE EXCEPTION 'C1 commit function does not enforce start gate'; END IF;
END $check$;
UPDATE territory_private.combat_config_v1
   SET starts_enabled=false, canary_only=true
 WHERE id=true;
DO $confirm$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM territory_private.combat_config_v1
   WHERE id=true AND starts_enabled=false AND canary_only=true) THEN
   RAISE EXCEPTION 'C1 emergency stop did not persist'; END IF;
END $confirm$;
COMMIT;

-- Next: preserve Edge and SQL versions until all active sessions can advance/resume
-- and all pending operation UUIDs are resolved. Verify wallet sums / receipts / progress.
-- Fully restoring the legacy commit function would BYPASS starts_enabled and could
-- allow new starts; never do that without separate proven external ingress closure
-- and a zero-active-session maintenance window.
