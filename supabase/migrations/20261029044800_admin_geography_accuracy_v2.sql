-- TERRITORY 1.0: show all actual players, including those without a verified country.
-- Both the geography view and owner stats use 00:00 UTC. Never infer a missing country.
CREATE OR REPLACE FUNCTION public.territory_admin_geography_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
WITH snapshots AS (
 SELECT p.id,p.last_seen_at,g.country_code
 FROM public.players AS p
 LEFT JOIN territory_private.player_geo_v1 AS g ON g.player_id=p.id
),
bounds AS (
 SELECT (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS utc_today
),
totals AS (
 SELECT
   count(*)::integer AS total_players,
   count(country_code)::integer AS tracked_players,
   count(*) FILTER (WHERE country_code IS NULL)::integer AS unknown_players,
   count(*) FILTER (WHERE last_seen_at >= now()-interval '5 minutes')::integer AS online_players,
   count(*) FILTER (WHERE last_seen_at >= utc_today)::integer AS today_players,
   count(*) FILTER (WHERE last_seen_at >= now()-interval '7 days')::integer AS week_players,
   count(*) FILTER (WHERE country_code IS NULL AND last_seen_at >= now()-interval '5 minutes')::integer AS unknown_online,
   count(*) FILTER (WHERE country_code IS NULL AND last_seen_at >= utc_today)::integer AS unknown_today,
   count(*) FILTER (WHERE country_code IS NULL AND last_seen_at >= now()-interval '7 days')::integer AS unknown_week
 FROM snapshots CROSS JOIN bounds
),
country_totals AS (
 SELECT s.country_code,
 count(*)::integer AS players,
 count(*) FILTER (WHERE s.last_seen_at >= now()-interval '5 minutes')::integer AS online,
 count(*) FILTER (WHERE s.last_seen_at >= b.utc_today)::integer AS today,
 count(*) FILTER (WHERE s.last_seen_at >= now()-interval '7 days')::integer AS week
 FROM snapshots AS s CROSS JOIN bounds AS b
 WHERE s.country_code IS NOT NULL
 GROUP BY s.country_code
)
SELECT jsonb_build_object(
 'totalPlayers', t.total_players,
 'trackedPlayers', t.tracked_players,
 'unknownPlayers', t.unknown_players,
 'onlinePlayers', t.online_players,
 'todayPlayers', t.today_players,
 'weekPlayers', t.week_players,
 'unknown', jsonb_build_object('players', t.unknown_players,
   'online', t.unknown_online, 'today', t.unknown_today, 'week', t.unknown_week),
 'lastGeoObservedAt', (SELECT max(observed_at) FROM territory_private.player_geo_v1),
 'countries', COALESCE((
   SELECT jsonb_agg(jsonb_build_object('code', c.country_code, 'players', c.players,
     'online', c.online, 'today', c.today, 'week', c.week)
     ORDER BY c.players DESC,c.country_code)
   FROM country_totals c), '[]'::jsonb)
) FROM totals t;
$$;
REVOKE ALL ON FUNCTION public.territory_admin_geography_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_geography_v1() TO service_role;
