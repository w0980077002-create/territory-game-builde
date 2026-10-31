-- Halloween 2026 cooperative world boss. Additive only: no player save, wallet or
-- equipment changes. Runs for three UTC days then closes itself.
CREATE TABLE IF NOT EXISTS public.territory_halloween_boss_2026 (
  id text PRIMARY KEY CHECK (id = 'halloween_2026'),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  max_hp bigint NOT NULL CHECK (max_hp > 0),
  hp bigint NOT NULL CHECK (hp >= 0 AND hp <= max_hp),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

INSERT INTO public.territory_halloween_boss_2026
  (id, starts_at, ends_at, max_hp, hp)
VALUES ('halloween_2026', '2026-10-31T00:00:00Z', '2026-11-03T00:00:00Z', 35000000, 35000000)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.territory_halloween_boss_2026_players (
  event_id text NOT NULL REFERENCES public.territory_halloween_boss_2026(id),
  player_id uuid NOT NULL REFERENCES public.players(id),
  total_damage bigint NOT NULL DEFAULT 0 CHECK (total_damage >= 0),
  total_hits integer NOT NULL DEFAULT 0 CHECK (total_hits >= 0),
  hit_day_utc date,
  hits_today integer NOT NULL DEFAULT 0 CHECK (hits_today >= 0),
  last_hit_at timestamptz,
  PRIMARY KEY (event_id, player_id)
);
CREATE INDEX IF NOT EXISTS territory_halloween_boss_2026_rank_idx
  ON public.territory_halloween_boss_2026_players
  (event_id, total_damage DESC, last_hit_at ASC, player_id);

-- No direct client reads or writes; only the tightly scoped authenticated RPCs.
ALTER TABLE public.territory_halloween_boss_2026 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_halloween_boss_2026_players ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_halloween_boss_2026 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.territory_halloween_boss_2026_players FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_halloween_boss_state_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.territory_halloween_boss_2026%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_damage bigint := 0;
  v_hits integer := 0;
  v_last timestamptz;
  v_day date;
  v_rank integer;
  v_top jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'halloween_boss_auth_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = v_uid AND NOT COALESCE(banned, false)) THEN
    RAISE EXCEPTION 'halloween_boss_player_unavailable';
  END IF;
  SELECT * INTO v_event FROM public.territory_halloween_boss_2026 WHERE id = 'halloween_2026';
  IF NOT FOUND THEN RAISE EXCEPTION 'halloween_boss_not_installed'; END IF;

  SELECT total_damage,
         CASE WHEN hit_day_utc = (v_now AT TIME ZONE 'UTC')::date THEN hits_today ELSE 0 END,
         last_hit_at, hit_day_utc
    INTO v_damage, v_hits, v_last, v_day
    FROM public.territory_halloween_boss_2026_players
   WHERE event_id = v_event.id AND player_id = v_uid;

  SELECT ranked.rank INTO v_rank
  FROM (
    SELECT player_id,
           ROW_NUMBER() OVER (ORDER BY total_damage DESC, last_hit_at ASC NULLS LAST, player_id) AS rank
    FROM public.territory_halloween_boss_2026_players
    WHERE event_id = v_event.id AND total_damage > 0
  ) ranked WHERE ranked.player_id = v_uid;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('rank', ranked.rank, 'name', ranked.name, 'damage', ranked.total_damage)
    ORDER BY ranked.rank
  ), '[]'::jsonb) INTO v_top
  FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY h.total_damage DESC, h.last_hit_at ASC NULLS LAST, h.player_id) AS rank,
           LEFT(COALESCE(NULLIF(p.display_name, ''), 'Герой'), 32) AS name,
           h.total_damage
    FROM public.territory_halloween_boss_2026_players h
    JOIN public.players p ON p.id = h.player_id
    WHERE h.event_id = v_event.id AND h.total_damage > 0
    ORDER BY h.total_damage DESC, h.last_hit_at ASC NULLS LAST, h.player_id
    LIMIT 10
  ) ranked;

  RETURN jsonb_build_object(
    'active', v_now >= v_event.starts_at AND v_now < v_event.ends_at AND v_event.hp > 0,
    'startsAt', v_event.starts_at, 'endsAt', v_event.ends_at,
    'maxHp', v_event.max_hp, 'hp', v_event.hp,
    'myDamage', COALESCE(v_damage, 0), 'myRank', v_rank,
    'myHitsToday', COALESCE(v_hits, 0), 'maxHitsToday', 40,
    'nextHitAt', CASE WHEN v_last IS NOT NULL THEN v_last + INTERVAL '8 seconds' ELSE NULL END,
    'top10', v_top, 'serverNow', v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.territory_halloween_boss_attack_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.territory_halloween_boss_2026%ROWTYPE;
  v_player_level integer;
  v_now timestamptz := clock_timestamp();
  v_day date := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  v_previous public.territory_halloween_boss_2026_players%ROWTYPE;
  v_hits integer;
  v_damage bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'halloween_boss_auth_required'; END IF;

  -- Serialize ALL hits against the one global HP pool, including two
  -- simultaneous hits by the same account. No client-supplied damage.
  SELECT * INTO v_event
  FROM public.territory_halloween_boss_2026
  WHERE id = 'halloween_2026'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'halloween_boss_not_installed'; END IF;
  v_now := clock_timestamp();
  v_day := (v_now AT TIME ZONE 'UTC')::date;
  IF v_now < v_event.starts_at OR v_now >= v_event.ends_at
    THEN RAISE EXCEPTION 'halloween_boss_event_ended'; END IF;
  IF v_event.hp <= 0 THEN RAISE EXCEPTION 'halloween_boss_defeated'; END IF;

  SELECT level INTO v_player_level
  FROM public.players
  WHERE id = v_uid AND NOT COALESCE(banned, false);
  IF NOT FOUND THEN RAISE EXCEPTION 'halloween_boss_player_unavailable'; END IF;

  SELECT * INTO v_previous
  FROM public.territory_halloween_boss_2026_players
  WHERE event_id = v_event.id AND player_id = v_uid;
  v_hits := CASE WHEN v_previous.hit_day_utc = v_day THEN COALESCE(v_previous.hits_today, 0) ELSE 0 END;
  IF v_hits >= 40 THEN RAISE EXCEPTION 'halloween_boss_daily_limit'; END IF;
  IF v_previous.last_hit_at IS NOT NULL AND v_now < v_previous.last_hit_at + INTERVAL '8 seconds'
    THEN RAISE EXCEPTION 'halloween_boss_cooldown'; END IF;

  -- Bounded damage uses the server's level column; the client never reports
  -- damage, critical chance, equipment or rewards to this event endpoint.
  v_damage := LEAST(v_event.hp,
    (220 + LEAST(100, GREATEST(1, COALESCE(v_player_level, 1))) * 28
      + FLOOR(random() * 400)::integer)::bigint);

  UPDATE public.territory_halloween_boss_2026
     SET hp = hp - v_damage, updated_at = v_now
   WHERE id = v_event.id;

  INSERT INTO public.territory_halloween_boss_2026_players
    (event_id, player_id, total_damage, total_hits, hit_day_utc, hits_today, last_hit_at)
  VALUES (v_event.id, v_uid, v_damage, 1, v_day, 1, v_now)
  ON CONFLICT (event_id, player_id)
  DO UPDATE SET total_damage = public.territory_halloween_boss_2026_players.total_damage + EXCLUDED.total_damage,
                total_hits = public.territory_halloween_boss_2026_players.total_hits + 1,
                hit_day_utc = v_day,
                hits_today = v_hits + 1,
                last_hit_at = v_now;

  RETURN public.territory_halloween_boss_state_v1()
      || jsonb_build_object('hitDamage', v_damage);
END;
$$;

REVOKE ALL ON FUNCTION public.territory_halloween_boss_state_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.territory_halloween_boss_attack_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.territory_halloween_boss_state_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.territory_halloween_boss_attack_v1() TO authenticated;
