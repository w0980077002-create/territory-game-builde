-- STAGED ONLY; requires 20261105_vip_entitlements_v1.sql.
-- Owner actions are admitted solely by verified admin-api using service_role.
-- No migration touches player game_state or existing VIP grants.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS territory_private.vip_admin_actions_v1 (
  operation_id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.players(id),
  grant_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('grant','revoke')),
  request jsonb NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE territory_private.vip_admin_actions_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.vip_admin_actions_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON territory_private.vip_admin_actions_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.territory_vip_admin_player_v1(p_player uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='pg_catalog'
AS $admin_status$
DECLARE v_status jsonb; v_grants jsonb; v_count integer;
BEGIN
 IF p_player IS NULL THEN RAISE EXCEPTION 'vip_admin_invalid_player'; END IF;
 v_status:=territory_private.vip_entitlement_status_v1(p_player);
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',g.grant_id,'campaign',g.campaign_key,'kind',g.kind,'level',g.vip_level,
   'expiresAt',g.expires_at,'reason',g.reason,'createdAt',g.created_at,
   'revoked',r.grant_id IS NOT NULL,'revokedReason',r.reason
 ) ORDER BY g.created_at DESC),'[]'::jsonb)
 INTO v_grants
 FROM territory_private.vip_entitlement_grants_v1 g
 LEFT JOIN territory_private.vip_entitlement_revocations_v1 r ON r.grant_id=g.grant_id
 WHERE g.player_id=p_player;
 SELECT count(*) INTO v_count FROM territory_private.vip_payment_ledger_v1
   WHERE player_id=p_player AND status='settled';
 RETURN jsonb_build_object('playerId',p_player,'entitlement',v_status,
   'grants',v_grants,'confirmedPaymentCount',v_count);
END $admin_status$;

