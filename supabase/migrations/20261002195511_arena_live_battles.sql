/*
# Live arena battles (1x1, 3x3, chaos) with zones, timer, chat, bots

## Overview
Replaces the old instant arena simulation with real turn-based battles that run on the server.
Each round every living fighter picks one enemy, one attack zone and two block zones.
A round resolves when everyone has moved or when the round timer ("тайм", 60s by default) runs out.
Players who do not move before the timer expires are knocked out ("проиграл по тайму").
Bots fill empty slots and are indistinguishable from players (bot flag is never exposed).

## 1. New tables
- `arena_rooms`: one battle. mode (duel/team/chaos), status (waiting/active/finished), capacity,
  timeout_seconds (30..60), round_no, round_started_at, round_deadline, starts_at, winner_team, timestamps.
- `arena_participants`: fighters in a room (players and bots). Snapshot of stats at join time,
  current hp, team (1 or 2), kills, damage dealt, adrenaline revives used, rating change, reward-claimed flag,
  left_at (set when the player leaves the room; until then the player stays in the room and keeps the chat).
- `arena_moves`: one move per fighter per round (target, attack zone, two block zones).
- `arena_messages`: battle log and player chat for a room.

## 2. Security
- RLS enabled on all four tables with NO client policies and all table privileges revoked:
  clients never read or write these tables directly.
- All access goes through SECURITY DEFINER functions that derive the caller from auth.uid(),
  check room membership, and validate every input (zones, targets, status, limits).
- Internal helper functions are not executable by clients.
- Ratings and win/loss counters are changed only by the server when a battle finishes.
- The old `process_arena_battle` function is no longer executable by clients.

## 3. Client functions
arena_join, arena_current_room, arena_state (also advances the battle), arena_move, arena_chat,
arena_time_potion (timer -10s, never below 30s), arena_revive (adrenaline, 50% hp, max 3 per battle),
arena_leave, arena_claim_reward (one-time, atomic).
*/

CREATE TABLE IF NOT EXISTS arena_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('duel','team','chaos')),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','active','finished')),
  capacity int NOT NULL,
  timeout_seconds int NOT NULL DEFAULT 60 CHECK (timeout_seconds BETWEEN 30 AND 60),
  round_no int NOT NULL DEFAULT 0,
  round_started_at timestamptz,
  round_deadline timestamptz,
  starts_at timestamptz NOT NULL,
  winner_team int,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS arena_rooms_mode_status_idx ON arena_rooms (mode, status);

