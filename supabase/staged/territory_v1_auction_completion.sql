-- TERRITORY 1.0 T9–T12, STAGING ONLY. Never apply or enable in production without review.
-- Prerequisites: Stage3 + Stage5, Stage8 professions and master-license shop schemas.
-- Extends the existing listings, wallets and item instances; imports no player save.
BEGIN;
CREATE SCHEMA IF NOT EXISTS territory_private;
ALTER TABLE public.territory_release_flags_v1 ADD COLUMN IF NOT EXISTS auction_completion_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.territory_profession_stage8_items ADD COLUMN IF NOT EXISTS auction_escrow uuid;
ALTER TABLE public.territory_crafted_items_v1 ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.territory_crafted_items_v1 ADD COLUMN IF NOT EXISTS maker_id uuid REFERENCES public.players(id), ADD COLUMN IF NOT EXISTS maker_name text;
ALTER TABLE public.territory_profession_stage8_items ADD COLUMN IF NOT EXISTS maker_id uuid REFERENCES public.players(id), ADD COLUMN IF NOT EXISTS maker_name text;
-- Historical maker identity is unknown. Do not label a reseller as the maker.
CREATE OR REPLACE FUNCTION territory_private.territory_auction_maker_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.maker_id:=NEW.player_id;
    IF NEW.item_output->>'type' IN ('elixir','potion','material','resource') THEN
      NEW.expires_at:=least(NEW.expires_at,clock_timestamp()+interval '7 days');
    END IF;
    SELECT left(display_name,64) INTO NEW.maker_name FROM public.players WHERE id=NEW.player_id;
  ELSIF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'item_lifetime_immutable';
  ELSIF NEW.maker_id IS DISTINCT FROM OLD.maker_id OR NEW.maker_name IS DISTINCT FROM OLD.maker_name THEN
    RAISE EXCEPTION 'maker_immutable';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION territory_private.territory_auction_maker_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER territory_auction_maker_stage3 BEFORE INSERT OR UPDATE ON public.territory_crafted_items_v1
FOR EACH ROW EXECUTE FUNCTION territory_private.territory_auction_maker_v1();
CREATE TRIGGER territory_auction_maker_stage8 BEFORE INSERT OR UPDATE ON public.territory_profession_stage8_items
FOR EACH ROW EXECUTE FUNCTION territory_private.territory_auction_maker_v1();

ALTER TABLE public.territory_auction_listings_v1 ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE public.territory_auction_listings_v1 ADD COLUMN IF NOT EXISTS stage8_item_id uuid REFERENCES public.territory_profession_stage8_items(item_id),
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'gold' CHECK(currency IN ('gold','gems','redGems')),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS item_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS resource_id text,ADD COLUMN IF NOT EXISTS resource_qty bigint CHECK(resource_qty>0),ADD COLUMN IF NOT EXISTS resource_fragments jsonb;
-- Preserve pre-existing open listings with unknown duration; release preflight must resolve them explicitly.
ALTER TABLE public.territory_auction_listings_v1 ADD CONSTRAINT territory_auction_item_source_v2 CHECK(num_nonnulls(item_id,stage8_item_id,resource_id)=1);
CREATE UNIQUE INDEX territory_auction_one_open_stage8_v2 ON public.territory_auction_listings_v1(stage8_item_id) WHERE status='open';
CREATE INDEX territory_auction_expiry_v2 ON public.territory_auction_listings_v1(expires_at,id) WHERE status='open';
-- Existing price_gold/fee_gold retain their column names for wire compatibility;
-- for non-gold lots they store the amount in the specified currency.
ALTER TABLE public.territory_auction_treasury_v1 ADD COLUMN IF NOT EXISTS fees_gems bigint NOT NULL DEFAULT 0 CHECK(fees_gems>=0),
  ADD COLUMN IF NOT EXISTS fees_red_gems bigint NOT NULL DEFAULT 0 CHECK(fees_red_gems>=0);
-- Replace only status constraints, keeping all historical rows and existing sold/cancelled invariants.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_catalog.pg_constraint WHERE conrelid='public.territory_auction_listings_v1'::regclass
    AND contype='c' AND pg_catalog.pg_get_constraintdef(oid) LIKE '%status%'
  LOOP EXECUTE format('ALTER TABLE public.territory_auction_listings_v1 DROP CONSTRAINT %I',c.conname); END LOOP;
END; $$;
ALTER TABLE public.territory_auction_listings_v1 ADD CONSTRAINT territory_auction_status_v2 CHECK(
  (status='open' AND buyer_id IS NULL AND fee_gold IS NULL AND closed_at IS NULL)
  OR (status IN ('cancelled','expired') AND buyer_id IS NULL AND fee_gold IS NULL AND closed_at IS NOT NULL)
  OR (status='sold' AND buyer_id IS NOT NULL AND fee_gold IS NOT NULL AND closed_at IS NOT NULL));

-- Expiry metadata supplements the existing aggregate; it never grants resources.
CREATE TABLE territory_private.territory_auction_resource_reconcile_v1(
  player_id uuid NOT NULL REFERENCES public.players(id),resource_id text NOT NULL,operation_id uuid NOT NULL,
  review_ref text NOT NULL,fragments jsonb NOT NULL,result jsonb NOT NULL,PRIMARY KEY(player_id,resource_id),UNIQUE(operation_id));
CREATE TABLE territory_private.territory_auction_resource_batches_v1(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_id uuid NOT NULL REFERENCES public.players(id),resource_id text NOT NULL,
  quantity bigint NOT NULL CHECK(quantity>=0),acquired_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,origin text NOT NULL,
  CHECK(expires_at<=acquired_at+interval '7 days' AND expires_at>acquired_at));
