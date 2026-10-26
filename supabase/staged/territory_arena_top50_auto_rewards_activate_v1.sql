-- TERRITORY 1.0 · REVIEWED RELEASE PART 2/2 (activate after install + tests).
-- Enables future Sundays only. Does not immediately issue historical rewards.
BEGIN;
UPDATE territory_private.arena_top50_reward_config_v1
SET enabled=true WHERE id=1 AND enabled=false;
SELECT cron.schedule('territory-arena-top50-auto-v1','* * * * *',
  'SELECT territory_private.arena_top50_rewards_tick_v1();');
COMMIT;
