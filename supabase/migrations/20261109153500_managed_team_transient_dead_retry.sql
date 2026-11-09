-- Resilience for owner tester-only team cron after a combatant dies
-- mid-volley. No changes to shared Arena combat AI or damage calculations.
CREATE OR REPLACE FUNCTION territory_private.owner_test_bot_team_poll_v1(p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_room uuid; v_processed integer:=0; v_attacks_before integer; v_attacks_after integer;
  v_new_attacks integer:=0; v_finished integer:=0; v_attempt integer; v_retry_count integer:=0; v_skipped integer:=0;
BEGIN
 FOR v_room IN
   SELECT r.id
   FROM public.arena_rooms r
   WHERE r.status='active' AND r.team_live_v1=true AND r.mode IN ('team','chaos')
     AND r.created_at > clock_timestamp()-interval '30 minutes'
     AND EXISTS (
       SELECT 1 FROM public.arena_participants p
       JOIN territory_private.owner_test_bots_v1 b ON b.player_id=p.user_id
       WHERE p.room_id=r.id AND p.is_bot
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.arena_participants p
       WHERE p.room_id=r.id AND NOT p.is_bot
     )
   ORDER BY r.created_at,r.id
   LIMIT least(greatest(coalesce(p_limit,12),1),20)
   FOR UPDATE OF r SKIP LOCKED
 LOOP
   SELECT count(*) INTO v_attacks_before FROM public.arena_participants
     WHERE room_id=v_room AND last_live_attack_at IS NOT NULL;
   -- In simultaneous 3x3 volleys, a bot may die after the target list
   -- was selected but before its turn. The existing shared combat engine
   -- raises 'dead'; retry that isolated room with a fresh random turn order.
   -- Each failed attempt rolls back only its own attacks (subtransaction).
   FOR v_attempt IN 1..3 LOOP
     BEGIN
       PERFORM public.arena_tick(v_room);
       EXIT;
     EXCEPTION WHEN raise_exception THEN
       IF SQLERRM <> 'dead' THEN RAISE; END IF;
       v_retry_count:=v_retry_count+1;
       IF v_attempt=3 THEN v_skipped:=v_skipped+1; END IF;
     END;
   END LOOP;
   SELECT count(*) INTO v_attacks_after FROM public.arena_participants
     WHERE room_id=v_room AND last_live_attack_at IS NOT NULL;
   v_processed:=v_processed+1;
   v_new_attacks:=v_new_attacks+greatest(0,v_attacks_after-v_attacks_before);
   IF EXISTS(SELECT 1 FROM public.arena_rooms WHERE id=v_room AND status='finished') THEN
     v_finished:=v_finished+1;
   END IF;
 END LOOP;
 RETURN jsonb_build_object('rooms_polled',v_processed,'new_attackers',v_new_attacks,'finished',v_finished,'dead_retries',v_retry_count,'skipped_rooms',v_skipped);
END
$function$;
REVOKE ALL ON FUNCTION territory_private.owner_test_bot_team_poll_v1(integer)
FROM PUBLIC,anon,authenticated,service_role;
