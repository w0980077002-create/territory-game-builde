\set ON_ERROR_STOP on
-- Continues disposable weekly VIP PostgreSQL 17 fixture in the same session.
\i supabase/staged/20261104_vip_daily_chest_v1.sql
\i supabase/staged/20261105_vip_claim_history_v1.sql

DO $permission$
BEGIN
 IF has_function_privilege('anon','public.territory_vip_claim_history_v1()','EXECUTE')
 OR has_table_privilege('authenticated','territory_private.vip_daily_claims_v1','SELECT')
 OR has_table_privilege('authenticated','territory_private.vip_weekly_claims_v1','SELECT')
 THEN RAISE EXCEPTION 'Client can read private chest ledger'; END IF;
 IF NOT has_function_privilege('authenticated','public.territory_vip_claim_history_v1()','EXECUTE')
 THEN RAISE EXCEPTION 'Owner cannot inspect own chest receipts'; END IF;
END $permission$;

INSERT INTO territory_private.vip_daily_claims_v1
(player_id,claim_day,operation_id,granted_vip,reward_gold,reward_gems,reward_stones)
VALUES('10000000-0000-0000-0000-000000000001',current_date,
 '50000000-0000-4000-8000-000000000001',5,350,4,1);

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
DO $owner$
DECLARE history jsonb;
BEGIN
 history:=public.territory_vip_claim_history_v1();
 IF history->>'success'<>'true'
   OR jsonb_array_length(history->'claims')<>2
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(history->'claims') e
       WHERE e->>'source'='daily' AND e->>'gold'='350' AND e->>'vip'='5')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(history->'claims') e
       WHERE e->>'source'='weekly' AND e->>'gold'='600' AND e->>'materials'='2')
 THEN RAISE EXCEPTION 'Own chest receipt history incomplete: %',history; END IF;
END $owner$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SET ROLE authenticated;
DO $isolation$
DECLARE history jsonb;
BEGIN
 history:=public.territory_vip_claim_history_v1();
 -- This synthetic user already claimed its own weekly chest in the
 -- preceding entitlement fixture. Seeing that receipt is correct; seeing
 -- the first player's DAILY receipt would be a cross-account leak.
 IF jsonb_array_length(history->'claims')<>1
   OR history#>>'{claims,0,source}'<>'weekly'
   OR history#>>'{claims,0,gold}'<>'600'
 THEN RAISE EXCEPTION 'Owner claim history mixed between players: %',history; END IF;
END $isolation$;
RESET ROLE;
-- A third synthetic player never claimed either daily or weekly rewards.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
SET ROLE authenticated;
DO $third_player$
DECLARE history jsonb;
BEGIN
 history:=public.territory_vip_claim_history_v1();
 IF jsonb_array_length(history->'claims')<>0
 THEN RAISE EXCEPTION 'Third player saw somebody else claims: %',history; END IF;
END $third_player$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',false);
SET ROLE authenticated;
DO $anon$
BEGIN
 BEGIN
  PERFORM public.territory_vip_claim_history_v1();
  RAISE EXCEPTION 'Unauthenticated caller saw VIP gift history';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_history_login_required' THEN RAISE; END IF;
 END;
END $anon$;
RESET ROLE;
SELECT 'VIP chest history PG17: owner-only read, correct daily/weekly amounts and no cross-player leak PASS' AS verified;
