-- Admin-only registration feed for TERRITORY 1.0.
-- Registration counts are based on players.created_at, not last_seen_at.
-- Never return the player's game_state, balances, IP address, or any geo history.
CREATE OR REPLACE FUNCTION public.territory_admin_new_players_v1(
  p_period text DEFAULT 'today',
  p_offset integer DEFAULT 0,
  p_page_size integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_today timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_week timestamptz := now() - interval '7 days';
  v_total integer;
  v_today_count integer;
  v_week_count integer;
  v_rows jsonb;
  v_has_more boolean;
BEGIN
  IF p_period NOT IN ('today', 'week', 'all') OR
     p_offset IS NULL OR p_offset < 0 OR p_offset > 5000 OR
     p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 50 THEN
    RAISE EXCEPTION 'invalid_period_or_page';
  END IF;
  SELECT count(*)::integer,
    count(*) FILTER (WHERE created_at >= v_today)::integer,
    count(*) FILTER (WHERE created_at >= v_week)::integer
  INTO v_total, v_today_count, v_week_count
  FROM public.players;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'telegramId', q.telegram_id,
    'username', q.username,
    'name', q.display_name,
    'level', q.level,
    'country', q.country_code,
    'createdAt', q.created_at,
    'lastSeenAt', q.last_seen_at,
    'online', q.last_seen_at >= now() - interval '5 minutes'
  ) ORDER BY q.created_at DESC, q.id DESC)
    FILTER (WHERE q.rn <= p_page_size), '[]'::jsonb),
    coalesce(bool_or(q.rn > p_page_size), false)
  INTO v_rows, v_has_more
  FROM (
    SELECT p.id, p.telegram_id, p.username, p.display_name,
      p.level, p.created_at, p.last_seen_at, g.country_code,
      row_number() OVER (ORDER BY p.created_at DESC, p.id DESC) AS rn
    FROM public.players AS p
    LEFT JOIN territory_private.player_geo_v1 AS g ON g.player_id = p.id
    WHERE (p_period = 'all' OR
      (p_period = 'today' AND p.created_at >= v_today) OR
      (p_period = 'week' AND p.created_at >= v_week))
    ORDER BY p.created_at DESC, p.id DESC
    OFFSET p_offset LIMIT p_page_size + 1
  ) q;
  RETURN jsonb_build_object('today', v_today_count, 'week', v_week_count,
    'total', v_total, 'players', v_rows, 'hasMore', v_has_more,
    'asOf', now());
END
$$;
REVOKE ALL ON FUNCTION public.territory_admin_new_players_v1(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_new_players_v1(text,integer,integer) TO service_role;
