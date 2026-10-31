-- TERRITORY 1.0: guarded 24h extension, then Monday 00:00 UTC Arena TOP-50.
-- REQUIRED: release reviewed client in same rollout; leave payouts DISABLED.
-- Preserve all player wins including the ongoing Sunday 25 Oct competition.
-- Current Sunday 25 Oct -> Monday 2 Nov 00:00 UTC is one 8-day season;
-- future weeks are Monday-to-Monday UTC. No deletes, grants or wallet edits.
BEGIN;
SELECT pg_advisory_xact_lock(14601,701);
DO $guard$
BEGIN
  IF (SELECT count(*) FROM territory_private.arena_top50_reward_config_v1
      WHERE id=1 AND enabled=false AND first_week=DATE '2026-10-25') <> 1 THEN
    RAISE EXCEPTION 'arena_cutover_requires_paused_original_config';
  END IF;
  IF EXISTS (SELECT 1 FROM territory_private.arena_top50_reward_weeks_v1)
    OR EXISTS (SELECT 1 FROM territory_private.arena_top50_reward_results_v1) THEN
    RAISE EXCEPTION 'arena_cutover_requires_manual_reward_archive_review';
  END IF;
  IF md5(pg_get_functiondef('public.arena_weekly_top50_v1()'::regprocedure))
      <> '8a6a489c5cd49078c34cb65afc8f2a97' THEN
    RAISE EXCEPTION 'arena_cutover_rpc_version_mismatch';
  END IF;
  IF md5(pg_get_functiondef('territory_private.arena_top50_rewards_tick_v1()'::regprocedure))
      <> '26b3d1787f62843f43f7d0b22b5fca39' THEN
    RAISE EXCEPTION 'arena_cutover_rewards_version_mismatch';
  END IF;
END $guard$;

ALTER TABLE territory_private.arena_top50_reward_weeks_v1
  DROP CONSTRAINT arena_top50_reward_weeks_v1_week_check,
  DROP CONSTRAINT arena_top50_reward_weeks_v1_check;
ALTER TABLE territory_private.arena_top50_reward_weeks_v1
  ADD CONSTRAINT arena_top50_reward_weeks_monday_utc_check CHECK (
   (week=DATE '2026-10-25'
     AND starts_at='2026-10-25T00:00:00Z'::timestamptz
     AND ends_at='2026-11-02T00:00:00Z'::timestamptz)
    OR
   (extract(isodow FROM week)=1
     AND starts_at=week::timestamp AT TIME ZONE 'UTC'
     AND ends_at=(week+7)::timestamp AT TIME ZONE 'UTC')
  );

CREATE OR REPLACE FUNCTION public.arena_weekly_top50_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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


CREATE OR REPLACE FUNCTION territory_private.arena_top50_rewards_tick_v1()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $tick$
DECLARE
  v_config territory_private.arena_top50_reward_config_v1%ROWTYPE;
  v_current_week date;
  v_week date;
  v_start timestamptz;
  v_end timestamptz;
  v_row record;
  v_gems integer;
  v_red integer;
  v_stones integer;
  v_elixirs integer;
  v_reward jsonb;
  v_grant uuid;
