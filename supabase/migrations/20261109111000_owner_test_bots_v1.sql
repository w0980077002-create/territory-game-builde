
-- Owner-controlled tester accounts participate in the same public.players and Arena statistics
-- as real players, but remain identifiable to the owner by this private registry.
CREATE TABLE IF NOT EXISTS territory_private.owner_test_bots_v1 (
  slot smallint PRIMARY KEY CHECK (slot BETWEEN 1 AND 10),
  player_id uuid UNIQUE NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  appearance text NOT NULL DEFAULT 'm1' CHECK (appearance IN ('m1','m2','f1','f2')),
  auto_arena boolean NOT NULL DEFAULT false,
  auto_campaign boolean NOT NULL DEFAULT false,
  auto_trials boolean NOT NULL DEFAULT false,
  auto_cave boolean NOT NULL DEFAULT false,
  arena_mode text NOT NULL DEFAULT 'duel' CHECK (arena_mode IN ('duel','team','chaos')),
  interval_minutes int NOT NULL DEFAULT 2 CHECK (interval_minutes BETWEEN 2 AND 1440),
  last_arena_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE territory_private.owner_test_bots_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.owner_test_bots_v1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS territory_private.owner_test_bot_events_v1 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot smallint NOT NULL REFERENCES territory_private.owner_test_bots_v1(slot),
  activity text NOT NULL CHECK (activity IN ('arena','campaign','trials','cave')),
  room_id uuid,
  result text NOT NULL CHECK (result IN ('started','won','lost','draw','failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (slot, room_id)
);
CREATE INDEX IF NOT EXISTS owner_test_bot_events_slot_idx
  ON territory_private.owner_test_bot_events_v1 (slot,created_at DESC);
ALTER TABLE territory_private.owner_test_bot_events_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.owner_test_bot_events_v1 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_admin_test_bots_list_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, territory_private AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'slot', b.slot, 'playerId', p.id, 'name', p.display_name,
    'appearance', b.appearance, 'level', p.level,
    'attack', p.attack, 'defense', p.defense, 'hp', p.max_hp,
    'crit', p.crit_chance, 'vip', p.vip_level,
    'gold', p.gold, 'gems', p.gems,
    'energy', p.energy, 'forgeMaterials', p.forge_materials,
    'arenaRating', p.arena_rating, 'arenaWins', p.arena_wins,
    'arenaLosses', p.arena_losses, 'totalBattlesWon', p.total_battles_won,
    'chapter', p.current_chapter, 'chapterWins', p.chapter_wins,
    'bossesDefeated', p.total_bosses_defeated,
    'autoArena', b.auto_arena, 'autoCampaign', b.auto_campaign,
    'autoTrials', b.auto_trials, 'autoCave', b.auto_cave,
    'arenaMode', b.arena_mode, 'intervalMinutes', b.interval_minutes,
    'lastArenaAt', b.last_arena_at,
    'arenaStarts', (SELECT count(*) FROM territory_private.owner_test_bot_events_v1 e
       WHERE e.slot=b.slot AND e.activity='arena'),
    'lastEvent', (SELECT jsonb_build_object('activity',e.activity,'result',e.result,'at',e.created_at)
       FROM territory_private.owner_test_bot_events_v1 e WHERE e.slot=b.slot
       ORDER BY e.created_at DESC LIMIT 1)
  ) ORDER BY b.slot), '[]'::jsonb)
  FROM territory_private.owner_test_bots_v1 b
  JOIN public.players p ON p.id=b.player_id
