/*
# Admin panel core

1. New Tables
- `game_settings` (single row id=1): maintenance, arena_bots_enabled, shop_sale, gold_x2, updated_at. Public read-only config for the game client.
- `admin_grants`: pending admin adjustments and in-game letters per player (kind 'adjust' | 'mail', subject, body, payload jsonb, created_at, claimed_at).
- `donations`: real-money red gem purchases (player_id, red_gems, amount_usd, created_at). Written only by the server.
- `admin_audit_log`: record of admin actions and failed logins. Server-only.

2. Modified Tables
- `players`: new `banned` (bool, default false) and `last_seen_at` (timestamptz). Players cannot change these (no column grants).
- Update policy on `players` now also requires `banned = false` so banned players cannot save progress.

3. Functions
- `player_heartbeat()`: signed-in player marks themselves online; returns banned flag, settings and unclaimed grants.
- `claim_admin_grant(p_id)`: atomically claims a player's own grant once and returns its payload.
- `arena_bots_on()`: reads the bots toggle.
- `admin_reset_arena_bots()`: server-only; closes stuck arena rooms and wakes bots.
- `arena_start_room` recreated: when bots are disabled no bots are added and a room waits for at least 2 real players.

4. Security
- RLS enabled on all new tables. game_settings readable by everyone; admin_grants readable only by owner; donations and audit log have no client policies (server only).
*/

CREATE TABLE IF NOT EXISTS game_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  maintenance boolean NOT NULL DEFAULT false,
  arena_bots_enabled boolean NOT NULL DEFAULT true,
  shop_sale boolean NOT NULL DEFAULT false,
  gold_x2 boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO game_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE game_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_game_settings" ON game_settings;
CREATE POLICY "read_game_settings" ON game_settings FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON game_settings FROM anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='banned') THEN
    ALTER TABLE players ADD COLUMN banned boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='last_seen_at') THEN
    ALTER TABLE players ADD COLUMN last_seen_at timestamptz;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS players_last_seen_idx ON players (last_seen_at);
CREATE INDEX IF NOT EXISTS players_telegram_idx ON players (telegram_id);

DROP POLICY IF EXISTS "update_own_player" ON players;
CREATE POLICY "update_own_player" ON players FOR UPDATE TO authenticated
  USING (auth.uid() = id AND banned = false) WITH CHECK (auth.uid() = id AND banned = false);

CREATE TABLE IF NOT EXISTS admin_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('adjust','mail')),
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS admin_grants_player_idx ON admin_grants (player_id, claimed_at);
ALTER TABLE admin_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_grants" ON admin_grants;
CREATE POLICY "select_own_grants" ON admin_grants FOR SELECT TO authenticated USING (auth.uid() = player_id);
REVOKE INSERT, UPDATE, DELETE ON admin_grants FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  red_gems int NOT NULL CHECK (red_gems > 0),
  amount_usd numeric(10,2) NOT NULL CHECK (amount_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS donations_created_idx ON donations (created_at DESC);
CREATE INDEX IF NOT EXISTS donations_player_idx ON donations (player_id);
ALTER TABLE donations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON donations FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit_log (action, created_at DESC);
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_audit_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION player_heartbeat() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_banned boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE players SET last_seen_at = now() WHERE id = v_uid RETURNING banned INTO v_banned;
  RETURN json_build_object(
    'banned', COALESCE(v_banned, false),
    'settings', (SELECT row_to_json(s) FROM (SELECT maintenance, shop_sale, gold_x2 FROM game_settings WHERE id = 1) s),
    'grants', COALESCE((SELECT json_agg(g ORDER BY g.created_at DESC) FROM (
      SELECT id, kind, subject, body, payload, created_at FROM admin_grants
      WHERE player_id = v_uid AND claimed_at IS NULL ORDER BY created_at DESC LIMIT 50) g), '[]'::json)
  );
END $$;
REVOKE EXECUTE ON FUNCTION player_heartbeat() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION player_heartbeat() TO authenticated;

CREATE OR REPLACE FUNCTION claim_admin_grant(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_payload jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE admin_grants SET claimed_at = now()
  WHERE id = p_id AND player_id = auth.uid() AND claimed_at IS NULL
  RETURNING payload INTO v_payload;
  RETURN v_payload;
END $$;
REVOKE EXECUTE ON FUNCTION claim_admin_grant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_admin_grant(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION arena_bots_on() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT arena_bots_enabled FROM game_settings WHERE id = 1), true);
$$;
REVOKE EXECUTE ON FUNCTION arena_bots_on() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION admin_reset_arena_bots() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_closed int;
BEGIN
  WITH stuck AS (
    UPDATE arena_rooms r SET status = 'finished', finished_at = now()
    WHERE r.status IN ('waiting','active')
      AND (r.created_at < now() - interval '30 minutes'
        OR NOT EXISTS (SELECT 1 FROM arena_participants p WHERE p.room_id = r.id AND NOT p.is_bot AND p.left_at IS NULL))
    RETURNING r.id)
  SELECT count(*) INTO v_closed FROM stuck;
  UPDATE arena_participants p SET bot_ready_at = now()
  FROM arena_rooms r WHERE r.id = p.room_id AND r.status = 'active' AND p.is_bot;
  RETURN v_closed;
END $$;
REVOKE EXECUTE ON FUNCTION admin_reset_arena_bots() FROM PUBLIC, anon, authenticated;

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
$function$;
REVOKE EXECUTE ON FUNCTION public.arena_start_room(uuid) FROM PUBLIC, anon, authenticated;