CREATE INDEX territory_auction_resource_oldest_v1 ON territory_private.territory_auction_resource_batches_v1(player_id,resource_id,expires_at,id) WHERE quantity>0;
ALTER TABLE territory_private.territory_auction_resource_reconcile_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.territory_auction_resource_batches_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.territory_auction_resource_reconcile_v1,territory_private.territory_auction_resource_batches_v1 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.territory_auction_reconcile_resources_v1(p_player uuid,p_resource text,p_operation uuid,p_expected bigint,p_review_ref text,p_fragments jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous territory_private.territory_auction_resource_reconcile_v1%ROWTYPE; actual bigint; total bigint:=0; f jsonb; qty bigint; acquired timestamptz; expiry timestamptz; r jsonb; BEGIN
  IF p_player IS NULL OR p_operation IS NULL OR p_resource IS NULL OR p_resource NOT IN ('gather-ore','gather-wood','gather-hide','gather-herb','gather-crystal')
    OR p_expected IS NULL OR p_expected NOT BETWEEN 0 AND 2147483647 OR p_review_ref IS NULL OR length(p_review_ref) NOT BETWEEN 10 AND 300
    OR jsonb_typeof(p_fragments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fragments)>1000 THEN RAISE EXCEPTION 'invalid_resource_reconciliation'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_player::text),7726);
  SELECT * INTO previous FROM territory_private.territory_auction_resource_reconcile_v1 WHERE player_id=p_player AND resource_id=p_resource;
  IF FOUND THEN
    IF previous.operation_id<>p_operation OR previous.fragments<>p_fragments OR previous.review_ref<>p_review_ref OR (previous.result->>'quantity')::bigint<>p_expected THEN RAISE EXCEPTION 'resource_already_reconciled'; END IF;
    RETURN previous.result;
  END IF;
  SELECT quantity INTO actual FROM public.territory_resource_wallet WHERE player_id=p_player AND resource_id=p_resource FOR UPDATE;
  IF actual IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'resource_reconciliation_mismatch'; END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(p_fragments) LOOP
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR NOT coalesce(f->>'qty' ~ '^[0-9]{1,10}$',false)
      OR f->>'origin' IS NULL OR length(f->>'origin') NOT BETWEEN 1 AND 200 OR f->>'acquired_at' IS NULL OR f->>'expires_at' IS NULL THEN RAISE EXCEPTION 'invalid_resource_fragment'; END IF;
    qty:=(f->>'qty')::bigint; acquired:=(f->>'acquired_at')::timestamptz; expiry:=(f->>'expires_at')::timestamptz;
    IF qty NOT BETWEEN 1 AND 2147483647 OR acquired>clock_timestamp() OR expiry<=acquired OR expiry>acquired+interval '7 days' THEN RAISE EXCEPTION 'invalid_resource_fragment'; END IF;
    total:=total+qty;
    INSERT INTO territory_private.territory_auction_resource_batches_v1(player_id,resource_id,quantity,acquired_at,expires_at,origin)
      VALUES(p_player,p_resource,qty,acquired,expiry,f->>'origin');
  END LOOP;
  IF total<>actual THEN RAISE EXCEPTION 'resource_reconciliation_mismatch'; END IF;
  r:=jsonb_build_object('success',true,'player_id',p_player,'resource_id',p_resource,'quantity',actual);
  INSERT INTO territory_private.territory_auction_resource_reconcile_v1 VALUES(p_player,p_resource,p_operation,p_review_ref,p_fragments,r);
  RETURN r;
