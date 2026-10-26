-- STAGED: owner access uses existing admin-api HMAC/PBKDF2 verification.
-- Never grant these RPCs to browser roles. Updates affect FUTURE seasons only.
BEGIN;
ALTER TABLE territory_private.weekly_season_config_v1 ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS territory_private.weekly_season_admin_receipts_v1 (
 operation_id uuid PRIMARY KEY, revision integer NOT NULL, prizes jsonb NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE territory_private.weekly_season_admin_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.weekly_season_admin_receipts_v1 FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.territory_season_admin_status_v1()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='pg_catalog' AS $$
 SELECT jsonb_build_object('enabled',c.enabled,'revision',c.revision,'prizes',c.prizes,
   'current_prizes',COALESCE(s.prizes,'[]'::jsonb),'current_week',s.week,
   'next_week',(d.week+7)::text)
 FROM territory_private.weekly_season_config_v1 c
 CROSS JOIN LATERAL(SELECT (now() AT TIME ZONE 'Europe/Kyiv')::date
   -extract(dow FROM now() AT TIME ZONE 'Europe/Kyiv')::integer AS week) d
 LEFT JOIN territory_private.weekly_seasons_v1 s ON s.week=d.week
 WHERE c.id=1
$$;
REVOKE ALL ON FUNCTION public.territory_season_admin_status_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_season_admin_status_v1() TO service_role;
CREATE OR REPLACE FUNCTION public.territory_season_admin_prizes_v1(
 p_operation uuid,p_revision integer,p_prizes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $$
DECLARE v_config territory_private.weekly_season_config_v1%ROWTYPE;
 v_receipt territory_private.weekly_season_admin_receipts_v1%ROWTYPE;
 v_result jsonb;
BEGIN
 IF p_operation IS NULL OR p_revision IS NULL THEN RAISE EXCEPTION 'season_invalid_request'; END IF;
 PERFORM territory_private.weekly_season_validate_prizes_v1(p_prizes);
 SELECT * INTO v_config FROM territory_private.weekly_season_config_v1 WHERE id=1 FOR UPDATE;
 SELECT * INTO v_receipt FROM territory_private.weekly_season_admin_receipts_v1 WHERE operation_id=p_operation;
 IF FOUND THEN
   IF v_receipt.revision<>p_revision OR v_receipt.prizes IS DISTINCT FROM p_prizes THEN
     RAISE EXCEPTION 'season_operation_collision'; END IF;
   RETURN v_receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF v_config.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'season_config_changed'; END IF;
 UPDATE territory_private.weekly_season_config_v1 SET prizes=p_prizes,revision=revision+1 WHERE id=1;
 v_result:=public.territory_season_admin_status_v1()||jsonb_build_object('replayed',false);
 INSERT INTO territory_private.weekly_season_admin_receipts_v1(operation_id,revision,prizes,result)
 VALUES(p_operation,p_revision,p_prizes,v_result);
 INSERT INTO public.admin_audit_log(action,details)
 VALUES('season_prizes',jsonb_build_object('operation',p_operation,'revision',p_revision+1,
 'previous_prizes',v_config.prizes,'prizes',p_prizes,'applies_from',v_result->'next_week'));
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.territory_season_admin_prizes_v1(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_season_admin_prizes_v1(uuid,integer,jsonb) TO service_role;
COMMIT;
