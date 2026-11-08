-- ARCHIVED STAGED SCRIPT — DO NOT ENABLE THE SEPARATE WEEKLY CHAMPIONSHIP.
-- Owner confirmed Monday 00:00 UTC to Monday 00:00 UTC on 2026-11-08.
-- This inactive legacy championship retains Sunday-based code until a separately
-- reviewed and approved Monday cutover; current weekly_season_config_v1.enabled=false.
-- Former staged deployment companion for territory_weekly_seasons_v1.sql.
-- Private job completes elapsed seasons and opens the next current Sunday week.
-- Disabled configuration remains disabled: no awards, no historical backfill.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
   RAISE EXCEPTION 'season_pg_cron_required';
 END IF;
END $$;
SELECT cron.schedule('territory-weekly-seasons-v1','* * * * *',
 'SELECT territory_private.weekly_season_tick_v1();');
COMMIT;
