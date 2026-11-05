\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 fixture; never run against production.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA territory_private;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA territory_private TO service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
CREATE TABLE public.players (
  id uuid PRIMARY KEY, banned boolean NOT NULL DEFAULT false,
  vip_level integer NOT NULL DEFAULT 0
);
CREATE FUNCTION territory_private.fortune_vip_v1(u uuid) RETURNS integer
  LANGUAGE sql STABLE AS 'SELECT vip_level FROM public.players WHERE id=u';
INSERT INTO public.players (id,vip_level) VALUES
 ('10000000-0000-0000-0000-000000000001',5),
 ('10000000-0000-0000-0000-000000000002',0),
 ('10000000-0000-0000-0000-000000000003',0);
\i supabase/staged/20261105_vip_entitlements_v1.sql
\i supabase/staged/20261105_vip_pve_bonus_v1.sql

DO $permissions$
BEGIN
 IF has_function_privilege('anon','public.territory_vip_entitlement_v1()','EXECUTE')
 OR has_function_privilege('authenticated','territory_private.vip_entitlement_status_v1(uuid)','EXECUTE')
 OR has_table_privilege('authenticated','territory_private.vip_payment_ledger_v1','SELECT')
 OR has_table_privilege('authenticated','territory_private.vip_entitlement_grants_v1','INSERT')
 OR has_table_privilege('authenticated','territory_private.vip_entitlement_revocations_v1','SELECT') THEN
  RAISE EXCEPTION 'VIP entitlement private data exposed to clients';
 END IF;
 IF NOT has_function_privilege('authenticated','public.territory_vip_entitlement_v1()','EXECUTE') THEN
  RAISE EXCEPTION 'Owner cannot query their VIP entitlement';
 END IF;
 IF (SELECT count(*) FROM public.players)<>3
 OR (SELECT vip_level FROM public.players WHERE id='10000000-0000-0000-0000-000000000001')<>5 THEN
  RAISE EXCEPTION 'Stage install changed legacy saves';
 END IF;
END $permissions$;

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
DO $legacy$
DECLARE j jsonb;
BEGIN
 j:=public.territory_vip_entitlement_v1();
 IF (j->>'vip')::integer<>5 OR (j->>'permanent_vip')::integer<>5
   OR (j->>'paid_vip')::integer<>0 OR (j->>'paid_spend_cents')::numeric<>0 THEN
  RAISE EXCEPTION 'Legacy gifted VIP5 was misrepresented as paid: %',j;
 END IF;
END $legacy$;
DO $client_cannot_mint$
BEGIN
 BEGIN
  INSERT INTO territory_private.vip_payment_ledger_v1
   (provider_transaction_id,player_id,sku,price_version,stars_amount,verified_usd_cents,status)
   VALUES ('forged-receipt-000001','10000000-0000-0000-0000-000000000001',
    'fake','1',999,1000000,'settled');
  RAISE EXCEPTION 'Authenticated client minted a purchase';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $client_cannot_mint$;
RESET ROLE;

-- The following rows simulate ALREADY VERIFIED trusted service operations.
-- No client-facing function can insert them.
INSERT INTO territory_private.vip_payment_ledger_v1
 (provider_transaction_id,player_id,sku,price_version,stars_amount,verified_usd_cents,status)
 VALUES ('verified-stars-00000001','10000000-0000-0000-0000-000000000002',
    'potion_pack','v1',50,1000,'settled'),
  ('pending-stars-0000000002','10000000-0000-0000-0000-000000000002',
    'potion_pack','v1',50,500000,'pending');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SET ROLE authenticated;
DO $paid$
DECLARE j jsonb;
BEGIN
 j:=public.territory_vip_entitlement_v1();
 IF (j->>'paid_vip')::integer<>2 OR (j->>'vip')::integer<>2
  OR (j->>'paid_spend_cents')::numeric<>1000 THEN
  RAISE EXCEPTION 'Pending payment counted or settled paid tier incorrect: %',j;
 END IF;
END $paid$;
RESET ROLE;

INSERT INTO territory_private.vip_entitlement_grants_v1
 (grant_id,player_id,campaign_key,kind,vip_level,reason,expires_at)
 VALUES
 ('20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002','tester-vip5','gift',5,'Verified tester',NULL),
 ('20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002','one-week-event','temporary',8,'Promo event',now()+interval '7 days'),
 ('20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000002','expired-event','temporary',10,'Expired promo',now()-interval '1 day');
SET ROLE authenticated;
DO $gift_temp$
DECLARE j jsonb;
BEGIN
 j:=public.territory_vip_entitlement_v1();
 IF (j->>'paid_vip')::integer<>2 OR (j->>'gift_vip')::integer<>5
  OR (j->>'temporary_vip')::integer<>8
  OR (j->>'permanent_vip')::integer<>5 OR (j->>'vip')::integer<>8
  OR (j->>'paid_spend_cents')::numeric<>1000
  OR (j->>'temporary_until')::timestamptz<=statement_timestamp()
  OR (j->>'temporary_until') IS NULL
  OR (j->>'server_now')::timestamptz IS NULL THEN
  RAISE EXCEPTION 'Paid/gift/temporary not separated: %',j;
 END IF;
END $gift_temp$;
RESET ROLE;

