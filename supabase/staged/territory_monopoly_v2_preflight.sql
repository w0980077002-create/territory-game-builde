-- READ ONLY: metadata only; does not call gameplay RPCs or read player saves.
WITH expected(name,body_hash) AS (VALUES ('territory_hall_status_v1','47ab87bb28b717a93dc9c3fb3d54491e'),('territory_hall_daily_v1','8c2c80eec27285d70011448eacd741eb'),('territory_hall_start_v1','e0186d2952c2c3b2e788dea615c403c7'),('territory_hall_finish_v1','eac89aad6d441b31f19f5b61175af88d'),('territory_hall_claim_v1','a8132cdbe453455ebd81cbc766640500'))
SELECT e.name, p.oid IS NOT NULL AS exists,
 md5(regexp_replace(p.prosrc,'\s','','g'))=e.body_hash AS matches_reviewed_body,
 p.prosecdef AS security_definer,p.proconfig
FROM expected e LEFT JOIN pg_namespace n ON n.nspname='public'
LEFT JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.name;
SELECT n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname='territory_private'
AND c.relname IN('hall_accounts_v1','hall_sessions_v1','hall_history_v1') ORDER BY c.relname,a.attnum;
SELECT c.relname,pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='territory_private' AND c.relname IN('hall_accounts_v1','hall_sessions_v1','hall_history_v1');
SELECT to_regclass('territory_private.monopoly_v2') AS existing_progress,
 to_regclass('territory_private.monopoly_testers_v2') AS existing_allowlist,
 to_regprocedure('public.territory_monopoly_v2(text,integer,uuid)') AS existing_rpc;

SELECT to_regprocedure('public.territory_monopoly_claim_v2(timestamptz,jsonb)') AS existing_reward_claim;
SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='players' AND column_name IN('gems','game_state','updated_at','forge_materials');
