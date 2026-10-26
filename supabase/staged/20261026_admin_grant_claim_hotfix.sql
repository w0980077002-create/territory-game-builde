-- TERRITORY V1 PRODUCTION HOTFIX CANDIDATE (staged, not deployed).
-- Review before running against territory-game-builde's production database.
-- Fix: ordinary admin grants (gold, blue gems, gear, items, empty warnings)
-- have no redGems key. PostgreSQL's NULL regex result must be treated as false.
-- The existing trigger remains attached; no grant rows or balances are touched.

CREATE OR REPLACE FUNCTION territory_private.territory_master_license_credit_reward_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid;
  v_amount integer := 0;
  v_source text;
  v_key text;
BEGIN
  IF TG_TABLE_NAME='admin_grants' THEN
    IF OLD.claimed_at IS NOT NULL OR NEW.claimed_at IS NULL THEN RETURN NEW; END IF;
    IF NOT COALESCE((NEW.payload->>'redGems') ~ '^[0-9]{1,10}$', false)
      THEN RETURN NEW; END IF;
    IF (NEW.payload->>'redGems')::numeric > 2147483647 THEN RETURN NEW; END IF;
    v_uid := NEW.player_id;
    v_amount := (NEW.payload->>'redGems')::integer;
    v_source := 'admin_mail';
    v_key := NEW.id::text;
  ELSIF TG_TABLE_NAME='referral_claim_cursor_v1' THEN
    v_amount := NEW.red_paid - OLD.red_paid;
    IF v_amount <= 0 THEN RETURN NEW; END IF;
    v_uid := NEW.player_id;
    v_source := 'referral';
    v_key := NEW.player_id::text || ':' || NEW.red_paid::text;
  ELSE
    RETURN NEW;
  END IF;

  IF COALESCE(v_amount,0) <= 0 THEN RETURN NEW; END IF;
  INSERT INTO territory_private.territory_master_license_credit_events_v1
    (source,source_key,player_id,amount)
  VALUES(v_source,v_key,v_uid,v_amount) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO territory_private.territory_master_license_red_wallet_v1(player_id,balance)
  VALUES(v_uid,0) ON CONFLICT(player_id) DO NOTHING;
  UPDATE territory_private.territory_master_license_red_wallet_v1
  SET balance=balance+v_amount WHERE player_id=v_uid;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION territory_private.territory_master_license_credit_reward_v1()
  FROM PUBLIC, anon, authenticated;