BEGIN
  -- Blocking lock: do not skip a just-closed week due to a competing fight.
  PERFORM pg_advisory_xact_lock(14601,701);
  SELECT * INTO v_config FROM territory_private.arena_top50_reward_config_v1
    WHERE id=1 FOR UPDATE;
  IF NOT FOUND OR NOT v_config.enabled THEN RETURN; END IF;

  -- Extended season cannot be finalized until Monday 2 Nov 00:00 UTC,
  -- even if an operator enables rewards early by mistake.
  IF now() >= '2026-10-25T00:00:00Z'::timestamptz
     AND now() < '2026-11-02T00:00:00Z'::timestamptz THEN
    v_current_week := DATE '2026-10-25';
  ELSE
    v_current_week := (now() AT TIME ZONE 'UTC')::date;
    v_current_week := v_current_week
      - (extract(isodow FROM v_current_week)::integer - 1);
  END IF;
  v_week := v_config.first_week;
  WHILE v_week < v_current_week LOOP
    IF NOT EXISTS (SELECT 1 FROM territory_private.arena_top50_reward_weeks_v1
        WHERE week=v_week) THEN
      IF v_week = DATE '2026-10-25' THEN
        -- One extended transitional week; reward the already-running competition once.
        v_start := '2026-10-25T00:00:00Z'::timestamptz;
        v_end := '2026-11-02T00:00:00Z'::timestamptz;
      ELSE
        v_start := v_week::timestamp AT TIME ZONE 'UTC';
        v_end := (v_week+7)::timestamp AT TIME ZONE 'UTC';
      END IF;
      -- Archive 50 places including virtual entries, without issuing them mail.
      INSERT INTO territory_private.arena_top50_reward_weeks_v1
        (week,starts_at,ends_at) VALUES (v_week,v_start,v_end);

      FOR v_row IN
        WITH real_scores AS (
          SELECT w.player_id,count(*)::integer AS wins
          FROM public.arena_weekly_wins_v1 w
          WHERE w.won_at >= v_start AND w.won_at < v_end
          GROUP BY w.player_id
        ), real_ranked AS (
          SELECT s.player_id,s.wins,p.display_name,p.telegram_id,p.banned,
            row_number() OVER (ORDER BY s.wins DESC,p.arena_rating DESC,s.player_id) AS real_place
          FROM real_scores s JOIN public.players p ON p.id=s.player_id
        ), mixed AS (
          SELECT r.player_id,r.display_name,r.wins,false AS virtual_contender,
            r.real_place,r.telegram_id,r.banned,r.player_id::text AS entrant_key
          FROM real_ranked r WHERE r.real_place <= 50
          UNION ALL
          SELECT NULL::uuid,b.bot_name,b.wins,true,NULL::bigint,NULL::bigint,
            NULL::boolean,'arena-npc:' || b.bot_name
          FROM territory_private.arena_top50_bot_final_v1(v_week) b
        ), placed AS (
          SELECT m.*,row_number() OVER (ORDER BY m.wins DESC,
            m.virtual_contender ASC,m.real_place ASC,m.entrant_key COLLATE "C")::integer AS place
          FROM mixed m
        )
        SELECT * FROM placed WHERE place <= 50 ORDER BY place
      LOOP
        v_reward := '{}'::jsonb;
        v_grant := NULL;
        IF NOT v_row.virtual_contender AND v_row.telegram_id IS NOT NULL
          AND v_row.banned IS DISTINCT FROM true THEN
          CASE
            WHEN v_row.place=1 THEN v_gems:=120;v_red:=3;v_stones:=25;v_elixirs:=20;
            WHEN v_row.place=2 THEN v_gems:=80;v_red:=2;v_stones:=20;v_elixirs:=15;
            WHEN v_row.place=3 THEN v_gems:=50;v_red:=1;v_stones:=15;v_elixirs:=12;
            WHEN v_row.place=4 THEN v_gems:=30;v_red:=0;v_stones:=12;v_elixirs:=10;
            WHEN v_row.place=5 THEN v_gems:=30;v_red:=0;v_stones:=10;v_elixirs:=8;
            ELSE v_gems:=15;v_red:=0;v_stones:=5;v_elixirs:=5;
          END CASE;
          -- Three different seven-day elixirs. Claiming is server-atomic.
          v_reward := jsonb_build_object('gems',v_gems,'redGems',v_red,
            'stones',v_stones,'items',jsonb_build_object(
              'shop_elixir_atk',(v_elixirs+2)/3,
              'shop_elixir_def',(v_elixirs+1)/3,
              'shop_elixir_crit',v_elixirs/3));
          INSERT INTO public.admin_grants(player_id,kind,subject,body,payload)
          VALUES(v_row.player_id,'mail','Арена · ТОП-50 · ' || v_week,
            'Место №' || v_row.place || '. Побед: ' || v_row.wins
              || '. Награда за неделю уже ждёт тебя в письме!',v_reward)
          RETURNING id INTO v_grant;
        END IF;
        INSERT INTO territory_private.arena_top50_reward_results_v1
          (week,place,player_id,display_name,wins,virtual_contender,reward,grant_id)
        VALUES(v_week,v_row.place,v_row.player_id,v_row.display_name,
          v_row.wins,v_row.virtual_contender,v_reward,v_grant);
      END LOOP;
    END IF;
    v_week := CASE WHEN v_week = DATE '2026-10-25'
      THEN DATE '2026-11-02' ELSE v_week + 7 END;
  END LOOP;
END $tick$;
REVOKE ALL ON FUNCTION territory_private.arena_top50_rewards_tick_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION territory_private.arena_top50_rewards_tick_v1() TO service_role;

COMMIT;
