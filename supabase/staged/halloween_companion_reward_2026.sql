-- STAGED ONLY. NEVER deploy before code review, PostgreSQL/JWT tests and safe cutover.
-- Halloween raid 2026: every signed-in fighter with >= 1 confirmed hit receives
-- the separate Pumpkin Witch companion AFTER the event ends. No player save writes.
CREATE TABLE IF NOT EXISTS territory_private.halloween_companion_rewards_2026 (
  event_id text NOT NULL REFERENCES public.territory_halloween_boss_2026(id),
  player_id uuid NOT NULL REFERENCES public.players(id),
  reward_id text NOT NULL DEFAULT 'follower_pumpkin_witch_2026'
    CHECK (reward_id = 'follower_pumpkin_witch_2026'),
  reward_level integer NOT NULL DEFAULT 100 CHECK (reward_level = 100),
  claimed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (event_id, player_id, reward_id)
);
ALTER TABLE territory_private.halloween_companion_rewards_2026 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE territory_private.halloween_companion_rewards_2026
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_halloween_companion_claim_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_end timestamptz;
  v_inserted timestamptz;
  v_awarded_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'halloween_companion_auth_required';
  END IF;
  SELECT ends_at INTO v_end
    FROM public.territory_halloween_boss_2026
    WHERE id = 'halloween_2026';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'halloween_companion_event_missing';
  END IF;
  IF pg_catalog.clock_timestamp() < GREATEST(v_end, '2026-11-03 00:00:00+00'::timestamptz) THEN
    RETURN pg_catalog.jsonb_build_object('eligible', false, 'reason', 'event_active');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.players WHERE id = v_uid
  ) THEN
    RAISE EXCEPTION 'halloween_companion_player_unavailable';
  END IF;
  -- Once issued, the ledger remains the authority even if historical raid
  -- participation is later archived; never depend on a stale client save.
  SELECT claimed_at INTO v_awarded_at
  FROM territory_private.halloween_companion_rewards_2026
  WHERE event_id='halloween_2026' AND player_id=v_uid
    AND reward_id='follower_pumpkin_witch_2026';
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('eligible',true,
      'rewardId','follower_pumpkin_witch_2026','level',100,
      'alreadyClaimed',true,'claimedAt',v_awarded_at);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.territory_halloween_boss_2026_players
    WHERE event_id='halloween_2026' AND player_id=v_uid
      AND total_hits > 0
  ) THEN
    RETURN pg_catalog.jsonb_build_object('eligible', false, 'reason', 'no_confirmed_hits');
  END IF;
  INSERT INTO territory_private.halloween_companion_rewards_2026
    (event_id, player_id, reward_id, reward_level)
  VALUES ('halloween_2026',v_uid,'follower_pumpkin_witch_2026',100)
  ON CONFLICT (event_id,player_id,reward_id) DO NOTHING
  RETURNING claimed_at INTO v_inserted;
  SELECT claimed_at INTO v_awarded_at
  FROM territory_private.halloween_companion_rewards_2026
  WHERE event_id = 'halloween_2026' AND player_id = v_uid
    AND reward_id = 'follower_pumpkin_witch_2026';
  IF v_awarded_at IS NULL THEN
    RAISE EXCEPTION 'halloween_companion_grant_unconfirmed';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'eligible',true,
    'rewardId','follower_pumpkin_witch_2026',
    'level',100,
    'alreadyClaimed', v_inserted IS NULL,
    'claimedAt',v_awarded_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.territory_halloween_companion_claim_v1()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.territory_halloween_companion_claim_v1()
  TO authenticated;

