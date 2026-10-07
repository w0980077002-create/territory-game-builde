/*
# Arena: 4 hit zones, auto-battle, VIP level

1. Changes
- Arena now uses 4 zones: head, chest, belly, legs (waist removed). Players still pick 1 attack + 2 blocks.
- New auto-battle: a fighter can switch "auto" on; the server then makes that fighter's moves (like bots), even if the tab is closed.
- Auto-battle is gated by VIP level via `arena_auto_min_vip()` (0 during testing, will be raised to 3 later).

2. Modified tables
- `players.vip_level` (int, 0..10, default 0) - VIP tier. Clients have NO write grant on it (column-level grants), only server functions can change it.
- `arena_participants.auto` (boolean, default false) - fighter is in auto-battle mode.

3. Functions
- New `arena_set_auto(p_room, p_on)` - authenticated, checks caller's VIP level.
- New `arena_auto_min_vip()` - internal setting.
- Updated `arena_zone_ru`, `arena_schedule_bots`, `arena_bot_moves`, `arena_resolve_round`, `arena_move`, `arena_state` (now returns me.auto, me.vip, autoMinVip).

4. Security
- All internal functions stay non-executable by clients; only `arena_set_auto` is added for authenticated.
*/

ALTER TABLE players ADD COLUMN IF NOT EXISTS vip_level int NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'players_vip_level_range') THEN
    ALTER TABLE players ADD CONSTRAINT players_vip_level_range CHECK (vip_level BETWEEN 0 AND 10);
  END IF;
END $$;

ALTER TABLE arena_participants ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION arena_auto_min_vip() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 0 $$;

CREATE OR REPLACE FUNCTION arena_zone_ru(z text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE z WHEN 'head' THEN 'в голову' WHEN 'chest' THEN 'в грудь' WHEN 'belly' THEN 'в живот'
    ELSE 'по ногам' END
$$;

CREATE OR REPLACE FUNCTION arena_schedule_bots(p_room uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE arena_participants
  SET bot_ready_at = now() + CASE WHEN is_bot THEN make_interval(secs => 2 + random() * 12)
                                  ELSE make_interval(secs => 1 + random() * 3) END
  WHERE room_id = p_room AND (is_bot OR auto) AND hp > 0;
END;
$$;

CREATE OR REPLACE FUNCTION arena_bot_moves(p_room uuid, p_force boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    ORDER BY CASE WHEN b.auto THEN hp ELSE 0 END, random() LIMIT 1;
    IF v_target IS NULL THEN CONTINUE; END IF;
    i := 1 + floor(random() * 4)::int;
    j := 1 + ((i + floor(random() * 3)::int) % 4);
    INSERT INTO arena_moves (room_id, round_no, participant_id, target_id, attack_zone, block_zones)
    VALUES (p_room, v_round, b.id, v_target, v_zones[1 + floor(random() * 4)::int], ARRAY[v_zones[i], v_zones[j]])
    ON CONFLICT DO NOTHING;
  END LOOP;
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
    v_mult := CASE m.attack_zone WHEN 'head' THEN 1.25 WHEN 'legs' THEN 0.85 ELSE 1.0 END;
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

CREATE OR REPLACE FUNCTION arena_set_auto(p_room uuid, p_on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vip int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_on THEN
    SELECT vip_level INTO v_vip FROM players WHERE id = auth.uid();
    IF COALESCE(v_vip, 0) < arena_auto_min_vip() THEN RAISE EXCEPTION 'vip_required'; END IF;
  END IF;
  UPDATE arena_participants
  SET auto = COALESCE(p_on, false), bot_ready_at = now() + make_interval(secs => 1 + random() * 2)
  WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION arena_state(p_room uuid, p_after bigint DEFAULT 0) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me arena_participants%ROWTYPE;
  v_room arena_rooms%ROWTYPE;
  v_vip int;
BEGIN
  SELECT * INTO v_me FROM arena_participants WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_member'); END IF;

  PERFORM arena_tick(p_room);

  SELECT * INTO v_me FROM arena_participants WHERE id = v_me.id;
  SELECT * INTO v_room FROM arena_rooms WHERE id = p_room;
  SELECT vip_level INTO v_vip FROM players WHERE id = auth.uid();

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
      'ratingChange', v_me.rating_change, 'auto', v_me.auto, 'vip', COALESCE(v_vip, 0),
      'autoMinVip', arena_auto_min_vip(),
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

REVOKE EXECUTE ON FUNCTION arena_auto_min_vip() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_zone_ru(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_schedule_bots(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_bot_moves(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_resolve_round(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION arena_move(uuid, uuid, text, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arena_state(uuid, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION arena_set_auto(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arena_move(uuid, uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION arena_state(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION arena_set_auto(uuid, boolean) TO authenticated;
