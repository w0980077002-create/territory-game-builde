-- One-time recoverable snapshot BEFORE enabling TERRITORY 1.0 professions.
-- Private schema and RLS: never exposed to the game client. No deletes/updates.
BEGIN;
CREATE TABLE IF NOT EXISTS territory_private.professions_stage8_backup_players_20261025 AS
  SELECT id AS player_id, gold, gems, level, game_state, created_at, updated_at
  FROM public.players;
ALTER TABLE territory_private.professions_stage8_backup_players_20261025 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.professions_stage8_backup_players_20261025
  FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS territory_private.professions_stage8_backup_unlocks_20261025 AS
  SELECT * FROM public.territory_profession_unlocks;
ALTER TABLE territory_private.professions_stage8_backup_unlocks_20261025 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.professions_stage8_backup_unlocks_20261025
  FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS territory_private.professions_stage8_backup_resources_20261025 AS
  SELECT * FROM public.territory_resource_wallet;
ALTER TABLE territory_private.professions_stage8_backup_resources_20261025 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.professions_stage8_backup_resources_20261025
  FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS territory_private.professions_stage8_backup_inventory_20261025 AS
  SELECT * FROM public.player_inventory;
ALTER TABLE territory_private.professions_stage8_backup_inventory_20261025 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.professions_stage8_backup_inventory_20261025
  FROM PUBLIC, anon, authenticated;

COMMIT;
