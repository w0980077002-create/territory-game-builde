-- OWNER APPROVED prizes, 2026-10-26. Reviewed deployment AFTER core+admin+cron.
-- One-time activation; never re-run this file to overwrite future owner edits.
BEGIN;
UPDATE territory_private.weekly_season_config_v1 SET enabled=true,prizes='[
 {"gold":3000,"gems":90},{"gold":2000,"gems":65},{"gold":1500,"gems":45},
 {"gold":1000,"gems":30},{"gold":1000,"gems":30},
 {"gold":500,"gems":15},{"gold":500,"gems":15},{"gold":500,"gems":15},
 {"gold":500,"gems":15},{"gold":500,"gems":15}]'::jsonb
WHERE id=1 AND NOT enabled AND prizes='[]'::jsonb AND revision=1;
SELECT territory_private.weekly_season_tick_v1();
COMMIT;
