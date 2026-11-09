-- Mortarion world raid. Separate from the expired Halloween raid and all player saves.
-- Deploy inactive. Activate only after the playable UI has passed public smoke checks.
CREATE TABLE IF NOT EXISTS public.territory_mortarion_2026 (
  id text PRIMARY KEY CHECK (id = 'mortarion_2026'),
  enabled boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  max_hp bigint NOT NULL CHECK (max_hp = 100000000),
  hp bigint NOT NULL CHECK (hp >= 0 AND hp <= max_hp),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

INSERT INTO public.territory_mortarion_2026(id, enabled, starts_at, ends_at, max_hp, hp)
VALUES ('mortarion_2026', false, clock_timestamp(), clock_timestamp() + interval '5 days', 100000000, 100000000)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.territory_mortarion_2026_players (
  event_id text NOT NULL REFERENCES public.territory_mortarion_2026(id),
  player_id uuid NOT NULL REFERENCES public.players(id),
  total_damage bigint NOT NULL DEFAULT 0 CHECK(total_damage >= 0),
  total_hits integer NOT NULL DEFAULT 0 CHECK(total_hits >= 0),
  hour_started_at timestamptz,
  hits_in_hour integer NOT NULL DEFAULT 0 CHECK (hits_in_hour BETWEEN 0 AND 5),
  last_hit_at timestamptz,
  PRIMARY KEY(event_id, player_id)
);

CREATE INDEX IF NOT EXISTS territory_mortarion_2026_rank
  ON public.territory_mortarion_2026_players(event_id, total_damage DESC, last_hit_at ASC, player_id);

ALTER TABLE public.territory_mortarion_2026 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_mortarion_2026_players ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.territory_mortarion_2026 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.territory_mortarion_2026_players FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_mortarion_state_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_event public.territory_mortarion_2026%ROWTYPE;
  v_player public.territory_mortarion_2026_players%ROWTYPE;
  v_hits integer := 0;
  v_next timestamptz;
  v_top jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'mortarion_auth_required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.players WHERE id=v_uid AND NOT COALESCE(banned,false)
  ) THEN RAISE EXCEPTION 'mortarion_player_unavailable'; END IF;

  SELECT * INTO v_event FROM public.territory_mortarion_2026 WHERE id='mortarion_2026';
  IF NOT FOUND THEN RAISE EXCEPTION 'mortarion_not_installed'; END IF;
  SELECT * INTO v_player FROM public.territory_mortarion_2026_players
    WHERE event_id=v_event.id AND player_id=v_uid;
  IF FOUND AND v_player.hour_started_at IS NOT NULL
    AND v_now < v_player.hour_started_at + interval '1 hour' THEN
    v_hits := v_player.hits_in_hour;
  END IF;

  v_next := CASE
    WHEN v_player.last_hit_at IS NOT NULL THEN v_player.last_hit_at + interval '60 seconds'
    ELSE NULL END;
  IF v_hits >= 5 THEN
    v_next := GREATEST(COALESCE(v_next, v_now), v_player.hour_started_at + interval '1 hour');
  END IF;

  SELECT COALESCE(jsonb_agg(
      jsonb_build_object('rank', q.rank, 'name', q.display_name, 'damage', q.total_damage)
      ORDER BY q.rank), '[]'::jsonb) INTO v_top
  FROM (
    SELECT row_number() OVER (ORDER BY s.total_damage DESC, s.last_hit_at ASC NULLS LAST, s.player_id) AS rank,
           left(coalesce(nullif(p.display_name,''), 'Герой'),32) AS display_name,
           s.total_damage
    FROM public.territory_mortarion_2026_players s
    JOIN public.players p ON p.id=s.player_id
    WHERE s.event_id=v_event.id AND s.total_damage>0 AND NOT COALESCE(p.banned,false)
    ORDER BY s.total_damage DESC, s.last_hit_at ASC NULLS LAST, s.player_id
    LIMIT 10
  ) q;

  RETURN jsonb_build_object(
    'active', v_event.enabled AND v_now >= v_event.starts_at AND v_now < v_event.ends_at AND v_event.hp>0,
    'enabled', v_event.enabled,
    'startsAt',v_event.starts_at,'endsAt',v_event.ends_at,
    'maxHp',v_event.max_hp,'hp',v_event.hp,
    'hitsInHour',v_hits,'maxHitsInHour',5,
    'nextHitAt',v_next,'top10',v_top,'serverNow',v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.territory_mortarion_attack_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_event public.territory_mortarion_2026%ROWTYPE;
  v_prev public.territory_mortarion_2026_players%ROWTYPE;
  v_level integer;
  v_attack integer;
  v_hits integer;
  v_window timestamptz;
  v_damage bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'mortarion_auth_required'; END IF;

  -- Global event lock serializes every damage application, including double taps.
  SELECT * INTO v_event FROM public.territory_mortarion_2026 WHERE id='mortarion_2026' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mortarion_not_installed'; END IF;
  v_now := clock_timestamp();
  IF NOT v_event.enabled OR v_now < v_event.starts_at OR v_now >= v_event.ends_at
    THEN RAISE EXCEPTION 'mortarion_event_closed'; END IF;
  IF v_event.hp <= 0 THEN RAISE EXCEPTION 'mortarion_defeated'; END IF;

  SELECT level, attack INTO v_level, v_attack FROM public.players
    WHERE id=v_uid AND NOT COALESCE(banned,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'mortarion_player_unavailable'; END IF;

  SELECT * INTO v_prev FROM public.territory_mortarion_2026_players
    WHERE event_id=v_event.id AND player_id=v_uid;

  v_window := v_prev.hour_started_at;
  v_hits := COALESCE(v_prev.hits_in_hour,0);
  IF v_window IS NULL OR v_now >= v_window + interval '1 hour' THEN
    v_window := v_now;
    v_hits := 0;
  END IF;

  IF v_hits >= 5 THEN RAISE EXCEPTION 'mortarion_hourly_limit'; END IF;
  IF v_prev.last_hit_at IS NOT NULL AND v_now < v_prev.last_hit_at + interval '60 seconds'
    THEN RAISE EXCEPTION 'mortarion_cooldown'; END IF;

  -- Server-owned player attributes; all combat and damage are server-computed.
  -- Cap malformed/high values so altered characters cannot destroy the global HP pool.
  v_damage := LEAST(v_event.hp, GREATEST(100, FLOOR(
    (1500 + LEAST(2500,GREATEST(20,COALESCE(v_attack,20)))*11
          + LEAST(100,GREATEST(1,COALESCE(v_level,1)))*150)
    * (0.90 + random()*0.20)
  ))::bigint);

  UPDATE public.territory_mortarion_2026
    SET hp=hp-v_damage, updated_at=v_now WHERE id=v_event.id;

  INSERT INTO public.territory_mortarion_2026_players
    (event_id,player_id,total_damage,total_hits,hour_started_at,hits_in_hour,last_hit_at)
  VALUES(v_event.id,v_uid,v_damage,1,v_window,v_hits+1,v_now)
  ON CONFLICT(event_id,player_id) DO UPDATE
    SET total_damage=public.territory_mortarion_2026_players.total_damage+EXCLUDED.total_damage,
        total_hits=public.territory_mortarion_2026_players.total_hits+1,
        hour_started_at=EXCLUDED.hour_started_at,
        hits_in_hour=EXCLUDED.hits_in_hour,
        last_hit_at=EXCLUDED.last_hit_at;

  RETURN public.territory_mortarion_state_v1() || jsonb_build_object('hitDamage',v_damage);
END;
$$;

REVOKE ALL ON FUNCTION public.territory_mortarion_state_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.territory_mortarion_attack_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.territory_mortarion_state_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.territory_mortarion_attack_v1() TO authenticated;
