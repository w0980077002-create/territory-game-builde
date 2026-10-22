-- Weekly Arena only: insert verified wins from completed server rooms; never reset lifetime stats.
CREATE TABLE IF NOT EXISTS public.arena_weekly_wins_v1 (
  room_id uuid NOT NULL,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  won_at timestamptz NOT NULL,
  PRIMARY KEY (room_id, player_id)
);
CREATE INDEX IF NOT EXISTS arena_weekly_wins_v1_week_idx
  ON public.arena_weekly_wins_v1 (won_at DESC, player_id);
ALTER TABLE public.arena_weekly_wins_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.arena_weekly_wins_v1 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.arena_weekly_capture_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'finished'
     AND OLD.status IS DISTINCT FROM 'finished'
     AND NEW.winner_team IN (1, 2)
  THEN
    INSERT INTO public.arena_weekly_wins_v1 (room_id, player_id, won_at)
    SELECT NEW.id, p.user_id, COALESCE(NEW.finished_at, now())
      FROM public.arena_participants p
     WHERE p.room_id = NEW.id
       AND p.is_bot = false
       AND p.user_id IS NOT NULL
       AND p.team = NEW.winner_team
    ON CONFLICT (room_id, player_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.arena_weekly_capture_v1() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS arena_weekly_capture_v1_trg ON public.arena_rooms;
CREATE TRIGGER arena_weekly_capture_v1_trg
AFTER UPDATE OF status ON public.arena_rooms
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'finished')
EXECUTE FUNCTION public.arena_weekly_capture_v1();

-- Backfill recently completed rooms still retained by log cleanup.
INSERT INTO public.arena_weekly_wins_v1 (room_id, player_id, won_at)
SELECT r.id, p.user_id, r.finished_at
  FROM public.arena_rooms r
  JOIN public.arena_participants p ON p.room_id = r.id
 WHERE r.status = 'finished' AND r.finished_at IS NOT NULL
   AND r.winner_team IN (1, 2) AND p.team = r.winner_team
   AND p.is_bot = false AND p.user_id IS NOT NULL
ON CONFLICT (room_id, player_id) DO NOTHING;

-- Authentic Top-50 Sunday-to-Sunday Europe/Kyiv; readonly for authenticated players.
CREATE OR REPLACE FUNCTION public.arena_weekly_top50_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sunday date;
  v_start timestamptz;
  v_end timestamptz;
  v_leaders jsonb := '[]'::jsonb;
  v_my_rank integer;
  v_my_wins integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_sunday := (now() AT TIME ZONE 'Europe/Kyiv')::date;
  v_sunday := v_sunday - EXTRACT(DOW FROM v_sunday)::integer;
  v_start := v_sunday::timestamp AT TIME ZONE 'Europe/Kyiv';
  v_end := (v_sunday + 7)::timestamp AT TIME ZONE 'Europe/Kyiv';

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
