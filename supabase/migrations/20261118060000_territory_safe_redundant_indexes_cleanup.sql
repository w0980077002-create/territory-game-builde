-- TERRITORY production-safe redundant index cleanup, verified 2026-11-18.
-- The unique players_telegram_id_key constraint/index must remain intact.
-- The active history-purge index arena_rooms_history_purge_due_idx must remain intact.
-- No player, wallet, economy, raid or arena record is deleted here.
SET LOCAL lock_timeout = '1500ms';
DROP INDEX IF EXISTS public.idx_players_telegram;
DROP INDEX IF EXISTS public.players_telegram_idx;
-- Old manual log purge index. The scheduled 30-minute history purge uses
-- arena_rooms_history_purge_due_idx instead.
DROP INDEX IF EXISTS public.arena_rooms_logs_purge_pending_idx;
