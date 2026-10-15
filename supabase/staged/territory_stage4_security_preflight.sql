-- TERRITORY STAGE 4 — READ-ONLY security preflight for Supabase.
-- This script performs SELECTs only. It does not edit existing player data,
-- policies, roles, rewards or migration history. Use before any economy cutover.
-- A 'RISK' result is EXPECTED on the existing client-authoritative version.

-- 1. Direct mutations of protected columns by the 'authenticated' browser role.
SELECT 'players.game_state writable' AS check_name,
       CASE WHEN has_column_privilege('authenticated','public.players','game_state','UPDATE')
                 THEN 'RISK' ELSE 'LOCKED' END AS result
UNION ALL
SELECT 'players.gems writable',
       CASE WHEN has_column_privilege('authenticated','public.players','gems','UPDATE')
                 THEN 'RISK' ELSE 'LOCKED' END
UNION ALL
SELECT 'players.gold writable',
       CASE WHEN has_column_privilege('authenticated','public.players','gold','UPDATE')
                 THEN 'RISK' ELSE 'LOCKED' END
UNION ALL
SELECT 'players.level writable',
       CASE WHEN has_column_privilege('authenticated','public.players','level','UPDATE')
                 THEN 'RISK' ELSE 'LOCKED' END
UNION ALL
SELECT 'players.client INSERT allowed',
       CASE WHEN has_column_privilege('authenticated','public.players','game_state','INSERT')
                 THEN 'RISK' ELSE 'LOCKED' END;

-- 2. Required server-only wallets and professions must be unwriteable by clients.
SELECT c.relname AS table_name,
       CASE WHEN has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE')
                 THEN 'CHECK: client has a write grant' ELSE 'READ ONLY for authenticated role' END AS role_status
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('territory_resource_wallet','territory_profession_unlocks');

-- 3. Confirm RLS remains enabled and record exposed server function names.
SELECT c.relname, c.relrowsecurity AS rls_on, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('players','territory_resource_wallet','territory_profession_unlocks');

SELECT p.proname AS available_rpc, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND (p.proname LIKE 'territory_%' OR p.proname IN ('arena_join','arena_start_room'))
ORDER BY p.proname;

-- IMPORTANT: securing a RLS self-write policy DOES NOT prevent the owner from
-- forging their own balances. Use REVOKE + server-approved atomic actions.
-- Never revoke production writes while saveCloudSave() still writes game_state.
