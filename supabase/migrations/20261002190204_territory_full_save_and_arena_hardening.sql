/*
# Full game save + arena hardening

1. Modified tables
   - `players`: new `game_state` (jsonb, full save: inventory, quests, achievements, equipment),
     plus combat summary columns `attack`, `defense`, `max_hp`, `crit_chance` used for arena opponents.
   - `leaderboard`: same combat summary columns so opponents' power is visible for arena fights.
2. Functions
   - `update_leaderboard_entry` trigger now copies combat stats.
   - `process_arena_battle(p_defender_id, p_attacker_won, p_battle_log)` replaces the old signature.
     Attacker is always the caller (auth.uid()); it only changes rating/wins/losses. Gold/XP rewards
     live in the player's save.
3. Security
   - Players can no longer write their own arena_rating / arena_wins / arena_losses / telegram_id (column grants).
   - Players can no longer write leaderboard rows directly; only the trigger maintains it.
   - Old process_arena_battle (which accepted any attacker id) is removed.
*/

ALTER TABLE players ADD COLUMN IF NOT EXISTS game_state jsonb;
ALTER TABLE players ADD COLUMN IF NOT EXISTS attack int NOT NULL DEFAULT 20;
ALTER TABLE players ADD COLUMN IF NOT EXISTS defense int NOT NULL DEFAULT 5;
ALTER TABLE players ADD COLUMN IF NOT EXISTS max_hp int NOT NULL DEFAULT 100;
ALTER TABLE players ADD COLUMN IF NOT EXISTS crit_chance int NOT NULL DEFAULT 5;

ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS attack int NOT NULL DEFAULT 20;
ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS defense int NOT NULL DEFAULT 5;
ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS max_hp int NOT NULL DEFAULT 100;
ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS crit_chance int NOT NULL DEFAULT 5;

REVOKE INSERT, UPDATE ON players FROM authenticated, anon;
GRANT INSERT (id, username, photo_url, display_name, level, xp, gold, gems, energy, max_energy,
  current_chapter, chapter_wins, total_battles_won, total_bosses_defeated, forge_materials,
  game_state, attack, defense, max_hp, crit_chance, updated_at) ON players TO authenticated;
GRANT UPDATE (username, photo_url, display_name, level, xp, gold, gems, energy, max_energy,
  current_chapter, chapter_wins, total_battles_won, total_bosses_defeated, forge_materials,
  game_state, attack, defense, max_hp, crit_chance, updated_at) ON players TO authenticated;

DROP POLICY IF EXISTS "insert_own_leaderboard" ON leaderboard;
DROP POLICY IF EXISTS "update_own_leaderboard" ON leaderboard;

CREATE OR REPLACE FUNCTION update_leaderboard_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO leaderboard (player_id, display_name, level, arena_rating, total_battles_won, arena_wins,
    photo_url, attack, defense, max_hp, crit_chance)
  VALUES (NEW.id, NEW.display_name, NEW.level, NEW.arena_rating, NEW.total_battles_won, NEW.arena_wins,
    NEW.photo_url, NEW.attack, NEW.defense, NEW.max_hp, NEW.crit_chance)
  ON CONFLICT (player_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    level = EXCLUDED.level,
    arena_rating = EXCLUDED.arena_rating,
    total_battles_won = EXCLUDED.total_battles_won,
    arena_wins = EXCLUDED.arena_wins,
    photo_url = EXCLUDED.photo_url,
    attack = EXCLUDED.attack,
    defense = EXCLUDED.defense,
    max_hp = EXCLUDED.max_hp,
    crit_chance = EXCLUDED.crit_chance,
    updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_leaderboard_entry() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS process_arena_battle(uuid, uuid, boolean, jsonb);

CREATE OR REPLACE FUNCTION process_arena_battle(
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
  v_attacker_id uuid := auth.uid();
  v_a int;
  v_d int;
  v_expected float8;
  v_change int;
BEGIN
  IF v_attacker_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF v_attacker_id = p_defender_id THEN
    RETURN jsonb_build_object('error', 'cannot_battle_self');
  END IF;

  SELECT arena_rating INTO v_a FROM players WHERE id = v_attacker_id;
  SELECT arena_rating INTO v_d FROM players WHERE id = p_defender_id;
  IF v_a IS NULL OR v_d IS NULL THEN
    RETURN jsonb_build_object('error', 'player_not_found');
  END IF;

  v_expected := 1.0 / (1.0 + power(10, (v_d - v_a) / 400.0));

  IF p_attacker_won THEN
    v_change := GREATEST(1, round(32 * (1.0 - v_expected))::int);
    UPDATE players SET arena_rating = arena_rating + v_change, arena_wins = arena_wins + 1, updated_at = now()
      WHERE id = v_attacker_id;
    UPDATE players SET arena_rating = GREATEST(100, arena_rating - v_change), arena_losses = arena_losses + 1, updated_at = now()
      WHERE id = p_defender_id;
  ELSE
    v_change := -GREATEST(1, round(32 * v_expected)::int);
    UPDATE players SET arena_rating = GREATEST(100, arena_rating + v_change), arena_losses = arena_losses + 1, updated_at = now()
      WHERE id = v_attacker_id;
    UPDATE players SET arena_rating = arena_rating - v_change, arena_wins = arena_wins + 1, updated_at = now()
      WHERE id = p_defender_id;
  END IF;

  INSERT INTO arena_battles (attacker_id, defender_id, winner_id, attacker_rating_before,
    defender_rating_before, rating_change, battle_log)
  VALUES (v_attacker_id, p_defender_id,
    CASE WHEN p_attacker_won THEN v_attacker_id ELSE p_defender_id END,
    v_a, v_d, v_change, p_battle_log);

  RETURN jsonb_build_object('rating_change', v_change, 'new_rating', v_a + v_change);
END;
$$;

REVOKE EXECUTE ON FUNCTION process_arena_battle(uuid, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION process_arena_battle(uuid, boolean, jsonb) TO authenticated;

DROP POLICY IF EXISTS "insert_battle" ON arena_battles;
