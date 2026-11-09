-- Owner-managed test profiles: adjust the TOTAL Arena win counter without
-- creating fake fights, touching weekly real-match rows, or changing balance.
-- The existing leaderboard trigger keeps the shared overall standings in sync.
CREATE TABLE IF NOT EXISTS territory_private.owner_test_bot_wins_edits_v1 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 10),
  player_id uuid NOT NULL REFERENCES public.players(id),
  mode text NOT NULL CHECK (mode IN ('delta','set')),
  requested_value integer NOT NULL,
  wins_before integer NOT NULL CHECK (wins_before >= 0),
  wins_after integer NOT NULL CHECK (wins_after >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE territory_private.owner_test_bot_wins_edits_v1
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_admin_test_bot_wins_v1(
  p_slot smallint,
  p_mode text,
  p_value integer,
  p_expected_current integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog', 'public', 'territory_private'
AS $tester_wins$
DECLARE
  v_player uuid;
  v_before integer;
  v_after bigint;
  v_weekly_before bigint;
BEGIN
  IF p_slot IS NULL OR p_slot NOT BETWEEN 1 AND 10
     OR p_mode NOT IN ('delta','set') OR p_value IS NULL THEN
    RAISE EXCEPTION 'tester_wins_invalid';
  END IF;

  -- Restrict every operation to a known private owner-controlled identity.
  -- This lock also serializes with an autonomous Arena result being settled.
  SELECT p.id, p.arena_wins
    INTO v_player, v_before
  FROM territory_private.owner_test_bots_v1 b
  JOIN public.players p ON p.id=b.player_id
  WHERE b.slot=p_slot
  FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'tester_wins_profile_missing'; END IF;

  IF p_mode='set' THEN
    IF p_value < 0 OR p_value > 1000000 THEN RAISE EXCEPTION 'tester_wins_invalid'; END IF;
    -- Do not overwrite wins earned in a fight while the owner was editing.
    IF p_expected_current IS NULL OR p_expected_current <> v_before THEN
      RAISE EXCEPTION 'tester_wins_conflict';
    END IF;
    v_after:=p_value;
  ELSE
    IF p_value < -1000 OR p_value > 1000 OR p_value=0 THEN
      RAISE EXCEPTION 'tester_wins_invalid';
    END IF;
    -- Deltas apply to the latest counter, even when a fight just finished.
    v_after:=v_before::bigint+p_value::bigint;
    IF v_after NOT BETWEEN 0 AND 1000000 THEN
      RAISE EXCEPTION 'tester_wins_out_of_range';
    END IF;
  END IF;

  IF v_after <> v_before THEN
    UPDATE public.players
      SET arena_wins=v_after::integer,
          updated_at=clock_timestamp()
      WHERE id=v_player;
    -- The normal public.players trigger mirrors this into public.leaderboard.
    INSERT INTO territory_private.owner_test_bot_wins_edits_v1 (
      slot,player_id,mode,requested_value,wins_before,wins_after
    ) VALUES (
      p_slot,v_player,p_mode,p_value,v_before,v_after::integer
    );
  END IF;

  RETURN jsonb_build_object(
    'slot',p_slot,'before',v_before,'after',v_after::integer,
    'delta',v_after::integer-v_before,
    'unchanged',v_after=v_before
  );
END;
$tester_wins$;

REVOKE ALL ON FUNCTION public.territory_admin_test_bot_wins_v1(smallint,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_test_bot_wins_v1(smallint,text,integer,integer)
  TO service_role;
