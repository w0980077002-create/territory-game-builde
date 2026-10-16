-- Server-enforced fair PvP matchmaking. No change to character save files or reward formulas.
-- Fix: earlier arena_join took the oldest waiting room without considering participants'
-- level, attack, defense, health or rating. Level 12 could meet level 81 / 10M HP.
-- New rooms with no compatible real opponent still fill with local-level bots at start.
-- Only new matchmaking is affected: live, finished and rewarded rooms are unchanged.

CREATE OR REPLACE FUNCTION public.arena_match_compatible(
  a_level integer, a_hp integer, a_attack integer, a_defense integer, a_rating integer,
  b_level integer, b_hp integer, b_attack integer, b_defense integer, b_rating integer
)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT
    -- Tight level brackets at low levels; slightly broader above level 40.
    abs(greatest(1, coalesce(a_level, 1)) - greatest(1, coalesce(b_level, 1)))
       <= greatest(4, least(10, least(greatest(1, coalesce(a_level, 1)), greatest(1, coalesce(b_level, 1))) / 4))
    AND abs(coalesce(a_rating, 1000)::bigint - coalesce(b_rating, 1000)::bigint) <= 700
    -- Level alone isn't enough: forged/high-buff saves have millions of HP.
    AND greatest(coalesce(a_hp, 1), coalesce(b_hp, 1))::numeric
        <= 3 * greatest(1, least(coalesce(a_hp, 1), coalesce(b_hp, 1)))::numeric
    AND greatest(coalesce(a_attack, 1), coalesce(b_attack, 1))::numeric
        <= 4 * greatest(1, least(coalesce(a_attack, 1), coalesce(b_attack, 1)))::numeric
    AND greatest(coalesce(a_defense, 0), coalesce(b_defense, 0))::numeric
        <= 4 * greatest(1, least(coalesce(a_defense, 0), coalesce(b_defense, 0)))::numeric;
$$;

CREATE OR REPLACE FUNCTION public.arena_join(p_mode text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room uuid;
  v_pl public.players%ROWTYPE;
  v_cap int;
  v_count int;
  v_name text;
  v_hp int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_mode NOT IN ('duel', 'team', 'chaos') THEN RAISE EXCEPTION 'invalid_mode'; END IF;

  -- Preserve current room/reward collection and 30-minute postfight chat flow.
  SELECT room_id INTO v_room FROM public.arena_participants
  WHERE user_id = v_uid AND left_at IS NULL ORDER BY joined_at DESC LIMIT 1;
  IF v_room IS NOT NULL THEN RETURN v_room; END IF;

  SELECT * INTO v_pl FROM public.players WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_player'; END IF;

  v_cap := CASE p_mode WHEN 'duel' THEN 2 WHEN 'team' THEN 6 ELSE 40 END;

  -- Compare against ALL real humans in the lobby. Bots are generated only
  -- once the compatible lobby starts, so high-power players cannot join weak lobbies.
  -- FOR UPDATE prevents two simultaneous joins from overfilling one room.
  SELECT r.id INTO v_room FROM public.arena_rooms r
  WHERE r.mode = p_mode AND r.status = 'waiting'
    AND (SELECT count(*) FROM public.arena_participants ap WHERE ap.room_id = r.id) < r.capacity
    AND NOT EXISTS (
      SELECT 1 FROM public.arena_participants ap
      WHERE ap.room_id = r.id
        AND NOT ap.is_bot
        AND NOT public.arena_match_compatible(
          v_pl.level, v_pl.max_hp, v_pl.attack, v_pl.defense, v_pl.arena_rating,
          ap.level, ap.max_hp, ap.attack, ap.defense, ap.rating
        )
    )
  ORDER BY r.created_at LIMIT 1
  FOR UPDATE OF r SKIP LOCKED;

  IF v_room IS NULL THEN
    INSERT INTO public.arena_rooms (mode, capacity, starts_at)
    VALUES (p_mode, v_cap, now() + make_interval(secs => CASE p_mode WHEN 'duel' THEN 12 WHEN 'team' THEN 20 ELSE 30 END))
    RETURNING id INTO v_room;
  END IF;

  v_name := coalesce(nullif(trim(v_pl.display_name), ''), 'Герой');
  v_hp := greatest(1, coalesce(v_pl.max_hp, 100));
  INSERT INTO public.arena_participants
    (room_id, user_id, name, level, rating, attack, defense, crit_chance, max_hp, hp)
  VALUES
    (v_room, v_uid, v_name, greatest(1, coalesce(v_pl.level, 1)), coalesce(v_pl.arena_rating, 1000),
      greatest(1, coalesce(v_pl.attack, 20)), greatest(0, coalesce(v_pl.defense, 5)),
      least(75, greatest(0, coalesce(v_pl.crit_chance, 5))), v_hp, v_hp);

  SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = v_room;
  IF v_count >= v_cap THEN UPDATE public.arena_rooms SET starts_at = now() WHERE id = v_room; END IF;
  PERFORM public.arena_msg(v_room, 'join', NULL, v_name || ' входит на арену');
  RETURN v_room;
END;
$$;

COMMENT ON FUNCTION public.arena_match_compatible(integer,integer,integer,integer,integer,integer,integer,integer,integer,integer) IS
'Enforces level, rating and proportional HP/attack/defense windows for REAL human PvP matchups; does not change PvP combat stats.';
