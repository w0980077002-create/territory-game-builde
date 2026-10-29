-- TERRITORY 1.0: aim for 51% bot / 49% human wins among decisive unbuffed duels.
-- Never assign victories by chance or override combat results.
-- Mirrored live snapshot stats allow equipment to matter fairly.
-- Items: attack/defense +25% (minimum +10), heals 18%/35% of maximum HP
-- (minimum 50/150), crit +15 percentage points, max 75%.
-- Existing players, items, currencies, arena history and weekly rewards untouched.
-- Real 51/49 rate needs calibration using completed fights after this migration.

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

CREATE OR REPLACE FUNCTION public.arena_use_item(p_room uuid, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_room arena_rooms%ROWTYPE;
v_me arena_participants%ROWTYPE;
v_heal int;
v_hp int;
BEGIN
IF p_kind NOT IN ('heal_small', 'heal_large', 'attack', 'defense', 'crit') THEN
RAISE EXCEPTION 'bad_item';
END IF;
SELECT * INTO v_room FROM arena_rooms WHERE id = p_room FOR UPDATE;
IF NOT FOUND OR v_room.status <> 'active' THEN RAISE EXCEPTION 'not_active'; END IF;
SELECT * INTO v_me FROM arena_participants
WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
IF v_me.hp <= 0 THEN RAISE EXCEPTION 'dead'; END IF;
IF v_me.item_round = v_room.round_no THEN RAISE EXCEPTION 'item_round'; END IF;

IF p_kind IN ('heal_small', 'heal_large') THEN
IF v_me.hp >= v_me.max_hp THEN RAISE EXCEPTION 'full_hp'; END IF;
-- Restores a relevant share of maximum HP, even for high-level fighters.
v_heal := CASE p_kind
  WHEN 'heal_small' THEN GREATEST(50, round(v_me.max_hp::numeric * 0.18)::int)
  ELSE GREATEST(150, round(v_me.max_hp::numeric * 0.35)::int)
END;
v_hp := LEAST(v_me.max_hp, v_me.hp + v_heal);
UPDATE arena_participants SET hp = v_hp, item_round = v_room.round_no WHERE id = v_me.id;
PERFORM arena_msg(p_room, 'item', v_me.name,
v_me.name || ' выпивает зелье здоровья: +' || (v_hp - v_me.hp) || ' HP [' || v_hp || '/' || v_me.max_hp || ']');
RETURN;
END IF;

IF p_kind = ANY(v_me.buffs) THEN RAISE EXCEPTION 'buff_active'; END IF;
UPDATE arena_participants SET
attack = CASE WHEN p_kind = 'attack' THEN
  LEAST(2000000000::numeric, attack::numeric + GREATEST(10::numeric, round(attack::numeric * 0.25)))::int
  ELSE attack END,
defense = CASE WHEN p_kind = 'defense' THEN
  LEAST(2000000000::numeric, defense::numeric + GREATEST(10::numeric, round(defense::numeric * 0.25)))::int
  ELSE defense END,
crit_chance = CASE WHEN p_kind = 'crit' THEN LEAST(75, crit_chance + 15) ELSE crit_chance END,
buffs = array_append(buffs, p_kind),
item_round = v_room.round_no
WHERE id = v_me.id;
PERFORM arena_msg(p_room, 'item', v_me.name, v_me.name || ' выпивает ' ||
CASE p_kind
WHEN 'attack' THEN 'эликсир силы (+' || GREATEST(10::numeric, round(v_me.attack::numeric * 0.25))::int || ' к атаке)'
WHEN 'defense' THEN 'эликсир защиты (+' || GREATEST(10::numeric, round(v_me.defense::numeric * 0.25))::int || ' к защите)'
ELSE 'эликсир крита (+15 п.п. к шансу крита, максимум 75%)' END);
END;
$function$;
