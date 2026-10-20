-- Optional geography dashboard. No IP addresses or fine location are stored.
-- Deploy before the player-geography Edge Function and client.
CREATE TABLE IF NOT EXISTS territory_private.player_geo_v1 (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_geo_v1_country_idx ON territory_private.player_geo_v1(country_code);
ALTER TABLE territory_private.player_geo_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.player_geo_v1 FROM PUBLIC, anon, authenticated;

-- The trusted Edge Function calls this with the authenticated user verified by Supabase Auth.
-- Client roles cannot execute it directly and cannot forge a country through an RPC.
CREATE OR REPLACE FUNCTION public.territory_geo_record_v1(p_player uuid, p_country text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF p_player IS NULL OR p_country IS NULL
     OR p_country !~ '^[A-Z]{2}$' OR p_country = 'XX' THEN
    RAISE EXCEPTION 'invalid_geo_input';
  END IF;
  INSERT INTO territory_private.player_geo_v1(player_id, country_code, observed_at)
    VALUES (p_player, p_country, now())
    ON CONFLICT (player_id) DO UPDATE SET
      country_code = EXCLUDED.country_code,
      observed_at = EXCLUDED.observed_at;
END
$$;
REVOKE ALL ON FUNCTION public.territory_geo_record_v1(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_geo_record_v1(uuid,text) TO service_role;

-- Owner-only aggregation. No per-user country, coordinates, or IP leaves the server.
CREATE OR REPLACE FUNCTION public.territory_admin_geography_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
 SELECT jsonb_build_object(
   'trackedPlayers', (SELECT count(*)::integer FROM territory_private.player_geo_v1),
   'countries', COALESCE((
     SELECT jsonb_agg(jsonb_build_object(
       'code', stats.country_code, 'players', stats.players,
       'online', stats.online, 'today', stats.today, 'week', stats.week
     ) ORDER BY stats.players DESC, stats.country_code)
     FROM (
       SELECT g.country_code,
         count(*)::integer AS players,
         count(*) FILTER (WHERE p.last_seen_at >= now() - interval '5 minutes')::integer AS online,
         count(*) FILTER (WHERE p.last_seen_at >=
             (timezone('Europe/Kyiv', now())::date::timestamp AT TIME ZONE 'Europe/Kyiv'))::integer AS today,
         count(*) FILTER (WHERE p.last_seen_at >= now() - interval '7 days')::integer AS week
       FROM territory_private.player_geo_v1 AS g
       JOIN public.players AS p ON p.id = g.player_id
       GROUP BY g.country_code
     ) AS stats
   ), '[]'::jsonb)
 );
$$;
REVOKE ALL ON FUNCTION public.territory_admin_geography_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_geography_v1() TO service_role;
