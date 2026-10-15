-- TERRITORY STAGE 5: ATOMIC, SERVER-OWNED AUCTION (INACTIVE STAGING DRAFT)
-- Prerequisite: territory_stage3_backend.sql on a TEST database only.
-- IMPORTANT: Do NOT run this on live until server-wallet and crafted-inventory
-- reconciliation, validated action cutover, back-up and owner approval.
-- It does NOT revoke unsafe players.game_state grants; it alone is NOT protection.
BEGIN;

ALTER TABLE public.territory_release_flags_v1
  ADD COLUMN IF NOT EXISTS auction_enabled boolean NOT NULL DEFAULT false;

-- The same unique crafted item cannot be sold or used while escrowed.
-- Every other future item mutation MUST check auction_escrow IS NULL.
ALTER TABLE public.territory_crafted_items_v1
  ADD COLUMN IF NOT EXISTS auction_escrow uuid;

CREATE TABLE IF NOT EXISTS public.territory_auction_listings_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.players(id),
  buyer_id uuid REFERENCES public.players(id),
  item_id uuid NOT NULL REFERENCES public.territory_crafted_items_v1(item_id),
  price_gold bigint NOT NULL CHECK (price_gold BETWEEN 1 AND 2147483647),
  fee_gold bigint CHECK (fee_gold BETWEEN 0 AND 2147483647),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','sold','cancelled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  CHECK ((status='open' AND buyer_id IS NULL AND fee_gold IS NULL AND closed_at IS NULL)
      OR (status='cancelled' AND buyer_id IS NULL AND fee_gold IS NULL AND closed_at IS NOT NULL)
      OR (status='sold' AND buyer_id IS NOT NULL AND fee_gold IS NOT NULL AND closed_at IS NOT NULL)),
  CHECK (buyer_id IS DISTINCT FROM seller_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS territory_auction_one_open_item_v1
  ON public.territory_auction_listings_v1(item_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS territory_auction_recent_open_v1
  ON public.territory_auction_listings_v1(created_at DESC,id) WHERE status='open';
CREATE INDEX IF NOT EXISTS territory_auction_seller_v1
  ON public.territory_auction_listings_v1(seller_id,created_at DESC);
ALTER TABLE public.territory_auction_listings_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_auction_listings_v1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.territory_auction_receipts_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id),
  operation_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('list','buy','cancel')),
  arguments jsonb NOT NULL CHECK(jsonb_typeof(arguments)='object'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (player_id,operation_id)
);
ALTER TABLE public.territory_auction_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_auction_receipts_v1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.territory_auction_treasury_v1 (
  id integer PRIMARY KEY CHECK(id=1),
  fees_gold bigint NOT NULL DEFAULT 0 CHECK(fees_gold >= 0),
  trades bigint NOT NULL DEFAULT 0 CHECK(trades >= 0)
);
INSERT INTO public.territory_auction_treasury_v1(id) VALUES(1) ON CONFLICT DO NOTHING;
ALTER TABLE public.territory_auction_treasury_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_auction_treasury_v1 FROM PUBLIC, anon, authenticated;

-- Single read-only RPC. No client-direct reads of wallets or escrow records.
CREATE OR REPLACE FUNCTION public.territory_auction_overview_v1(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_enabled boolean;
  v_lots jsonb := '[]'::jsonb;
  v_mine jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_gold bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT auction_enabled INTO v_enabled FROM public.territory_release_flags_v1 WHERE id=1;
  IF NOT COALESCE(v_enabled,false) THEN
    RETURN jsonb_build_object('enabled',false,'lots','[]'::jsonb,'mine','[]'::jsonb,'items','[]'::jsonb);
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',v.id,'seller_id',v.seller_id,'seller',v.seller,
    'item_id',v.item_id,'item',v.item_output,'price_gold',v.price_gold,
    'created_at',v.created_at) ORDER BY v.created_at DESC,v.id),'[]'::jsonb) INTO v_lots
  FROM (SELECT l.*, left(p.display_name,64) AS seller, i.item_output
    FROM public.territory_auction_listings_v1 l
    JOIN public.territory_crafted_items_v1 i ON i.item_id=l.item_id
    JOIN public.players p ON p.id=l.seller_id
    WHERE l.status='open' ORDER BY l.created_at DESC,l.id LIMIT p_limit) v;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',l.id,'item_id',l.item_id,'item',i.item_output,'price_gold',l.price_gold,
    'status',l.status,'created_at',l.created_at) ORDER BY l.created_at DESC),'[]'::jsonb)
    INTO v_mine FROM public.territory_auction_listings_v1 l
    JOIN public.territory_crafted_items_v1 i ON i.item_id=l.item_id
    WHERE l.seller_id=v_uid AND l.status='open';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id',i.item_id,'item',i.item_output)
    ORDER BY i.created_at DESC),'[]'::jsonb)
    INTO v_items FROM public.territory_crafted_items_v1 i
    WHERE i.player_id=v_uid AND i.auction_escrow IS NULL;
  SELECT gold INTO v_gold FROM public.territory_wallet_v1
    WHERE player_id=v_uid AND verified=true;
  RETURN jsonb_build_object('enabled',true,'lots',v_lots,'mine',v_mine,'items',v_items,'my_gold',v_gold);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_auction_overview_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_auction_overview_v1(integer) TO authenticated, service_role;

