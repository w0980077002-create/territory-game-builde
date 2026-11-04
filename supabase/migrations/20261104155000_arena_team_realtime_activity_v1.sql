
-- TERRITORY 1.0, Arena team/chaos real-time strikes and team inactivity.
-- ONLY new fights, 3v3/chaos: existing rooms and 1v1 stay on legacy round engine.
-- No player, item, saved state or economy rows modified by this migration.
ALTER TABLE public.arena_rooms ADD COLUMN IF NOT EXISTS team_live_v1 boolean NOT NULL DEFAULT false;
ALTER TABLE public.arena_rooms ADD COLUMN IF NOT EXISTS team1_last_attack_at timestamptz;
ALTER TABLE public.arena_rooms ADD COLUMN IF NOT EXISTS team2_last_attack_at timestamptz;
ALTER TABLE public.arena_rooms ADD COLUMN IF NOT EXISTS team1_clock_penalty integer NOT NULL DEFAULT 0 CHECK (team1_clock_penalty BETWEEN 0 AND 30);
ALTER TABLE public.arena_rooms ADD COLUMN IF NOT EXISTS team2_clock_penalty integer NOT NULL DEFAULT 0 CHECK (team2_clock_penalty BETWEEN 0 AND 30);
ALTER TABLE public.arena_participants ADD COLUMN IF NOT EXISTS last_live_attack_at timestamptz;
ALTER TABLE public.arena_participants ADD COLUMN IF NOT EXISTS last_live_blocks text[] NOT NULL DEFAULT '{}'::text[];

-- Called only by trusted server RPCs. Internal actor is not Data API exposed.
CREATE OR REPLACE FUNCTION territory_private.arena_team_strike_actor_v1(
  p_room uuid, p_attacker uuid, p_target uuid, p_attack text, p_blocks text[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, territory_private AS $actor$
DECLARE
  r public.arena_rooms%ROWTYPE;
  a public.arena_participants%ROWTYPE;
  t public.arena_participants%ROWTYPE;
  v_zones text[] := ARRAY['head','chest','belly','legs'];
  v_blocked boolean;
  v_crit boolean;
  v_dmg integer;
  v_hp integer;
  v_zone text;
  v_mult numeric;
BEGIN
  SELECT * INTO r FROM public.arena_rooms WHERE id=p_room FOR UPDATE;
  IF NOT FOUND OR r.status <> 'active' OR NOT r.team_live_v1 OR r.mode='duel' THEN RAISE EXCEPTION 'not_active'; END IF;
  SELECT * INTO a FROM public.arena_participants WHERE id=p_attacker AND room_id=p_room AND hp>0 AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'dead'; END IF;
  IF p_attack IS NULL OR NOT p_attack=ANY(v_zones) OR p_blocks IS NULL
     OR array_length(p_blocks,1) IS DISTINCT FROM 2 OR p_blocks[1]=p_blocks[2] OR NOT (p_blocks <@ v_zones)
  THEN RAISE EXCEPTION 'invalid_zones'; END IF;
  -- Server-authoritative cooldown; serialization on arena_rooms prevents double taps from replaying damage.
  IF a.last_live_attack_at IS NOT NULL AND now() < a.last_live_attack_at + interval '3 seconds'
  THEN RAISE EXCEPTION 'attack_cooldown'; END IF;
  SELECT * INTO t FROM public.arena_participants WHERE id=p_target AND room_id=p_room AND team<>a.team AND hp>0;
  IF NOT FOUND THEN
    -- An ally may finish the selected target during a simultaneous volley. Retarget instead of dropping the strike.
    SELECT * INTO t FROM public.arena_participants
      WHERE room_id=p_room AND team<>a.team AND hp>0 ORDER BY hp,random() LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;

  -- Accepted attack counts as team activity even if dodged or blocked.
  UPDATE public.arena_participants SET last_live_attack_at=now(),last_live_blocks=p_blocks WHERE id=a.id;
  IF a.team=1 THEN
    UPDATE public.arena_rooms SET team1_last_attack_at=now(),team1_clock_penalty=0 WHERE id=p_room;
  ELSE
    UPDATE public.arena_rooms SET team2_last_attack_at=now(),team2_clock_penalty=0 WHERE id=p_room;
  END IF;
  UPDATE public.arena_rooms
    SET round_deadline=LEAST(
      team1_last_attack_at + make_interval(secs => 60-team1_clock_penalty),
      team2_last_attack_at + make_interval(secs => 60-team2_clock_penalty))
    WHERE id=p_room;

  v_zone := public.arena_zone_ru(p_attack);
  IF random()*100 < territory_private.runes_arena_chance_v1(p_room,a.id,t.id,'dodge',6) THEN
    PERFORM public.arena_msg(p_room,'dodge',a.name,a.name||' → '||t.name||': уклоняется от удара '||v_zone);
    RETURN;
  END IF;
  v_blocked := p_attack=ANY(t.last_live_blocks);
  v_crit := random()*100 < territory_private.runes_arena_chance_v1(p_room,a.id,t.id,'crit',a.crit_chance);
  v_mult := CASE p_attack WHEN 'head' THEN 1.25 WHEN 'legs' THEN 0.85 ELSE 1.0 END;
  v_dmg := GREATEST(1,round((a.attack*(0.85+random()*0.3)-t.defense*0.5)*v_mult))::int;
  IF v_blocked AND NOT v_crit THEN
    PERFORM public.arena_msg(p_room,'block',a.name,a.name||' → '||t.name||': удар '||v_zone||' заблокирован');
    RETURN;
  END IF;
  IF v_blocked THEN v_dmg:=GREATEST(1,round(v_dmg*0.8))::int;
  ELSIF v_crit THEN v_dmg:=round(v_dmg*1.6)::int; END IF;
  v_dmg:=territory_private.runes_arena_damage_v1(p_room,a.id,t.id,v_dmg,v_blocked);
  UPDATE public.arena_participants SET hp=GREATEST(0,hp-v_dmg) WHERE id=t.id RETURNING hp INTO v_hp;
  UPDATE public.arena_participants SET damage_dealt=damage_dealt+LEAST(v_dmg,t.hp) WHERE id=a.id;
  PERFORM public.arena_msg(p_room,CASE WHEN v_crit THEN 'crit' ELSE 'hit' END,a.name,
    a.name||' → '||t.name||': '||
    CASE WHEN v_blocked THEN 'пробивает блок, удар ' WHEN v_crit THEN 'критический удар ' ELSE 'удар ' END||
    v_zone||', −'||v_dmg||' ['||v_hp||'/'||t.max_hp||']');
  IF v_hp=0 AND t.hp>0 THEN
    UPDATE public.arena_participants SET kills=kills+1 WHERE id=a.id;
    PERFORM public.arena_msg(p_room,'kill',a.name,t.name||' падает от удара '||a.name);
  END IF;
  -- Final death of an entire team ends the match; living medics retain adrenaline revive opportunities.
  IF NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id=p_room AND team=1 AND hp>0) THEN
    PERFORM public.arena_finish(p_room,2);
  ELSIF NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id=p_room AND team=2 AND hp>0) THEN
    PERFORM public.arena_finish(p_room,1);
  END IF;
