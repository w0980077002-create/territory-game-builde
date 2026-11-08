-- HISTORICAL STAGED ACTIVATE SCRIPT: DO NOT REAPPLY TO LIVE ARENA.
-- OWNER DECISION 2026-11-08: weeks are MONDAY 00:00 UTC to next MONDAY 00:00 UTC.
-- Current Arena TOP-50 reward configuration and function are already live on Monday.
-- This archived script was authored for an earlier Sunday-era setup.
-- It is retained for reference, not as permission to re-enable/reset payouts.
BEGIN;
UPDATE territory_private.arena_top50_reward_config_v1
SET enabled=true WHERE id=1 AND enabled=false;
SELECT cron.schedule('territory-arena-top50-auto-v1','* * * * *',
  'SELECT territory_private.arena_top50_rewards_tick_v1();');
COMMIT;
