-- TERRITORY arena: ephemeral battle logs.
-- Only finished rooms whose post-fight 30-minute chat has expired are eligible.
-- Never delete room/participant rows: they hold pending rewards and rankings.
-- Bounded pg_cron cleanup avoids an expensive one-shot purge on production.

ALTER TABLE public.arena_rooms
  ADD COLUMN IF NOT EXISTS logs_purged_at timestamptz;

CREATE INDEX IF NOT EXISTS arena_rooms_logs_purge_pending_idx
  ON public.arena_rooms (finished_at, id)
  WHERE status = 'finished' AND logs_purged_at IS NULL;

CREATE OR REPLACE FUNCTION territory_private.arena_purge_logs_v1(p_batch integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[];
  v_messages bigint := 0;
  v_moves bigint := 0;
  v_rooms bigint := 0;
  v_batch int := least(greatest(coalesce(p_batch, 200), 1), 200);
BEGIN
  -- Lock eligible rooms so simultaneous cron/manual runs cannot overlap.
  SELECT array_agg(candidate.id) INTO v_ids
  FROM (
    SELECT r.id
    FROM public.arena_rooms AS r
    WHERE r.status = 'finished'
      AND r.finished_at < now() - interval '30 minutes'
      AND r.logs_purged_at IS NULL
    ORDER BY r.finished_at, r.id
    LIMIT v_batch
    FOR UPDATE SKIP LOCKED
  ) AS candidate;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('rooms', 0, 'messages', 0, 'moves', 0);
  END IF;

  DELETE FROM public.arena_messages
  WHERE room_id = ANY(v_ids);
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  DELETE FROM public.arena_moves
  WHERE room_id = ANY(v_ids);
  GET DIAGNOSTICS v_moves = ROW_COUNT;

  UPDATE public.arena_rooms
  SET logs_purged_at = now()
  WHERE id = ANY(v_ids)
    AND status = 'finished';
  GET DIAGNOSTICS v_rooms = ROW_COUNT;

  RETURN jsonb_build_object('rooms', v_rooms, 'messages', v_messages, 'moves', v_moves);
END;
$function$;

-- Not an RPC. The private helper may only be run by a trusted DB/cron role.
REVOKE ALL ON FUNCTION territory_private.arena_purge_logs_v1(integer)
  FROM PUBLIC, anon, authenticated;

-- One short batch every minute, including a gradual cleanup of existing history.
SELECT cron.schedule(
  'territory-arena-logs-cleanup-v1',
  '* * * * *',
  'SELECT territory_private.arena_purge_logs_v1(200);'
);