END;
$actor$;

CREATE OR REPLACE FUNCTION territory_private.arena_team_bot_strikes_v1(p_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,territory_private AS $bots$
DECLARE
  b public.arena_participants%ROWTYPE;
  v_target uuid;
  v_zones text[] := ARRAY['head','chest','belly','legs'];
  i int;
  j int;
BEGIN
  -- Max 8 due fighters per poll prevents chaos battles from overwhelming mobile/DB.
  FOR b IN SELECT * FROM public.arena_participants p WHERE p.room_id=p_room
    AND (p.is_bot OR (p.auto AND p.left_at IS NULL)) AND p.hp>0
    AND p.bot_ready_at<=now()
    AND (p.last_live_attack_at IS NULL OR p.last_live_attack_at<=now()-interval '3 seconds')
    ORDER BY p.bot_ready_at,p.id LIMIT 8
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.arena_rooms WHERE id=p_room AND status='active') THEN EXIT; END IF;
    SELECT id INTO v_target FROM public.arena_participants
      WHERE room_id=p_room AND team<>b.team AND hp>0 ORDER BY hp,random() LIMIT 1;
    IF v_target IS NULL THEN EXIT; END IF;
    i:=1+floor(random()*4)::int;
    j:=1+((i+floor(random()*3)::int)%4);
    PERFORM territory_private.arena_team_strike_actor_v1(
      p_room,b.id,v_target,v_zones[1+floor(random()*4)::int],ARRAY[v_zones[i],v_zones[j]]);
    UPDATE public.arena_participants SET bot_ready_at=now()+make_interval(secs=>4+random()*5) WHERE id=b.id;
  END LOOP;
