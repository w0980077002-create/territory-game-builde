-- Tester-only selection guard: owner-managed Duel profiles no longer get
-- pulled into 3x3/Chaos filler and vice versa.
-- Existing Arena ±7-level matchmaking, NPC generation and combat are unchanged.
CREATE OR REPLACE FUNCTION public.arena_start_room(p_room uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_room arena_rooms%ROWTYPE;
v_humans int;
v_present int;
v_total int;
v_avg_lvl numeric;
v_avg_rating numeric;
v_avg_attack numeric;
v_avg_defense numeric;
v_avg_hp numeric;
v_avg_crit numeric;
v_lvl int;
v_hp int;
v_name text;
v_names text[] := ARRAY['Рагнар','Сигурд','Хельга','Бьорн','Ивар','Астрид','Торвальд','Фрейя','Улаф','Лагерта',
'Хротгар','Эйрик','Сольвейг','Гуннар','Кнуд','Ингрид','Харальд','Тюр','Вали','Сван','ВолкСевера','Берсерк',
'ТёмныйЯрл','Ледоруб','Медведь','Skald','Valkyr','Drakkar','Fenrir','NordKing','Wolfhart','Grimnir','Тордис',
'Хаук','Агнар','Ярослав','Мстислав','Дружинник','СтальнойКулак','Варяг'];
v_c1 int;
v_c2 int;
i int;
v_controlled record;
BEGIN
SELECT * INTO v_room FROM arena_rooms WHERE id = p_room;
-- Scale newly generated combat opponents to real participating heroes.
SELECT count(*), COALESCE(avg(level), 1), COALESCE(avg(rating), 1000),
       COALESCE(avg(attack), 20), COALESCE(avg(defense), 5),
       COALESCE(avg(max_hp), 100), COALESCE(avg(crit_chance), 5)
INTO v_humans, v_avg_lvl, v_avg_rating,
     v_avg_attack, v_avg_defense, v_avg_hp, v_avg_crit
FROM arena_participants WHERE room_id = p_room AND (NOT is_bot OR NOT EXISTS (SELECT 1 FROM arena_participants h WHERE h.room_id = p_room AND NOT h.is_bot));
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
-- Human rooms prefer an available owner-controlled tester within the existing
-- single ±7 level rule. No override of rating/power matchmaking.
IF v_humans > 0 THEN
  SELECT b.slot,b.player_id,p.display_name,p.level,p.arena_rating,
         p.attack,p.defense,p.crit_chance,p.max_hp
  INTO v_controlled
  FROM territory_private.owner_test_bots_v1 b
  JOIN public.players p ON p.id=b.player_id
  WHERE b.auto_arena AND b.arena_mode=v_room.mode AND abs(p.level - round(v_avg_lvl)::int) <= 7
    AND NOT EXISTS (SELECT 1 FROM public.arena_participants a
                    WHERE a.room_id=p_room AND a.user_id=b.player_id)
    AND NOT EXISTS (SELECT 1 FROM public.arena_participants a
                    JOIN public.arena_rooms r ON r.id=a.room_id
                    WHERE a.user_id=b.player_id AND r.status IN ('waiting','active')
                    AND r.created_at>clock_timestamp()-interval '30 minutes')
  ORDER BY b.last_arena_at NULLS FIRST,b.slot
  LIMIT 1 FOR UPDATE OF b SKIP LOCKED;
  IF FOUND THEN
    INSERT INTO public.arena_participants
      (room_id,user_id,is_bot,name,level,rating,attack,defense,crit_chance,max_hp,hp)
    VALUES
      (p_room,v_controlled.player_id,true,v_controlled.display_name,v_controlled.level,
       v_controlled.arena_rating,v_controlled.attack,v_controlled.defense,
       v_controlled.crit_chance,v_controlled.max_hp,v_controlled.max_hp);
    UPDATE territory_private.owner_test_bots_v1 SET last_arena_at=clock_timestamp()
      WHERE slot=v_controlled.slot;
    PERFORM public.arena_msg(p_room,'join',NULL,v_controlled.display_name || ' входит на арену');
    CONTINUE;
  END IF;
END IF;
v_lvl := GREATEST(1, round(v_avg_lvl)::int + floor(random() * 3)::int - 1);
v_name := v_names[1 + floor(random() * array_length(v_names, 1))::int]
|| CASE WHEN random() < 0.35 THEN '_' || (10 + floor(random() * 90)::int) ELSE '' END;
IF EXISTS (SELECT 1 FROM arena_participants WHERE room_id = p_room AND name = v_name) THEN
v_name := v_name || (100 + floor(random() * 900)::int);
END IF;
-- Approximately even real power, independent ±4% combat-stat variation.
-- Winners are always decided by arena_resolve_round, not preset outcomes.
v_hp := GREATEST(1, LEAST(200000000, round(v_avg_hp * (0.96 + random() * 0.08))::bigint))::int;
INSERT INTO arena_participants (room_id, is_bot, name, level, rating, attack, defense, crit_chance, max_hp, hp, joined_at)
VALUES (p_room, true, v_name, v_lvl,
GREATEST(100, round(v_avg_rating + (random() - 0.5) * 120)::int),
GREATEST(1, LEAST(200000000, round(v_avg_attack * (0.96 + random() * 0.08))::bigint))::int,
GREATEST(0, LEAST(200000000, round(v_avg_defense * (0.96 + random() * 0.08))::bigint))::int,
LEAST(75, GREATEST(0, round(v_avg_crit + (random() - 0.5) * 4)::int)),
v_hp, v_hp, now() + make_interval(secs => i * 0.001));
PERFORM arena_msg(p_room, 'join', NULL, v_name || ' входит на арену');
END LOOP;

WITH shuffled AS (
SELECT id, row_number() OVER (ORDER BY random()) AS rn FROM arena_participants WHERE room_id = p_room
)
UPDATE arena_participants p SET team = CASE WHEN s.rn % 2 = 1 THEN 1 ELSE 2 END, hp = p.max_hp
FROM shuffled s WHERE p.id = s.id;

-- Snapshot only after all participants, including bots, have been created.
PERFORM territory_private.runes_pin_arena_room_v1(p_room);
UPDATE arena_rooms SET status = 'active', round_no = 1, round_started_at = now(),
team_live_v1 = (v_room.mode <> 'duel'),
team1_last_attack_at = CASE WHEN v_room.mode <> 'duel' THEN now() ELSE NULL END,
team2_last_attack_at = CASE WHEN v_room.mode <> 'duel' THEN now() ELSE NULL END,
round_deadline = now() + make_interval(secs => CASE WHEN v_room.mode='duel' THEN timeout_seconds ELSE 60 END)
WHERE id = p_room;
PERFORM arena_schedule_bots(p_room);

SELECT count(*) FILTER (WHERE team = 1), count(*) FILTER (WHERE team = 2) INTO v_c1, v_c2
FROM arena_participants WHERE room_id = p_room;
PERFORM arena_msg(p_room, 'system', NULL,
CASE WHEN v_room.mode = 'duel' THEN 'Бой начался! Выбери зону удара и две зоны защиты.'
ELSE 'Бой начался! Волки (' || v_c1 || ') против Воронов (' || v_c2 || '). Выбери цель, зону удара и две зоны защиты.' END);
END;
$function$;
