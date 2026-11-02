-- Generated exact checked-in Arena functions for disposable database tests.
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
BEGIN
SELECT * INTO v_room FROM arena_rooms WHERE id = p_room;
-- Scale newly generated combat opponents to real participating heroes.
SELECT count(*), COALESCE(avg(level), 1), COALESCE(avg(rating), 1000),
       COALESCE(avg(attack), 20), COALESCE(avg(defense), 5),
       COALESCE(avg(max_hp), 100), COALESCE(avg(crit_chance), 5)
INTO v_humans, v_avg_lvl, v_avg_rating,
     v_avg_attack, v_avg_defense, v_avg_hp, v_avg_crit
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

CREATE OR REPLACE FUNCTION public.arena_resolve_round(p_room uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_room arena_rooms%ROWTYPE;
v_alive uuid[];
m arena_moves%ROWTYPE;
a arena_participants%ROWTYPE;
t arena_participants%ROWTYPE;
v_blocks text[];
v_blocked boolean;
v_crit boolean;
v_mult numeric;
v_dmg int;
v_new_hp int;
v_zone text;
v_alive1 int;
v_alive2 int;
v_hp1 bigint;
v_hp2 bigint;
BEGIN
SELECT * INTO v_room FROM arena_rooms WHERE id = p_room;
PERFORM arena_bot_moves(p_room, true);

FOR a IN
SELECT * FROM arena_participants p
WHERE p.room_id = p_room AND p.hp > 0
AND NOT EXISTS (SELECT 1 FROM arena_moves mv WHERE mv.room_id = p_room AND mv.round_no = v_room.round_no AND mv.participant_id = p.id)
LOOP
UPDATE arena_participants SET hp = 0 WHERE id = a.id;
PERFORM arena_msg(p_room, 'timeout', NULL,
a.name || ' не сделал ход за ' || v_room.timeout_seconds || ' сек. и выбывает по тайму');
END LOOP;

v_alive := ARRAY(SELECT id FROM arena_participants WHERE room_id = p_room AND hp > 0);

FOR m IN
SELECT * FROM arena_moves
WHERE room_id = p_room AND round_no = v_room.round_no AND participant_id = ANY(v_alive)
ORDER BY random()
LOOP
SELECT * INTO a FROM arena_participants WHERE id = m.participant_id;
SELECT * INTO t FROM arena_participants
WHERE id = m.target_id AND room_id = p_room AND team <> a.team AND id = ANY(v_alive);
IF NOT FOUND THEN
SELECT * INTO t FROM arena_participants
WHERE room_id = p_room AND team <> a.team AND id = ANY(v_alive) ORDER BY random() LIMIT 1;
IF NOT FOUND THEN CONTINUE; END IF;
END IF;

v_zone := arena_zone_ru(m.attack_zone);

IF random() * 100 < 6 THEN
PERFORM arena_msg(p_room, 'dodge', a.name, a.name || ' → ' || t.name || ': уклоняется от удара ' || v_zone);
CONTINUE;
END IF;

SELECT block_zones INTO v_blocks FROM arena_moves
WHERE room_id = p_room AND round_no = v_room.round_no AND participant_id = t.id;
v_blocked := m.attack_zone = ANY(COALESCE(v_blocks, '{}'::text[]));
v_crit := random() * 100 < a.crit_chance;
v_mult := CASE m.attack_zone WHEN 'head' THEN 1.25 WHEN 'legs' THEN 0.85 ELSE 1.0 END;
v_dmg := GREATEST(1, round((a.attack * (0.85 + random() * 0.3) - t.defense * 0.5) * v_mult))::int;

IF v_blocked AND NOT v_crit THEN
PERFORM arena_msg(p_room, 'block', a.name, a.name || ' → ' || t.name || ': удар ' || v_zone || ' заблокирован');
CONTINUE;
END IF;
IF v_blocked THEN
v_dmg := GREATEST(1, round(v_dmg * 0.8))::int;
ELSIF v_crit THEN
v_dmg := round(v_dmg * 1.6)::int;
END IF;

UPDATE arena_participants SET hp = GREATEST(0, hp - v_dmg) WHERE id = t.id RETURNING hp INTO v_new_hp;
UPDATE arena_participants SET damage_dealt = damage_dealt + LEAST(v_dmg, t.hp) WHERE id = a.id;
PERFORM arena_msg(p_room, CASE WHEN v_crit THEN 'crit' ELSE 'hit' END, a.name,
a.name || ' → ' || t.name || ': ' ||
CASE WHEN v_blocked THEN 'пробивает блок, удар ' WHEN v_crit THEN 'критический удар ' ELSE 'удар ' END ||
v_zone || ', −' || v_dmg || ' [' || v_new_hp || '/' || t.max_hp || ']');

IF v_new_hp = 0 AND t.hp > 0 THEN
UPDATE arena_participants SET kills = kills + 1 WHERE id = a.id;
PERFORM arena_msg(p_room, 'kill', a.name, t.name || ' падает от удара ' || a.name);
END IF;
END LOOP;

SELECT count(*) FILTER (WHERE team = 1 AND hp > 0), count(*) FILTER (WHERE team = 2 AND hp > 0),
COALESCE(sum(hp) FILTER (WHERE team = 1), 0), COALESCE(sum(hp) FILTER (WHERE team = 2), 0)
INTO v_alive1, v_alive2, v_hp1, v_hp2
FROM arena_participants WHERE room_id = p_room;

IF v_alive1 = 0 AND v_alive2 = 0 THEN
PERFORM arena_finish(p_room, NULL);
ELSIF v_alive1 = 0 THEN
PERFORM arena_finish(p_room, 2);
ELSIF v_alive2 = 0 THEN
PERFORM arena_finish(p_room, 1);
ELSIF v_room.round_no >= 60 THEN
PERFORM arena_finish(p_room, CASE WHEN v_hp1 > v_hp2 THEN 1 WHEN v_hp2 > v_hp1 THEN 2 ELSE NULL END);
ELSE
UPDATE arena_rooms SET round_no = round_no + 1, round_started_at = now(),
round_deadline = now() + make_interval(secs => timeout_seconds)
WHERE id = p_room;
PERFORM arena_schedule_bots(p_room);
END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.arena_bot_moves(p_room uuid, p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_round int;
b arena_participants%ROWTYPE;
v_target uuid;
v_zones text[] := ARRAY['head','chest','belly','legs'];
i int;
j int;
BEGIN
SELECT round_no INTO v_round FROM arena_rooms WHERE id = p_room;
FOR b IN
SELECT * FROM arena_participants p
WHERE p.room_id = p_room AND (p.is_bot OR (p.auto AND p.left_at IS NULL)) AND p.hp > 0
AND (p_force OR p.bot_ready_at <= now())
AND NOT EXISTS (SELECT 1 FROM arena_moves mv WHERE mv.room_id = p_room AND mv.round_no = v_round AND mv.participant_id = p.id)
LOOP
SELECT id INTO v_target FROM arena_participants
WHERE room_id = p_room AND team <> b.team AND hp > 0
-- Favor the least-healthy enemy rather than a random target.
ORDER BY CASE WHEN b.is_bot OR b.auto THEN hp ELSE 0 END, random() LIMIT 1;
IF v_target IS NULL THEN CONTINUE; END IF;
i := 1 + floor(random() * 4)::int;
j := 1 + ((i + floor(random() * 3)::int) % 4);
INSERT INTO arena_moves (room_id, round_no, participant_id, target_id, attack_zone, block_zones)
VALUES (p_room, v_round, b.id, v_target, v_zones[1 + floor(random() * 4)::int], ARRAY[v_zones[i], v_zones[j]])
ON CONFLICT DO NOTHING;
END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION arena_tick(p_room uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room arena_rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM arena_rooms WHERE id = p_room FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_room.status = 'waiting' THEN
    IF NOT EXISTS (SELECT 1 FROM arena_participants WHERE room_id = p_room AND NOT is_bot) THEN
      UPDATE arena_rooms SET status = 'finished', finished_at = now() WHERE id = p_room;
    ELSIF now() >= v_room.starts_at THEN
      PERFORM arena_start_room(p_room);
    END IF;
    RETURN;
  END IF;

  IF v_room.status <> 'active' THEN RETURN; END IF;

  PERFORM arena_bot_moves(p_room, false);
  IF random() < 0.025 THEN
    PERFORM arena_bot_say(p_room, ARRAY['Вперёд!','Держитесь!','кто со мной?','ну давай давай','хил бы сейчас...',
      'Один, дай мне силы!','лол','сейчас разнесём','аккуратнее с критами','бейте по одному','жми быстрее','за Вальхаллу!']);
  END IF;

  IF now() >= v_room.round_deadline OR NOT EXISTS (
    SELECT 1 FROM arena_participants p
    WHERE p.room_id = p_room AND p.hp > 0
      AND NOT EXISTS (SELECT 1 FROM arena_moves mv WHERE mv.room_id = p_room AND mv.round_no = v_room.round_no AND mv.participant_id = p.id)
  ) THEN
    PERFORM arena_resolve_round(p_room);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION arena_move(p_room uuid, p_target uuid, p_attack text, p_blocks text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room arena_rooms%ROWTYPE;
  v_me arena_participants%ROWTYPE;
  v_zones text[] := ARRAY['head','chest','belly','legs'];
  v_cnt int;
BEGIN
  SELECT * INTO v_room FROM arena_rooms WHERE id = p_room FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'active' THEN RAISE EXCEPTION 'not_active'; END IF;
  SELECT * INTO v_me FROM arena_participants WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
  IF v_me.hp <= 0 THEN RAISE EXCEPTION 'dead'; END IF;
  IF p_attack IS NULL OR NOT (p_attack = ANY(v_zones)) OR p_blocks IS NULL OR array_length(p_blocks, 1) IS DISTINCT FROM 2
     OR p_blocks[1] = p_blocks[2] OR NOT (p_blocks <@ v_zones) THEN
    RAISE EXCEPTION 'invalid_zones';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM arena_participants WHERE id = p_target AND room_id = p_room AND team <> v_me.team AND hp > 0) THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  INSERT INTO arena_moves (room_id, round_no, participant_id, target_id, attack_zone, block_zones)
  VALUES (p_room, v_room.round_no, v_me.id, p_target, p_attack, p_blocks)
  ON CONFLICT (room_id, round_no, participant_id) DO NOTHING;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN RAISE EXCEPTION 'already_moved'; END IF;

  PERFORM arena_tick(p_room);
END;
$$;
