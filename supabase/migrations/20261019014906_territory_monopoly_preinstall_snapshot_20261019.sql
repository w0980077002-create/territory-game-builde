-- Private point-in-time backup of the four affected gameplay tables before Monopoly v2 launch.
-- Additive snapshot only; no original table rows are altered. Same as applied to production.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF to_regclass('territory_private.monopoly_backup_players_20261019') IS NOT NULL
 OR to_regclass('territory_private.monopoly_backup_hall_accounts_20261019') IS NOT NULL
 OR to_regclass('territory_private.monopoly_backup_hall_sessions_20261019') IS NOT NULL
 OR to_regclass('territory_private.monopoly_backup_hall_history_20261019') IS NOT NULL
 THEN RAISE EXCEPTION 'monopoly_backup_already_exists_review_required'; END IF;
END $guard$;
CREATE TABLE territory_private.monopoly_backup_players_20261019 AS SELECT * FROM public.players;
CREATE TABLE territory_private.monopoly_backup_hall_accounts_20261019 AS SELECT * FROM territory_private.hall_accounts_v1;
CREATE TABLE territory_private.monopoly_backup_hall_sessions_20261019 AS SELECT * FROM territory_private.hall_sessions_v1;
CREATE TABLE territory_private.monopoly_backup_hall_history_20261019 AS SELECT * FROM territory_private.hall_history_v1;
ALTER TABLE territory_private.monopoly_backup_players_20261019 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.monopoly_backup_hall_accounts_20261019 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.monopoly_backup_hall_sessions_20261019 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.monopoly_backup_hall_history_20261019 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.monopoly_backup_players_20261019, territory_private.monopoly_backup_hall_accounts_20261019, territory_private.monopoly_backup_hall_sessions_20261019, territory_private.monopoly_backup_hall_history_20261019 FROM PUBLIC, anon, authenticated;
COMMIT;