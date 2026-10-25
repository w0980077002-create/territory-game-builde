-- TERRITORY V1: permanent Master License, exactly 50 red gems.
-- The legacy game_state redGems field is client-writable. Never authorize a
-- purchase from that field after this one-time, reviewed wallet snapshot.
-- Run the wallet cutover ONCE; later credits must be server-authorized.

CREATE TABLE IF NOT EXISTS territory_private.territory_master_license_red_wallet_v1 (
  player_id uuid PRIMARY KEY REFERENCES public.players(id),
  balance integer NOT NULL CHECK(balance BETWEEN 0 AND 2147483647),
  seeded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE territory_private.territory_master_license_red_wallet_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.territory_master_license_red_wallet_v1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS territory_private.territory_master_license_buy_events_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id),
  operation_id uuid NOT NULL,
  price integer NOT NULL CHECK(price=50),
  balance_after integer NOT NULL CHECK(balance_after>=0),
  purchased_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY(player_id,operation_id)
);
ALTER TABLE territory_private.territory_master_license_buy_events_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.territory_master_license_buy_events_v1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS territory_private.territory_master_license_credit_events_v1 (
  source text NOT NULL,
  source_key text NOT NULL,
  player_id uuid NOT NULL REFERENCES public.players(id),
  amount integer NOT NULL CHECK(amount>0),
  credited_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY(source,source_key)
);
ALTER TABLE territory_private.territory_master_license_credit_events_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.territory_master_license_credit_events_v1 FROM PUBLIC, anon, authenticated;