DO $duplicates$
BEGIN
 BEGIN
  INSERT INTO territory_private.vip_payment_ledger_v1
   (provider_transaction_id,player_id,sku,price_version,stars_amount,verified_usd_cents,status)
   VALUES ('verified-stars-00000001','10000000-0000-0000-0000-000000000002',
    'same_event_again','v2',50,1000,'settled');
  RAISE EXCEPTION 'Provider transaction replay accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO territory_private.vip_entitlement_grants_v1
   (grant_id,player_id,campaign_key,kind,vip_level,reason)
   VALUES ('20000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000002','tester-vip5','gift',5,'Duplicate tester grant');
  RAISE EXCEPTION 'Gift campaign replay accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $duplicates$;

INSERT INTO territory_private.vip_entitlement_revocations_v1 (grant_id,reason)
 VALUES ('20000000-0000-0000-0000-000000000002','Temporary promotion revoked');
SET ROLE authenticated;
DO $revoked_temp$
DECLARE j jsonb;
BEGIN
 j:=public.territory_vip_entitlement_v1();
 IF (j->>'vip')::integer<>5 OR (j->>'temporary_vip')::integer<>0
  OR (j->>'gift_vip')::integer<>5 OR j->'temporary_until'<>'null'::jsonb THEN
  RAISE EXCEPTION 'Temporary revocation removed permanent gift: %',j;
 END IF;
END $revoked_temp$;
RESET ROLE;

UPDATE territory_private.vip_payment_ledger_v1
 SET status='refunded', refunded_at=clock_timestamp()
 WHERE provider_transaction_id='verified-stars-00000001';
SET ROLE authenticated;
DO $refunded$
DECLARE j jsonb;
BEGIN
 j:=public.territory_vip_entitlement_v1();
 IF (j->>'paid_vip')::integer<>0 OR (j->>'paid_spend_cents')::numeric<>0
  OR (j->>'gift_vip')::integer<>5 OR (j->>'permanent_vip')::integer<>5 THEN
  RAISE EXCEPTION 'Refund damaged gift VIP or did not remove paid amount: %',j;
 END IF;
END $refunded$;
RESET ROLE;
INSERT INTO territory_private.vip_entitlement_revocations_v1(grant_id,reason)
 VALUES ('20000000-0000-0000-0000-000000000001','Approved separate promotional revocation');
SET ROLE authenticated;
DO $revoked_gift$
DECLARE j jsonb;
BEGIN
 j:=public.territory_vip_entitlement_v1();
 IF (j->>'vip')::integer<>0 OR (j->>'permanent_vip')::integer<>0 THEN
  RAISE EXCEPTION 'Gift revocation did not leave paid/refunded tier at zero: %',j;
 END IF;
END $revoked_gift$;
RESET ROLE;

-- Verify isolated server-only VIP PvE calculation. It starts disabled,
-- grants no power to authenticated clients, and never reads client tiers.
DO $vip_pve_rights$
BEGIN
 IF has_function_privilege('authenticated','territory_private.vip_pve_bonus_v1(uuid,integer,integer)','EXECUTE')
 OR has_table_privilege('authenticated','territory_private.vip_pve_bonus_config_v1','UPDATE')
 THEN RAISE EXCEPTION 'Client can mint VIP PvE rewards'; END IF;
END $vip_pve_rights$;
SET ROLE service_role;
DO $vip_pve_disabled$
DECLARE j jsonb;
BEGIN
 j:=territory_private.vip_pve_bonus_v1('10000000-0000-0000-0000-000000000001',15,20);
 IF (j->>'gold')::int<>15 OR (j->>'xp')::int<>20 OR (j->>'percent')::int<>0
 THEN RAISE EXCEPTION 'Disabled VIP bonus changed existing rewards: %',j; END IF;
END $vip_pve_disabled$;
RESET ROLE;
UPDATE territory_private.vip_pve_bonus_config_v1
 SET enabled=true,approval_reference='disposable PG17 test only' WHERE id=true;
SET ROLE service_role;
DO $vip_pve_legacy$
DECLARE j jsonb;
BEGIN
 j:=territory_private.vip_pve_bonus_v1('10000000-0000-0000-0000-000000000001',15,20);
 IF (j->>'gold')::int<>16 OR (j->>'xp')::int<>22 OR (j->>'percent')::int<>10
 THEN RAISE EXCEPTION 'Legacy VIP5 did not apply 10 percent with floor: %',j; END IF;
 j:=territory_private.vip_pve_bonus_v1('10000000-0000-0000-0000-000000000002',15,20);
 IF (j->>'gold')::int<>15 OR (j->>'xp')::int<>20
 THEN RAISE EXCEPTION 'Revoked/refunded player still gained VIP bonus: %',j; END IF;
 BEGIN
  PERFORM territory_private.vip_pve_bonus_v1('10000000-0000-0000-0000-000000000001',2147483647,2147483647);
  RAISE EXCEPTION 'Overflow reward was accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_pve_reward_overflow' THEN RAISE; END IF;
 END;
END $vip_pve_legacy$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','',false);
SET ROLE authenticated;
DO $anonymous_identity$
BEGIN
 BEGIN
  PERFORM public.territory_vip_entitlement_v1();
  RAISE EXCEPTION 'Null JWT was accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_entitlement_login_required' THEN RAISE; END IF;
 END;
END $anonymous_identity$;
RESET ROLE;
SELECT 'VIP entitlements PG17: legacy, paid, gift, temporary, refunds, expiry, RLS, idempotence PASS' AS verified;
