/*
# Territory Game — Arena Battle Function

## Purpose
 SECURITY DEFINER function that processes a PvP arena battle between two players.
 Updates ratings, rewards, and battle records atomically.
 This function runs with elevated privileges to update both players' stats.

## New Functions
- `process_arena_battle(attacker_uuid, defender_uuid, battle_result_json)`:
  - Validates both players exist
  - Calculates ELO-style rating change
  - Updates both players' arena stats
  - Inserts arena_battle record
  - Updates leaderboard for both players
  - Returns battle summary

## Security
- SECURITY DEFINER so it can update both attacker and defender rows
- EXECUTE granted to authenticated role only
- Input validation: attacker != defender, both must exist
*/

CREATE OR REPLACE FUNCTION process_arena_battle(
  p_attacker_id uuid,
  p_defender_id uuid,
  p_attacker_won boolean,
  p_battle_log jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attacker_rating int;
  v_defender_rating int;
  v_rating_change int;
  v_reward_gold int;
  v_reward_xp int;
  v_expected_a float8;
  v_expected_d float8;
  v_k int := 32;
  v_attacker_level int;
  v_defender_level int;
BEGIN
  -- Validate
  IF p_attacker_id = p_defender_id THEN
    RETURN jsonb_build_object('error', 'cannot_battle_self');
  END IF;

  SELECT arena_rating, level INTO v_attacker_rating, v_attacker_level
    FROM players WHERE id = p_attacker_id;
  SELECT arena_rating, level INTO v_defender_rating, v_defender_level
    FROM players WHERE id = p_defender_id;

  IF v_attacker_rating IS NULL OR v_defender_rating IS NULL THEN
    RETURN jsonb_build_object('error', 'player_not_found');
  END IF;

  -- ELO calculation
  v_expected_a := 1.0 / (1.0 + power(10, (v_defender_rating - v_attacker_rating) / 400.0));
  v_expected_d := 1.0 - v_expected_a;

  IF p_attacker_won THEN
    v_rating_change := round(v_k * (1.0 - v_expected_a))::int;
    v_reward_gold := 30 + v_defender_level * 10;
    v_reward_xp := 40 + v_defender_level * 15;

    -- Update attacker (winner)
    UPDATE players SET
      arena_rating = arena_rating + v_rating_change,
      arena_wins = arena_wins + 1,
      gold = gold + v_reward_gold,
      xp = xp + v_reward_xp,
      updated_at = now()
    WHERE id = p_attacker_id;

    -- Update defender (loser)
    UPDATE players SET
      arena_rating = GREATEST(100, arena_rating - v_rating_change),
      arena_losses = arena_losses + 1,
      updated_at = now()
    WHERE id = p_defender_id;
  ELSE
    v_rating_change := round(v_k * (1.0 - v_expected_d))::int;
    v_reward_gold := 10 + v_attacker_level * 3;
    v_reward_xp := 15 + v_attacker_level * 5;

    -- Update defender (winner)
    UPDATE players SET
      arena_rating = arena_rating + v_rating_change,
      arena_wins = arena_wins + 1,
      gold = gold + v_reward_gold,
      xp = xp + v_reward_xp,
      updated_at = now()
    WHERE id = p_defender_id;

    -- Update attacker (loser)
    UPDATE players SET
      arena_rating = GREATEST(100, arena_rating - v_rating_change),
      arena_losses = arena_losses + 1,
      updated_at = now()
    WHERE id = p_attacker_id;

    -- Swap for record
    v_rating_change := -v_rating_change;
    v_reward_gold := 0;
    v_reward_xp := 0;
  END IF;

  -- Record battle
  INSERT INTO arena_battles (
    attacker_id, defender_id, winner_id,
    attacker_rating_before, defender_rating_before,
    rating_change, reward_gold, reward_xp, battle_log
  ) VALUES (
    p_attacker_id, p_defender_id,
    CASE WHEN p_attacker_won THEN p_attacker_id ELSE p_defender_id END,
    v_attacker_rating, v_defender_rating,
    v_rating_change, v_reward_gold, v_reward_xp, p_battle_log
  );

  -- Update leaderboard for both
  INSERT INTO leaderboard (player_id, display_name, level, arena_rating, total_battles_won, arena_wins, photo_url)
  SELECT id, display_name, level, arena_rating, total_battles_won, arena_wins, photo_url
    FROM players WHERE id = p_attacker_id
  ON CONFLICT (player_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    level = EXCLUDED.level,
    arena_rating = EXCLUDED.arena_rating,
    total_battles_won = EXCLUDED.total_battles_won,
    arena_wins = EXCLUDED.arena_wins,
    photo_url = EXCLUDED.photo_url,
    updated_at = now();

  INSERT INTO leaderboard (player_id, display_name, level, arena_rating, total_battles_won, arena_wins, photo_url)
  SELECT id, display_name, level, arena_rating, total_battles_won, arena_wins, photo_url
    FROM players WHERE id = p_defender_id
  ON CONFLICT (player_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    level = EXCLUDED.level,
    arena_rating = EXCLUDED.arena_rating,
    total_battles_won = EXCLUDED.total_battles_won,
    arena_wins = EXCLUDED.arena_wins,
    photo_url = EXCLUDED.photo_url,
    updated_at = now();

  RETURN jsonb_build_object(
    'rating_change', v_rating_change,
    'reward_gold', v_reward_gold,
    'reward_xp', v_reward_xp,
    'attacker_won', p_attacker_won
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_arena_battle TO authenticated;

-- Auto-update leaderboard when player levels up or stats change
CREATE OR REPLACE FUNCTION update_leaderboard_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO leaderboard (player_id, display_name, level, arena_rating, total_battles_won, arena_wins, photo_url)
  VALUES (
    NEW.id, NEW.display_name, NEW.level, NEW.arena_rating,
    NEW.total_battles_won, NEW.arena_wins, NEW.photo_url
  )
  ON CONFLICT (player_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    level = EXCLUDED.level,
    arena_rating = EXCLUDED.arena_rating,
    total_battles_won = EXCLUDED.total_battles_won,
    arena_wins = EXCLUDED.arena_wins,
    photo_url = EXCLUDED.photo_url,
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_leaderboard ON players;
CREATE TRIGGER trigger_update_leaderboard
  AFTER INSERT OR UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION update_leaderboard_entry();

GRANT EXECUTE ON FUNCTION update_leaderboard_entry TO authenticated;
