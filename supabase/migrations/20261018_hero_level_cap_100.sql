-- Hero progression cap (not profession mastery, equipment or clan levels).
-- The existing territory_economy_guard_v1 compares game_state.player.level
-- against public.players.level on every changed save, so a database check on
-- players.level also protects synced game_state from >100.
-- No existing player is modified or reset by this migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.players'::pg_catalog.regclass
      AND conname = 'territory_hero_max_level_100'
  ) THEN
    ALTER TABLE public.players
      ADD CONSTRAINT territory_hero_max_level_100
      CHECK (level BETWEEN 1 AND 100) NOT VALID;
  END IF;
END;
$$;
ALTER TABLE public.players VALIDATE CONSTRAINT territory_hero_max_level_100;
