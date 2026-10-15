-- STAGED and INACTIVE: do NOT apply to production without simulation / approval.
-- This adjusts *Arena entry snapshots only*. PvE, XP, gear and inventories
-- remain untouched. Existing active Arena rooms are also unchanged.
-- Caveat: legitimate in-battle potions can add their normal temporary buffs.
BEGIN;
CREATE OR REPLACE FUNCTION public.territory_pvp_normalized_stats_v1(p_level int,p_attack int)
RETURNS TABLE(attack int,defense int,max_hp int,crit_chance int)
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  WITH bonus AS (
    SELECT 1.0::numeric
      + LEAST(0.03, GREATEST(0, COALESCE(p_level,1)-1) * 0.0004)
      + LEAST(0.02, GREATEST(0, COALESCE(p_attack,0)-20) * 0.00005) AS factor
  )
  SELECT round(70*factor)::integer, round(24*factor)::integer,
         round(420*factor)::integer, 7 FROM bonus;
$$;
REVOKE ALL ON FUNCTION public.territory_pvp_normalized_stats_v1(int,int)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_pvp_normalized_stats_v1(int,int)
  TO authenticated,service_role;

-- Based on the latest shipped arena_join(p_mode) body; change only insertion
-- of combat entry stats, preserving room locking, current-room and timeout rules.
CREATE OR REPLACE FUNCTION arena_join(p_mode text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room uuid;
  v_pl players%ROWTYPE;
  v_cap int;
  v_count int;
  v_name text;
  v_hp int;
  v_atk int;
  v_def int;
  v_crit int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_mode NOT IN ('duel','team','chaos') THEN RAISE EXCEPTION 'invalid_mode'; END IF;

  SELECT room_id INTO v_room FROM arena_participants
  WHERE user_id = v_uid AND left_at IS NULL ORDER BY joined_at DESC LIMIT 1;
  IF v_room IS NOT NULL THEN RETURN v_room; END IF;

  SELECT * INTO v_pl FROM players WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_player'; END IF;

  v_cap := CASE p_mode WHEN 'duel' THEN 2 WHEN 'team' THEN 6 ELSE 40 END;

  SELECT r.id INTO v_room FROM arena_rooms r
  WHERE r.mode = p_mode AND r.status = 'waiting'
    AND (SELECT count(*) FROM arena_participants ap WHERE ap.room_id = r.id) < r.capacity
  ORDER BY r.created_at LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_room IS NULL THEN
    INSERT INTO arena_rooms (mode, capacity, starts_at)
    VALUES (p_mode, v_cap, now() + make_interval(secs => CASE p_mode WHEN 'duel' THEN 12 WHEN 'team' THEN 20 ELSE 30 END))
    RETURNING id INTO v_room;
  END IF;

  v_name := COALESCE(NULLIF(trim(v_pl.display_name), ''), 'Герой');
  SELECT attack, defense, max_hp, crit_chance
  INTO v_atk, v_def, v_hp, v_crit
  FROM public.territory_pvp_normalized_stats_v1(v_pl.level, v_pl.attack);
  INSERT INTO arena_participants (room_id, user_id, name, level, rating, attack, defense, crit_chance, max_hp, hp)
  VALUES (v_room, v_uid, v_name, GREATEST(1, COALESCE(v_pl.level, 1)), COALESCE(v_pl.arena_rating, 1000),
    v_atk, v_def, v_crit, v_hp, v_hp);

  SELECT count(*) INTO v_count FROM arena_participants WHERE room_id = v_room;
  IF v_count >= v_cap THEN
    UPDATE arena_rooms SET starts_at = now() WHERE id = v_room;
  END IF;
  PERFORM arena_msg(v_room, 'join', NULL, v_name || ' входит на арену');
  RETURN v_room;
END;
$$;


REVOKE ALL ON FUNCTION public.arena_join(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_join(text) TO authenticated,service_role;
-- Bot filling uses the same normalized entry budget. Preserve admin-configured
-- bot toggle, original timeout, party sizes, and arena team assignment.
CREATE OR REPLACE FUNCTION public.arena_start_room(p_room uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_room arena_rooms%ROWTYPE;
v_humans int;
v_present int;
v_total int;
v_avg_lvl numeric;
v_avg_rating numeric;
v_lvl int;
v_hp int;
v_atk int;
v_def int;
v_crit int;
v_name text;
v_names text[] := ARRAY['Рагнар','Сигурд','Хельга','Бьорн','Ивар','Астрид','Торвальд','Фрейя','Улаф','Лагерта',
'Хротгар','Эйрик','Сольвейг','Гуннар','Кнуд','Ингрид','Харальд','Тюр','Вали','Сван','ВолкСевера','Берсерк',
'ТёмныйЯрл','Ледоруб','Медведь','Skald','Valkyr','Drakkar','Fenrir','NordKing','Wolfhart','Grimnir','Тордис',
'Хаук','Агнар','Ярослав','Мстислав','Дружинник','СтальнойКулак','Варяг'];
v_c1 int;
v_c2 int;
i int;
BEGIN
SELECT * INTO v_room FROM arena_rooms WHERE id = p_room;
SELECT count(*), COALESCE(avg(level), 1), COALESCE(avg(rating), 1000)
INTO v_humans, v_avg_lvl, v_avg_rating
FROM arena_participants WHERE room_id = p_room AND NOT is_bot;
SELECT count(*) INTO v_present FROM arena_participants WHERE room_id = p_room;

v_total := CASE v_room.mode
WHEN 'duel' THEN 2
WHEN 'team' THEN 6
ELSE LEAST(40, GREATEST(v_present + (v_present % 2), 2 * (5 + floor(random() * 16)::int)))
END;

IF NOT arena_bots_on() THEN
  IF v_present < 2 THEN
    UPDATE arena_rooms SET starts_at = now() + interval '10 seconds' WHERE id = p_room;
    RETURN;
  END IF;
  v_total := v_present;
END IF;

FOR i IN 1..GREATEST(0, v_total - v_present) LOOP
v_lvl := GREATEST(1, round(v_avg_lvl)::int + floor(random() * 3)::int - 1);
v_name := v_names[1 + floor(random() * array_length(v_names, 1))::int]
|| CASE WHEN random() < 0.35 THEN '_' || (10 + floor(random() * 90)::int) ELSE '' END;
IF EXISTS (SELECT 1 FROM arena_participants WHERE room_id = p_room AND name = v_name) THEN
v_name := v_name || (100 + floor(random() * 900)::int);
END IF;
SELECT attack,defense,max_hp,crit_chance INTO v_atk,v_def,v_hp,v_crit
FROM public.territory_pvp_normalized_stats_v1(v_lvl,20+(v_lvl-1)*5);
INSERT INTO arena_participants (room_id, is_bot, name, level, rating, attack, defense, crit_chance, max_hp, hp, joined_at)
VALUES (p_room, true, v_name, v_lvl,
GREATEST(100, round(v_avg_rating + (random() - 0.5) * 120)::int),
v_atk, v_def, v_crit,
v_hp, v_hp, now() + make_interval(secs => i * 0.001));
PERFORM arena_msg(p_room, 'join', NULL, v_name || ' входит на арену');
END LOOP;

WITH shuffled AS (
SELECT id, row_number() OVER (ORDER BY random()) AS rn FROM arena_participants WHERE room_id = p_room
)
UPDATE arena_participants p SET team = CASE WHEN s.rn % 2 = 1 THEN 1 ELSE 2 END, hp = p.max_hp
FROM shuffled s WHERE p.id = s.id;

UPDATE arena_rooms SET status = 'active', round_no = 1, round_started_at = now(),
round_deadline = now() + make_interval(secs => timeout_seconds)
WHERE id = p_room;
PERFORM arena_schedule_bots(p_room);

SELECT count(*) FILTER (WHERE team = 1), count(*) FILTER (WHERE team = 2) INTO v_c1, v_c2
FROM arena_participants WHERE room_id = p_room;
PERFORM arena_msg(p_room, 'system', NULL,
CASE WHEN v_room.mode = 'duel' THEN 'Бой начался! Выбери зону удара и две зоны защиты.'
ELSE 'Бой начался! Волки (' || v_c1 || ') против Воронов (' || v_c2 || '). Выбери цель, зону удара и две зоны защиты.' END);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.arena_start_room(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.arena_start_room(uuid) TO service_role;
COMMIT;