$$;
REVOKE ALL ON FUNCTION public.territory_admin_test_bots_list_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_test_bots_list_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.territory_admin_test_bot_register_v1(p_slot smallint,p_player uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, territory_private AS $$
BEGIN
 IF p_slot NOT BETWEEN 1 AND 10 OR p_player IS NULL
   OR NOT EXISTS (SELECT 1 FROM public.players WHERE id=p_player) THEN
   RAISE EXCEPTION 'invalid_bot_registration';
 END IF;
 INSERT INTO territory_private.owner_test_bots_v1(slot,player_id,appearance)
 VALUES (p_slot,p_player,CASE WHEN p_slot IN (3,5,8,10) THEN 'f1' ELSE 'm1' END)
 ON CONFLICT (slot) DO NOTHING;
 RETURN EXISTS(SELECT 1 FROM territory_private.owner_test_bots_v1
    WHERE slot=p_slot AND player_id=p_player);
END
$$;
REVOKE ALL ON FUNCTION public.territory_admin_test_bot_register_v1(smallint,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_test_bot_register_v1(smallint,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.territory_admin_test_bot_update_v1(p_slot smallint,p_patch jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, territory_private AS $$
DECLARE v_id uuid; v_key text;
BEGIN
 SELECT player_id INTO v_id FROM territory_private.owner_test_bots_v1 WHERE slot=p_slot FOR UPDATE;
 IF v_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' THEN
   RAISE EXCEPTION 'invalid_bot_update';
 END IF;
 FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
   IF v_key NOT IN ('name','appearance','level','attack','defense','hp','crit','vip',
                   'gold','gems','energy','forgeMaterials','arenaRating',
                   'autoArena','autoCampaign','autoTrials','autoCave','arenaMode','intervalMinutes') THEN
     RAISE EXCEPTION 'invalid_bot_field';
   END IF;
 END LOOP;
 IF p_patch ? 'name' AND (length(btrim(p_patch->>'name')) NOT BETWEEN 2 AND 28) THEN
   RAISE EXCEPTION 'invalid_bot_name';
 END IF;
 IF p_patch ? 'level' AND (p_patch->>'level')::int NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_bot_level'; END IF;
 IF p_patch ? 'attack' AND (p_patch->>'attack')::int NOT BETWEEN 1 AND 2000000 THEN RAISE EXCEPTION 'invalid_bot_attack'; END IF;
 IF p_patch ? 'defense' AND (p_patch->>'defense')::int NOT BETWEEN 0 AND 2000000 THEN RAISE EXCEPTION 'invalid_bot_defense'; END IF;
 IF p_patch ? 'hp' AND (p_patch->>'hp')::int NOT BETWEEN 1 AND 2000000 THEN RAISE EXCEPTION 'invalid_bot_hp'; END IF;
 IF p_patch ? 'crit' AND (p_patch->>'crit')::int NOT BETWEEN 0 AND 75 THEN RAISE EXCEPTION 'invalid_bot_crit'; END IF;
 IF p_patch ? 'vip' AND (p_patch->>'vip')::int NOT BETWEEN 0 AND 10 THEN RAISE EXCEPTION 'invalid_bot_vip'; END IF;
 IF p_patch ? 'gold' AND (p_patch->>'gold')::bigint NOT BETWEEN 0 AND 2147483647 THEN RAISE EXCEPTION 'invalid_bot_gold'; END IF;
 IF p_patch ? 'gems' AND (p_patch->>'gems')::bigint NOT BETWEEN 0 AND 2147483647 THEN RAISE EXCEPTION 'invalid_bot_gems'; END IF;
 IF p_patch ? 'energy' AND (p_patch->>'energy')::int NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'invalid_bot_energy'; END IF;
 IF p_patch ? 'forgeMaterials' AND (p_patch->>'forgeMaterials')::bigint NOT BETWEEN 0 AND 2147483647 THEN RAISE EXCEPTION 'invalid_bot_materials'; END IF;
 IF p_patch ? 'arenaRating' AND (p_patch->>'arenaRating')::int NOT BETWEEN 100 AND 100000 THEN RAISE EXCEPTION 'invalid_bot_rating'; END IF;
 IF p_patch ? 'intervalMinutes' AND (p_patch->>'intervalMinutes')::int NOT BETWEEN 2 AND 1440 THEN RAISE EXCEPTION 'invalid_bot_interval'; END IF;
 IF p_patch ? 'appearance' AND (p_patch->>'appearance') NOT IN ('m1','m2','f1','f2') THEN RAISE EXCEPTION 'invalid_bot_appearance'; END IF;
 IF p_patch ? 'arenaMode' AND (p_patch->>'arenaMode') NOT IN ('duel','team','chaos') THEN RAISE EXCEPTION 'invalid_bot_mode'; END IF;
 FOR v_key IN SELECT unnest(ARRAY['autoArena','autoCampaign','autoTrials','autoCave']) LOOP
   IF p_patch ? v_key AND jsonb_typeof(p_patch->v_key)<>'boolean' THEN RAISE EXCEPTION 'invalid_bot_toggle'; END IF;
 END LOOP;
 UPDATE public.players SET
   display_name=CASE WHEN p_patch?'name' THEN btrim(p_patch->>'name') ELSE display_name END,
   level=CASE WHEN p_patch?'level' THEN (p_patch->>'level')::int ELSE level END,
   attack=CASE WHEN p_patch?'attack' THEN (p_patch->>'attack')::int ELSE attack END,
   defense=CASE WHEN p_patch?'defense' THEN (p_patch->>'defense')::int ELSE defense END,
   max_hp=CASE WHEN p_patch?'hp' THEN (p_patch->>'hp')::int ELSE max_hp END,
   crit_chance=CASE WHEN p_patch?'crit' THEN (p_patch->>'crit')::int ELSE crit_chance END,
   vip_level=CASE WHEN p_patch?'vip' THEN (p_patch->>'vip')::int ELSE vip_level END,
   gold=CASE WHEN p_patch?'gold' THEN (p_patch->>'gold')::int ELSE gold END,
   gems=CASE WHEN p_patch?'gems' THEN (p_patch->>'gems')::int ELSE gems END,
   energy=CASE WHEN p_patch?'energy' THEN (p_patch->>'energy')::int ELSE energy END,
   forge_materials=CASE WHEN p_patch?'forgeMaterials' THEN (p_patch->>'forgeMaterials')::int ELSE forge_materials END,
   arena_rating=CASE WHEN p_patch?'arenaRating' THEN (p_patch->>'arenaRating')::int ELSE arena_rating END,
   updated_at=clock_timestamp()
 WHERE id=v_id;
 UPDATE territory_private.owner_test_bots_v1 SET
   appearance=CASE WHEN p_patch?'appearance' THEN p_patch->>'appearance' ELSE appearance END,
   auto_arena=CASE WHEN p_patch?'autoArena' THEN (p_patch->>'autoArena')::boolean ELSE auto_arena END,
   auto_campaign=CASE WHEN p_patch?'autoCampaign' THEN (p_patch->>'autoCampaign')::boolean ELSE auto_campaign END,
   auto_trials=CASE WHEN p_patch?'autoTrials' THEN (p_patch->>'autoTrials')::boolean ELSE auto_trials END,
   auto_cave=CASE WHEN p_patch?'autoCave' THEN (p_patch->>'autoCave')::boolean ELSE auto_cave END,
   arena_mode=CASE WHEN p_patch?'arenaMode' THEN p_patch->>'arenaMode' ELSE arena_mode END,
   interval_minutes=CASE WHEN p_patch?'intervalMinutes' THEN (p_patch->>'intervalMinutes')::int ELSE interval_minutes END,
   updated_at=clock_timestamp()
 WHERE slot=p_slot;
 RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.territory_admin_test_bot_update_v1(smallint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_test_bot_update_v1(smallint,jsonb) TO service_role;

-- Preserve authentic Arena outcomes for controlled tester profiles. They are
-- genuine players in public.players but server-controlled Arena participants.
CREATE OR REPLACE FUNCTION territory_private.owner_test_bot_arena_finish_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, territory_private AS $$
DECLARE v_entry record; v_result text;
BEGIN
 IF NEW.status <> 'finished' OR OLD.status='finished' THEN RETURN NEW; END IF;
 FOR v_entry IN
   SELECT b.slot,b.player_id,ap.team,ap.id AS participant_id
   FROM public.arena_participants ap
   JOIN territory_private.owner_test_bots_v1 b ON b.player_id=ap.user_id
   WHERE ap.room_id=NEW.id AND ap.is_bot
 LOOP
   v_result:=CASE WHEN NEW.winner_team IS NULL THEN 'draw'
                  WHEN NEW.winner_team=v_entry.team THEN 'won' ELSE 'lost' END;
   INSERT INTO territory_private.owner_test_bot_events_v1(slot,activity,room_id,result)
   VALUES (v_entry.slot,'arena',NEW.id,v_result)
   ON CONFLICT (slot,room_id) DO UPDATE SET result=EXCLUDED.result;
   UPDATE public.players SET
     arena_wins=arena_wins+CASE WHEN v_result='won' THEN 1 ELSE 0 END,
     arena_losses=arena_losses+CASE WHEN v_result='lost' THEN 1 ELSE 0 END,
     arena_rating=GREATEST(100,arena_rating + CASE WHEN v_result='won' THEN 16 WHEN v_result='lost' THEN -16 ELSE 0 END)
   WHERE id=v_entry.player_id;
   IF v_result='won' THEN
     -- Same shared, server-verified weekly results table as human players.
     PERFORM pg_advisory_xact_lock(14601,701);
     INSERT INTO public.arena_weekly_wins_v1(room_id,player_id,won_at)
       VALUES (NEW.id,v_entry.player_id,clock_timestamp())
     ON CONFLICT (room_id,player_id) DO NOTHING;
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS owner_test_bot_arena_finish_v1_trg ON public.arena_rooms;
CREATE TRIGGER owner_test_bot_arena_finish_v1_trg
AFTER UPDATE OF status ON public.arena_rooms
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status='finished')
EXECUTE FUNCTION territory_private.owner_test_bot_arena_finish_v1();
REVOKE ALL ON FUNCTION territory_private.owner_test_bot_arena_finish_v1() FROM PUBLIC,anon,authenticated;

-- The job exists but does not create fights until owner explicitly enables a tester.
CREATE OR REPLACE FUNCTION territory_private.owner_test_bot_arena_tick_v1()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, territory_private AS $$
DECLARE b record; v_room uuid; v_started int := 0;
BEGIN
 IF NOT public.arena_bots_on() THEN RETURN 0; END IF;
 FOR b IN
   SELECT c.slot,c.player_id,c.interval_minutes,c.arena_mode,p.display_name,p.level,p.arena_rating,
          p.attack,p.defense,p.crit_chance,p.max_hp
   FROM territory_private.owner_test_bots_v1 c
   JOIN public.players p ON p.id=c.player_id
   WHERE c.auto_arena AND clock_timestamp() >= COALESCE(c.last_arena_at,'epoch'::timestamptz)
           + make_interval(mins=>c.interval_minutes)
   ORDER BY c.slot FOR UPDATE OF c SKIP LOCKED
 LOOP
   IF EXISTS (
     SELECT 1 FROM public.arena_participants a
       JOIN public.arena_rooms r ON r.id=a.room_id
     WHERE a.user_id=b.player_id AND r.status IN ('waiting','active')
       AND r.created_at > clock_timestamp()-interval '30 minutes'
   ) THEN CONTINUE; END IF;
   INSERT INTO public.arena_rooms(mode,capacity,starts_at)
     VALUES (b.arena_mode,CASE b.arena_mode WHEN 'duel' THEN 2 WHEN 'team' THEN 6 ELSE 40 END,clock_timestamp()) RETURNING id INTO v_room;
   INSERT INTO public.arena_participants(room_id,user_id,is_bot,name,level,rating,
       attack,defense,crit_chance,max_hp,hp)
   VALUES (v_room,b.player_id,true,b.display_name,b.level,b.arena_rating,
       b.attack,b.defense,b.crit_chance,b.max_hp,b.max_hp);
   INSERT INTO public.arena_participants(room_id,is_bot,name,level,rating,
       attack,defense,crit_chance,max_hp,hp)
   VALUES (v_room,true,
       (ARRAY['Скальд','Варяг','Хельга','ВолкСевера'])[1+floor(random()*4)::int],
       GREATEST(1,b.level-1+floor(random()*3)::int),b.arena_rating,
       GREATEST(1,b.attack),GREATEST(0,b.defense),b.crit_chance,b.max_hp,b.max_hp);
   PERFORM public.arena_start_room(v_room);
   UPDATE territory_private.owner_test_bots_v1
     SET last_arena_at=clock_timestamp() WHERE slot=b.slot;
   INSERT INTO territory_private.owner_test_bot_events_v1(slot,activity,room_id,result)
     VALUES (b.slot,'arena',v_room,'started') ON CONFLICT DO NOTHING;
   v_started:=v_started+1;
 END LOOP;
 RETURN v_started;
END $$;
REVOKE ALL ON FUNCTION territory_private.owner_test_bot_arena_tick_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.owner_test_bot_arena_tick_v1() TO service_role;
SELECT cron.schedule('territory-owner-test-bots-v1','* * * * *',
   'SELECT territory_private.owner_test_bot_arena_tick_v1();');

-- Only in synthetic bot-only rooms, derive new AI opponents from the actual
-- managed tester instead of level-1 fallback. Human-room matchmaking is untouched.
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
