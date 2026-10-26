-- Read-only metadata check. Run against the project embedded in the published V1.
-- Missing dependencies are blockers, never permission to seed/reset player data.
SELECT current_database() AS database_name, current_user AS database_role;
WITH required(kind, name) AS (VALUES
 ('table', 'public.players'),
 ('table', 'public.clans'),
 ('table', 'public.clan_members'),
 ('table', 'public.arena_weekly_wins_v1'),
 ('table', 'public.admin_grants'),
 ('table', 'territory_private.territory_master_license_red_wallet_v1'),
 ('table', 'territory_private.hall_accounts_v1'),
 ('table', 'territory_private.hall_sessions_v1'),
 ('table', 'public.territory_wallet_v1'),
 ('table', 'public.territory_crafted_items_v1'),
 ('table', 'public.territory_release_flags_v1'),
 ('table', 'territory_private.weekly_seasons_v1'),
 ('function', 'public.clan_state(uuid,bigint)'),
 ('function', 'public.clan_create(text,text,integer,text,text,text,text,integer,timestamp with time zone)'),
 ('function', 'public.territory_season_status_v1()'),
 ('function', 'public.territory_admin_claim_grant_v2(uuid)')
)
SELECT kind, name,
 CASE WHEN kind='table' THEN to_regclass(name) IS NOT NULL
 ELSE to_regprocedure(name) IS NOT NULL END AS installed
FROM required ORDER BY kind,name;

SELECT n.nspname AS schema_name,p.proname,
 pg_get_function_identity_arguments(p.oid) AS arguments,
 p.prosecdef AS security_definer,p.proconfig AS settings,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS player_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','territory_private')
 AND (p.proname LIKE 'clan_%' OR p.proname LIKE 'territory_auction_%'
 OR p.proname LIKE '%weekly_season%' OR p.proname='territory_season_status_v1')
ORDER BY n.nspname,p.proname;
