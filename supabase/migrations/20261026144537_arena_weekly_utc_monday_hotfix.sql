-- TERRITORY 1.0 live Arena Top-50 hotfix, 2026-10-26.
-- Align the read-only weekly leaderboard with the already deployed client calendar:
-- Monday 00:00 UTC to next Monday 00:00 UTC.
-- Preserves arena_weekly_wins_v1, lifetime wins, history, rewards and all player rows.
-- Do not edit the historical Sunday-based migration.

CREATE OR REPLACE FUNCTION public.arena_weekly_top50_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start timestamptz := date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_end timestamptz := v_start + interval '7 days';
  v_leaders jsonb := '[]'::jsonb;
  v_my_rank integer;
  v_my_wins integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  WITH scores AS (
    SELECT player_id, COUNT(*)::integer AS wins
      FROM public.arena_weekly_wins_v1
     WHERE won_at >= v_start AND won_at < v_end
     GROUP BY player_id
  ), ranked AS (
    SELECT s.player_id, s.wins, p.display_name, p.level,
      COALESCE(CASE WHEN p.game_state ->> 'appearance' IN ('m1','m2','f1','f2')
        THEN p.game_state ->> 'appearance' END, 'm2') AS appearance,
      ROW_NUMBER() OVER (ORDER BY s.wins DESC, p.arena_rating DESC, s.player_id) AS place
    FROM scores s JOIN public.players p ON p.id = s.player_id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'player_id', player_id, 'display_name', display_name,
      'level', level, 'appearance', appearance,
      'wins', wins, 'rank', place
    ) ORDER BY place) FILTER (WHERE place <= 50), '[]'::jsonb),
    (MAX(place) FILTER (WHERE player_id = auth.uid()))::integer,
    COALESCE(MAX(wins) FILTER (WHERE player_id = auth.uid()), 0)
  INTO v_leaders, v_my_rank, v_my_wins FROM ranked;

  RETURN jsonb_build_object(
    'starts_at', to_char(v_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ends_at', to_char(v_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'leaders', v_leaders, 'my_rank', v_my_rank, 'my_wins', v_my_wins
  );
END
$$;

REVOKE ALL ON FUNCTION public.arena_weekly_top50_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arena_weekly_top50_v1() TO authenticated;