-- Atomic player lock + entitlement grant + immutable operation receipt.
-- Unique campaign_key prevents a second copy of the same tester gift.
CREATE OR REPLACE FUNCTION public.territory_vip_admin_grant_v1(
 p_player uuid,p_operation uuid,p_campaign text,p_kind text,p_level integer,
 p_expires timestamptz,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $admin_grant$
DECLARE v_before jsonb; v_after jsonb; v_request jsonb; v_receipt jsonb;
 v_old territory_private.vip_admin_actions_v1%ROWTYPE;
BEGIN
 IF p_player IS NULL OR p_operation IS NULL OR p_campaign IS NULL
  OR length(trim(p_campaign)) NOT BETWEEN 3 AND 120
  OR p_kind NOT IN ('gift','temporary') OR p_kind IS NULL
  OR p_level NOT BETWEEN 1 AND 10 OR p_level IS NULL
  OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 4 AND 500
  OR (p_kind='gift' AND p_expires IS NOT NULL)
  OR (p_kind='temporary' AND
     (p_expires IS NULL OR p_expires<=statement_timestamp()
      OR p_expires>statement_timestamp()+interval '365 days'))
 THEN RAISE EXCEPTION 'vip_admin_invalid_grant'; END IF;
 PERFORM 1 FROM public.players WHERE id=p_player AND NOT banned FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'vip_admin_player_unavailable'; END IF;
 v_request:=jsonb_build_object('player',p_player,'campaign',p_campaign,
   'kind',p_kind,'level',p_level,'expires',p_expires,'reason',trim(p_reason));
 SELECT * INTO v_old FROM territory_private.vip_admin_actions_v1 WHERE operation_id=p_operation;
 IF FOUND THEN
   IF v_old.action<>'grant' OR v_old.player_id<>p_player OR v_old.request<>v_request
   THEN RAISE EXCEPTION 'vip_admin_operation_conflict'; END IF;
   RETURN v_old.receipt;
 END IF;
 IF EXISTS(SELECT 1 FROM territory_private.vip_entitlement_grants_v1
    WHERE player_id=p_player AND campaign_key=p_campaign)
 THEN RAISE EXCEPTION 'vip_admin_campaign_exists'; END IF;
 v_before:=territory_private.vip_entitlement_status_v1(p_player);
 INSERT INTO territory_private.vip_entitlement_grants_v1
   (grant_id,player_id,campaign_key,kind,vip_level,expires_at,reason)
 VALUES(p_operation,p_player,p_campaign,p_kind,p_level,p_expires,trim(p_reason));
 v_after:=territory_private.vip_entitlement_status_v1(p_player);
 v_receipt:=jsonb_build_object('success',true,'replayed',false,
   'operationId',p_operation,'grantId',p_operation,'playerId',p_player,
   'kind',p_kind,'level',p_level,'before',v_before,'after',v_after);
 INSERT INTO territory_private.vip_admin_actions_v1
  (operation_id,player_id,grant_id,action,request,receipt)
 VALUES(p_operation,p_player,p_operation,'grant',v_request,v_receipt);
 RETURN v_receipt;
END $admin_grant$;

CREATE OR REPLACE FUNCTION public.territory_vip_admin_revoke_v1(
 p_player uuid,p_grant uuid,p_operation uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $admin_revoke$
DECLARE v_old territory_private.vip_admin_actions_v1%ROWTYPE;
 v_request jsonb; v_before jsonb; v_after jsonb; v_receipt jsonb;
BEGIN
 IF p_player IS NULL OR p_grant IS NULL OR p_operation IS NULL
   OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 4 AND 500
 THEN RAISE EXCEPTION 'vip_admin_invalid_revoke'; END IF;
 PERFORM 1 FROM public.players WHERE id=p_player AND NOT banned FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'vip_admin_player_unavailable'; END IF;
 v_request:=jsonb_build_object('player',p_player,'grant',p_grant,'reason',trim(p_reason));
 SELECT * INTO v_old FROM territory_private.vip_admin_actions_v1 WHERE operation_id=p_operation;
 IF FOUND THEN
   IF v_old.action<>'revoke' OR v_old.player_id<>p_player OR v_old.request<>v_request
   THEN RAISE EXCEPTION 'vip_admin_operation_conflict'; END IF;
   RETURN v_old.receipt;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM territory_private.vip_entitlement_grants_v1
     WHERE player_id=p_player AND grant_id=p_grant)
 THEN RAISE EXCEPTION 'vip_admin_grant_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM territory_private.vip_entitlement_revocations_v1
     WHERE grant_id=p_grant)
 THEN RAISE EXCEPTION 'vip_admin_already_revoked'; END IF;
 v_before:=territory_private.vip_entitlement_status_v1(p_player);
 INSERT INTO territory_private.vip_entitlement_revocations_v1(grant_id,reason)
 VALUES(p_grant,trim(p_reason));
 v_after:=territory_private.vip_entitlement_status_v1(p_player);
 v_receipt:=jsonb_build_object('success',true,'replayed',false,
  'operationId',p_operation,'grantId',p_grant,'playerId',p_player,
  'before',v_before,'after',v_after);
 INSERT INTO territory_private.vip_admin_actions_v1
   (operation_id,player_id,grant_id,action,request,receipt)
 VALUES(p_operation,p_player,p_grant,'revoke',v_request,v_receipt);
 RETURN v_receipt;
END $admin_revoke$;

-- The public RPC names are merely a routing convention. The CLIENT has no
-- EXECUTE privilege; only the owner-authenticated Edge service may invoke them.
REVOKE ALL ON FUNCTION public.territory_vip_admin_player_v1(uuid),
 public.territory_vip_admin_grant_v1(uuid,uuid,text,text,integer,timestamptz,text),
 public.territory_vip_admin_revoke_v1(uuid,uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_vip_admin_player_v1(uuid),
 public.territory_vip_admin_grant_v1(uuid,uuid,text,text,integer,timestamptz,text),
 public.territory_vip_admin_revoke_v1(uuid,uuid,uuid,text)
 TO service_role;
COMMIT;