-- No client-supplied seller, buyer, item stats, commission or wallet balances.
-- All actions serializable for the actor by advisory lock, and all affected
-- wallet rows are locked in a deterministic UUID order. Failed transactions
-- never debit; successful retries return a stable receipt.
CREATE OR REPLACE FUNCTION public.territory_auction_trade_v1(
  p_action text, p_operation uuid, p_item uuid DEFAULT NULL,
  p_listing uuid DEFAULT NULL, p_price bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_arguments jsonb;
  v_old public.territory_auction_receipts_v1%ROWTYPE;
  v_item public.territory_crafted_items_v1%ROWTYPE;
  v_listing public.territory_auction_listings_v1%ROWTYPE;
  v_buyer public.territory_wallet_v1%ROWTYPE;
  v_seller public.territory_wallet_v1%ROWTYPE;
  v_lid uuid;
  v_fee bigint;
  v_net bigint;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_operation IS NULL OR p_action NOT IN ('list','buy','cancel') OR p_action IS NULL
    THEN RAISE EXCEPTION 'invalid_operation'; END IF;
  IF (p_action='list' AND (p_item IS NULL OR p_listing IS NOT NULL OR p_price IS NULL OR p_price NOT BETWEEN 1 AND 2147483647))
    OR (p_action IN ('buy','cancel') AND (p_listing IS NULL OR p_item IS NOT NULL OR p_price IS NOT NULL))
    THEN RAISE EXCEPTION 'invalid_arguments'; END IF;
  v_arguments := jsonb_build_object('item',p_item,'listing',p_listing,'price',p_price);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text), 7726);
  SELECT * INTO v_old FROM public.territory_auction_receipts_v1
    WHERE player_id=v_uid AND operation_id=p_operation;
  IF FOUND THEN
    IF v_old.action IS DISTINCT FROM p_action OR v_old.arguments IS DISTINCT FROM v_arguments
      THEN RAISE EXCEPTION 'operation_id_reused'; END IF;
    RETURN v_old.result;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_release_flags_v1 WHERE id=1 AND auction_enabled)
    THEN RAISE EXCEPTION 'auction_not_enabled'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_uid AND banned=false)
    THEN RAISE EXCEPTION 'player_unavailable'; END IF;

  IF p_action='list' THEN
    SELECT * INTO v_item FROM public.territory_crafted_items_v1 WHERE item_id=p_item FOR UPDATE;
    IF NOT FOUND OR v_item.player_id<>v_uid OR v_item.auction_escrow IS NOT NULL
      THEN RAISE EXCEPTION 'item_not_available'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.territory_wallet_v1 WHERE player_id=v_uid AND verified=true)
      THEN RAISE EXCEPTION 'wallet_not_verified'; END IF;
    INSERT INTO public.territory_auction_listings_v1(seller_id,item_id,price_gold)
      VALUES(v_uid,p_item,p_price) RETURNING id INTO v_lid;
    UPDATE public.territory_crafted_items_v1 SET auction_escrow=v_lid WHERE item_id=p_item;
    v_result := jsonb_build_object('success',true,'action','list','listing_id',v_lid,'item_id',p_item,'price_gold',p_price);
  ELSE
    SELECT * INTO v_listing FROM public.territory_auction_listings_v1
      WHERE id=p_listing FOR UPDATE;
    IF NOT FOUND OR v_listing.status<>'open' THEN RAISE EXCEPTION 'listing_not_open'; END IF;
    IF p_action='cancel' THEN
      IF v_listing.seller_id<>v_uid THEN RAISE EXCEPTION 'not_listing_owner'; END IF;
      UPDATE public.territory_crafted_items_v1 SET auction_escrow=NULL
        WHERE item_id=v_listing.item_id AND player_id=v_uid AND auction_escrow=v_listing.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'escrow_inconsistent'; END IF;
      UPDATE public.territory_auction_listings_v1 SET status='cancelled',closed_at=clock_timestamp()
        WHERE id=v_listing.id;
      v_result:=jsonb_build_object('success',true,'action','cancel','listing_id',v_listing.id);
    ELSE
      IF v_listing.seller_id=v_uid THEN RAISE EXCEPTION 'self_trade_forbidden'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_listing.seller_id AND banned=false)
        THEN RAISE EXCEPTION 'seller_unavailable'; END IF;
      -- Other trade actors may concurrently try to buy from each other.
      -- Never WAIT on the seller mutex after already taking the buyer mutex:
      -- reverse buys would deadlock. Fail quickly and let the same UUID retry.
      IF NOT pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtext(v_listing.seller_id::text),7726)
      THEN RAISE EXCEPTION 'trade_busy'; END IF;
      -- NOWAIT prevents cross-buy deadlock of opposing account locks. A
      -- transient lock failure can be retried with the SAME operation UUID.
      SELECT * INTO v_buyer FROM public.territory_wallet_v1
        WHERE player_id=v_uid AND verified=true FOR UPDATE NOWAIT;
      SELECT * INTO v_seller FROM public.territory_wallet_v1
        WHERE player_id=v_listing.seller_id AND verified=true FOR UPDATE NOWAIT;
      IF v_buyer.player_id IS NULL OR v_seller.player_id IS NULL
        THEN RAISE EXCEPTION 'wallet_not_verified'; END IF;
      SELECT * INTO v_item FROM public.territory_crafted_items_v1
        WHERE item_id=v_listing.item_id FOR UPDATE;
      IF NOT FOUND OR v_item.player_id<>v_listing.seller_id OR v_item.auction_escrow IS DISTINCT FROM v_listing.id
        THEN RAISE EXCEPTION 'escrow_inconsistent'; END IF;
      v_fee := (v_listing.price_gold + 9) / 10;
      v_net := v_listing.price_gold - v_fee;
      IF v_buyer.gold < v_listing.price_gold THEN RAISE EXCEPTION 'insufficient_gold'; END IF;
      IF v_seller.gold + v_net > 2147483647 THEN RAISE EXCEPTION 'seller_wallet_overflow'; END IF;
      UPDATE public.territory_wallet_v1 SET gold=gold-v_listing.price_gold,updated_at=clock_timestamp()
        WHERE player_id=v_uid;
      UPDATE public.territory_wallet_v1 SET gold=gold+v_net,updated_at=clock_timestamp()
        WHERE player_id=v_listing.seller_id;
      UPDATE public.territory_auction_treasury_v1
        SET fees_gold=fees_gold+v_fee,trades=trades+1 WHERE id=1;
      UPDATE public.territory_crafted_items_v1 SET player_id=v_uid,auction_escrow=NULL
        WHERE item_id=v_listing.item_id;
      UPDATE public.territory_auction_listings_v1
        SET status='sold',buyer_id=v_uid,fee_gold=v_fee,closed_at=clock_timestamp()
        WHERE id=v_listing.id;
      v_result:=jsonb_build_object('success',true,'action','buy','listing_id',v_listing.id,
        'item_id',v_listing.item_id,'price_gold',v_listing.price_gold,
        'fee_gold',v_fee,'seller_receives',v_net,'buyer_gold',v_buyer.gold-v_listing.price_gold);
    END IF;
  END IF;
  INSERT INTO public.territory_auction_receipts_v1(player_id,operation_id,action,arguments,result)
    VALUES (v_uid,p_operation,p_action,v_arguments,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.territory_auction_trade_v1(text,uuid,uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_auction_trade_v1(text,uuid,uuid,uuid,bigint)
  TO authenticated, service_role;
COMMIT;