CREATE TABLE IF NOT EXISTS arena_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES arena_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_bot boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  level int NOT NULL DEFAULT 1,
  rating int NOT NULL DEFAULT 1000,
  attack int NOT NULL,
  defense int NOT NULL,
  crit_chance int NOT NULL,
  max_hp int NOT NULL,
  hp int NOT NULL,
  team int,
  kills int NOT NULL DEFAULT 0,
  damage_dealt int NOT NULL DEFAULT 0,
  revives_used int NOT NULL DEFAULT 0,
  bot_ready_at timestamptz,
  rating_change int,
  rewarded boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz
);
CREATE INDEX IF NOT EXISTS arena_participants_room_idx ON arena_participants (room_id);
CREATE INDEX IF NOT EXISTS arena_participants_user_idx ON arena_participants (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS arena_participants_room_user_key ON arena_participants (room_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS arena_moves (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES arena_rooms(id) ON DELETE CASCADE,
  round_no int NOT NULL,
  participant_id uuid NOT NULL REFERENCES arena_participants(id) ON DELETE CASCADE,
  target_id uuid NOT NULL,
  attack_zone text NOT NULL,
  block_zones text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, round_no, participant_id)
);

CREATE TABLE IF NOT EXISTS arena_messages (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES arena_rooms(id) ON DELETE CASCADE,
  kind text NOT NULL,
  author text,
  author_id uuid,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arena_messages_room_idx ON arena_messages (room_id, id);

ALTER TABLE arena_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE arena_rooms, arena_participants, arena_moves, arena_messages FROM anon, authenticated;

-- ---------- internal helpers ----------

CREATE OR REPLACE FUNCTION arena_zone_ru(z text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE z WHEN 'head' THEN 'в голову' WHEN 'chest' THEN 'в грудь' WHEN 'belly' THEN 'в живот'
    WHEN 'waist' THEN 'в пояс' ELSE 'по ногам' END
$$;

CREATE OR REPLACE FUNCTION arena_msg(p_room uuid, p_kind text, p_author text, p_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO arena_messages (room_id, kind, author, body) VALUES (p_room, p_kind, p_author, p_body);
END;
$$;

CREATE OR REPLACE FUNCTION arena_bot_say(p_room uuid, p_phrases text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  SELECT name INTO v_name FROM arena_participants WHERE room_id = p_room AND is_bot ORDER BY random() LIMIT 1;
  IF v_name IS NULL THEN RETURN; END IF;
  INSERT INTO arena_messages (room_id, kind, author, body)
  VALUES (p_room, 'chat', v_name, p_phrases[1 + floor(random() * array_length(p_phrases, 1))::int]);
END;
$$;

CREATE OR REPLACE FUNCTION arena_schedule_bots(p_room uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE arena_participants SET bot_ready_at = now() + make_interval(secs => 2 + random() * 12)
  WHERE room_id = p_room AND is_bot AND hp > 0;
END;
$$;

CREATE OR REPLACE FUNCTION arena_bot_moves(p_room uuid, p_force boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_round int;
  b arena_participants%ROWTYPE;
  v_target uuid;
  v_zones text[] := ARRAY['head','chest','belly','waist','legs'];
  i int;
  j int;
BEGIN
  SELECT round_no INTO v_round FROM arena_rooms WHERE id = p_room;
  FOR b IN
    SELECT * FROM arena_participants p
    WHERE p.room_id = p_room AND p.is_bot AND p.hp > 0
      AND (p_force OR p.bot_ready_at <= now())
      AND NOT EXISTS (SELECT 1 FROM arena_moves mv WHERE mv.room_id = p_room AND mv.round_no = v_round AND mv.participant_id = p.id)
  LOOP
    SELECT id INTO v_target FROM arena_participants
    WHERE room_id = p_room AND team <> b.team AND hp > 0 ORDER BY random() LIMIT 1;
    IF v_target IS NULL THEN CONTINUE; END IF;
    i := 1 + floor(random() * 5)::int;
    j := 1 + ((i + floor(random() * 4)::int) % 5);
    INSERT INTO arena_moves (room_id, round_no, participant_id, target_id, attack_zone, block_zones)
    VALUES (p_room, v_round, b.id, v_target, v_zones[1 + floor(random() * 5)::int], ARRAY[v_zones[i], v_zones[j]])
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION arena_start_room(p_room uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room arena_rooms%ROWTYPE;
  v_humans int;
  v_present int;
  v_total int;
  v_avg_lvl numeric;
  v_avg_rating numeric;
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
  SELECT count(*), COALESCE(avg(level), 1), COALESCE(avg(rating), 1000)
    INTO v_humans, v_avg_lvl, v_avg_rating
  FROM arena_participants WHERE room_id = p_room AND NOT is_bot;
  SELECT count(*) INTO v_present FROM arena_participants WHERE room_id = p_room;

  v_total := CASE v_room.mode
    WHEN 'duel' THEN 2
    WHEN 'team' THEN 6
    ELSE LEAST(40, GREATEST(v_present + (v_present % 2), 2 * (5 + floor(random() * 16)::int)))
  END;

  FOR i IN 1..GREATEST(0, v_total - v_present) LOOP
    v_lvl := GREATEST(1, round(v_avg_lvl)::int + floor(random() * 3)::int - 1);
    v_name := v_names[1 + floor(random() * array_length(v_names, 1))::int]
      || CASE WHEN random() < 0.35 THEN '_' || (10 + floor(random() * 90)::int) ELSE '' END;
    IF EXISTS (SELECT 1 FROM arena_participants WHERE room_id = p_room AND name = v_name) THEN
      v_name := v_name || (100 + floor(random() * 900)::int);
    END IF;
    v_hp := 100 + (v_lvl - 1) * 20 + floor(random() * (v_lvl * 10 + 20))::int;
    INSERT INTO arena_participants (room_id, is_bot, name, level, rating, attack, defense, crit_chance, max_hp, hp, joined_at)
    VALUES (p_room, true, v_name, v_lvl,
      GREATEST(100, round(v_avg_rating + (random() - 0.5) * 120)::int),
      20 + (v_lvl - 1) * 5 + floor(random() * (v_lvl * 3 + 4))::int,
      5 + (v_lvl - 1) * 2 + floor(random() * (v_lvl * 2 + 3))::int,
      5 + floor(random() * 6)::int,
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
$$;

CREATE OR REPLACE FUNCTION arena_finish(p_room uuid, p_winner int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mode text;
  v_r1 numeric;
  v_r2 numeric;
  p arena_participants%ROWTYPE;
  v_enemy numeric;
  v_exp numeric;
  v_score numeric;
  v_change int;
BEGIN
  SELECT mode INTO v_mode FROM arena_rooms WHERE id = p_room;
  SELECT COALESCE(avg(rating) FILTER (WHERE team = 1), 1000), COALESCE(avg(rating) FILTER (WHERE team = 2), 1000)
    INTO v_r1, v_r2 FROM arena_participants WHERE room_id = p_room;

  UPDATE arena_rooms SET status = 'finished', winner_team = p_winner, finished_at = now(), round_deadline = NULL
  WHERE id = p_room;

  FOR p IN SELECT * FROM arena_participants WHERE room_id = p_room AND NOT is_bot AND user_id IS NOT NULL LOOP
    v_enemy := CASE WHEN p.team = 1 THEN v_r2 ELSE v_r1 END;
    v_exp := 1 / (1 + power(10, (v_enemy - p.rating) / 400.0));
    v_score := CASE WHEN p_winner IS NULL THEN 0.5 WHEN p.team = p_winner THEN 1 ELSE 0 END;
    v_change := round(32 * (v_score - v_exp))::int;
    UPDATE arena_participants SET rating_change = v_change WHERE id = p.id;
    UPDATE players SET
      arena_rating = GREATEST(100, arena_rating + v_change),
      arena_wins = arena_wins + CASE WHEN v_score = 1 THEN 1 ELSE 0 END,
      arena_losses = arena_losses + CASE WHEN v_score = 0 THEN 1 ELSE 0 END
    WHERE id = p.user_id;
  END LOOP;

  PERFORM arena_msg(p_room, 'system', NULL, CASE
    WHEN p_winner IS NULL THEN 'Бой окончен вничью'
    WHEN v_mode = 'duel' THEN 'Бой окончен. Победитель: ' ||
      (SELECT name FROM arena_participants WHERE room_id = p_room AND team = p_winner LIMIT 1)
    ELSE 'Бой окончен. Победила команда «' || CASE WHEN p_winner = 1 THEN 'Волки' ELSE 'Вороны' END || '»'
  END);

  IF random() < 0.6 THEN
    PERFORM arena_bot_say(p_room, ARRAY['гг','gg','хороший бой','гг вп','ещё раз?','норм замес','было близко']);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION arena_resolve_round(p_room uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

    SELECT block_zones INTO v_blocks FROM arena_moves
    WHERE room_id = p_room AND round_no = v_room.round_no AND participant_id = t.id;
    v_blocked := m.attack_zone = ANY(COALESCE(v_blocks, '{}'::text[]));
    v_crit := random() * 100 < a.crit_chance;
    v_mult := CASE m.attack_zone WHEN 'head' THEN 1.25 WHEN 'waist' THEN 0.9 WHEN 'legs' THEN 0.85 ELSE 1.0 END;
    v_dmg := GREATEST(1, round((a.attack * (0.85 + random() * 0.3) - t.defense * 0.5) * v_mult))::int;
    v_zone := arena_zone_ru(m.attack_zone);

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
$$;

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

-- ---------- client functions ----------

CREATE OR REPLACE FUNCTION arena_current_room() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT room_id FROM arena_participants
  WHERE user_id = auth.uid() AND left_at IS NULL
  ORDER BY joined_at DESC LIMIT 1
$$;

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
  v_hp := GREATEST(1, COALESCE(v_pl.max_hp, 100));
  INSERT INTO arena_participants (room_id, user_id, name, level, rating, attack, defense, crit_chance, max_hp, hp)
  VALUES (v_room, v_uid, v_name, GREATEST(1, COALESCE(v_pl.level, 1)), COALESCE(v_pl.arena_rating, 1000),
    GREATEST(1, COALESCE(v_pl.attack, 20)), GREATEST(0, COALESCE(v_pl.defense, 5)),
    LEAST(75, GREATEST(0, COALESCE(v_pl.crit_chance, 5))), v_hp, v_hp);

  SELECT count(*) INTO v_count FROM arena_participants WHERE room_id = v_room;
  IF v_count >= v_cap THEN
    UPDATE arena_rooms SET starts_at = now() WHERE id = v_room;
  END IF;
  PERFORM arena_msg(v_room, 'join', NULL, v_name || ' входит на арену');
  RETURN v_room;
END;
$$;

CREATE OR REPLACE FUNCTION arena_state(p_room uuid, p_after bigint DEFAULT 0) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me arena_participants%ROWTYPE;
  v_room arena_rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_me FROM arena_participants WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_member'); END IF;

  PERFORM arena_tick(p_room);

  SELECT * INTO v_me FROM arena_participants WHERE id = v_me.id;
  SELECT * INTO v_room FROM arena_rooms WHERE id = p_room;

  RETURN json_build_object(
    'now', floor(extract(epoch FROM now()) * 1000),
    'room', json_build_object(
      'id', v_room.id, 'mode', v_room.mode, 'status', v_room.status, 'round', v_room.round_no,
      'timeout', v_room.timeout_seconds,
      'deadline', CASE WHEN v_room.round_deadline IS NULL THEN NULL ELSE floor(extract(epoch FROM v_room.round_deadline) * 1000) END,
      'startsAt', floor(extract(epoch FROM v_room.starts_at) * 1000),
      'winnerTeam', v_room.winner_team),
    'me', json_build_object(
      'id', v_me.id, 'team', v_me.team, 'rewarded', v_me.rewarded, 'revivesUsed', v_me.revives_used,
      'ratingChange', v_me.rating_change,
      'moved', EXISTS (SELECT 1 FROM arena_moves WHERE room_id = p_room AND round_no = v_room.round_no AND participant_id = v_me.id)),
    'participants', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'level', p.level, 'rating', p.rating, 'hp', p.hp, 'maxHp', p.max_hp,
        'team', p.team, 'kills', p.kills, 'damage', p.damage_dealt, 'left', p.left_at IS NOT NULL,
        'moved', EXISTS (SELECT 1 FROM arena_moves mv WHERE mv.room_id = p_room AND mv.round_no = v_room.round_no AND mv.participant_id = p.id)
      ) ORDER BY p.joined_at, p.id), '[]'::json)
      FROM arena_participants p WHERE p.room_id = p_room),
    'messages', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', x.id, 'kind', x.kind, 'author', x.author, 'body', x.body,
        'at', floor(extract(epoch FROM x.created_at) * 1000)
      ) ORDER BY x.id), '[]'::json)
      FROM (SELECT * FROM arena_messages WHERE room_id = p_room AND id > COALESCE(p_after, 0) ORDER BY id DESC LIMIT 300) x)
  );
END;
$$;

CREATE OR REPLACE FUNCTION arena_move(p_room uuid, p_target uuid, p_attack text, p_blocks text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room arena_rooms%ROWTYPE;
  v_me arena_participants%ROWTYPE;
  v_zones text[] := ARRAY['head','chest','belly','waist','legs'];
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

CREATE OR REPLACE FUNCTION arena_chat(p_room uuid, p_text text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me arena_participants%ROWTYPE;
  v_text text := left(trim(COALESCE(p_text, '')), 200);
BEGIN
  SELECT * INTO v_me FROM arena_participants WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
  IF v_text = '' THEN RAISE EXCEPTION 'empty'; END IF;
  IF EXISTS (SELECT 1 FROM arena_messages WHERE room_id = p_room AND author_id = v_me.id AND created_at > now() - interval '1 second') THEN
    RAISE EXCEPTION 'too_fast';
  END IF;
  INSERT INTO arena_messages (room_id, kind, author, author_id, body) VALUES (p_room, 'chat', v_me.name, v_me.id, v_text);
END;
$$;

CREATE OR REPLACE FUNCTION arena_time_potion(p_room uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room arena_rooms%ROWTYPE;
  v_me arena_participants%ROWTYPE;
  v_new int;
BEGIN
  SELECT * INTO v_room FROM arena_rooms WHERE id = p_room FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'active' THEN RAISE EXCEPTION 'not_active'; END IF;
  SELECT * INTO v_me FROM arena_participants WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
  IF v_me.hp <= 0 THEN RAISE EXCEPTION 'dead'; END IF;
  IF v_room.timeout_seconds <= 30 THEN RAISE EXCEPTION 'min_timeout'; END IF;

  v_new := GREATEST(30, v_room.timeout_seconds - 10);
  UPDATE arena_rooms SET timeout_seconds = v_new,
    round_deadline = LEAST(round_deadline, round_started_at + make_interval(secs => v_new))
  WHERE id = p_room;
  PERFORM arena_msg(p_room, 'item', v_me.name, v_me.name || ' выпивает зелье времени: тайм сокращён до ' || v_new || ' сек.');
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION arena_revive(p_room uuid, p_target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room arena_rooms%ROWTYPE;
  v_me arena_participants%ROWTYPE;
  v_t arena_participants%ROWTYPE;
  v_hp int;
BEGIN
  SELECT * INTO v_room FROM arena_rooms WHERE id = p_room FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'active' THEN RAISE EXCEPTION 'not_active'; END IF;
  SELECT * INTO v_me FROM arena_participants WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
  IF v_me.hp <= 0 THEN RAISE EXCEPTION 'dead'; END IF;
  IF v_me.revives_used >= 3 THEN RAISE EXCEPTION 'revive_limit'; END IF;

  SELECT * INTO v_t FROM arena_participants
  WHERE id = p_target AND room_id = p_room AND team = v_me.team AND hp = 0 AND left_at IS NULL AND id <> v_me.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_target'; END IF;

  v_hp := GREATEST(1, ceil(v_t.max_hp * 0.5)::int);
  UPDATE arena_participants SET hp = v_hp, bot_ready_at = now() + make_interval(secs => 2 + random() * 8) WHERE id = v_t.id;
  UPDATE arena_participants SET revives_used = revives_used + 1 WHERE id = v_me.id;
  PERFORM arena_msg(p_room, 'revive', v_me.name,
    v_me.name || ' вкалывает адреналин: ' || v_t.name || ' возвращается в бой [' || v_hp || '/' || v_t.max_hp || ']');
END;
$$;

CREATE OR REPLACE FUNCTION arena_leave(p_room uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room arena_rooms%ROWTYPE;
  v_me arena_participants%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM arena_rooms WHERE id = p_room FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
  SELECT * INTO v_me FROM arena_participants WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_room.status = 'waiting' THEN
    DELETE FROM arena_participants WHERE id = v_me.id;
    PERFORM arena_msg(p_room, 'leave', NULL, v_me.name || ' покидает арену');
  ELSIF v_room.status = 'active' AND v_me.hp > 0 THEN
    UPDATE arena_participants SET hp = 0, left_at = now() WHERE id = v_me.id;
    PERFORM arena_msg(p_room, 'leave', NULL, v_me.name || ' покидает бой и считается павшим');
  ELSE
    UPDATE arena_participants SET left_at = now() WHERE id = v_me.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION arena_claim_reward(p_room uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me arena_participants%ROWTYPE;
  v_room arena_rooms%ROWTYPE;
  v_won boolean;
  v_draw boolean;
  v_mult numeric;
  v_gold int;
  v_xp int;
  v_rating int;
  v_wins int;
  v_losses int;
BEGIN
  UPDATE arena_participants p SET rewarded = true
  FROM arena_rooms r
  WHERE p.room_id = p_room AND r.id = p.room_id AND r.status = 'finished'
    AND p.user_id = auth.uid() AND NOT p.rewarded
  RETURNING p.* INTO v_me;
  IF v_me.id IS NULL THEN RETURN json_build_object('error', 'already_claimed'); END IF;

  SELECT * INTO v_room FROM arena_rooms WHERE id = p_room;
  v_draw := v_room.winner_team IS NULL;
  v_won := COALESCE(v_room.winner_team = v_me.team, false);
  v_mult := CASE v_room.mode WHEN 'duel' THEN 1.0 WHEN 'team' THEN 1.2 ELSE 1.5 END;
  v_gold := round(CASE WHEN v_won THEN 30 + v_me.level * 10 WHEN v_draw THEN 15 + v_me.level * 5 ELSE 5 + v_me.level * 2 END * v_mult + v_me.kills * 10)::int;
  v_xp := round(CASE WHEN v_won THEN 40 + v_me.level * 15 WHEN v_draw THEN 20 + v_me.level * 8 ELSE 10 + v_me.level * 3 END * v_mult + v_me.kills * 10)::int;

  SELECT arena_rating, arena_wins, arena_losses INTO v_rating, v_wins, v_losses FROM players WHERE id = auth.uid();

  RETURN json_build_object('won', v_won, 'draw', v_draw, 'gold', v_gold, 'xp', v_xp, 'kills', v_me.kills,
    'ratingChange', COALESCE(v_me.rating_change, 0), 'rating', v_rating, 'wins', v_wins, 'losses', v_losses);
END;
$$;

-- ---------- privileges ----------

REVOKE EXECUTE ON FUNCTION arena_zone_ru(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_msg(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_bot_say(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_schedule_bots(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_bot_moves(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_start_room(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_finish(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_resolve_round(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_tick(uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION arena_current_room() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arena_join(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arena_state(uuid, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arena_move(uuid, uuid, text, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arena_chat(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arena_time_potion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arena_revive(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arena_leave(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arena_claim_reward(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION arena_current_room() TO authenticated;
GRANT EXECUTE ON FUNCTION arena_join(text) TO authenticated;
GRANT EXECUTE ON FUNCTION arena_state(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION arena_move(uuid, uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION arena_chat(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION arena_time_potion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION arena_revive(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION arena_leave(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION arena_claim_reward(uuid) TO authenticated;

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'process_arena_battle'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
