-- TERRITORY Monopoly Classic: separate board economy, server dice, property, rent,
-- houses, human rooms (2-4), bots, resume. No player inventory/gems changed.
-- Staged: DO NOT install in production without isolated tests and owner's release check.
BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='45s';
CREATE TABLE IF NOT EXISTS territory_private.mono_classic_rooms_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text UNIQUE NOT NULL CHECK (code ~ '^[A-F0-9]{6}$'),
 host uuid NOT NULL REFERENCES public.players(id),
 mode text NOT NULL CHECK (mode IN ('solo','online')),
 seats integer NOT NULL CHECK (seats BETWEEN 2 AND 4),
 state text NOT NULL DEFAULT 'lobby' CHECK (state IN ('lobby','playing','finished','cancelled')),
 turn_seat integer NOT NULL DEFAULT 0 CHECK (turn_seat BETWEEN 0 AND 3),
 phase text NOT NULL DEFAULT 'roll' CHECK (phase IN ('roll','buy')),
 turns integer NOT NULL DEFAULT 0 CHECK (turns BETWEEN 0 AND 200),
 landed integer CHECK (landed BETWEEN 0 AND 27),
 last_roll integer CHECK (last_roll BETWEEN 2 AND 12),
 winner_seat integer,
 last_event text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS territory_private.mono_classic_seats_v1 (
 room_id uuid NOT NULL REFERENCES territory_private.mono_classic_rooms_v1(id) ON DELETE CASCADE,
 seat integer NOT NULL CHECK (seat BETWEEN 0 AND 3),
 player_id uuid REFERENCES public.players(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 48),
 bot boolean NOT NULL,
 cash integer NOT NULL DEFAULT 750 CHECK(cash BETWEEN 0 AND 50000),
 position integer NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 27),
 bankrupt boolean NOT NULL DEFAULT false,
 PRIMARY KEY(room_id,seat),
 UNIQUE(room_id,player_id),
 CHECK ((player_id IS NULL) = bot)
);
CREATE TABLE IF NOT EXISTS territory_private.mono_classic_members_v1 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
 room_id uuid NOT NULL REFERENCES territory_private.mono_classic_rooms_v1(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS territory_private.mono_classic_properties_v1 (
 room_id uuid NOT NULL REFERENCES territory_private.mono_classic_rooms_v1(id) ON DELETE CASCADE,
 cell integer NOT NULL CHECK(cell BETWEEN 1 AND 27),
 owner_seat integer NOT NULL CHECK(owner_seat BETWEEN 0 AND 3),
 houses integer NOT NULL DEFAULT 0 CHECK(houses BETWEEN 0 AND 3),
 last_built_turn integer NOT NULL DEFAULT -1,
 PRIMARY KEY(room_id,cell)
);
CREATE INDEX IF NOT EXISTS mono_classic_room_member_idx_v1 ON territory_private.mono_classic_members_v1(room_id);
CREATE INDEX IF NOT EXISTS mono_classic_room_seats_idx_v1 ON territory_private.mono_classic_seats_v1(room_id);
ALTER TABLE territory_private.mono_classic_rooms_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.mono_classic_seats_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.mono_classic_members_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.mono_classic_properties_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.mono_classic_rooms_v1,territory_private.mono_classic_seats_v1,
 territory_private.mono_classic_members_v1,territory_private.mono_classic_properties_v1 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION territory_private.mono_classic_price_v1(p_cell integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='pg_catalog' AS $$
 SELECT CASE WHEN p_cell BETWEEN 1 AND 27 AND p_cell NOT IN (7,14,21)
 THEN 60+p_cell*8 ELSE 0 END
$$;
CREATE OR REPLACE FUNCTION territory_private.mono_classic_rent_v1(p_cell integer,p_houses integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='pg_catalog' AS $$
 SELECT (territory_private.mono_classic_price_v1(p_cell)*16/100)
        *(1+greatest(0,least(3,p_houses))*2)
$$;

-- On the server, get the next active seat or finish the game. One receipt per game.
CREATE OR REPLACE FUNCTION territory_private.mono_classic_advance_v1(p_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $advance$
DECLARE r territory_private.mono_classic_rooms_v1%ROWTYPE;
 v_alive integer; v_winner integer; v_next integer; v_step integer;
 v_human record; v_account territory_private.hall_accounts_v1%ROWTYPE;
 v_prize integer;v_day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 SELECT * INTO r FROM territory_private.mono_classic_rooms_v1 WHERE id=p_room FOR UPDATE;
 IF r.state<>'playing' THEN RETURN; END IF;
 SELECT count(*) INTO v_alive FROM territory_private.mono_classic_seats_v1 WHERE room_id=p_room AND NOT bankrupt;
 IF v_alive<=1 OR r.turns>=120 THEN
   SELECT s.seat INTO v_winner FROM territory_private.mono_classic_seats_v1 s
   WHERE s.room_id=p_room
   ORDER BY (s.cash + COALESCE((
    SELECT sum(territory_private.mono_classic_price_v1(p.cell)*(1+p.houses))
    FROM territory_private.mono_classic_properties_v1 p WHERE p.room_id=p_room AND p.owner_seat=s.seat
   ),0)) DESC,s.seat ASC LIMIT 1;
   UPDATE territory_private.mono_classic_rooms_v1
   SET state='finished',phase='roll',winner_seat=v_winner,updated_at=clock_timestamp(),
    last_event='Игра завершена' WHERE id=p_room;
   -- In-hall gold only. Limited, claimable via the existing secured claim RPC.
   FOR v_human IN SELECT player_id,seat FROM territory_private.mono_classic_seats_v1
    WHERE room_id=p_room AND player_id IS NOT NULL
   LOOP
     SELECT * INTO v_account FROM territory_private.hall_accounts_v1
       WHERE player_id=v_human.player_id FOR UPDATE;
     v_prize:=CASE WHEN v_human.seat=v_winner THEN least(50,
       greatest(0,1000-CASE WHEN v_account.daily_day=v_day THEN v_account.daily_gold ELSE 0 END),
       greatest(0,100000-v_account.pending_gold)) ELSE 0 END;
     UPDATE territory_private.hall_accounts_v1
     SET played=least(10000000,played+1),
      wins=least(10000000,wins+CASE WHEN v_human.seat=v_winner THEN 1 ELSE 0 END),
      points=least(100000000,points+CASE WHEN v_human.seat=v_winner THEN 8 ELSE 2 END),
      pending_gold=pending_gold+v_prize,
      daily_gold=CASE WHEN daily_day=v_day THEN daily_gold ELSE 0 END+v_prize,
      daily_day=v_day WHERE player_id=v_human.player_id;
     INSERT INTO territory_private.hall_history_v1(player_id,game,won,earned_gold,points)
      VALUES(v_human.player_id,'monopoly',v_human.seat=v_winner,v_prize,
       CASE WHEN v_human.seat=v_winner THEN 8 ELSE 2 END);
   END LOOP;
   RETURN;
 END IF;
 FOR v_step IN 1..4 LOOP
  v_next:=(r.turn_seat+v_step)%r.seats;
  IF EXISTS(SELECT 1 FROM territory_private.mono_classic_seats_v1
    WHERE room_id=p_room AND seat=v_next AND NOT bankrupt) THEN
    UPDATE territory_private.mono_classic_rooms_v1
      SET turn_seat=v_next,phase='roll',landed=NULL,last_roll=NULL,
       turns=turns+1,updated_at=clock_timestamp() WHERE id=p_room;
    RETURN;
  END IF;
 END LOOP;
END;
$advance$;

-- Apply a landing exactly once, with all transfers under one room-row lock.
CREATE OR REPLACE FUNCTION territory_private.mono_classic_land_v1(p_room uuid,p_seat integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $land$
DECLARE s territory_private.mono_classic_seats_v1%ROWTYPE;
 r territory_private.mono_classic_rooms_v1%ROWTYPE;
 p territory_private.mono_classic_properties_v1%ROWTYPE;
 v_price integer;v_rent integer;v_paid integer;
BEGIN
 SELECT * INTO r FROM territory_private.mono_classic_rooms_v1 WHERE id=p_room FOR UPDATE;
 SELECT * INTO s FROM territory_private.mono_classic_seats_v1
   WHERE room_id=p_room AND seat=p_seat FOR UPDATE;
 IF r.state<>'playing' OR r.turn_seat<>p_seat THEN RAISE EXCEPTION 'mono_not_your_turn'; END IF;
 IF s.position=7 THEN
  UPDATE territory_private.mono_classic_seats_v1 SET cash=greatest(0,cash-55),
   bankrupt=(cash<=55) WHERE room_id=p_room AND seat=p_seat;
  UPDATE territory_private.mono_classic_rooms_v1 SET last_event='Налог порта: −55' WHERE id=p_room;
 ELSIF s.position=14 THEN
  UPDATE territory_private.mono_classic_seats_v1 SET cash=least(50000,cash+95) WHERE room_id=p_room AND seat=p_seat;
  UPDATE territory_private.mono_classic_rooms_v1 SET last_event='Сундук: +95' WHERE id=p_room;
 ELSIF s.position=21 THEN
  UPDATE territory_private.mono_classic_seats_v1 SET cash=least(50000,cash+45) WHERE room_id=p_room AND seat=p_seat;
  UPDATE territory_private.mono_classic_rooms_v1 SET last_event='Попутный ветер: +45' WHERE id=p_room;
 ELSE
  v_price:=territory_private.mono_classic_price_v1(s.position);
  IF v_price>0 THEN
   SELECT * INTO p FROM territory_private.mono_classic_properties_v1
      WHERE room_id=p_room AND cell=s.position;
   IF NOT FOUND THEN
    IF s.cash>=v_price THEN
     UPDATE territory_private.mono_classic_rooms_v1 SET phase='buy',landed=s.position,
      last_event='Участок свободен — можно купить за '||v_price WHERE id=p_room;
     RETURN;
    END IF;
   ELSIF p.owner_seat<>p_seat THEN
    v_rent:=territory_private.mono_classic_rent_v1(s.position,p.houses);
    v_paid:=least(v_rent,s.cash);
    UPDATE territory_private.mono_classic_seats_v1 SET cash=cash-v_paid,
      bankrupt=(cash=v_paid) WHERE room_id=p_room AND seat=p_seat;
    UPDATE territory_private.mono_classic_seats_v1 SET cash=least(50000,cash+v_paid)
      WHERE room_id=p_room AND seat=p.owner_seat;
    UPDATE territory_private.mono_classic_rooms_v1 SET last_event='Аренда: −'||v_paid WHERE id=p_room;
   END IF;
  END IF;
 END IF;
 -- Bankrupts lose property to the bank; no player can buy or collect it after leaving.
 IF EXISTS(SELECT 1 FROM territory_private.mono_classic_seats_v1
   WHERE room_id=p_room AND seat=p_seat AND bankrupt) THEN
  DELETE FROM territory_private.mono_classic_properties_v1 WHERE room_id=p_room AND owner_seat=p_seat;
 END IF;
 PERFORM territory_private.mono_classic_advance_v1(p_room);
END;
$land$;

CREATE OR REPLACE FUNCTION territory_private.mono_classic_view_v1(p_room uuid,p_viewer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $view$
DECLARE r territory_private.mono_classic_rooms_v1%ROWTYPE;
 v_room jsonb;v_seats jsonb;v_properties jsonb;v_own_seat integer;
BEGIN
 SELECT * INTO r FROM territory_private.mono_classic_rooms_v1 WHERE id=p_room;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM territory_private.mono_classic_members_v1
     WHERE player_id=p_viewer AND room_id=p_room)
 THEN RAISE EXCEPTION 'mono_room_access_denied'; END IF;
 SELECT seat INTO v_own_seat FROM territory_private.mono_classic_seats_v1
   WHERE room_id=p_room AND player_id=p_viewer;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('seat',seat,'name',name,
  'bot',bot,'cash',cash,'position',position,'bankrupt',bankrupt,'mine',seat=v_own_seat)
  ORDER BY seat),'[]'::jsonb) INTO v_seats
 FROM territory_private.mono_classic_seats_v1 WHERE room_id=p_room;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('cell',cell,'owner',owner_seat,'houses',houses,
  'price',territory_private.mono_classic_price_v1(cell),
  'rent',territory_private.mono_classic_rent_v1(cell,houses)) ORDER BY cell),'[]'::jsonb)
 INTO v_properties FROM territory_private.mono_classic_properties_v1 WHERE room_id=p_room;
 v_room:=jsonb_build_object('id',r.id,'code',r.code,'mode',r.mode,
  'seats',r.seats,'state',r.state,'turn',r.turn_seat,'phase',r.phase,'turns',r.turns,
  'landed',r.landed,'last_roll',r.last_roll,'winner',r.winner_seat,
  'last_event',r.last_event,'updated_at',r.updated_at,
  'host',r.host=p_viewer,'my_seat',v_own_seat);
 RETURN jsonb_build_object('room',v_room,'players',v_seats,'properties',v_properties);
END;
$view$;

CREATE OR REPLACE FUNCTION public.territory_monopoly_classic_v1(
 p_action text DEFAULT 'status',p_code text DEFAULT NULL,p_choice integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $rpc$
DECLARE
 u uuid:=auth.uid(); v_room uuid; v_roomrow territory_private.mono_classic_rooms_v1%ROWTYPE;
 v_account territory_private.hall_accounts_v1%ROWTYPE; v_seat territory_private.mono_classic_seats_v1%ROWTYPE;
 v_prop territory_private.mono_classic_properties_v1%ROWTYPE;
 v_code text; v_players integer; v_n integer; v_roll integer; v_old integer;
 v_cell integer; v_price integer; v_count integer; v_tries integer;
 v_today timestamptz:=clock_timestamp();
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT banned)
 THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 IF p_action NOT IN ('status','solo','create','join','start','roll','buy','pass','build','bot','leave','resign')
 OR p_action IS NULL THEN RAISE EXCEPTION 'mono_bad_action'; END IF;
 IF p_code IS NOT NULL AND (length(p_code)>12 OR p_code !~ '^[A-Fa-f0-9]{6}$')
 THEN RAISE EXCEPTION 'mono_invalid_code'; END IF;
 PERFORM public.territory_hall_status_v1();
 SELECT * INTO v_account FROM territory_private.hall_accounts_v1 WHERE player_id=u FOR UPDATE;
 SELECT room_id INTO v_room FROM territory_private.mono_classic_members_v1 WHERE player_id=u;
 IF p_action IN ('solo','create','join') THEN
  IF v_room IS NOT NULL THEN RAISE EXCEPTION 'mono_already_playing'; END IF;
  IF EXISTS(SELECT 1 FROM territory_private.hall_sessions_v1
    WHERE player_id=u AND created_at>v_today-interval '15 minutes')
  THEN RAISE EXCEPTION 'mono_other_hall_round'; END IF;
  IF v_account.tickets<1 THEN RAISE EXCEPTION 'hall_no_tickets'; END IF;
  IF p_action='join' THEN
   SELECT * INTO v_roomrow FROM territory_private.mono_classic_rooms_v1
    WHERE code=upper(p_code) FOR UPDATE;
   IF NOT FOUND OR v_roomrow.state<>'lobby' OR v_roomrow.mode<>'online'
   THEN RAISE EXCEPTION 'mono_room_not_found'; END IF;
   SELECT count(*) INTO v_players FROM territory_private.mono_classic_seats_v1 WHERE room_id=v_roomrow.id;
   IF v_players>=v_roomrow.seats THEN RAISE EXCEPTION 'mono_room_full'; END IF;
   SELECT g.i INTO v_n FROM generate_series(0,v_roomrow.seats-1) g(i)
   WHERE NOT EXISTS(SELECT 1 FROM territory_private.mono_classic_seats_v1
    WHERE room_id=v_roomrow.id AND seat=g.i) ORDER BY g.i LIMIT 1;
  ELSE
   IF p_action='create' AND (p_choice IS NULL OR p_choice NOT BETWEEN 2 AND 4)
   THEN RAISE EXCEPTION 'mono_invalid_seats'; END IF;
   v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
   INSERT INTO territory_private.mono_classic_rooms_v1(code,host,mode,seats,state)
   VALUES (v_code,u,CASE WHEN p_action='solo' THEN 'solo' ELSE 'online' END,
           CASE WHEN p_action='solo' THEN 4 ELSE p_choice END,
           CASE WHEN p_action='solo' THEN 'playing' ELSE 'lobby' END)
   RETURNING * INTO v_roomrow;
   v_n:=0;
  END IF;
  INSERT INTO territory_private.mono_classic_seats_v1(room_id,seat,player_id,name,bot)
   SELECT v_roomrow.id,v_n,u,left(coalesce(NULLIF(p.display_name,''),'Герой'),48),false
   FROM public.players p WHERE p.id=u;
  INSERT INTO territory_private.mono_classic_members_v1(player_id,room_id)
    VALUES(u,v_roomrow.id);
  UPDATE territory_private.hall_accounts_v1 SET tickets=tickets-1 WHERE player_id=u;
  v_room:=v_roomrow.id;
  IF p_action='solo' THEN
   FOR v_n IN 1..3 LOOP
    INSERT INTO territory_private.mono_classic_seats_v1(room_id,seat,name,bot)
      VALUES(v_room,v_n,(ARRAY['Северный ярл','Хитрый торговец','Страж лагуны'])[v_n],true);
   END LOOP;
  END IF;
 ELSIF v_room IS NULL THEN
  IF p_action='status' THEN
   RETURN jsonb_build_object('tickets',v_account.tickets,'room',NULL);
  END IF;
  RAISE EXCEPTION 'mono_no_active_room';
 END IF;
 SELECT * INTO v_roomrow FROM territory_private.mono_classic_rooms_v1
   WHERE id=v_room FOR UPDATE;
 SELECT * INTO v_seat FROM territory_private.mono_classic_seats_v1
   WHERE room_id=v_room AND player_id=u;
 IF p_action='start' THEN
  IF v_roomrow.mode<>'online' OR v_roomrow.host<>u OR v_roomrow.state<>'lobby'
  THEN RAISE EXCEPTION 'mono_cannot_start'; END IF;
  SELECT count(*) INTO v_players FROM territory_private.mono_classic_seats_v1 WHERE room_id=v_room;
  IF v_players<2 THEN RAISE EXCEPTION 'mono_need_two_players'; END IF;
  -- Fill no bots in online rooms; act only with joined seats.
  UPDATE territory_private.mono_classic_rooms_v1 SET state='playing',seats=v_players,
  updated_at=clock_timestamp() WHERE id=v_room;
 ELSIF p_action='leave' THEN
  IF v_roomrow.state='lobby' THEN
   IF v_roomrow.host=u THEN
    UPDATE territory_private.hall_accounts_v1 SET tickets=least(1000,tickets+1)
     WHERE player_id IN (SELECT player_id FROM territory_private.mono_classic_seats_v1
      WHERE room_id=v_room AND player_id IS NOT NULL);
    DELETE FROM territory_private.mono_classic_members_v1 WHERE room_id=v_room;
    UPDATE territory_private.mono_classic_rooms_v1 SET state='cancelled' WHERE id=v_room;
    RETURN jsonb_build_object('tickets',v_account.tickets+1,'room',NULL);
   ELSE
    DELETE FROM territory_private.mono_classic_seats_v1
     WHERE room_id=v_room AND player_id=u;
    DELETE FROM territory_private.mono_classic_members_v1 WHERE player_id=u;
    UPDATE territory_private.hall_accounts_v1 SET tickets=least(1000,tickets+1) WHERE player_id=u;
    RETURN jsonb_build_object('tickets',v_account.tickets+1,'room',NULL);
   END IF;
  ELSIF v_roomrow.state='finished' OR v_roomrow.state='cancelled' THEN
   DELETE FROM territory_private.mono_classic_members_v1 WHERE player_id=u;
   RETURN jsonb_build_object('tickets',v_account.tickets,'room',NULL);
  ELSE
   RAISE EXCEPTION 'mono_resign_required';
  END IF;
 ELSIF p_action='resign' THEN
  IF v_roomrow.state<>'playing' THEN RAISE EXCEPTION 'mono_not_playing'; END IF;
  UPDATE territory_private.mono_classic_seats_v1 SET bankrupt=true,cash=0
   WHERE room_id=v_room AND seat=v_seat.seat;
  DELETE FROM territory_private.mono_classic_properties_v1
   WHERE room_id=v_room AND owner_seat=v_seat.seat;
  IF v_roomrow.turn_seat=v_seat.seat THEN
   PERFORM territory_private.mono_classic_advance_v1(v_room);
  ELSE
   SELECT count(*) INTO v_players FROM territory_private.mono_classic_seats_v1
    WHERE room_id=v_room AND NOT bankrupt;
   IF v_players<=1 THEN
     PERFORM territory_private.mono_classic_advance_v1(v_room);
   END IF;
  END IF;
 ELSIF p_action='roll' THEN
  IF v_roomrow.state<>'playing' OR v_roomrow.phase<>'roll'
   OR v_roomrow.turn_seat<>v_seat.seat OR v_seat.bankrupt
  THEN RAISE EXCEPTION 'mono_not_your_turn'; END IF;
  v_roll:=2+floor(random()*11)::int;
  v_old:=v_seat.position;
  UPDATE territory_private.mono_classic_seats_v1 SET position=(position+v_roll)%28,
   cash=least(50000,cash+CASE WHEN position+v_roll>=28 THEN 120 ELSE 0 END)
   WHERE room_id=v_room AND seat=v_seat.seat;
  UPDATE territory_private.mono_classic_rooms_v1
   SET last_roll=v_roll,last_event='Бросок '||v_roll||CASE WHEN v_old+v_roll>=28 THEN ' · Старт +120' ELSE '' END,
   updated_at=clock_timestamp() WHERE id=v_room;
  PERFORM territory_private.mono_classic_land_v1(v_room,v_seat.seat);
 ELSIF p_action='build' THEN
  IF v_roomrow.state<>'playing' OR v_roomrow.turn_seat<>v_seat.seat
   OR v_roomrow.phase<>'roll' OR p_choice IS NULL OR p_choice NOT BETWEEN 1 AND 27
  THEN RAISE EXCEPTION 'mono_cannot_build'; END IF;
  SELECT * INTO v_prop FROM territory_private.mono_classic_properties_v1
   WHERE room_id=v_room AND cell=p_choice FOR UPDATE;
  IF NOT FOUND OR v_prop.owner_seat<>v_seat.seat OR v_prop.houses>=3 OR
   v_prop.last_built_turn=v_roomrow.turns THEN RAISE EXCEPTION 'mono_cannot_build'; END IF;
  v_price:=territory_private.mono_classic_price_v1(p_choice)/2;
  IF v_seat.cash<v_price THEN RAISE EXCEPTION 'mono_insufficient_cash'; END IF;
  UPDATE territory_private.mono_classic_seats_v1 SET cash=cash-v_price
   WHERE room_id=v_room AND seat=v_seat.seat;
  UPDATE territory_private.mono_classic_properties_v1 SET houses=houses+1,
   last_built_turn=v_roomrow.turns WHERE room_id=v_room AND cell=p_choice;
  UPDATE territory_private.mono_classic_rooms_v1 SET last_event='Постройка на клетке '||p_choice,
   updated_at=clock_timestamp() WHERE id=v_room;
 ELSIF p_action IN ('buy','pass') THEN
  IF v_roomrow.state<>'playing' OR v_roomrow.phase<>'buy'
   OR v_roomrow.turn_seat<>v_seat.seat OR v_seat.bankrupt
  THEN RAISE EXCEPTION 'mono_not_buy_phase'; END IF;
  IF p_action='buy' THEN
   v_price:=territory_private.mono_classic_price_v1(v_roomrow.landed);
   IF v_price=0 OR v_seat.cash<v_price THEN RAISE EXCEPTION 'mono_insufficient_cash'; END IF;
   INSERT INTO territory_private.mono_classic_properties_v1(room_id,cell,owner_seat)
      VALUES(v_room,v_roomrow.landed,v_seat.seat);
   UPDATE territory_private.mono_classic_seats_v1 SET cash=cash-v_price
    WHERE room_id=v_room AND seat=v_seat.seat;
   UPDATE territory_private.mono_classic_rooms_v1
    SET last_event='Куплена клетка '||v_roomrow.landed WHERE id=v_room;
  END IF;
  PERFORM territory_private.mono_classic_advance_v1(v_room);
 ELSIF p_action='bot' THEN
  FOR v_tries IN 1..8 LOOP
   SELECT * INTO v_roomrow FROM territory_private.mono_classic_rooms_v1 WHERE id=v_room FOR UPDATE;
   EXIT WHEN v_roomrow.state<>'playing';
   SELECT * INTO v_seat FROM territory_private.mono_classic_seats_v1
    WHERE room_id=v_room AND seat=v_roomrow.turn_seat;
   EXIT WHEN NOT v_seat.bot;
   IF v_roomrow.phase='buy' THEN
    v_price:=territory_private.mono_classic_price_v1(v_roomrow.landed);
    IF v_seat.cash>=v_price+170 THEN
     INSERT INTO territory_private.mono_classic_properties_v1(room_id,cell,owner_seat)
      VALUES(v_room,v_roomrow.landed,v_seat.seat);
     UPDATE territory_private.mono_classic_seats_v1 SET cash=cash-v_price
      WHERE room_id=v_room AND seat=v_seat.seat;
     UPDATE territory_private.mono_classic_rooms_v1 SET last_event='Бот купил клетку '||v_roomrow.landed WHERE id=v_room;
    END IF;
    PERFORM territory_private.mono_classic_advance_v1(v_room);
   ELSE
    SELECT cell INTO v_cell FROM territory_private.mono_classic_properties_v1
     WHERE room_id=v_room AND owner_seat=v_seat.seat
      AND houses<3 AND last_built_turn<>v_roomrow.turns
      AND v_seat.cash>territory_private.mono_classic_price_v1(cell)/2+220
     ORDER BY houses,cell LIMIT 1;
    IF FOUND THEN
      UPDATE territory_private.mono_classic_seats_v1 SET cash=cash-territory_private.mono_classic_price_v1(v_cell)/2
       WHERE room_id=v_room AND seat=v_seat.seat;
      UPDATE territory_private.mono_classic_properties_v1
       SET houses=houses+1,last_built_turn=v_roomrow.turns
       WHERE room_id=v_room AND cell=v_cell;
    END IF;
    v_roll:=2+floor(random()*11)::int;
    UPDATE territory_private.mono_classic_seats_v1
     SET position=(position+v_roll)%28,
     cash=least(50000,cash+CASE WHEN position+v_roll>=28 THEN 120 ELSE 0 END)
     WHERE room_id=v_room AND seat=v_seat.seat;
    UPDATE territory_private.mono_classic_rooms_v1
     SET last_roll=v_roll,last_event='Бот бросил '||v_roll,updated_at=clock_timestamp() WHERE id=v_room;
    PERFORM territory_private.mono_classic_land_v1(v_room,v_seat.seat);
   END IF;
  END LOOP;
 END IF;
 SELECT * INTO v_account FROM territory_private.hall_accounts_v1 WHERE player_id=u;
 RETURN territory_private.mono_classic_view_v1(v_room,u)
   || jsonb_build_object('tickets',v_account.tickets);
END;
$rpc$;
REVOKE ALL ON FUNCTION public.territory_monopoly_classic_v1(text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_monopoly_classic_v1(text,text,integer) TO authenticated;
REVOKE ALL ON FUNCTION territory_private.mono_classic_advance_v1(uuid),
 territory_private.mono_classic_land_v1(uuid,integer),
 territory_private.mono_classic_view_v1(uuid,uuid),
 territory_private.mono_classic_price_v1(integer),
 territory_private.mono_classic_rent_v1(integer,integer) FROM PUBLIC,anon,authenticated;
COMMIT;
