-- Display owner-adjusted tester victory counts in the Arena's weekly Top 50.
-- Verified Arena match receipts and prize-award calculations remain unchanged.
-- Scope strictly to the ten owner-controlled tester identities.
CREATE TABLE IF NOT EXISTS territory_private.owner_test_bot_weekly_display_v1 (
  slot smallint NOT NULL REFERENCES territory_private.owner_test_bots_v1(slot),
  player_id uuid NOT NULL REFERENCES public.players(id),
  season_start timestamptz NOT NULL,
  adjustment integer NOT NULL CHECK (adjustment BETWEEN -1000000 AND 1000000),
  latest_edit_id bigint NOT NULL REFERENCES territory_private.owner_test_bot_wins_edits_v1(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(slot,season_start)
);
REVOKE ALL ON territory_private.owner_test_bot_weekly_display_v1
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION territory_private.owner_test_bot_wins_season_sync_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $sync$
DECLARE v_week date; v_start timestamptz; v_real_wins integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM territory_private.owner_test_bots_v1
    WHERE slot=NEW.slot AND player_id=NEW.player_id
  ) THEN RAISE EXCEPTION 'tester_wins_not_managed'; END IF;
  v_week:=(NEW.created_at AT TIME ZONE 'UTC')::date;
  v_week:=v_week-(EXTRACT(ISODOW FROM v_week)::int-1);
  v_start:=v_week::timestamp AT TIME ZONE 'UTC';
  SELECT count(*)::integer INTO v_real_wins
  FROM public.arena_weekly_wins_v1
  WHERE player_id=NEW.player_id AND won_at>=v_start AND won_at<=NEW.created_at;
  INSERT INTO territory_private.owner_test_bot_weekly_display_v1
    (slot,player_id,season_start,adjustment,latest_edit_id,updated_at)
  VALUES (NEW.slot,NEW.player_id,v_start,NEW.wins_after-v_real_wins,NEW.id,clock_timestamp())
  ON CONFLICT (slot,season_start) DO UPDATE SET
    player_id=EXCLUDED.player_id,
    adjustment=EXCLUDED.adjustment,
    latest_edit_id=EXCLUDED.latest_edit_id,
    updated_at=EXCLUDED.updated_at;
  RETURN NEW;
END $sync$;
REVOKE ALL ON FUNCTION territory_private.owner_test_bot_wins_season_sync_v1()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS owner_test_bot_weekly_sync_after_edit_v1
 ON territory_private.owner_test_bot_wins_edits_v1;
CREATE TRIGGER owner_test_bot_weekly_sync_after_edit_v1
 AFTER INSERT ON territory_private.owner_test_bot_wins_edits_v1
 FOR EACH ROW EXECUTE FUNCTION territory_private.owner_test_bot_wins_season_sync_v1();

-- Backfill only EXISTING owner edits in the CURRENT week; do not touch
-- ordinary players or reclassify past real matches.
WITH recent AS (
  SELECT DISTINCT ON (slot) *
  FROM territory_private.owner_test_bot_wins_edits_v1
  WHERE created_at >= (date_trunc('week',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    AND created_at < (date_trunc('week',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '7 days'
  ORDER BY slot,created_at DESC,id DESC
), offsets AS (
  SELECT r.*, (date_trunc('week',r.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS week_start,
    (SELECT count(*)::integer FROM public.arena_weekly_wins_v1 w
     WHERE w.player_id=r.player_id
       AND w.won_at >= (date_trunc('week',r.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
       AND w.won_at<=r.created_at) AS real_wins_at_edit
  FROM recent r
  JOIN territory_private.owner_test_bots_v1 b
    ON b.slot=r.slot AND b.player_id=r.player_id
)
INSERT INTO territory_private.owner_test_bot_weekly_display_v1
(slot,player_id,season_start,adjustment,latest_edit_id)
SELECT slot,player_id,week_start,wins_after-real_wins_at_edit,id FROM offsets
ON CONFLICT (slot,season_start) DO UPDATE SET
 player_id=EXCLUDED.player_id,
 adjustment=EXCLUDED.adjustment,
 latest_edit_id=EXCLUDED.latest_edit_id,
 updated_at=clock_timestamp();

-- Reuse the existing auth-gated Top-50 RPC and ranking tie-breaks.
CREATE OR REPLACE FUNCTION public.arena_weekly_top50_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_utc_day date;
  v_monday date;
  v_start timestamptz;
  v_end timestamptz;
  v_leaders jsonb := '[]'::jsonb;
  v_my_rank integer;
  v_my_wins integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF now() >= '2026-10-25T00:00:00Z'::timestamptz
     AND now() < '2026-11-02T00:00:00Z'::timestamptz THEN
    -- Extended ongoing season: keep every win already counted in the live board.
    v_start := '2026-10-25T00:00:00Z'::timestamptz;
    v_end := '2026-11-02T00:00:00Z'::timestamptz;
  ELSIF now() < '2026-10-25T00:00:00Z'::timestamptz THEN
    v_utc_day := (now() AT TIME ZONE 'UTC')::date;
    v_start := (v_utc_day - EXTRACT(DOW FROM v_utc_day)::integer)::timestamp AT TIME ZONE 'UTC';
    v_end := v_start + interval '7 days';
  ELSE
    -- Future seasons: Monday 00:00 UTC, identical for all players.
    v_utc_day := (now() AT TIME ZONE 'UTC')::date;
    v_monday := v_utc_day - (EXTRACT(ISODOW FROM v_utc_day)::integer - 1);
    v_start := v_monday::timestamp AT TIME ZONE 'UTC';
    v_end := (v_monday + 7)::timestamp AT TIME ZONE 'UTC';
  END IF;

  -- Verified fights remain authoritative for all real players.
  -- Owner-edited managed testers have a private, audited seasonal display
  -- adjustment. Never forge arena_weekly_wins_v1 room/award records.
  WITH verified AS (
    SELECT player_id, COUNT(*)::integer AS wins
      FROM public.arena_weekly_wins_v1
     WHERE won_at >= v_start AND won_at < v_end
     GROUP BY player_id
  ), overrides AS (
    SELECT a.player_id, a.adjustment
    FROM territory_private.owner_test_bot_weekly_display_v1 a
    JOIN territory_private.owner_test_bots_v1 b
      ON b.slot=a.slot AND b.player_id=a.player_id
    WHERE a.season_start=v_start
  ), scores AS (
    SELECT coalesce(v.player_id,o.player_id) AS player_id,
      GREATEST(0,COALESCE(v.wins,0)+COALESCE(o.adjustment,0))::integer AS wins
    FROM verified v FULL OUTER JOIN overrides o ON o.player_id=v.player_id
    WHERE GREATEST(0,COALESCE(v.wins,0)+COALESCE(o.adjustment,0))>0
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
$function$;
