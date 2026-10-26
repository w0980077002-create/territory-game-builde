-- TERRITORY 1.0 · REVIEWED RELEASE PART 1/2 (install only, disabled by default).
-- Apply only to the existing live V1 database after review. Part 2 enables cron.
-- Sunday 00:00 UTC; verified wins only; virtual contenders occupy rank but never
-- receive player accounts, mail or currency. Old weeks are never back-paid.
-- No player balances, existing grants, or the separate Weekly Championship change.
BEGIN;

DO $check$
BEGIN
  IF to_regprocedure('public.territory_admin_claim_grant_v2(uuid)') IS NULL
    OR to_regclass('public.arena_weekly_wins_v1') IS NULL
    OR to_regclass('public.admin_grants') IS NULL THEN
    RAISE EXCEPTION 'arena_prizes_atomic_mail_or_wins_missing';
  END IF;
END $check$;

CREATE TABLE IF NOT EXISTS territory_private.arena_top50_reward_config_v1 (
  id integer PRIMARY KEY CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  first_week date NOT NULL CHECK (extract(dow FROM first_week) = 0)
);
INSERT INTO territory_private.arena_top50_reward_config_v1 (id, first_week)
VALUES (1, (now() AT TIME ZONE 'UTC')::date
  - extract(dow FROM (now() AT TIME ZONE 'UTC')::date)::integer)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS territory_private.arena_top50_reward_weeks_v1 (
  week date PRIMARY KEY CHECK (extract(dow FROM week) = 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ends_at = starts_at + interval '7 days')
);

CREATE TABLE IF NOT EXISTS territory_private.arena_top50_reward_results_v1 (
  week date NOT NULL REFERENCES territory_private.arena_top50_reward_weeks_v1(week),
  place integer NOT NULL CHECK (place BETWEEN 1 AND 50),
  player_id uuid REFERENCES public.players(id),
  display_name text NOT NULL,
  wins integer NOT NULL CHECK (wins >= 0),
  virtual_contender boolean NOT NULL,
  reward jsonb NOT NULL DEFAULT '{}'::jsonb,
  grant_id uuid UNIQUE REFERENCES public.admin_grants(id) ON DELETE SET NULL,
  PRIMARY KEY (week, place),
  UNIQUE (week, player_id),
  CHECK ((virtual_contender AND player_id IS NULL AND grant_id IS NULL AND reward = '{}'::jsonb)
      OR (NOT virtual_contender AND player_id IS NOT NULL))
);

ALTER TABLE territory_private.arena_top50_reward_config_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.arena_top50_reward_weeks_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.arena_top50_reward_results_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.arena_top50_reward_config_v1,
  territory_private.arena_top50_reward_weeks_v1,
  territory_private.arena_top50_reward_results_v1 FROM PUBLIC, anon, authenticated;

-- Exact PostgreSQL equivalent of arenaWeeklyBots.ts stableHash for our BMP-only
-- Latin/Cyrillic names: JS Math.imul((hash ^ charCodeAt), 16777619) >>> 0.
CREATE OR REPLACE FUNCTION territory_private.arena_top50_hash_v1(p_text text)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='pg_catalog' AS $hash$
DECLARE v_hash bigint := 2166136261; v_index integer;
BEGIN
  FOR v_index IN 1..char_length(p_text) LOOP
    v_hash := ((v_hash # ascii(substr(p_text,v_index,1))::bigint) * 16777619)
      % 4294967296;
  END LOOP;
  RETURN v_hash;
END $hash$;
REVOKE ALL ON FUNCTION territory_private.arena_top50_hash_v1(text)
  FROM PUBLIC, anon, authenticated;

-- At the instant the week ends, all 50 scheduled contenders have reached
-- their deterministic *weekly* goals. The minute-by-minute UI schedule is
-- not payment data. The hash changes each Sunday's assigned activity tiers.
CREATE OR REPLACE FUNCTION territory_private.arena_top50_bot_final_v1(p_week date)
RETURNS TABLE(bot_name text, wins integer)
LANGUAGE sql STABLE SET search_path='pg_catalog' AS $bots$
  WITH names AS (
    SELECT unnest(ARRAY[
      'Рагнар','Сигурд','Хельга','Бьорн','Ивар','Астрид','Торвальд','Фрейя',
      'Улаф','Лагерта','Хротгар','Эйрик','Сольвейг','Гуннар','Кнуд',
      'Ингрид','Харальд','Тюр','Вали','Сван','Тордис','Хаук',
      'Агнар','Ярослав','Мстислав',
      'Skald','Valkyr','Drakkar','Fenrir','NordKing','Wolfhart','Grimnir',
      'Leif','Hakon','Halfdan','Arne','Sten','Finn','Sven',
      'Torsten','Einar','Roald','Sigmund','Asger','Arvid','Rollo',
      'Vidar','Sigrid','Brynhild','Freydis'
    ]::text[]) AS name
  ), ordered AS (
    SELECT name,
      row_number() OVER (ORDER BY
        territory_private.arena_top50_hash_v1(p_week::text || ':' || name || ':skill'),
        name COLLATE "C") - 1 AS slot
    FROM names
  ), strengths AS (
    SELECT name, 49 - slot AS strength FROM ordered
  )
  SELECT name, (1 + strength * 3
    + round(27 * power(strength::numeric / 49, 2)))::integer AS wins
  FROM strengths;
$bots$;
REVOKE ALL ON FUNCTION territory_private.arena_top50_bot_final_v1(date)
  FROM PUBLIC, anon, authenticated;

-- Database-owned rank snapshot + immutable mail results in one transaction.
-- Same advisory lock as arena_weekly_capture_v1 and weekly_season_tick_v1.
-- A capture waiting past the cutoff receives the new week's timestamp.
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

  v_current_week := (now() AT TIME ZONE 'UTC')::date;
  v_current_week := v_current_week - extract(dow FROM v_current_week)::integer;
  v_week := v_config.first_week;
  WHILE v_week < v_current_week LOOP
    IF NOT EXISTS (SELECT 1 FROM territory_private.arena_top50_reward_weeks_v1
        WHERE week=v_week) THEN
      v_start := v_week::timestamp AT TIME ZONE 'UTC';
      v_end := v_start + interval '7 days';
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
    v_week := v_week + 7;
  END LOOP;
END $tick$;
REVOKE ALL ON FUNCTION territory_private.arena_top50_rewards_tick_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION territory_private.arena_top50_rewards_tick_v1() TO service_role;
COMMIT;
