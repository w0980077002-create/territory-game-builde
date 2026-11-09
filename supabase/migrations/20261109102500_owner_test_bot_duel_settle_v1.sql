-- Managed tester-only duels were waiting for the 60-second PvP deadline on
-- every bot turn, which prevents a requested two-minute automation cadence.
-- Only resolve completely synthetic bot-only duel rooms, never human battles.
CREATE OR REPLACE FUNCTION territory_private.owner_test_bot_duel_settle_v1(p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_room uuid; v_round int; v_finished int := 0; v_checked int := 0;
BEGIN
  FOR v_room IN
    SELECT r.id
    FROM public.arena_rooms r
    WHERE r.status = 'active'
      AND r.mode = 'duel'
      AND r.team_live_v1 IS FALSE
      AND r.created_at <= clock_timestamp() - interval '45 seconds'
      AND EXISTS (
        SELECT 1 FROM public.arena_participants a
        JOIN territory_private.owner_test_bots_v1 b ON b.player_id = a.user_id
        WHERE a.room_id = r.id AND a.is_bot
      )
      AND (SELECT count(*) FROM public.arena_participants a WHERE a.room_id = r.id) = 2
      AND NOT EXISTS (
        SELECT 1 FROM public.arena_participants a
        WHERE a.room_id = r.id AND NOT a.is_bot
      )
    ORDER BY r.created_at, r.id
    LIMIT least(10,greatest(1,coalesce(p_limit,10)))
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    v_checked := v_checked + 1;
    FOR v_round IN 1..60 LOOP
      EXIT WHEN (SELECT status FROM public.arena_rooms WHERE id=v_room) <> 'active';
      -- This is the game's real combat resolver, preserving dodge, blocks,
      -- crits, damage, rune effects and the existing victory trigger.
      PERFORM public.arena_resolve_round(v_room);
    END LOOP;
    IF (SELECT status FROM public.arena_rooms WHERE id=v_room) = 'finished' THEN
      v_finished := v_finished + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('processed',v_checked,'finished',v_finished);
END;
$$;
REVOKE ALL ON FUNCTION territory_private.owner_test_bot_duel_settle_v1(integer)
  FROM PUBLIC,anon,authenticated,service_role;

DO $managed_test_duel_cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='territory-managed-test-duels-v1') THEN
    PERFORM cron.schedule('territory-managed-test-duels-v1','* * * * *',
      'SELECT territory_private.owner_test_bot_duel_settle_v1(10);');
  END IF;
END $managed_test_duel_cron$;
