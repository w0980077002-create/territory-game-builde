-- Owner-only automatic participation in Mortarion for TEN private managed testers.
-- Default OFF; does not alter player saves, currencies, Arena bot settings, or global event dates.
ALTER TABLE territory_private.owner_test_bots_v1
  ADD COLUMN IF NOT EXISTS auto_mortarion boolean NOT NULL DEFAULT false;

-- Admin Edge Function (service_role only) reads ten independent saved toggle states.
CREATE OR REPLACE FUNCTION public.territory_admin_test_bots_mortarion_status_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT COALESCE(jsonb_agg(
      jsonb_build_object('slot',b.slot,'enabled',b.auto_mortarion) ORDER BY b.slot
    ),'[]'::jsonb)
  FROM territory_private.owner_test_bots_v1 b
  WHERE b.slot BETWEEN 1 AND 10;
$fn$;
REVOKE ALL ON FUNCTION public.territory_admin_test_bots_mortarion_status_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_test_bots_mortarion_status_v1() TO service_role;

-- Only existing owner-controlled identities can have this boolean changed.
-- The admin Edge Function authenticates the owner before calling this private action.
CREATE OR REPLACE FUNCTION public.territory_admin_test_bot_mortarion_toggle_v1(
  p_slot smallint, p_enabled boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF p_slot IS NULL OR p_slot NOT BETWEEN 1 AND 10 OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid_mortarion_tester_setting';
  END IF;
  UPDATE territory_private.owner_test_bots_v1
  SET auto_mortarion=p_enabled, updated_at=clock_timestamp()
  WHERE slot=p_slot;
  IF NOT FOUND THEN RAISE EXCEPTION 'mortarion_tester_not_found'; END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.territory_admin_test_bot_mortarion_toggle_v1(smallint,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_test_bot_mortarion_toggle_v1(smallint,boolean)
  TO service_role;

-- Background tick has no public/authenticated/service_role access. It executes
-- only as the database cron owner, after the owner explicitly turns a bot ON.
-- Same global HP, server-derived level/attack damage, 5 hits per 60-minute window,
-- and >=60 seconds between hits as the human Mortarion RPC.
CREATE OR REPLACE FUNCTION territory_private.owner_test_bot_mortarion_tick_v1()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $tick$
DECLARE
  v_event public.territory_mortarion_2026%ROWTYPE;
  v_prev public.territory_mortarion_2026_players%ROWTYPE;
  v_bot record;
  v_now timestamptz;
  v_window timestamptz;
  v_hits integer;
  v_damage bigint;
  v_attacks integer := 0;
BEGIN
  -- Lock the same boss row as public.territory_mortarion_attack_v1().
  -- This serializes real player and tester damage; no lost HP updates.
  SELECT * INTO v_event FROM public.territory_mortarion_2026
  WHERE id='mortarion_2026' FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_now := clock_timestamp();
  IF NOT v_event.enabled OR v_event.hp<=0
    OR v_now < v_event.starts_at OR v_now >= v_event.ends_at THEN RETURN 0; END IF;

  -- Skip a tester while the owner is switching it; no queued/synthetic attacks
  -- for accounts without the explicit owner opt-in.
  FOR v_bot IN
    SELECT b.slot, b.player_id, p.level, p.attack
    FROM territory_private.owner_test_bots_v1 b
    JOIN public.players p ON p.id=b.player_id
    WHERE b.slot BETWEEN 1 AND 10 AND b.auto_mortarion
      AND NOT COALESCE(p.banned,false)
    ORDER BY b.slot
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    v_now := clock_timestamp();
    EXIT WHEN v_event.hp <= 0 OR v_now >= v_event.ends_at;

    SELECT * INTO v_prev FROM public.territory_mortarion_2026_players
      WHERE event_id=v_event.id AND player_id=v_bot.player_id;
    v_window := v_prev.hour_started_at;
    v_hits := COALESCE(v_prev.hits_in_hour,0);
    IF v_window IS NULL OR v_now >= v_window + interval '1 hour' THEN
      v_window := v_now;
      v_hits := 0;
    END IF;
    IF v_hits >= 5 OR (v_prev.last_hit_at IS NOT NULL
        AND v_now < v_prev.last_hit_at + interval '60 seconds') THEN
      CONTINUE;
    END IF;

    -- Identical formula to the public player attack RPC; no admin override,
    -- no fake hits and no special tester-only damage multiplier.
    v_damage := LEAST(v_event.hp, GREATEST(100, FLOOR(
      (1500 + LEAST(2500,GREATEST(20,COALESCE(v_bot.attack,20)))*11
            + LEAST(100,GREATEST(1,COALESCE(v_bot.level,1)))*150)
      * (0.90 + random()*0.20)
    ))::bigint);

    UPDATE public.territory_mortarion_2026
      SET hp=hp-v_damage, updated_at=v_now WHERE id=v_event.id;
    v_event.hp := v_event.hp - v_damage;

    INSERT INTO public.territory_mortarion_2026_players
      (event_id,player_id,total_damage,total_hits,hour_started_at,hits_in_hour,last_hit_at)
    VALUES (v_event.id,v_bot.player_id,v_damage,1,v_window,v_hits+1,v_now)
    ON CONFLICT(event_id,player_id) DO UPDATE
      SET total_damage=public.territory_mortarion_2026_players.total_damage
          +EXCLUDED.total_damage,
          total_hits=public.territory_mortarion_2026_players.total_hits+1,
          hour_started_at=EXCLUDED.hour_started_at,
          hits_in_hour=EXCLUDED.hits_in_hour,
          last_hit_at=EXCLUDED.last_hit_at;
    v_attacks := v_attacks + 1;
  END LOOP;
  RETURN v_attacks;
END;
$tick$;
REVOKE ALL ON FUNCTION territory_private.owner_test_bot_mortarion_tick_v1()
  FROM PUBLIC,anon,authenticated,service_role;

-- Existing Arena cron is untouched. This independent one-minute job does
-- absolutely nothing until one or more managed testers are switched ON.
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job
                 WHERE jobname='territory-owner-test-bots-mortarion-v1') THEN
    PERFORM cron.schedule(
      'territory-owner-test-bots-mortarion-v1',
      '* * * * *',
      'SELECT territory_private.owner_test_bot_mortarion_tick_v1();'
    );
  END IF;
END;
$cron$;
