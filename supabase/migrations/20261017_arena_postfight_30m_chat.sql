-- Arena post-battle chat: 30-minute deadline anchored to arena_rooms.finished_at.
-- This migration does not modify combat, results, rewards or active matches.

CREATE OR REPLACE FUNCTION public.arena_postfight_deadline(p_room uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT floor(extract(epoch FROM (r.finished_at + interval '30 minutes')) * 1000)::bigint
  FROM public.arena_rooms r
  JOIN public.arena_participants p ON p.room_id = r.id
  WHERE r.id = p_room
    AND p.user_id = auth.uid()
    AND p.left_at IS NULL
    AND r.status = 'finished'
    AND r.finished_at IS NOT NULL
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.arena_postfight_deadline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arena_postfight_deadline(uuid) TO authenticated;

-- The chat deadline is also checked server-side: reloading, pausing Telegram
-- or directly calling the RPC cannot extend the session.
CREATE OR REPLACE FUNCTION public.arena_chat(p_room uuid, p_text text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_me public.arena_participants%ROWTYPE;
  v_text text := left(trim(COALESCE(p_text, '')), 200);
  v_status text;
  v_finished_at timestamptz;
BEGIN
  SELECT * INTO v_me FROM public.arena_participants
  WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;

  SELECT r.status, r.finished_at INTO v_status, v_finished_at
  FROM public.arena_rooms r WHERE r.id = p_room;
  IF v_status = 'finished'
     AND (v_finished_at IS NULL OR now() >= v_finished_at + interval '30 minutes') THEN
    RAISE EXCEPTION 'chat_expired';
  END IF;

  IF v_text = '' THEN RAISE EXCEPTION 'empty'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.arena_messages
    WHERE room_id = p_room AND author_id = v_me.id
      AND created_at > now() - interval '1 second'
  ) THEN
    RAISE EXCEPTION 'too_fast';
  END IF;

  INSERT INTO public.arena_messages (room_id, kind, author, author_id, body)
  VALUES (p_room, 'chat', v_me.name, v_me.id, v_text);
END;
$$;

-- Expired, already-rewarded sessions are lazily released when the player
-- returns. Unclaimed results remain reachable so the client can claim them
-- BEFORE leaving (protects rewards after a closed/paused app).
CREATE OR REPLACE FUNCTION public.arena_current_room()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_room uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  UPDATE public.arena_participants p
  SET left_at = now()
  FROM public.arena_rooms r
  WHERE p.room_id = r.id
    AND p.user_id = auth.uid()
    AND p.left_at IS NULL
    AND p.rewarded IS TRUE
    AND r.status = 'finished'
    AND r.finished_at IS NOT NULL
    AND r.finished_at + interval '30 minutes' <= now();

  SELECT p.room_id INTO v_room
  FROM public.arena_participants p
  WHERE p.user_id = auth.uid() AND p.left_at IS NULL
  ORDER BY p.joined_at DESC LIMIT 1;
  RETURN v_room;
END;
$$;

COMMENT ON FUNCTION public.arena_postfight_deadline(uuid) IS
'Authenticated arena participant post-battle chat deadline in Unix milliseconds, fixed at finished_at + 30 minutes.';
