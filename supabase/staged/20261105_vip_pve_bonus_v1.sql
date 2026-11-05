-- STAGED ONLY. Install AFTER 20261105_vip_entitlements_v1.sql and
-- territory_v1_adventure_settlement.sql. This module does not enable VIP
-- PvE rewards: an owner-reviewed release must enable the private config.
-- All amounts come from an authoritative server settlement, not the browser.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS territory_private.vip_pve_bonus_config_v1 (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  approval_reference text NOT NULL DEFAULT 'not approved'
    CHECK (length(trim(approval_reference)) > 0),
  CONSTRAINT vip_pve_enabled_requires_approval CHECK (
    NOT enabled OR lower(trim(approval_reference)) <> 'not approved'
  )
);
INSERT INTO territory_private.vip_pve_bonus_config_v1(id,enabled)
 VALUES (true,false) ON CONFLICT (id) DO NOTHING;
ALTER TABLE territory_private.vip_pve_bonus_config_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.vip_pve_bonus_config_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON territory_private.vip_pve_bonus_config_v1 TO service_role;

-- This function is private and service-only. When disabled, the existing
-- adventure payout remains byte-for-byte numerically identical.
-- A valid effective VIP grants precisely 2 percentage points per tier,
-- capped at 20%. The percentages never stack and floor toward zero.
CREATE OR REPLACE FUNCTION territory_private.vip_pve_bonus_v1(
  p_player uuid,p_base_gold integer,p_base_xp integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_pve$
DECLARE
  v_enabled boolean;
  v_level integer := 0;
  v_percent integer := 0;
  v_gold bigint;
  v_xp bigint;
  v_status jsonb;
BEGIN
  IF p_player IS NULL OR p_base_gold IS NULL OR p_base_xp IS NULL
     OR p_base_gold < 0 OR p_base_xp < 0 THEN
    RAISE EXCEPTION 'vip_pve_invalid_reward';
  END IF;
  SELECT enabled INTO v_enabled
    FROM territory_private.vip_pve_bonus_config_v1 WHERE id=true;
  IF v_enabled IS NULL THEN RAISE EXCEPTION 'vip_pve_config_missing'; END IF;

  IF v_enabled THEN
    v_status:=territory_private.vip_entitlement_status_v1(p_player);
    v_level:=(v_status->>'vip')::integer;
    IF v_level IS NULL OR v_level NOT BETWEEN 0 AND 10 THEN
      RAISE EXCEPTION 'vip_pve_invalid_entitlement';
    END IF;
    v_percent:=v_level*2;
  END IF;

  v_gold:=p_base_gold::bigint
    + floor(p_base_gold::numeric*v_percent/100)::bigint;
  v_xp:=p_base_xp::bigint
    + floor(p_base_xp::numeric*v_percent/100)::bigint;
  IF v_gold>2147483647 OR v_xp>2147483647 THEN
    RAISE EXCEPTION 'vip_pve_reward_overflow';
  END IF;
  RETURN jsonb_build_object('gold',v_gold,'xp',v_xp,
    'vip',v_level,'percent',v_percent);
END $vip_pve$;

REVOKE ALL ON FUNCTION territory_private.vip_pve_bonus_v1(uuid,integer,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.vip_pve_bonus_v1(uuid,integer,integer)
 TO service_role;
COMMIT;