END;
$bots$;
REVOKE ALL ON FUNCTION territory_private.arena_team_strike_actor_v1(uuid,uuid,uuid,text,text[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION territory_private.arena_team_bot_strikes_v1(uuid) FROM PUBLIC,anon,authenticated;

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
$function$
;

CREATE OR REPLACE FUNCTION public.arena_tick(p_room uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_room arena_rooms%ROWTYPE;
v_d1 timestamptz;
v_d2 timestamptz;
v_new_round integer;
v_hp1 bigint;
v_hp2 bigint;
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

IF v_room.team_live_v1 THEN
  -- A teammate's accepted strike renews the entire team's clock. No individual timeouts.
  v_d1:=v_room.team1_last_attack_at + make_interval(secs=>60-v_room.team1_clock_penalty);
  v_d2:=v_room.team2_last_attack_at + make_interval(secs=>60-v_room.team2_clock_penalty);
  IF now()>=v_d1 AND now()>=v_d2 THEN
    PERFORM public.arena_finish(p_room,NULL);
    PERFORM public.arena_msg(p_room,'timeout',NULL,'Обе команды не атаковали 60 секунд — победителей нет');
    RETURN;
  ELSIF now()>=v_d1 THEN
    PERFORM public.arena_finish(p_room,2);
    PERFORM public.arena_msg(p_room,'timeout',NULL,'Волки не атаковали 60 секунд — техническое поражение команды');
    RETURN;
  ELSIF now()>=v_d2 THEN
    PERFORM public.arena_finish(p_room,1);
    PERFORM public.arena_msg(p_room,'timeout',NULL,'Вороны не атаковали 60 секунд — техническое поражение команды');
    RETURN;
  END IF;
  PERFORM territory_private.arena_team_bot_strikes_v1(p_room);
  SELECT * INTO v_room FROM public.arena_rooms WHERE id=p_room;
  IF v_room.status<>'active' THEN RETURN; END IF;
  v_new_round:=LEAST(60,1+floor(extract(epoch FROM (now()-v_room.round_started_at))/60)::int);
  IF v_new_round>=60 AND now() >= v_room.round_started_at+interval '60 minutes' THEN
    SELECT coalesce(sum(hp) FILTER(WHERE team=1),0),coalesce(sum(hp) FILTER(WHERE team=2),0)
      INTO v_hp1,v_hp2 FROM public.arena_participants WHERE room_id=p_room;
    PERFORM public.arena_finish(p_room,CASE WHEN v_hp1>v_hp2 THEN 1 WHEN v_hp2>v_hp1 THEN 2 ELSE NULL END);
    RETURN;
  END IF;
  UPDATE public.arena_rooms SET
    round_no=v_new_round,
    round_deadline=LEAST(
      team1_last_attack_at+make_interval(secs=>60-team1_clock_penalty),
      team2_last_attack_at+make_interval(secs=>60-team2_clock_penalty))
    WHERE id=p_room;
  RETURN;
END IF;

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
$function$
;

CREATE OR REPLACE FUNCTION public.arena_move(p_room uuid, p_target uuid, p_attack text, p_blocks text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

IF v_room.team_live_v1 THEN
  -- Important: tick first; an expired team must lose before its next late attack.
  -- If tick finishes the match, RETURN (not RAISE) to commit that result.
  PERFORM public.arena_tick(p_room);
  SELECT * INTO v_room FROM public.arena_rooms WHERE id=p_room;
  IF v_room.status <> 'active' THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.arena_participants WHERE id=v_me.id AND hp>0) THEN RETURN; END IF;
  PERFORM territory_private.arena_team_strike_actor_v1(p_room,v_me.id,p_target,p_attack,p_blocks);
  RETURN;
END IF;

INSERT INTO arena_moves (room_id, round_no, participant_id, target_id, attack_zone, block_zones)
VALUES (p_room, v_room.round_no, v_me.id, p_target, p_attack, p_blocks)
ON CONFLICT (room_id, round_no, participant_id) DO NOTHING;
GET DIAGNOSTICS v_cnt = ROW_COUNT;
IF v_cnt = 0 THEN RAISE EXCEPTION 'already_moved'; END IF;

PERFORM arena_tick(p_room);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.arena_state(p_room uuid, p_after bigint DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
SELECT territory_private.fortune_vip_v1(auth.uid()) INTO v_vip;

RETURN json_build_object(
'now', floor(extract(epoch FROM now()) * 1000),
'room', json_build_object(
'id', v_room.id, 'mode', v_room.mode, 'status', v_room.status, 'round', v_room.round_no,
'timeout', v_room.timeout_seconds,
'deadline', CASE WHEN v_room.round_deadline IS NULL THEN NULL ELSE floor(extract(epoch FROM v_room.round_deadline) * 1000) END,
'startsAt', floor(extract(epoch FROM v_room.starts_at) * 1000),
'winnerTeam', v_room.winner_team,
'teamLive', v_room.team_live_v1,
'teamDeadline1', CASE WHEN v_room.team_live_v1 AND v_room.status='active'
  THEN floor(extract(epoch FROM (v_room.team1_last_attack_at+make_interval(secs=>60-v_room.team1_clock_penalty)))*1000)
  ELSE NULL END,
'teamDeadline2', CASE WHEN v_room.team_live_v1 AND v_room.status='active'
  THEN floor(extract(epoch FROM (v_room.team2_last_attack_at+make_interval(secs=>60-v_room.team2_clock_penalty)))*1000)
  ELSE NULL END),
'me', json_build_object(
'id', v_me.id, 'team', v_me.team, 'rewarded', v_me.rewarded, 'revivesUsed', v_me.revives_used,
'ratingChange', v_me.rating_change, 'auto', v_me.auto, 'vip', COALESCE(v_vip, 0),
'autoMinVip', arena_auto_min_vip(),
'nextStrikeAt', CASE WHEN v_room.team_live_v1 AND v_me.last_live_attack_at IS NOT NULL
  THEN floor(extract(epoch FROM (v_me.last_live_attack_at+interval '3 seconds'))*1000)
  ELSE NULL END,
'moved', CASE WHEN v_room.team_live_v1 THEN false ELSE
  EXISTS (SELECT 1 FROM arena_moves WHERE room_id = p_room AND round_no = v_room.round_no AND participant_id = v_me.id) END),
'participants', (
SELECT COALESCE(json_agg(json_build_object(
'id', p.id, 'name', p.name, 'level', p.level, 'rating', p.rating, 'hp', p.hp, 'maxHp', p.max_hp,
'team', p.team, 'kills', p.kills, 'damage', p.damage_dealt, 'left', p.left_at IS NOT NULL,
'moved', CASE WHEN v_room.team_live_v1 THEN (p.last_live_attack_at IS NOT NULL) ELSE
  EXISTS (SELECT 1 FROM arena_moves mv WHERE mv.room_id = p_room AND mv.round_no = v_room.round_no AND mv.participant_id = p.id) END
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
$function$
;

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
IF v_room.team_live_v1 THEN RETURN; END IF;
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

IF random() * 100 < territory_private.runes_arena_chance_v1(p_room,a.id,t.id,'dodge',6) THEN
PERFORM arena_msg(p_room, 'dodge', a.name, a.name || ' → ' || t.name || ': уклоняется от удара ' || v_zone);
CONTINUE;
END IF;

SELECT block_zones INTO v_blocks FROM arena_moves
WHERE room_id = p_room AND round_no = v_room.round_no AND participant_id = t.id;
v_blocked := m.attack_zone = ANY(COALESCE(v_blocks, '{}'::text[]));
v_crit := random() * 100 < territory_private.runes_arena_chance_v1(p_room,a.id,t.id,'crit',a.crit_chance);
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

-- The original targeting, dodge, block, crit and base damage have already resolved.
v_dmg := territory_private.runes_arena_damage_v1(p_room,a.id,t.id,v_dmg,v_blocked);
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
$function$
;

CREATE OR REPLACE FUNCTION public.arena_time_potion(p_room uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
IF v_room.team_live_v1 THEN
  -- In team combat the Time Potion pressures the OPPOSING team clock; never removes a teammate.
  IF v_me.team=1 THEN
    IF v_room.team2_clock_penalty>=30 THEN RAISE EXCEPTION 'min_timeout'; END IF;
    UPDATE public.arena_rooms SET team2_clock_penalty=LEAST(30,team2_clock_penalty+10)
    WHERE id=p_room RETURNING team2_clock_penalty INTO v_new;
  ELSE
    IF v_room.team1_clock_penalty>=30 THEN RAISE EXCEPTION 'min_timeout'; END IF;
    UPDATE public.arena_rooms SET team1_clock_penalty=LEAST(30,team1_clock_penalty+10)
    WHERE id=p_room RETURNING team1_clock_penalty INTO v_new;
  END IF;
  PERFORM public.arena_msg(p_room,'item',v_me.name,
    v_me.name||' использует зелье времени: тайм соперников сокращён на 10 секунд');
  UPDATE public.arena_rooms SET round_deadline=LEAST(
    team1_last_attack_at+make_interval(secs=>60-team1_clock_penalty),
    team2_last_attack_at+make_interval(secs=>60-team2_clock_penalty))
  WHERE id=p_room;
  -- The next state poll or move processes an expired clock; do not silently swallow the effect.
  PERFORM public.arena_tick(p_room);
  RETURN 60-v_new;
END IF;
IF v_room.timeout_seconds <= 30 THEN RAISE EXCEPTION 'min_timeout'; END IF;

v_new := GREATEST(30, v_room.timeout_seconds - 10);
UPDATE arena_rooms SET timeout_seconds = v_new,
round_deadline = LEAST(round_deadline, round_started_at + make_interval(secs => v_new))
WHERE id = p_room;
PERFORM arena_msg(p_room, 'item', v_me.name, v_me.name || ' выпивает зелье времени: тайм сокращён до ' || v_new || ' сек.');
RETURN v_new;
END;
$function$
;
