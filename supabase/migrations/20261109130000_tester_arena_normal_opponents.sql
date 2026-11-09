-- Make owner-managed tester combat overrides meaningful in automated Arena.
-- Only changes the synthetic rival generated for an owner-controlled tester;
-- existing player match rules, real PvP and combat engine stay untouched.
CREATE OR REPLACE FUNCTION territory_private.owner_test_bot_arena_tick_v1()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'territory_private'
AS $function$
DECLARE b record; v_room uuid; v_started int := 0;
v_enemy_level int; v_enemy_attack int; v_enemy_defense int;
v_enemy_hp int; v_enemy_crit int;
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
   -- A randomly generated rival must be a NORMAL level-appropriate fighter,
   -- not a mirror of the owner's custom attack/defense/HP/critical settings.
   -- The owner's independently edited strength must have real combat value.
   v_enemy_level := GREATEST(1,b.level-1+floor(random()*3)::int);
   v_enemy_attack := GREATEST(1,round((20 + 5*(v_enemy_level-1))*(0.90 + random()*0.20))::int);
   v_enemy_defense := GREATEST(0,round((5 + 2*(v_enemy_level-1))*(0.90 + random()*0.20))::int);
   v_enemy_hp := GREATEST(1,round((100 + 20*(v_enemy_level-1))*(0.90 + random()*0.20))::int);
   v_enemy_crit := 5 + floor(random()*4)::int;
   INSERT INTO public.arena_participants(room_id,is_bot,name,level,rating,
       attack,defense,crit_chance,max_hp,hp)
   VALUES (v_room,true,
       (ARRAY['Скальд','Варяг','Хельга','ВолкСевера'])[1+floor(random()*4)::int],
       v_enemy_level,b.arena_rating,
       v_enemy_attack,v_enemy_defense,v_enemy_crit,v_enemy_hp,v_enemy_hp);
   PERFORM public.arena_start_room(v_room);
   UPDATE territory_private.owner_test_bots_v1
     SET last_arena_at=clock_timestamp() WHERE slot=b.slot;
   INSERT INTO territory_private.owner_test_bot_events_v1(slot,activity,room_id,result)
     VALUES (b.slot,'arena',v_room,'started') ON CONFLICT DO NOTHING;
   v_started:=v_started+1;
 END LOOP;
 RETURN v_started;
END $function$
;
REVOKE ALL ON FUNCTION territory_private.owner_test_bot_arena_tick_v1()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.owner_test_bot_arena_tick_v1()
  TO service_role;