-- Copy legacy balances once. Do not use client snapshots for future top-ups.
INSERT INTO territory_private.territory_master_license_red_wallet_v1(player_id,balance)
SELECT id,CASE WHEN game_state #>> '{player,redGems}' ~ '^[0-9]{1,9}$'
  THEN (game_state #>> '{player,redGems}')::integer ELSE 0 END
FROM public.players
ON CONFLICT(player_id) DO NOTHING;

-- Credit *verified* new awards after the cutover; never trust a client save.
-- Admin mail is a one-time claimed grant, and referrals have a monotonic
-- red_paid cursor. Neither source can be replayed by uploading game_state.
CREATE OR REPLACE FUNCTION territory_private.territory_master_license_credit_reward_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid;
  v_amount integer:=0;
  v_source text;
  v_key text;
BEGIN
  IF TG_TABLE_NAME='admin_grants' THEN
    IF OLD.claimed_at IS NOT NULL OR NEW.claimed_at IS NULL THEN RETURN NEW; END IF;
    IF (NEW.payload->>'redGems') !~ '^[0-9]{1,9}$' THEN RETURN NEW; END IF;
    v_uid:=NEW.player_id;
    v_amount:=(NEW.payload->>'redGems')::int;
    v_source:='admin_mail';v_key:=NEW.id::text;
  ELSIF TG_TABLE_NAME='referral_claim_cursor_v1' THEN
    v_amount:=NEW.red_paid-OLD.red_paid;
    IF v_amount<=0 THEN RETURN NEW; END IF;
    v_uid:=NEW.player_id;
    v_source:='referral';v_key:=NEW.player_id::text||':'||NEW.red_paid::text;
  ELSE RETURN NEW; END IF;
  IF v_amount<=0 THEN RETURN NEW; END IF;
  INSERT INTO territory_private.territory_master_license_credit_events_v1(source,source_key,player_id,amount)
  VALUES(v_source,v_key,v_uid,v_amount) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NEW; END IF;
  INSERT INTO territory_private.territory_master_license_red_wallet_v1(player_id,balance)
  VALUES(v_uid,0) ON CONFLICT(player_id) DO NOTHING;
  UPDATE territory_private.territory_master_license_red_wallet_v1
  SET balance=balance+v_amount WHERE player_id=v_uid;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION territory_private.territory_master_license_credit_reward_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS territory_master_license_mail_credit_v1 ON public.admin_grants;
CREATE TRIGGER territory_master_license_mail_credit_v1
AFTER UPDATE OF claimed_at ON public.admin_grants FOR EACH ROW
EXECUTE FUNCTION territory_private.territory_master_license_credit_reward_v1();

DROP TRIGGER IF EXISTS territory_master_license_referral_credit_v1 ON territory_private.referral_claim_cursor_v1;
CREATE TRIGGER territory_master_license_referral_credit_v1
AFTER UPDATE OF red_paid ON territory_private.referral_claim_cursor_v1 FOR EACH ROW
EXECUTE FUNCTION territory_private.territory_master_license_credit_reward_v1();

CREATE OR REPLACE FUNCTION public.territory_master_license_shop_status_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_player public.players%ROWTYPE;
  v_profession text;
  v_owned boolean:=false;
  v_balance integer:=0;
  v_legacy integer:=0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'license_login_required'; END IF;
  SELECT * INTO v_player FROM public.players WHERE id=v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'license_player_missing'; END IF;
  SELECT profession,master_license INTO v_profession,v_owned
  FROM public.territory_profession_unlocks WHERE player_id=v_uid;
  SELECT balance INTO v_balance
  FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=v_uid;
  IF v_player.game_state #>> '{player,redGems}' ~ '^[0-9]{1,9}$'
    THEN v_legacy:=(v_player.game_state #>> '{player,redGems}')::integer; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'enabled',true,'price',50,'red_balance',LEAST(COALESCE(v_balance,0),v_legacy),
    'owned',COALESCE(v_owned,false),'has_profession',v_profession IS NOT NULL,
    'verified_telegram',v_player.telegram_id IS NOT NULL AND NOT v_player.banned);
END $function$;
REVOKE ALL ON FUNCTION public.territory_master_license_shop_status_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_master_license_shop_status_v1() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.territory_master_license_shop_buy_v1(p_operation uuid,p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_player public.players%ROWTYPE;
  v_profession text;
  v_owned boolean;
  v_balance integer;
  v_legacy integer:=0;
  v_previous territory_private.territory_master_license_buy_events_v1%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'license_login_required'; END IF;
  -- Acquire locks in the same order as profession crafting: player first.
  SELECT * INTO v_player FROM public.players
    WHERE id=v_uid AND telegram_id IS NOT NULL AND NOT banned FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'license_verified_telegram_required'; END IF;

  SELECT * INTO v_previous
  FROM territory_private.territory_master_license_buy_events_v1
  WHERE player_id=v_uid AND operation_id=p_operation;
  IF FOUND THEN
    SELECT balance INTO v_balance
    FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=v_uid;
    IF v_player.game_state #>> '{player,redGems}' ~ '^[0-9]{1,9}$'
      THEN v_legacy:=(v_player.game_state #>> '{player,redGems}')::integer; END IF;
    RETURN pg_catalog.jsonb_build_object('success',true,'owned',true,
      'price',v_previous.price,'red_balance',LEAST(COALESCE(v_balance,0),v_legacy),
      'operation_id',p_operation,'replayed',true,
      'updated_at',v_player.updated_at,'game_state',v_player.game_state,
      'wallet_gold',v_player.gold,'wallet_gems',v_player.gems);
  END IF;

  IF p_expected IS NULL OR v_player.updated_at IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'license_reload_save';
  END IF;

  SELECT profession,master_license INTO v_profession,v_owned
  FROM public.territory_profession_unlocks WHERE player_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'license_profession_required'; END IF;
  IF v_owned THEN RAISE EXCEPTION 'license_already_owned'; END IF;

  -- Players arriving after the one-time legacy cutover begin with zero.
  INSERT INTO territory_private.territory_master_license_red_wallet_v1(player_id,balance)
  VALUES(v_uid,0) ON CONFLICT(player_id) DO NOTHING;
  SELECT balance INTO v_balance
  FROM territory_private.territory_master_license_red_wallet_v1
  WHERE player_id=v_uid FOR UPDATE;
  IF v_player.game_state #>> '{player,redGems}' ~ '^[0-9]{1,9}$'
    THEN v_legacy:=(v_player.game_state #>> '{player,redGems}')::integer; END IF;
  -- Protect against double spend with old Monopoly/local consumers too.
  v_balance:=LEAST(v_balance,v_legacy);
  IF v_balance < 50 THEN RAISE EXCEPTION 'license_insufficient_red_gems'; END IF;

  UPDATE territory_private.territory_master_license_red_wallet_v1
  SET balance=v_balance-50 WHERE player_id=v_uid;
  UPDATE public.territory_profession_unlocks
  SET master_license=true WHERE player_id=v_uid AND NOT master_license;
  -- Reflect the debit to the existing HUD. The wallet is still the authority.
  IF pg_catalog.jsonb_typeof(v_player.game_state)!='object'
    OR pg_catalog.jsonb_typeof(v_player.game_state->'player')!='object'
  THEN RAISE EXCEPTION 'license_invalid_save'; END IF;
  UPDATE public.players SET game_state=pg_catalog.jsonb_set(
    game_state,'{player,redGems}',pg_catalog.to_jsonb(v_balance-50),true),
    updated_at=GREATEST(pg_catalog.clock_timestamp(),updated_at+interval '1 microsecond')
  WHERE id=v_uid RETURNING * INTO v_player;
  INSERT INTO territory_private.territory_master_license_buy_events_v1
    (player_id,operation_id,price,balance_after)
  VALUES(v_uid,p_operation,50,v_balance-50);
  RETURN pg_catalog.jsonb_build_object('success',true,'owned',true,
    'price',50,'red_balance',v_balance-50,
    'operation_id',p_operation,'replayed',false,
    'updated_at',v_player.updated_at,'game_state',v_player.game_state,
    'wallet_gold',v_player.gold,'wallet_gems',v_player.gems);
END $function$;
REVOKE ALL ON FUNCTION public.territory_master_license_shop_buy_v1(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_master_license_shop_buy_v1(uuid,timestamptz) TO authenticated, service_role;