END; $$;
REVOKE ALL ON FUNCTION public.territory_auction_reconcile_resources_v1(uuid,text,uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_auction_reconcile_resources_v1(uuid,text,uuid,bigint,text,jsonb) TO service_role;

-- Every existing craft/gather update automatically spends oldest live batches
-- once that player's resource was explicitly reconciled. Legacy accounts are untouched.
CREATE FUNCTION territory_private.territory_auction_resource_wallet_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE total bigint; live bigint; delta bigint; need bigint; b record; take bigint; credited_at timestamptz:=clock_timestamp(); BEGIN
  IF NOT EXISTS(SELECT 1 FROM territory_private.territory_auction_resource_reconcile_v1 WHERE player_id=OLD.player_id AND resource_id=OLD.resource_id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'reconciled_resource_delete_forbidden'; END IF;
  SELECT coalesce(sum(quantity),0) INTO total FROM territory_private.territory_auction_resource_batches_v1 WHERE player_id=OLD.player_id AND resource_id=OLD.resource_id;
  IF total<>OLD.quantity THEN
    -- A trusted escrow return/transfer first inserts exact dated fragments.
    IF total=NEW.quantity THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'resource_batch_inconsistent';
  END IF;
  delta:=NEW.quantity-OLD.quantity;
  SELECT coalesce(sum(quantity),0) INTO live FROM territory_private.territory_auction_resource_batches_v1 WHERE player_id=OLD.player_id AND resource_id=OLD.resource_id AND expires_at>clock_timestamp();
  UPDATE territory_private.territory_auction_resource_batches_v1 SET quantity=0 WHERE player_id=OLD.player_id AND resource_id=OLD.resource_id AND expires_at<=clock_timestamp();
  IF delta<0 THEN
    need:=-delta;
    IF live<need THEN RAISE EXCEPTION 'insufficient_unexpired_resources'; END IF;
    FOR b IN SELECT * FROM territory_private.territory_auction_resource_batches_v1 WHERE player_id=OLD.player_id AND resource_id=OLD.resource_id AND quantity>0 AND expires_at>clock_timestamp() ORDER BY expires_at,id FOR UPDATE LOOP
      take:=least(need,b.quantity);
      UPDATE territory_private.territory_auction_resource_batches_v1 SET quantity=quantity-take WHERE id=b.id;
      need:=need-take; EXIT WHEN need=0;
    END LOOP;
  ELSIF delta>0 THEN
    INSERT INTO territory_private.territory_auction_resource_batches_v1(player_id,resource_id,quantity,acquired_at,expires_at,origin)
      VALUES(OLD.player_id,OLD.resource_id,delta,credited_at,credited_at+interval '7 days','server-wallet-credit:'||gen_random_uuid()::text);
  END IF;
  NEW.quantity:=live+delta;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION territory_private.territory_auction_resource_wallet_guard_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER territory_auction_resource_wallet_guard_v1 BEFORE UPDATE OR DELETE ON public.territory_resource_wallet
FOR EACH ROW EXECUTE FUNCTION territory_private.territory_auction_resource_wallet_guard_v1();

CREATE FUNCTION territory_private.territory_auction_resource_restore_v1(p_player uuid,p_resource text,p_fragments jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE qty bigint; added bigint:=0; f jsonb; existing bigint; BEGIN
  IF NOT EXISTS(SELECT 1 FROM territory_private.territory_auction_resource_reconcile_v1 WHERE player_id=p_player AND resource_id=p_resource) THEN RAISE EXCEPTION 'resource_not_reconciled'; END IF;
  SELECT quantity INTO existing FROM public.territory_resource_wallet WHERE player_id=p_player AND resource_id=p_resource FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'resource_wallet_missing'; END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(p_fragments) LOOP
    IF (f->>'expires_at')::timestamptz<=clock_timestamp() THEN CONTINUE; END IF;
    qty:=(f->>'qty')::bigint; added:=added+qty;
    INSERT INTO territory_private.territory_auction_resource_batches_v1(player_id,resource_id,quantity,acquired_at,expires_at,origin)
      VALUES(p_player,p_resource,qty,(f->>'acquired_at')::timestamptz,(f->>'expires_at')::timestamptz,f->>'origin');
  END LOOP;
  IF existing+added>2147483647 THEN RAISE EXCEPTION 'resource_wallet_overflow'; END IF;
  IF added>0 THEN UPDATE public.territory_resource_wallet SET quantity=quantity+added WHERE player_id=p_player AND resource_id=p_resource; END IF;
  RETURN added;
END; $$;
REVOKE ALL ON FUNCTION territory_private.territory_auction_resource_restore_v1(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION territory_private.territory_auction_assert_wallet_v2(p_player uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.players%ROWTYPE; w public.territory_wallet_v1%ROWTYPE; r bigint; BEGIN
  SELECT * INTO p FROM public.players WHERE id=p_player AND NOT banned FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  SELECT * INTO w FROM public.territory_wallet_v1 WHERE player_id=p_player AND verified FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_verified'; END IF;
  IF w.gold IS DISTINCT FROM p.gold OR w.gems IS DISTINCT FROM p.gems OR (p.game_state#>>'{player,gold}')::bigint IS DISTINCT FROM w.gold
    OR (p.game_state#>>'{player,gems}')::bigint IS DISTINCT FROM w.gems THEN RAISE EXCEPTION 'wallet_reconciliation_required'; END IF;
  SELECT balance INTO r FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=p_player;
  IF FOUND AND coalesce((p.game_state#>>'{player,redGems}')::bigint,0) IS DISTINCT FROM r THEN RAISE EXCEPTION 'wallet_reconciliation_required'; END IF;
END; $$;
REVOKE ALL ON FUNCTION territory_private.territory_auction_assert_wallet_v2(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION territory_private.territory_auction_sync_wallet_v2(p_player uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.territory_wallet_v1%ROWTYPE; r bigint; BEGIN
  SELECT * INTO w FROM public.territory_wallet_v1 WHERE player_id=p_player AND verified;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_verified'; END IF;
  SELECT balance INTO r FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=p_player;
  UPDATE public.players SET gold=w.gold,gems=w.gems,updated_at=clock_timestamp(),
    game_state=jsonb_set(game_state,'{player}',coalesce(game_state->'player','{}'::jsonb)||jsonb_build_object('gold',w.gold,'gems',w.gems)||
      CASE WHEN r IS NOT NULL THEN jsonb_build_object('redGems',r) ELSE '{}'::jsonb END,true) WHERE id=p_player;
END; $$;
REVOKE ALL ON FUNCTION territory_private.territory_auction_sync_wallet_v2(uuid) FROM PUBLIC,anon,authenticated;
-- Harmless release flag reader; clients receive no wallet-table privileges.
CREATE FUNCTION public.territory_auction_wallet_guard_active_v2() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT exists(SELECT 1 FROM public.territory_release_flags_v1 WHERE id=1 AND auction_completion_enabled)
$$;
REVOKE ALL ON FUNCTION public.territory_auction_wallet_guard_active_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_auction_wallet_guard_active_v2() TO authenticated,service_role;
-- SECURITY INVOKER preserves the outer server function's identity: server-owned
-- mail/arena/referral handlers synchronize verified ledgers, whereas a raw client
-- save cannot manufacture a balance. Disabled release leaves old flows untouched.
CREATE FUNCTION territory_private.territory_auction_wallet_save_guard_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.territory_wallet_v1%ROWTYPE; r bigint; old_red bigint; new_red bigint; BEGIN
  IF NOT public.territory_auction_wallet_guard_active_v2() THEN RETURN NEW; END IF;
  IF current_user IN ('authenticated','anon') THEN
    IF NEW.gold IS DISTINCT FROM OLD.gold OR NEW.gems IS DISTINCT FROM OLD.gems
      OR NEW.game_state#>'{player,gold}' IS DISTINCT FROM OLD.game_state#>'{player,gold}'
      OR NEW.game_state#>'{player,gems}' IS DISTINCT FROM OLD.game_state#>'{player,gems}'
      OR NEW.game_state#>'{player,redGems}' IS DISTINCT FROM OLD.game_state#>'{player,redGems}' THEN
      RAISE EXCEPTION 'stale_auction_wallet_save';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO w FROM public.territory_wallet_v1 WHERE player_id=NEW.id AND verified FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF (NEW.game_state#>>'{player,gold}')::bigint IS DISTINCT FROM NEW.gold OR (NEW.game_state#>>'{player,gems}')::bigint IS DISTINCT FROM NEW.gems
    OR (w.gold IS DISTINCT FROM OLD.gold AND w.gold IS DISTINCT FROM NEW.gold)
    OR (w.gems IS DISTINCT FROM OLD.gems AND w.gems IS DISTINCT FROM NEW.gems) THEN RAISE EXCEPTION 'wallet_reconciliation_required'; END IF;
  UPDATE public.territory_wallet_v1 SET gold=NEW.gold,gems=NEW.gems,updated_at=clock_timestamp() WHERE player_id=NEW.id;
  SELECT balance INTO r FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=NEW.id FOR UPDATE NOWAIT;
  IF FOUND THEN
    old_red:=coalesce((OLD.game_state#>>'{player,redGems}')::bigint,0);new_red:=coalesce((NEW.game_state#>>'{player,redGems}')::bigint,0);
    IF r IS DISTINCT FROM old_red AND r IS DISTINCT FROM new_red THEN RAISE EXCEPTION 'wallet_reconciliation_required'; END IF;
    UPDATE territory_private.territory_master_license_red_wallet_v1 SET balance=new_red WHERE player_id=NEW.id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION territory_private.territory_auction_wallet_save_guard_v2() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER territory_auction_wallet_save_guard_v2 BEFORE UPDATE OF game_state,gold,gems ON public.players
FOR EACH ROW EXECUTE FUNCTION territory_private.territory_auction_wallet_save_guard_v2();

CREATE FUNCTION public.territory_auction_list_resources_v1(p_operation uuid,p_resource text,p_quantity bigint,p_price bigint,p_currency text DEFAULT 'gold',p_duration_seconds integer DEFAULT 86400)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); a jsonb; old public.territory_auction_receipts_v1%ROWTYPE; b record; remaining bigint; take bigint; available bigint;
  fragments jsonb:='[]'::jsonb; deadline timestamptz:=clock_timestamp()+make_interval(secs=>p_duration_seconds); lid uuid; r jsonb; BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_operation IS NULL OR p_resource IS NULL OR p_resource NOT IN ('gather-ore','gather-wood','gather-hide','gather-herb','gather-crystal')
    OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 2147483647 OR p_price IS NULL OR p_price NOT BETWEEN 1 AND 2147483647
    OR p_currency IS NULL OR p_currency NOT IN ('gold','gems','redGems') OR (p_currency<>'gold' AND p_price%10<>0)
    OR p_duration_seconds IS NULL OR p_duration_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'invalid_arguments'; END IF;
  a:=jsonb_build_object('resource',p_resource,'quantity',p_quantity,'price',p_price,'currency',p_currency,'duration',p_duration_seconds);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(u::text),7726);
  SELECT * INTO old FROM public.territory_auction_receipts_v1 WHERE player_id=u AND operation_id=p_operation;
  IF FOUND THEN IF old.action<>'list' OR old.arguments<>a THEN RAISE EXCEPTION 'operation_id_reused'; END IF; RETURN old.result; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_release_flags_v1 WHERE id=1 AND auction_enabled AND auction_completion_enabled) THEN RAISE EXCEPTION 'auction_not_enabled'; END IF;
  PERFORM territory_private.territory_auction_assert_wallet_v2(u);
  IF pg_catalog.has_column_privilege('authenticated','public.territory_resource_wallet','quantity','UPDATE') OR pg_catalog.has_column_privilege('authenticated','public.territory_resource_wallet','quantity','INSERT') OR pg_catalog.has_table_privilege('authenticated','public.territory_resource_wallet','DELETE') THEN RAISE EXCEPTION 'resource_wallet_not_authoritative'; END IF;
  IF NOT EXISTS(SELECT 1 FROM territory_private.territory_auction_resource_reconcile_v1 WHERE player_id=u AND resource_id=p_resource) THEN RAISE EXCEPTION 'resource_not_reconciled'; END IF;
  SELECT quantity INTO available FROM public.territory_resource_wallet WHERE player_id=u AND resource_id=p_resource FOR UPDATE;
  IF available IS NULL OR available<p_quantity THEN RAISE EXCEPTION 'insufficient_resources'; END IF;
  remaining:=p_quantity;
  FOR b IN SELECT * FROM territory_private.territory_auction_resource_batches_v1 WHERE player_id=u AND resource_id=p_resource AND quantity>0 AND expires_at>clock_timestamp() ORDER BY expires_at,id FOR UPDATE LOOP
    take:=least(remaining,b.quantity); remaining:=remaining-take; deadline:=least(deadline,b.expires_at);
    fragments:=fragments||jsonb_build_array(jsonb_build_object('qty',take,'acquired_at',b.acquired_at,'expires_at',b.expires_at,'origin',b.origin));
    EXIT WHEN remaining=0;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'insufficient_unexpired_resources'; END IF;
  -- The aggregate trigger withdraws the exact same oldest-expiring fragments.
  UPDATE public.territory_resource_wallet SET quantity=quantity-p_quantity WHERE player_id=u AND resource_id=p_resource;
  INSERT INTO public.territory_auction_listings_v1(seller_id,resource_id,resource_qty,resource_fragments,item_snapshot,price_gold,currency,expires_at)
    VALUES(u,p_resource,p_quantity,fragments,jsonb_build_object('name',p_resource,'resourceId',p_resource,'type','resource','qty',p_quantity),p_price,p_currency,deadline) RETURNING id INTO lid;
  r:=jsonb_build_object('success',true,'action','list','listing_id',lid,'item_id',lid,'source','resource','price',p_price,'currency',p_currency,'expires_at',deadline);
  INSERT INTO public.territory_auction_receipts_v1(player_id,operation_id,action,arguments,result) VALUES(u,p_operation,'list',a,r);
  RETURN r;
END; $$;
REVOKE ALL ON FUNCTION public.territory_auction_list_resources_v1(uuid,text,bigint,bigint,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_auction_list_resources_v1(uuid,text,bigint,bigint,text,integer) TO authenticated,service_role;

-- No wallet moves on expiration. Idempotent and suitable for a reviewed scheduler.
CREATE OR REPLACE FUNCTION territory_private.territory_auction_expire_v2(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l record; n integer:=0; BEGIN
  FOR l IN SELECT * FROM public.territory_auction_listings_v1 WHERE status='open' AND expires_at<=clock_timestamp()
    ORDER BY expires_at,id LIMIT greatest(1,least(p_limit,1000)) FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.territory_auction_listings_v1 SET status='expired',closed_at=clock_timestamp() WHERE id=l.id;
    IF l.item_id IS NOT NULL THEN
      UPDATE public.territory_crafted_items_v1 SET auction_escrow=NULL WHERE item_id=l.item_id AND player_id=l.seller_id AND auction_escrow=l.id;
    ELSIF l.stage8_item_id IS NOT NULL THEN
      UPDATE public.territory_profession_stage8_items SET auction_escrow=NULL WHERE item_id=l.stage8_item_id AND player_id=l.seller_id AND auction_escrow=l.id;
    END IF;
    IF l.resource_id IS NOT NULL THEN PERFORM territory_private.territory_auction_resource_restore_v1(l.seller_id,l.resource_id,l.resource_fragments);
    ELSIF NOT FOUND THEN RAISE EXCEPTION 'escrow_inconsistent'; END IF;
    UPDATE public.territory_auction_listings_v1 SET status='expired',closed_at=clock_timestamp() WHERE id=l.id;
    n:=n+1;
  END LOOP;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION territory_private.territory_auction_expire_v2(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.territory_auction_expire_v2(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.territory_auction_trade_v2(
  p_action text,p_operation uuid,p_item uuid DEFAULT NULL,p_listing uuid DEFAULT NULL,p_price bigint DEFAULT NULL,
  p_currency text DEFAULT 'gold',p_source text DEFAULT 'stage3',p_duration_seconds integer DEFAULT 86400
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  u uuid:=auth.uid(); a jsonb; old public.territory_auction_receipts_v1%ROWTYPE; l public.territory_auction_listings_v1%ROWTYPE;
  it record; buyer public.territory_wallet_v1%ROWTYPE; seller public.territory_wallet_v1%ROWTYPE;
  buyer_balance bigint; seller_balance bigint; fee bigint; net bigint; result jsonb; lid uuid; deadline timestamptz;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_operation IS NULL OR p_action IS NULL OR p_action NOT IN ('list','buy','cancel') THEN RAISE EXCEPTION 'invalid_operation'; END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('gold','gems','redGems') OR p_source IS NULL OR p_source NOT IN ('stage3','stage8')
    OR p_duration_seconds IS NULL OR p_duration_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'invalid_arguments'; END IF;
  IF (p_action='list' AND (p_item IS NULL OR p_listing IS NOT NULL OR p_price IS NULL OR p_price NOT BETWEEN 1 AND 2147483647 OR (p_currency<>'gold' AND p_price%10<>0)))
    OR (p_action IN ('buy','cancel') AND (p_listing IS NULL OR p_item IS NOT NULL OR p_price IS NOT NULL)) THEN RAISE EXCEPTION 'invalid_arguments'; END IF;
  a:=jsonb_build_object('item',p_item,'listing',p_listing,'price',p_price,'currency',p_currency,'source',p_source,'duration',p_duration_seconds);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(u::text),7726);
  SELECT * INTO old FROM public.territory_auction_receipts_v1 WHERE player_id=u AND operation_id=p_operation;
  IF FOUND THEN
    IF old.action IS DISTINCT FROM p_action OR old.arguments IS DISTINCT FROM a THEN RAISE EXCEPTION 'operation_id_reused'; END IF;
    RETURN old.result;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_release_flags_v1 WHERE id=1 AND auction_enabled AND auction_completion_enabled) THEN RAISE EXCEPTION 'auction_not_enabled'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND banned=false) THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  PERFORM territory_private.territory_auction_assert_wallet_v2(u);
  IF p_action='list' THEN
    -- Expire this actor's previous listings first so an ended lot can be relisted.
    PERFORM territory_private.territory_auction_expire_v2(1000);
    IF p_source='stage3' THEN
      SELECT item_id,player_id,item_output,auction_escrow,maker_id,maker_name,expires_at INTO it FROM public.territory_crafted_items_v1 WHERE item_id=p_item FOR UPDATE;
    ELSE
      SELECT item_id,player_id,item_output,auction_escrow,maker_id,maker_name,expires_at INTO it FROM public.territory_profession_stage8_items WHERE item_id=p_item FOR UPDATE;
    END IF;
    IF NOT FOUND OR it.player_id<>u OR it.auction_escrow IS NOT NULL OR it.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'item_not_available'; END IF;
    -- Legacy consumables/materials without lifetime proof cannot be made immortal by resale.
    IF it.item_output->>'type' NOT IN ('equipment','elixir','potion','material','resource') OR it.item_output->>'type' IS NULL THEN RAISE EXCEPTION 'unsupported_item'; END IF;
    IF it.item_output->>'type'<>'equipment' AND it.expires_at IS NULL THEN RAISE EXCEPTION 'item_lifetime_unverified'; END IF;
    IF EXISTS(SELECT 1 FROM public.players p CROSS JOIN LATERAL jsonb_each(coalesce(p.game_state#>'{player,equipped}','{}'::jsonb)) e WHERE p.id=u AND (e.value->>'id') IN ('stage8_'||p_item::text,'craft_'||p_item::text)) THEN RAISE EXCEPTION 'item_equipped'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.territory_wallet_v1 WHERE player_id=u AND verified) THEN RAISE EXCEPTION 'wallet_not_verified'; END IF;
    deadline:=least(clock_timestamp()+make_interval(secs=>p_duration_seconds),it.expires_at);
    INSERT INTO public.territory_auction_listings_v1(seller_id,item_id,stage8_item_id,price_gold,currency,expires_at,item_snapshot)
      VALUES(u,CASE WHEN p_source='stage3' THEN p_item END,CASE WHEN p_source='stage8' THEN p_item END,p_price,p_currency,deadline,
        it.item_output||jsonb_build_object('makerId',it.maker_id,'makerName',it.maker_name)) RETURNING id INTO lid;
    IF p_source='stage3' THEN UPDATE public.territory_crafted_items_v1 SET auction_escrow=lid WHERE item_id=p_item;
    ELSE UPDATE public.territory_profession_stage8_items SET auction_escrow=lid WHERE item_id=p_item; END IF;
    result:=jsonb_build_object('success',true,'action','list','listing_id',lid,'item_id',p_item,'price',p_price,'currency',p_currency,'expires_at',deadline);
  ELSE
    SELECT * INTO l FROM public.territory_auction_listings_v1 WHERE id=p_listing FOR UPDATE;
    IF NOT FOUND OR l.status<>'open' THEN RAISE EXCEPTION 'listing_not_open'; END IF;
    IF l.expires_at IS NULL THEN RAISE EXCEPTION 'legacy_listing_requires_review'; END IF;
    IF l.expires_at<=clock_timestamp() THEN
      PERFORM territory_private.territory_auction_expire_v2(1000);
      result:=jsonb_build_object('success',true,'action',p_action,'listing_id',l.id,'outcome','expired');
    ELSIF p_action='cancel' THEN
      IF l.seller_id<>u THEN RAISE EXCEPTION 'not_listing_owner'; END IF;
      UPDATE public.territory_auction_listings_v1 SET status='cancelled',closed_at=clock_timestamp() WHERE id=l.id;
      IF l.item_id IS NOT NULL THEN UPDATE public.territory_crafted_items_v1 SET auction_escrow=NULL WHERE item_id=l.item_id AND player_id=u AND auction_escrow=l.id;
      ELSIF l.stage8_item_id IS NOT NULL THEN UPDATE public.territory_profession_stage8_items SET auction_escrow=NULL WHERE item_id=l.stage8_item_id AND player_id=u AND auction_escrow=l.id; END IF;
      IF l.resource_id IS NOT NULL THEN PERFORM territory_private.territory_auction_resource_restore_v1(l.seller_id,l.resource_id,l.resource_fragments);
      ELSIF NOT FOUND THEN RAISE EXCEPTION 'escrow_inconsistent'; END IF;
      UPDATE public.territory_auction_listings_v1 SET status='cancelled',closed_at=clock_timestamp() WHERE id=l.id;
      result:=jsonb_build_object('success',true,'action','cancel','listing_id',l.id,'outcome','cancelled');
    ELSE
      IF l.seller_id=u THEN RAISE EXCEPTION 'self_trade_forbidden'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=l.seller_id AND banned=false) THEN RAISE EXCEPTION 'seller_unavailable'; END IF;
      IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext(l.seller_id::text),7726) THEN RAISE EXCEPTION 'trade_busy'; END IF;
      PERFORM territory_private.territory_auction_assert_wallet_v2(l.seller_id);
      SELECT * INTO buyer FROM public.territory_wallet_v1 WHERE player_id=u AND verified FOR UPDATE NOWAIT;
      SELECT * INTO seller FROM public.territory_wallet_v1 WHERE player_id=l.seller_id AND verified FOR UPDATE NOWAIT;
      IF buyer.player_id IS NULL OR seller.player_id IS NULL THEN RAISE EXCEPTION 'wallet_not_verified'; END IF;
      IF l.item_id IS NOT NULL THEN
        SELECT item_id,player_id,auction_escrow,expires_at INTO it FROM public.territory_crafted_items_v1 WHERE item_id=l.item_id FOR UPDATE;
      ELSIF l.stage8_item_id IS NOT NULL THEN
        SELECT item_id,player_id,auction_escrow,expires_at INTO it FROM public.territory_profession_stage8_items WHERE item_id=l.stage8_item_id FOR UPDATE;
      END IF;
      IF l.resource_id IS NULL THEN
        IF NOT FOUND OR it.player_id<>l.seller_id OR it.auction_escrow IS DISTINCT FROM l.id OR it.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'escrow_inconsistent'; END IF;
      END IF;
      fee:=(l.price_gold+9)/10; net:=l.price_gold-fee;
      IF l.currency='redGems' THEN
        SELECT balance INTO buyer_balance FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=u FOR UPDATE NOWAIT;
        SELECT balance INTO seller_balance FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=l.seller_id FOR UPDATE NOWAIT;
      ELSE
        buyer_balance:=CASE l.currency WHEN 'gold' THEN buyer.gold ELSE buyer.gems END;
        seller_balance:=CASE l.currency WHEN 'gold' THEN seller.gold ELSE seller.gems END;
      END IF;
      IF buyer_balance IS NULL OR seller_balance IS NULL THEN RAISE EXCEPTION 'wallet_not_verified'; END IF;
      IF buyer_balance<l.price_gold THEN RAISE EXCEPTION 'insufficient_funds'; END IF;
      IF seller_balance+net>2147483647 THEN RAISE EXCEPTION 'seller_wallet_overflow'; END IF;
      IF l.currency='redGems' THEN
        UPDATE territory_private.territory_master_license_red_wallet_v1 SET balance=balance-l.price_gold WHERE player_id=u;
        UPDATE territory_private.territory_master_license_red_wallet_v1 SET balance=balance+net WHERE player_id=l.seller_id;
      ELSIF l.currency='gems' THEN
        UPDATE public.territory_wallet_v1 SET gems=gems-l.price_gold,updated_at=clock_timestamp() WHERE player_id=u;
        UPDATE public.territory_wallet_v1 SET gems=gems+net,updated_at=clock_timestamp() WHERE player_id=l.seller_id;
      ELSE
        UPDATE public.territory_wallet_v1 SET gold=gold-l.price_gold,updated_at=clock_timestamp() WHERE player_id=u;
        UPDATE public.territory_wallet_v1 SET gold=gold+net,updated_at=clock_timestamp() WHERE player_id=l.seller_id;
      END IF;
      PERFORM territory_private.territory_auction_sync_wallet_v2(u);
      PERFORM territory_private.territory_auction_sync_wallet_v2(l.seller_id);
      UPDATE public.territory_auction_treasury_v1 SET trades=trades+1,
        fees_gold=fees_gold+CASE WHEN l.currency='gold' THEN fee ELSE 0 END,
        fees_gems=fees_gems+CASE WHEN l.currency='gems' THEN fee ELSE 0 END,
        fees_red_gems=fees_red_gems+CASE WHEN l.currency='redGems' THEN fee ELSE 0 END WHERE id=1;
      UPDATE public.territory_auction_listings_v1 SET status='sold',buyer_id=u,fee_gold=fee,closed_at=clock_timestamp() WHERE id=l.id;
      IF l.item_id IS NOT NULL THEN UPDATE public.territory_crafted_items_v1 SET player_id=u,auction_escrow=NULL WHERE item_id=l.item_id;
      ELSIF l.stage8_item_id IS NOT NULL THEN UPDATE public.territory_profession_stage8_items SET player_id=u,auction_escrow=NULL WHERE item_id=l.stage8_item_id; END IF;
      UPDATE public.territory_auction_listings_v1 SET status='sold',buyer_id=u,fee_gold=fee,closed_at=clock_timestamp() WHERE id=l.id;
      IF l.resource_id IS NOT NULL THEN PERFORM territory_private.territory_auction_resource_restore_v1(u,l.resource_id,l.resource_fragments); END IF;
      result:=jsonb_build_object('success',true,'action','buy','outcome','sold','listing_id',l.id,'item_id',coalesce(l.item_id,l.stage8_item_id,l.id),
        'price',l.price_gold,'currency',l.currency,'fee',fee,'seller_receives',net,'buyer_balance',buyer_balance-l.price_gold);
    END IF;
  END IF;
  INSERT INTO public.territory_auction_receipts_v1(player_id,operation_id,action,arguments,result) VALUES(u,p_operation,p_action,a,result);
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.territory_auction_trade_v2(text,uuid,uuid,uuid,bigint,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_auction_trade_v2(text,uuid,uuid,uuid,bigint,text,text,integer) TO authenticated,service_role;
-- Prevent the old endpoint bypassing multi-currency/lifetime checks after reviewed cutover.
CREATE OR REPLACE FUNCTION public.territory_auction_trade_v1(p_action text,p_operation uuid,p_item uuid DEFAULT NULL,p_listing uuid DEFAULT NULL,p_price bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; l public.territory_auction_listings_v1%ROWTYPE; previous public.territory_auction_receipts_v1%ROWTYPE; BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO previous FROM public.territory_auction_receipts_v1 WHERE player_id=auth.uid() AND operation_id=p_operation;
  IF FOUND AND NOT (previous.arguments ? 'currency') THEN
    IF previous.action IS DISTINCT FROM p_action OR previous.arguments IS DISTINCT FROM jsonb_build_object('item',p_item,'listing',p_listing,'price',p_price) THEN RAISE EXCEPTION 'operation_id_reused'; END IF;
    RETURN previous.result;
  END IF;
  IF p_listing IS NOT NULL THEN
    SELECT * INTO l FROM public.territory_auction_listings_v1 WHERE id=p_listing;
    IF FOUND AND (l.currency<>'gold' OR l.stage8_item_id IS NOT NULL OR l.resource_id IS NOT NULL) THEN RAISE EXCEPTION 'auction_client_upgrade_required'; END IF;
  END IF;
  r:=public.territory_auction_trade_v2(p_action,p_operation,p_item,p_listing,p_price);
  RETURN r||jsonb_build_object('price_gold',r->'price','fee_gold',r->'fee','buyer_gold',r->'buyer_balance');
END; $$;
-- Persistent naming receipt; naming never spends or manufactures an item.
CREATE TABLE territory_private.territory_auction_name_receipts_v1(
  player_id uuid NOT NULL REFERENCES public.players(id),operation_id uuid NOT NULL,item_id uuid NOT NULL,
  source text NOT NULL,name text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(player_id,operation_id));
ALTER TABLE territory_private.territory_auction_name_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.territory_auction_name_receipts_v1 FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.territory_auction_name_item_v1(p_operation uuid,p_item uuid,p_source text,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); old territory_private.territory_auction_name_receipts_v1%ROWTYPE; it record; r jsonb; n text:=btrim(p_name); BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_operation IS NULL OR p_item IS NULL OR p_source IS NULL OR p_source NOT IN ('stage3','stage8') OR n IS NULL
    OR char_length(n) NOT BETWEEN 1 AND 60 OR n ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid_name'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(u::text),7726);
  SELECT * INTO old FROM territory_private.territory_auction_name_receipts_v1 WHERE player_id=u AND operation_id=p_operation;
  IF FOUND THEN
    IF old.item_id<>p_item OR old.source<>p_source OR old.name<>n THEN RAISE EXCEPTION 'operation_id_reused'; END IF;
    RETURN old.result;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_release_flags_v1 WHERE id=1 AND auction_enabled AND auction_completion_enabled)
    THEN RAISE EXCEPTION 'auction_not_enabled'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND banned=false) THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_unlocks WHERE player_id=u AND master_license)
    OR NOT EXISTS(SELECT 1 FROM territory_private.territory_master_license_buy_events_v1 WHERE player_id=u)
    THEN RAISE EXCEPTION 'purchased_master_license_required'; END IF;
  IF p_source='stage3' THEN
    IF NOT EXISTS(SELECT 1 FROM public.territory_profession_mastery_v1 WHERE player_id=u AND verified AND mastery_level=300)
      THEN RAISE EXCEPTION 'profession_level_300_required'; END IF;
    SELECT player_id,maker_id,item_output,auction_escrow,expires_at INTO it FROM public.territory_crafted_items_v1 WHERE item_id=p_item FOR UPDATE;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_progress WHERE player_id=u AND verified AND mastery_level=300)
      THEN RAISE EXCEPTION 'profession_level_300_required'; END IF;
    SELECT player_id,maker_id,item_output,auction_escrow,expires_at INTO it FROM public.territory_profession_stage8_items WHERE item_id=p_item FOR UPDATE;
  END IF;
  IF NOT FOUND OR it.player_id<>u OR it.maker_id IS DISTINCT FROM u OR it.auction_escrow IS NOT NULL OR it.expires_at<=clock_timestamp()
    THEN RAISE EXCEPTION 'item_not_available'; END IF;
  -- Custom name is a display field; immutable original template and stats remain intact.
  IF p_source='stage3' THEN UPDATE public.territory_crafted_items_v1 SET item_output=jsonb_set(item_output,'{customName}',to_jsonb(n),true) WHERE item_id=p_item;
  ELSE UPDATE public.territory_profession_stage8_items SET item_output=jsonb_set(item_output,'{customName}',to_jsonb(n),true) WHERE item_id=p_item; END IF;
  r:=jsonb_build_object('success',true,'item_id',p_item,'custom_name',n);
  INSERT INTO territory_private.territory_auction_name_receipts_v1 VALUES(u,p_operation,p_item,p_source,n,r);
  RETURN r;
END; $$;
REVOKE ALL ON FUNCTION public.territory_auction_name_item_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_auction_name_item_v1(uuid,uuid,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.territory_auction_overview_v2(p_limit integer DEFAULT 50,p_search text DEFAULT '',p_rarity text DEFAULT '',p_sort text DEFAULT 'newest',p_currency text DEFAULT '',p_category text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); lots jsonb; mine jsonb; history jsonb; items jsonb; wallets jsonb; BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_release_flags_v1 WHERE id=1 AND auction_enabled AND auction_completion_enabled)
    THEN RETURN jsonb_build_object('enabled',false,'lots','[]'::jsonb,'mine','[]'::jsonb,'items','[]'::jsonb,'history','[]'::jsonb); END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_sort IS NULL OR p_sort NOT IN ('newest','price_asc','price_desc','expires_first')
    OR p_currency IS NULL OR p_currency NOT IN ('','gold','gems','redGems') OR p_category IS NULL OR p_category NOT IN ('','equipment','potion','elixir','material','resource')
    OR p_rarity IS NULL OR p_rarity NOT IN ('','common','rare','epic','legendary') OR p_search IS NULL OR char_length(p_search)>100
    THEN RAISE EXCEPTION 'invalid_filter'; END IF;
  PERFORM territory_private.territory_auction_expire_v2(1000);
  SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO lots FROM (
    SELECT l.id,l.seller_id,left(p.display_name,64) AS seller,coalesce(l.item_id,l.stage8_item_id,l.id) AS item_id,
      CASE WHEN l.item_id IS NOT NULL THEN 'stage3' WHEN l.stage8_item_id IS NOT NULL THEN 'stage8' ELSE 'resource' END AS source,
      l.item_snapshot AS item,l.price_gold AS price,l.currency,l.created_at,l.expires_at
    FROM public.territory_auction_listings_v1 l JOIN public.players p ON p.id=l.seller_id
    WHERE l.status='open' AND l.expires_at>clock_timestamp()
      AND (p_currency='' OR l.currency=p_currency) AND (p_category='' OR l.item_snapshot->>'type'=p_category)
      AND (p_rarity='' OR l.item_snapshot->>'rarity'=p_rarity)
      AND (p_search='' OR position(lower(p_search) in lower(coalesce(l.item_snapshot->>'name','')||' '||coalesce(l.item_snapshot->>'customName','')||' '||coalesce(l.item_snapshot->>'makerName','')||' '||coalesce(p.display_name,'')))>0)
    ORDER BY CASE WHEN p_sort='price_asc' THEN l.price_gold END ASC,CASE WHEN p_sort='price_desc' THEN l.price_gold END DESC,
      CASE WHEN p_sort='expires_first' THEN l.expires_at END ASC,l.created_at DESC,l.id LIMIT p_limit) t;
  SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO mine FROM (
    SELECT id,coalesce(item_id,stage8_item_id,id) AS item_id,CASE WHEN item_id IS NOT NULL THEN 'stage3' WHEN stage8_item_id IS NOT NULL THEN 'stage8' ELSE 'resource' END AS source,
      item_snapshot AS item,price_gold AS price,currency,status,created_at,expires_at FROM public.territory_auction_listings_v1
    WHERE seller_id=u AND status='open' AND expires_at>clock_timestamp() ORDER BY created_at DESC,id) t;
  SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO history FROM (
    SELECT id,coalesce(item_id,stage8_item_id,id) AS item_id,CASE WHEN item_id IS NOT NULL THEN 'stage3' WHEN stage8_item_id IS NOT NULL THEN 'stage8' ELSE 'resource' END AS source,item_snapshot AS item,price_gold AS price,fee_gold AS fee,currency,status,closed_at,
      CASE WHEN seller_id=u THEN 'seller' ELSE 'buyer' END AS role FROM public.territory_auction_listings_v1
    WHERE (seller_id=u OR buyer_id=u) AND status<>'open' ORDER BY closed_at DESC,id LIMIT 100) t;
  SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO items FROM (
    SELECT item_id,'stage3'::text AS source,item_output||jsonb_build_object('makerId',maker_id,'makerName',maker_name) AS item,expires_at
      FROM public.territory_crafted_items_v1 WHERE player_id=u AND auction_escrow IS NULL
        AND (expires_at>clock_timestamp() OR (expires_at IS NULL AND item_output->>'type'='equipment'))
    UNION ALL
    SELECT item_id,'stage8',item_output||jsonb_build_object('makerId',maker_id,'makerName',maker_name),expires_at
      FROM public.territory_profession_stage8_items WHERE player_id=u AND auction_escrow IS NULL
        AND (expires_at>clock_timestamp() OR (expires_at IS NULL AND item_output->>'type'='equipment'))) t;
  SELECT jsonb_build_object('gold',w.gold,'gems',w.gems,'redGems',r.balance) INTO wallets
    FROM public.territory_wallet_v1 w LEFT JOIN territory_private.territory_master_license_red_wallet_v1 r ON r.player_id=w.player_id
    WHERE w.player_id=u AND w.verified;
  RETURN jsonb_build_object('enabled',true,'lots',lots,'mine',mine,'history',history,'items',items,'wallets',wallets,'resources',(SELECT coalesce(jsonb_object_agg(resource_id,quantity),'{}'::jsonb) FROM (SELECT w.resource_id,CASE WHEN EXISTS(SELECT 1 FROM territory_private.territory_auction_resource_reconcile_v1 r WHERE r.player_id=w.player_id AND r.resource_id=w.resource_id) THEN (SELECT coalesce(sum(b.quantity),0) FROM territory_private.territory_auction_resource_batches_v1 b WHERE b.player_id=w.player_id AND b.resource_id=w.resource_id AND b.expires_at>clock_timestamp()) ELSE w.quantity END AS quantity FROM public.territory_resource_wallet w WHERE w.player_id=u) available));
END; $$;
REVOKE ALL ON FUNCTION public.territory_auction_overview_v2(integer,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_auction_overview_v2(integer,text,text,text,text,text) TO authenticated,service_role;
-- Legacy screens see gold Stage3 lots only; v2 consumers explicitly select a currency.
CREATE OR REPLACE FUNCTION public.territory_auction_overview_v1(p_limit integer DEFAULT 50,p_search text DEFAULT '',p_rarity text DEFAULT '',p_sort text DEFAULT 'newest')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; lots jsonb; mine jsonb; history jsonb; items jsonb; BEGIN
  r:=public.territory_auction_overview_v2(p_limit,p_search,p_rarity,p_sort,'gold','');
  SELECT coalesce(jsonb_agg(x||jsonb_build_object('price_gold',x->'price')),'[]'::jsonb) INTO lots FROM jsonb_array_elements(r->'lots') x WHERE x->>'source'='stage3';
  SELECT coalesce(jsonb_agg(x||jsonb_build_object('price_gold',x->'price')),'[]'::jsonb) INTO mine FROM jsonb_array_elements(r->'mine') x WHERE x->>'source'='stage3' AND x->>'currency'='gold';
  SELECT coalesce(jsonb_agg(x||jsonb_build_object('price_gold',x->'price','fee_gold',x->'fee')),'[]'::jsonb) INTO history FROM jsonb_array_elements(r->'history') x WHERE x->>'currency'='gold' AND x->>'source'='stage3';
  SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO items FROM jsonb_array_elements(r->'items') x WHERE x->>'source'='stage3';
  RETURN r||jsonb_build_object('lots',lots,'mine',mine,'items',items,'history',history,'my_gold',r#>'{wallets,gold}');
END; $$;
-- Protect every current/future consumer, including trusted recycle handlers.
CREATE OR REPLACE FUNCTION territory_private.territory_auction_escrow_guard_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.territory_auction_listings_v1%ROWTYPE; BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.auction_escrow IS NOT NULL THEN RAISE EXCEPTION 'item_in_auction_escrow'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.auction_escrow IS NOT NULL THEN
    SELECT * INTO l FROM public.territory_auction_listings_v1 WHERE id=OLD.auction_escrow;
    IF NOT FOUND OR l.status='open' OR NEW.auction_escrow IS NOT NULL
      OR (to_jsonb(NEW)-ARRAY['player_id','auction_escrow']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['player_id','auction_escrow'])
      OR NOT ((l.status IN ('cancelled','expired') AND NEW.player_id=OLD.player_id) OR (l.status='sold' AND NEW.player_id=l.buyer_id))
      THEN RAISE EXCEPTION 'item_in_auction_escrow'; END IF;
  ELSIF NEW.auction_escrow IS NOT NULL THEN
    SELECT * INTO l FROM public.territory_auction_listings_v1 WHERE id=NEW.auction_escrow;
    IF NOT FOUND OR l.status<>'open' OR l.seller_id<>OLD.player_id OR NEW.player_id<>OLD.player_id
      OR coalesce(l.item_id,l.stage8_item_id,l.id)<>OLD.item_id THEN RAISE EXCEPTION 'escrow_inconsistent'; END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION territory_private.territory_auction_escrow_guard_v2() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER territory_auction_escrow_guard_stage3 BEFORE UPDATE OR DELETE ON public.territory_crafted_items_v1
FOR EACH ROW EXECUTE FUNCTION territory_private.territory_auction_escrow_guard_v2();
CREATE TRIGGER territory_auction_escrow_guard_stage8 BEFORE UPDATE OR DELETE ON public.territory_profession_stage8_items
FOR EACH ROW EXECUTE FUNCTION territory_private.territory_auction_escrow_guard_v2();

-- Equip is currently a save-state operation, not a separate Stage8 RPC.
-- Validate only canonical crafted IDs; unrelated historic equipment is preserved.
CREATE OR REPLACE FUNCTION territory_private.territory_auction_equipment_guard_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record; iid uuid; prefix text; BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.territory_release_flags_v1 WHERE id=1 AND auction_completion_enabled) THEN RETURN NEW; END IF;
  FOR e IN SELECT value FROM jsonb_each(coalesce(NEW.game_state#>'{player,equipped}','{}'::jsonb)) LOOP
    prefix:=CASE WHEN left(e.value->>'id',7)='stage8_' THEN 'stage8_' WHEN left(e.value->>'id',6)='craft_' THEN 'craft_' END;
    IF prefix IS NOT NULL THEN
      BEGIN iid:=substring(e.value->>'id' FROM length(prefix)+1)::uuid;
      EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_crafted_equipment'; END;
      IF prefix='stage8_' THEN
        PERFORM 1 FROM public.territory_profession_stage8_items WHERE item_id=iid AND player_id=NEW.id AND auction_escrow IS NULL
          AND item_output->>'type'='equipment' AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE;
      ELSE
        PERFORM 1 FROM public.territory_crafted_items_v1 WHERE item_id=iid AND player_id=NEW.id AND auction_escrow IS NULL
          AND item_output->>'type'='equipment' AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'crafted_equipment_not_owned_or_escrowed'; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION territory_private.territory_auction_equipment_guard_v2() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER territory_auction_equipment_guard_v2 BEFORE INSERT OR UPDATE OF game_state ON public.players
FOR EACH ROW EXECUTE FUNCTION territory_private.territory_auction_equipment_guard_v2();

-- Preserve Stage8 craft semantics and return the canonical trigger-stamped lifetime.
ALTER FUNCTION public.territory_profession_stage8_execute(text,uuid) RENAME TO territory_profession_stage8_execute_before_auction_v2;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_execute_before_auction_v2(text,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.territory_profession_stage8_execute(p_recipe text,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; expiry timestamptz; BEGIN
  r:=public.territory_profession_stage8_execute_before_auction_v2(p_recipe,p_operation);
  IF r->>'item_id' IS NOT NULL THEN
    SELECT expires_at INTO expiry FROM public.territory_profession_stage8_items WHERE item_id=(r->>'item_id')::uuid;
    IF FOUND THEN
      r:=r||jsonb_build_object('expires_at',expiry);
      UPDATE public.territory_profession_stage8_receipts SET result=r WHERE player_id=auth.uid() AND operation_id=p_operation;
    END IF;
  END IF;
  RETURN r;
END; $$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_execute(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_execute(text,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.territory_profession_stage8_inventory()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); items jsonb; BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_release WHERE id=1 AND enabled) THEN RAISE EXCEPTION 'profession_stage8_disabled'; END IF;
  IF NOT public.territory_profession_stage8_economy_ready() THEN RAISE EXCEPTION 'economy_not_server_authoritative'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND banned=false) THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.territory_profession_stage8_progress WHERE player_id=u AND verified) THEN RAISE EXCEPTION 'mastery_not_reconciled'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',i.item_id,'recipe_id',i.recipe_id,'item_output',i.item_output,
    'expires_at',i.expires_at) ORDER BY i.created_at,i.item_id),'[]'::jsonb) INTO items
    FROM public.territory_profession_stage8_items i WHERE player_id=u AND auction_escrow IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp());
  RETURN jsonb_build_object('success',true,'items',items);
END; $$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_inventory() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_inventory() TO authenticated,service_role;
COMMIT;
