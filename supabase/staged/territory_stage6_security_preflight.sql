-- TERRITORY STAGE6 - READ-ONLY PRODUCTION AUDIT.
-- Does not change any schema, permissions, players, VIP, wallets or equipment.
-- Check results under a privileged admin/owner session; never return raw player
-- data or this complete report to untrusted players.
-- 1: All untrusted updates must be removed BEFORE production is secure.
SELECT
  current_database() AS database_name,
  (SELECT COUNT(*) FROM public.players) AS player_count,
  has_table_privilege('authenticated','public.players','UPDATE') AS players_update_table_grant,
  has_column_privilege('authenticated','public.players','game_state','UPDATE') AS can_forge_game_state,
  has_column_privilege('authenticated','public.players','gems','UPDATE') AS can_forge_gems,
  has_column_privilege('authenticated','public.players','gold','UPDATE') AS can_forge_gold,
  has_column_privilege('authenticated','public.players','level','UPDATE') AS can_forge_level,
  has_column_privilege('authenticated','public.players','updated_at','UPDATE') AS can_forge_revision,
  has_column_privilege('authenticated','public.players','game_state','INSERT') AS can_inject_initial_game_state;

-- 2: Aggregate only: do not migrate players with inconsistent wallet mirrors.
SELECT
  COUNT(*) AS total_players,
  COUNT(*) FILTER (WHERE game_state IS NULL OR jsonb_typeof(game_state) <> 'object') AS invalid_saved_state,
  COUNT(*) FILTER (WHERE jsonb_typeof(game_state->'player') <> 'object') AS missing_player,
  COUNT(*) FILTER (WHERE (game_state->'player'->>'gems') !~ '^[0-9]+$') AS invalid_game_gems,
  COUNT(*) FILTER (WHERE (game_state->'player'->>'gold') !~ '^[0-9]+$') AS invalid_game_gold,
  COUNT(*) FILTER (WHERE (game_state->'player'->>'gems') ~ '^[0-9]+$' AND
    length(game_state->'player'->>'gems') <= 10 AND
    (game_state->'player'->>'gems')::bigint <> gems) AS mismatched_gems,
  COUNT(*) FILTER (WHERE (game_state->'player'->>'gold') ~ '^[0-9]+$' AND
    length(game_state->'player'->>'gold') <= 10 AND
    (game_state->'player'->>'gold')::bigint <> gold) AS mismatched_gold
FROM public.players;

-- 3: Review server security-definer entry points (do not execute them here).
SELECT p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS signature,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anonymous_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef AND
  (p.proname LIKE 'territory_%' OR p.proname LIKE 'arena_%')
ORDER BY p.proname;

-- 4: No direct API write grants on server ledgers; empty if Stage3/5 not applied.
SELECT t.table_name, t.privilege_type, t.grantee
FROM information_schema.role_table_grants t
WHERE t.table_schema='public'
  AND t.table_name LIKE 'territory_%'
  AND t.grantee IN ('anon','authenticated')
  AND t.privilege_type IN ('INSERT','UPDATE','DELETE')
ORDER BY t.table_name,t.grantee,t.privilege_type;

-- 5: All legacy write policies must be examined, not blindly dropped.
SELECT schemaname,tablename,policyname,cmd,roles,qual,with_check
FROM pg_policies WHERE schemaname='public'
  AND tablename IN ('players','territory_resource_wallet','territory_gather_jobs',
                    'territory_profession_unlocks')
ORDER BY tablename,policyname;
