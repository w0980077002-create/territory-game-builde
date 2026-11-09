-- Fast server-side polling for exclusively synthetic team/chaos rooms that
-- contain one of the TEN owner-managed tester accounts.
-- Preserve all public Arena bot strength, movement, damage, timers and match rules.
-- This calls the existing arena_tick, which uses existing live team strikes.
CREATE OR REPLACE FUNCTION territory_private.owner_test_bot_team_poll_v1(p_limit integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $body$
DECLARE v_room uuid; v_processed integer:=0; v_attacks_before integer; v_attacks_after integer;
  v_new_attacks integer:=0; v_finished integer:=0;
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
   PERFORM public.arena_tick(v_room);
   SELECT count(*) INTO v_attacks_after FROM public.arena_participants
     WHERE room_id=v_room AND last_live_attack_at IS NOT NULL;
   v_processed:=v_processed+1;
   v_new_attacks:=v_new_attacks+greatest(0,v_attacks_after-v_attacks_before);
   IF EXISTS(SELECT 1 FROM public.arena_rooms WHERE id=v_room AND status='finished') THEN
     v_finished:=v_finished+1;
   END IF;
 END LOOP;
 RETURN jsonb_build_object('rooms_polled',v_processed,'new_attackers',v_new_attacks,'finished',v_finished);
END
$body$;

REVOKE ALL ON FUNCTION territory_private.owner_test_bot_team_poll_v1(integer)
 FROM PUBLIC,anon,authenticated,service_role;

DO $cron$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='territory-owner-test-teams-fast-v1') THEN
   PERFORM cron.schedule('territory-owner-test-teams-fast-v1','10 seconds',
     'SELECT territory_private.owner_test_bot_team_poll_v1(12);');
 END IF;
END
$cron$;