-- This service-only operator interface is STAGED. It never runs on its own.
-- The owner-authenticated Edge endpoint and CI integration must be reviewed
-- separately before deploying this file or using it against real data.
CREATE TABLE IF NOT EXISTS territory_private.halloween_companion_bulk_receipts_2026 (
  request_id uuid PRIMARY KEY,
  eligible_count bigint NOT NULL,
  snapshot_digest text NOT NULL,
  inserted_count bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE territory_private.halloween_companion_bulk_receipts_2026 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE territory_private.halloween_companion_bulk_receipts_2026 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_halloween_companion_snapshot_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_end timestamptz;
  v_count bigint;
  v_digest text;
  v_granted bigint;
BEGIN
  SELECT ends_at INTO v_end FROM public.territory_halloween_boss_2026 WHERE id='halloween_2026';
  IF NOT FOUND OR v_end IS NULL THEN RAISE EXCEPTION 'halloween_companion_event_missing'; END IF;
  IF pg_catalog.clock_timestamp() < GREATEST(v_end, '2026-11-03 00:00:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'halloween_companion_event_active';
  END IF;
  SELECT count(*), pg_catalog.md5(COALESCE(pg_catalog.string_agg(h.player_id::text, ',' ORDER BY h.player_id), '')),
         count(r.player_id)
    INTO v_count, v_digest, v_granted
    FROM public.territory_halloween_boss_2026_players h
    LEFT JOIN territory_private.halloween_companion_rewards_2026 r
      ON r.event_id=h.event_id AND r.player_id=h.player_id AND r.reward_id='follower_pumpkin_witch_2026'
    WHERE h.event_id='halloween_2026' AND h.total_hits>0;
  RETURN pg_catalog.jsonb_build_object('eligible',v_count,'granted',v_granted,
    'pending',v_count-v_granted,'digest',v_digest);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_halloween_companion_snapshot_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_halloween_companion_snapshot_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.territory_halloween_companion_bulk_v1(
  p_request_id uuid, p_expected_count bigint, p_expected_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_snapshot jsonb;
  v_after jsonb;
  v_inserted bigint;
  v_prior territory_private.halloween_companion_bulk_receipts_2026%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR p_expected_count IS NULL OR p_expected_count < 0
     OR p_expected_digest IS NULL OR p_expected_digest !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'halloween_companion_invalid_request';
  END IF;
  -- Boss attacks serialize on this same row, including a hit started before
  -- closure. This prevents a snapshot racing the final committed attack.
  PERFORM 1 FROM public.territory_halloween_boss_2026 WHERE id='halloween_2026' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'halloween_companion_event_missing'; END IF;
  v_snapshot := public.territory_halloween_companion_snapshot_v1();
  SELECT * INTO v_prior FROM territory_private.halloween_companion_bulk_receipts_2026 WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_prior.eligible_count <> p_expected_count OR v_prior.snapshot_digest <> p_expected_digest THEN
      RAISE EXCEPTION 'halloween_companion_request_conflict';
    END IF;
    RETURN pg_catalog.jsonb_build_object('alreadyProcessed',true,'inserted',v_prior.inserted_count,'snapshot',v_snapshot);
  END IF;
  IF (v_snapshot->>'eligible')::bigint <> p_expected_count OR v_snapshot->>'digest' <> p_expected_digest THEN
    RAISE EXCEPTION 'halloween_companion_snapshot_changed';
  END IF;
  INSERT INTO territory_private.halloween_companion_rewards_2026 (event_id,player_id,reward_id,reward_level)
    SELECT h.event_id,h.player_id,'follower_pumpkin_witch_2026',100
    FROM public.territory_halloween_boss_2026_players h
    WHERE h.event_id='halloween_2026' AND h.total_hits>0
    ON CONFLICT (event_id,player_id,reward_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_after := public.territory_halloween_companion_snapshot_v1();
  IF v_after->>'digest' <> p_expected_digest OR (v_after->>'eligible')::bigint <> p_expected_count
     OR (v_after->>'pending')::bigint <> 0 THEN
    RAISE EXCEPTION 'halloween_companion_reconcile_failed';
  END IF;
  INSERT INTO territory_private.halloween_companion_bulk_receipts_2026
    (request_id,eligible_count,snapshot_digest,inserted_count)
    VALUES (p_request_id,p_expected_count,p_expected_digest,v_inserted);
  RETURN pg_catalog.jsonb_build_object('alreadyProcessed',false,'inserted',v_inserted,'snapshot',v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_halloween_companion_bulk_v1(uuid,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_halloween_companion_bulk_v1(uuid,bigint,text) TO service_role;
