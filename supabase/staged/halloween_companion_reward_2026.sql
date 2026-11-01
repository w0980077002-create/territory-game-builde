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
  v_previous timestamptz;
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
  IF pg_catalog.clock_timestamp() < v_end THEN
    RETURN pg_catalog.jsonb_build_object('eligible', false, 'reason', 'event_active');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.players WHERE id = v_uid AND NOT COALESCE(banned,false)
  ) THEN
    RAISE EXCEPTION 'halloween_companion_player_unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.territory_halloween_boss_2026_players
    WHERE event_id='halloween_2026' AND player_id=v_uid
      AND total_hits > 0
  ) THEN
    RETURN pg_catalog.jsonb_build_object('eligible', false, 'reason', 'no_confirmed_hits');
  END IF;
  SELECT claimed_at INTO v_previous
  FROM territory_private.halloween_companion_rewards_2026
  WHERE event_id = 'halloween_2026' AND player_id = v_uid
    AND reward_id = 'follower_pumpkin_witch_2026';
  INSERT INTO territory_private.halloween_companion_rewards_2026
    (event_id, player_id, reward_id, reward_level)
  VALUES ('halloween_2026',v_uid,'follower_pumpkin_witch_2026',100)
  ON CONFLICT (event_id,player_id,reward_id) DO NOTHING;
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
    'alreadyClaimed', v_previous IS NOT NULL,
    'claimedAt',v_awarded_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.territory_halloween_companion_claim_v1()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.territory_halloween_companion_claim_v1()
  TO authenticated;

-- After event closure, optional audited bulk grant for participants who never log in:
-- INSERT INTO territory_private.halloween_companion_rewards_2026
--   (event_id,player_id,reward_id,reward_level)
-- SELECT 'halloween_2026', h.player_id, 'follower_pumpkin_witch_2026',100
-- FROM public.territory_halloween_boss_2026_players h
-- WHERE h.event_id='halloween_2026' AND h.total_hits>0
-- ON CONFLICT (event_id,player_id,reward_id) DO NOTHING;
-- Never run until actual 2026-11-03T00:00:00Z and owner-approved cutover.
