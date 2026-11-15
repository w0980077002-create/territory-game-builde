-- Final Mortarion raid: remove the five-hits-per-hour cap for players.
-- Keep 60 seconds between strikes. No reset of HP, contributions, rewards or ranking.
-- The per-hour count is retained for historical statistics but no longer limited to five.
ALTER TABLE public.territory_mortarion_2026_players
  DROP CONSTRAINT IF EXISTS territory_mortarion_2026_players_hits_in_hour_check;
ALTER TABLE public.territory_mortarion_2026_players
  ADD CONSTRAINT territory_mortarion_2026_players_hits_in_hour_check
  CHECK (hits_in_hour >= 0);

CREATE OR REPLACE FUNCTION public.territory_mortarion_attack_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- The hourly strike limit is removed; 60-second cooldown is enforced below.
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
$function$
;

CREATE OR REPLACE FUNCTION public.territory_mortarion_state_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- No hourly cooldown; only the 60-second delay applies.

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
    'hitsInHour',0,'maxHitsInHour',0,
    'nextHitAt',v_next,'top10',v_top,'serverNow',v_now
  );
END;
$function$
;
