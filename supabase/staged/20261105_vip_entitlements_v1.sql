-- STAGED ONLY. This is a read-only VIP entitlement bridge until the
-- reviewed Telegram Stars webhook, audited admin grants and restore plan ship.
-- Do not install on production or write legacy player rows in this migration.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Only a server-verified payment processor may write these rows. Neither a
-- Telegram WebView callback nor a client request is a payment receipt.
CREATE TABLE IF NOT EXISTS territory_private.vip_payment_ledger_v1 (
  provider_transaction_id text PRIMARY KEY CHECK (length(provider_transaction_id) BETWEEN 8 AND 200),
  player_id uuid NOT NULL REFERENCES public.players(id),
  sku text NOT NULL CHECK (length(trim(sku)) BETWEEN 1 AND 100),
  price_version text NOT NULL CHECK (length(trim(price_version)) BETWEEN 1 AND 100),
  currency text NOT NULL DEFAULT 'XTR' CHECK (currency='XTR'),
  stars_amount integer NOT NULL CHECK (stars_amount>0),
  verified_usd_cents bigint NOT NULL CHECK (verified_usd_cents>=0),
  status text NOT NULL CHECK (status IN ('pending','settled','refunded')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  refunded_at timestamptz,
  CHECK ((status='refunded') = (refunded_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS vip_payment_ledger_v1_player_idx
  ON territory_private.vip_payment_ledger_v1(player_id,status);
ALTER TABLE territory_private.vip_payment_ledger_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.vip_payment_ledger_v1 FROM PUBLIC,anon,authenticated;

-- Gifts and temporary VIP are independent of the paid ledger and legacy
-- players.vip_level. Revocation is an append-only audit row, not a deletion.
CREATE TABLE IF NOT EXISTS territory_private.vip_entitlement_grants_v1 (
  grant_id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.players(id),
  campaign_key text NOT NULL CHECK (length(trim(campaign_key)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('gift','temporary')),
  vip_level integer NOT NULL CHECK (vip_level BETWEEN 1 AND 10),
  expires_at timestamptz,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(player_id,campaign_key),
  CHECK ((kind='temporary') = (expires_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS territory_private.vip_entitlement_revocations_v1 (
  grant_id uuid PRIMARY KEY REFERENCES territory_private.vip_entitlement_grants_v1(grant_id),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE territory_private.vip_entitlement_grants_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.vip_entitlement_revocations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.vip_entitlement_grants_v1,
  territory_private.vip_entitlement_revocations_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON territory_private.vip_payment_ledger_v1 TO service_role;
GRANT SELECT,INSERT ON territory_private.vip_entitlement_grants_v1,
  territory_private.vip_entitlement_revocations_v1 TO service_role;

-- Server-owned status. USD cents below are verified price snapshots, never
-- invented from a gifted VIP level, never Stars converted on the client.
CREATE OR REPLACE FUNCTION territory_private.vip_entitlement_status_v1(p_player uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_entitlement$
DECLARE
  v_legacy integer;
  v_fortune integer;
  v_paid integer;
  v_gift integer;
  v_temporary integer;
  v_temporary_until timestamptz;
  v_paid_cents numeric;
  v_permanent integer;
  v_current integer;
BEGIN
  SELECT vip_level INTO v_legacy FROM public.players
    WHERE id=p_player AND NOT banned;
  IF NOT FOUND THEN RAISE EXCEPTION 'vip_entitlement_player_unavailable'; END IF;
  IF v_legacy IS NULL OR v_legacy NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION 'vip_entitlement_legacy_invalid';
  END IF;
  SELECT COALESCE(sum(verified_usd_cents),0) INTO v_paid_cents
    FROM territory_private.vip_payment_ledger_v1
    WHERE player_id=p_player AND status='settled';
  SELECT COALESCE(max(level),0) INTO v_paid FROM (
    VALUES (0,0::numeric),(1,100),(2,1000),(3,5000),(4,15000),
      (5,35000),(6,75000),(7,150000),(8,300000),(9,500000),(10,1000000)
  ) AS threshold(level,cents) WHERE cents<=v_paid_cents;
  SELECT COALESCE(max(g.vip_level),0) INTO v_gift
    FROM territory_private.vip_entitlement_grants_v1 g
    WHERE g.player_id=p_player AND g.kind='gift'
      AND NOT EXISTS (SELECT 1 FROM territory_private.vip_entitlement_revocations_v1 r
        WHERE r.grant_id=g.grant_id);
  SELECT COALESCE(max(g.vip_level),0) INTO v_temporary
    FROM territory_private.vip_entitlement_grants_v1 g
    WHERE g.player_id=p_player AND g.kind='temporary'
      AND g.expires_at>statement_timestamp()
      AND NOT EXISTS (SELECT 1 FROM territory_private.vip_entitlement_revocations_v1 r
        WHERE r.grant_id=g.grant_id);
  -- Existing Fortune VIP (up to temporary VIP1) must continue to work.
  v_fortune:=territory_private.fortune_vip_v1(p_player);
  IF v_fortune IS NULL OR v_fortune NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION 'vip_entitlement_fortune_invalid';
  END IF;
  v_permanent:=greatest(v_legacy,v_paid,v_gift);
  v_current:=greatest(v_permanent,v_temporary,v_fortune);
  -- A temporary status must never become permanent in a cached client.
  -- Only the expiry for the currently effective tier is relevant.
  IF v_current>v_permanent THEN
    SELECT max(g.expires_at) INTO v_temporary_until
      FROM territory_private.vip_entitlement_grants_v1 g
      WHERE g.player_id=p_player AND g.kind='temporary'
        AND g.vip_level=v_current AND g.expires_at>statement_timestamp()
        AND NOT EXISTS (SELECT 1 FROM territory_private.vip_entitlement_revocations_v1 r
          WHERE r.grant_id=g.grant_id);
  END IF;
  RETURN jsonb_build_object('vip',v_current,'permanent_vip',v_permanent,
    'legacy_vip',v_legacy,'paid_vip',v_paid,'gift_vip',v_gift,
    'temporary_vip',v_temporary,'temporary_until',v_temporary_until,
    'server_now',statement_timestamp(),'paid_spend_cents',v_paid_cents);
END $vip_entitlement$;
REVOKE ALL ON FUNCTION territory_private.vip_entitlement_status_v1(uuid)
  FROM PUBLIC,anon,authenticated;

-- Authenticated owner of a player row sees only their own verified snapshot.
CREATE OR REPLACE FUNCTION public.territory_vip_entitlement_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_read$
DECLARE u uuid:=auth.uid();
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'vip_entitlement_login_required'; END IF;
  RETURN territory_private.vip_entitlement_status_v1(u);
END $vip_read$;
REVOKE ALL ON FUNCTION public.territory_vip_entitlement_v1()
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_vip_entitlement_v1() TO authenticated;
COMMIT;
