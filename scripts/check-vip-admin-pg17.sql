\set ON_ERROR_STOP on
-- Continues disposable 20261105 VIP entitlement fixture in the same psql session.
-- NEVER run this against production: synthetic players and privilege probes.
\i supabase/staged/20261105_vip_admin_v1.sql
DO $permissions$
BEGIN
 IF has_function_privilege('authenticated','public.territory_vip_admin_player_v1(uuid)','EXECUTE')
 OR has_function_privilege('authenticated',
   'public.territory_vip_admin_grant_v1(uuid,uuid,text,text,integer,timestamptz,text)','EXECUTE')
 OR has_function_privilege('anon','public.territory_vip_admin_revoke_v1(uuid,uuid,uuid,text)','EXECUTE')
 OR has_table_privilege('authenticated','territory_private.vip_admin_actions_v1','SELECT')
 THEN RAISE EXCEPTION 'VIP admin endpoint leaked to player or anonymous roles'; END IF;
 IF NOT has_function_privilege('service_role',
   'public.territory_vip_admin_grant_v1(uuid,uuid,text,text,integer,timestamptz,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Trusted admin Edge cannot grant'; END IF;
END $permissions$;

SET ROLE service_role;
DO $admin_grant$
DECLARE
 p uuid:='10000000-0000-0000-0000-000000000002';
 op uuid:='40000000-0000-4000-8000-000000000001';
 a jsonb; b jsonb; v jsonb;
BEGIN
 a:=public.territory_vip_admin_grant_v1(p,op,'fixture-player2-vip8','gift',8,null,'PG17 verified tester grant');
 b:=public.territory_vip_admin_grant_v1(p,op,'fixture-player2-vip8','gift',8,null,'PG17 verified tester grant');
 IF a<>b OR a->>'grantId'<>op::text OR a#>>'{after,gift_vip}'<>'8'
    OR a#>>'{after,paid_vip}'<>'0'
 THEN RAISE EXCEPTION 'Gift was not durable or replay used a new receipt: %',a; END IF;
 v:=public.territory_vip_admin_player_v1(p);
 IF v#>>'{entitlement,permanent_vip}'<>'8'
   OR v#>>'{entitlement,paid_spend_cents}'<>'0'
   OR jsonb_array_length(v->'grants')<>4
 THEN RAISE EXCEPTION 'Gift was counted as paid or hidden from admin status: %',v; END IF;
 BEGIN
  PERFORM public.territory_vip_admin_grant_v1(p,op,'different-campaign','gift',9,null,'Conflicting replay');
  RAISE EXCEPTION 'Operation ID reused for a different grant';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_admin_operation_conflict' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.territory_vip_admin_grant_v1(p,
    '40000000-0000-4000-8000-000000000002','fixture-player2-vip8',
    'gift',8,null,'Duplicate campaign from new UUID');
  RAISE EXCEPTION 'One campaign issued two independent tester grants';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_admin_campaign_exists' THEN RAISE; END IF;
 END;
END $admin_grant$;
RESET ROLE;

SET ROLE service_role;
DO $temporary$
DECLARE
 p uuid:='10000000-0000-0000-0000-000000000002';
 op uuid:='40000000-0000-4000-8000-000000000003';
 v jsonb;
BEGIN
 v:=public.territory_vip_admin_grant_v1(p,op,'fixture-player2-temp-vip10',
     'temporary',10,statement_timestamp()+interval '7 days','PG17 temporary promotion');
 IF v#>>'{after,vip}'<>'10' OR v#>>'{after,permanent_vip}'<>'8'
 THEN RAISE EXCEPTION 'Temporary bonus incorrectly replaced the permanent gift'; END IF;
 BEGIN
  PERFORM public.territory_vip_admin_grant_v1(p,
   '40000000-0000-4000-8000-000000000004','bad-expired-grant',
   'temporary',10,statement_timestamp()-interval '7 days','Expired temporary');
  RAISE EXCEPTION 'Expired temporary VIP could be issued';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_admin_invalid_grant' THEN RAISE; END IF;
 END;
END $temporary$;
RESET ROLE;

SET ROLE service_role;
DO $revocation$
DECLARE
 p uuid:='10000000-0000-0000-0000-000000000002';
 grant_id uuid:='40000000-0000-4000-8000-000000000003';
 op uuid:='40000000-0000-4000-8000-000000000005';
 a jsonb; b jsonb;
BEGIN
 a:=public.territory_vip_admin_revoke_v1(p,grant_id,op,'Promotion ended after tests');
 b:=public.territory_vip_admin_revoke_v1(p,grant_id,op,'Promotion ended after tests');
 IF a<>b OR a#>>'{after,vip}'<>'8' OR a#>>'{after,gift_vip}'<>'8'
 THEN RAISE EXCEPTION 'Temporary revoke damaged permanent gift: %',a; END IF;
 BEGIN
  PERFORM public.territory_vip_admin_revoke_v1(p,grant_id,
   '40000000-0000-4000-8000-000000000006','Second revoke attempt');
  RAISE EXCEPTION 'Duplicate revocation used a different operation';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_admin_already_revoked' THEN RAISE; END IF;
 END;
END $revocation$;
RESET ROLE;

DO $preserved$
BEGIN
 IF (SELECT vip_level FROM public.players WHERE id='10000000-0000-0000-0000-000000000001')<>5
 OR (SELECT vip_level FROM public.players WHERE id='10000000-0000-0000-0000-000000000002')<>0
 OR (SELECT count(*) FROM territory_private.vip_admin_actions_v1)<>3
 OR (SELECT count(*) FROM territory_private.vip_entitlement_revocations_v1
   WHERE grant_id='40000000-0000-4000-8000-000000000003')<>1
 THEN RAISE EXCEPTION 'VIP admin corrupted existing saves or idempotent audit'; END IF;
END $preserved$;
SELECT 'VIP owner PG17: service-only grant/revoke, immutable audit, replay, gift vs payment, no player save writes PASS' AS verified;
