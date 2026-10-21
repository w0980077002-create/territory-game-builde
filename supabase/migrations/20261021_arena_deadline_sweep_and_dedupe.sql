-- Live rollout migration. Active/waiting rooms are advanced by public.arena_tick().
CREATE INDEX IF NOT EXISTS arena_rooms_active_deadline_v1 ON public.arena_rooms(round_deadline) WHERE status='active';
CREATE INDEX IF NOT EXISTS arena_rooms_waiting_start_v1 ON public.arena_rooms(starts_at) WHERE status='waiting';

CREATE OR REPLACE FUNCTION territory_private.arena_deadline_sweep_v1(p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_room uuid;
  v_before text;
  v_after text;
  v_seen integer := 0;
  v_closed integer := 0;
  v_human_teams integer;
  v_human_team integer;
  v_humans_alive integer;
BEGIN
  -- Every arena deadline is enforced by the server, even when Telegram is closed.
  -- SKIP LOCKED cooperates with the client's arena_state/arena_move locks.
  FOR v_room IN
    SELECT r.id FROM public.arena_rooms r
    WHERE (r.status = 'active' AND r.round_deadline <= statement_timestamp())
       OR (r.status = 'waiting' AND r.starts_at <= statement_timestamp())
    ORDER BY COALESCE(r.round_deadline, r.starts_at), r.id
    LIMIT LEAST(80, GREATEST(1, COALESCE(p_limit, 40)))
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT status INTO v_before FROM public.arena_rooms WHERE id = v_room;
    -- This uses exactly the same round/time-out logic as an open arena client.
    PERFORM public.arena_tick(v_room);
    SELECT status INTO v_after FROM public.arena_rooms WHERE id = v_room;

    -- If all *human* fighters have fallen or left, don't run endless bot-only
    -- rounds. When there was only one human team, its opponents win.
    -- In mixed-human-team matches with no living humans, treat it as a draw.
    IF v_after = 'active' THEN
      SELECT COUNT(DISTINCT p.team), MIN(p.team),
             COUNT(*) FILTER (WHERE p.hp > 0 AND p.left_at IS NULL)
      INTO v_human_teams, v_human_team, v_humans_alive
      FROM public.arena_participants p
      WHERE p.room_id = v_room AND NOT p.is_bot AND p.user_id IS NOT NULL;

      IF v_human_teams > 0 AND v_humans_alive = 0 THEN
        PERFORM public.arena_finish(v_room,
          CASE WHEN v_human_teams = 1 AND v_human_team IN (1,2)
          THEN 3 - v_human_team ELSE NULL END);
        v_after := 'finished';
      END IF;
    END IF;

    v_seen := v_seen + 1;
    IF v_before <> 'finished' AND v_after = 'finished' THEN
      v_closed := v_closed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('processed', v_seen, 'finished', v_closed);
END
$function$


REVOKE ALL ON FUNCTION territory_private.arena_deadline_sweep_v1(integer) FROM PUBLIC,anon,authenticated;

DO $s$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='territory-arena-deadlines-v1') THEN
  PERFORM cron.schedule('territory-arena-deadlines-v1','* * * * *','SELECT territory_private.arena_deadline_sweep_v1(40);');
 END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='territory-arena-logs-cleanup-v1') THEN
  PERFORM cron.unschedule('territory-arena-logs-cleanup-v1');
 END IF;
END
$s$;
