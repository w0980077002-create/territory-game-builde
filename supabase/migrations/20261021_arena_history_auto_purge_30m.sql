-- TERRITORY arena: keep chat and moves only while the fight/post-fight chat is live.
-- Permanent match outcomes, rewards, players and participant statistics are never deleted.
ALTER TABLE public.arena_rooms
  ADD COLUMN IF NOT EXISTS history_purged_at timestamptz;

CREATE INDEX IF NOT EXISTS arena_rooms_history_purge_due_idx
  ON public.arena_rooms (finished_at, id)
  WHERE status = 'finished' AND history_purged_at IS NULL;

CREATE OR REPLACE FUNCTION territory_private.arena_purge_expired_history_v1(p_batch integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_room_ids uuid[];
BEGIN
  -- Lock a bounded set of completed rooms; never touch active/waiting fights.
  -- Match the existing server-enforced 30-minute post-fight chat deadline.
  SELECT array_agg(due.id) INTO v_room_ids
  FROM (
    SELECT r.id
    FROM public.arena_rooms r
    WHERE r.status = 'finished'
      AND r.finished_at IS NOT NULL
      AND r.finished_at <= clock_timestamp() - interval '30 minutes'
      AND r.history_purged_at IS NULL
    ORDER BY r.finished_at, r.id
    LIMIT GREATEST(1, LEAST(COALESCE(p_batch, 200), 200))
    FOR UPDATE SKIP LOCKED
  ) AS due;

  IF COALESCE(array_length(v_room_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.arena_moves m WHERE m.room_id = ANY(v_room_ids);
  DELETE FROM public.arena_messages m WHERE m.room_id = ANY(v_room_ids);

  -- Mark even zero-history rooms so future cron runs do not rescan them.
  UPDATE public.arena_rooms r
    SET history_purged_at = clock_timestamp()
    WHERE r.id = ANY(v_room_ids);

  RETURN array_length(v_room_ids, 1);
END;
$fn$;

REVOKE ALL ON FUNCTION territory_private.arena_purge_expired_history_v1(integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION territory_private.arena_purge_expired_history_v1(integer) IS
  'Cron-only bounded purge of old arena chat and turns after the 30-minute postfight window. Keeps rooms, participants, rewards and leaderboard stats.';

-- Idempotent job registration. Old backlog is drained in small transactions.
SELECT cron.schedule(
  'territory-arena-history-purge-v1',
  '* * * * *',
  'SELECT territory_private.arena_purge_expired_history_v1(200);'
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'territory-arena-history-purge-v1'
);
