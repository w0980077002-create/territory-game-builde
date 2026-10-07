/*
# Arena: dodge chance and belt potions/elixirs in battle

1. Modified Tables
- `arena_participants`
  - `item_round` (int, default 0): last round in which the fighter drank a belt potion/elixir (max one per round).
  - `buffs` (text[], default '{}'): elixir buffs already applied this battle (each type once per battle).

2. Gameplay changes
- `arena_resolve_round`: a 6% chance that the defender dodges an unblocked or blocked hit entirely
  (new message kind `dodge`, format "A → T: уклоняется от удара <zone>").
- New function `arena_use_item(p_room, p_kind)`:
  - kinds: heal_small (+50 HP), heal_large (+150 HP), attack (+10), defense (+10), crit (+15%).
  - only for a living member of an active room; one item per round; each elixir once per battle;
    healing never exceeds max HP. All values are fixed server-side.

3. Security
- Function is SECURITY DEFINER with fixed search_path, identifies the caller via auth.uid(),
  EXECUTE revoked from public/anon and granted to authenticated only.
- No table privileges are granted to clients.
*/

ALTER TABLE arena_participants ADD COLUMN IF NOT EXISTS item_round int NOT NULL DEFAULT 0;
ALTER TABLE arena_participants ADD COLUMN IF NOT EXISTS buffs text[] NOT NULL DEFAULT '{}';

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
v_heal := CASE p_kind WHEN 'heal_small' THEN 50 ELSE 150 END;
v_hp := LEAST(v_me.max_hp, v_me.hp + v_heal);
UPDATE arena_participants SET hp = v_hp, item_round = v_room.round_no WHERE id = v_me.id;
PERFORM arena_msg(p_room, 'item', v_me.name,
v_me.name || ' выпивает зелье здоровья: +' || (v_hp - v_me.hp) || ' HP [' || v_hp || '/' || v_me.max_hp || ']');
RETURN;
END IF;

IF p_kind = ANY(v_me.buffs) THEN RAISE EXCEPTION 'buff_active'; END IF;
UPDATE arena_participants SET
attack = attack + CASE WHEN p_kind = 'attack' THEN 10 ELSE 0 END,
defense = defense + CASE WHEN p_kind = 'defense' THEN 10 ELSE 0 END,
crit_chance = crit_chance + CASE WHEN p_kind = 'crit' THEN 15 ELSE 0 END,
buffs = array_append(buffs, p_kind),
item_round = v_room.round_no
WHERE id = v_me.id;
PERFORM arena_msg(p_room, 'item', v_me.name, v_me.name || ' выпивает ' ||
CASE p_kind WHEN 'attack' THEN 'эликсир силы (+10 к атаке)'
WHEN 'defense' THEN 'эликсир защиты (+10 к защите)'
ELSE 'эликсир крита (+15% к криту)' END);
END;
$function$;

REVOKE ALL ON FUNCTION public.arena_use_item(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.arena_use_item(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.arena_use_item(uuid, text) TO authenticated;
