-- STAGED ONLY: reviewed deployment companion for territory_weekly_seasons_v1.sql.
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
