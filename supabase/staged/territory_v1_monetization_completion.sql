-- STAGED ONLY. No catalog prices, tiers, secrets or release flags are activated.
-- Requires existing players, fortune VIP and the master-license red wallet.
-- Apply only after backup, reviewed cutover and owner's release approval.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE SCHEMA IF NOT EXISTS territory_private;
CREATE TABLE IF NOT EXISTS territory_private.monetization_config_v1 (
 id integer PRIMARY KEY CHECK(id=1), payments_enabled boolean NOT NULL DEFAULT false,
 vip_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO territory_private.monetization_config_v1(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS territory_private.vip_tiers_v1 (
 tier integer PRIMARY KEY CHECK(tier BETWEEN 0 AND 10), required_points bigint UNIQUE NOT NULL CHECK(required_points BETWEEN 0 AND 9007199254740991),
 attack_bps integer NOT NULL CHECK(attack_bps>=0),defense_bps integer NOT NULL CHECK(defense_bps>=0),hp_bps integer NOT NULL CHECK(hp_bps>=0),
 approval_reference text NOT NULL CHECK(length(approval_reference)>0)
);
CREATE TABLE IF NOT EXISTS territory_private.vip_progress_v1 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id), points bigint NOT NULL DEFAULT 0 CHECK(points BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE IF NOT EXISTS territory_private.stars_catalog_v1 (
 sku text PRIMARY KEY CHECK(sku ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 32), description text NOT NULL CHECK(length(description) BETWEEN 1 AND 255),
 stars integer NOT NULL CHECK(stars>0), gold integer NOT NULL DEFAULT 0 CHECK(gold>=0),
 gems integer NOT NULL DEFAULT 0 CHECK(gems>=0),red_gems integer NOT NULL DEFAULT 0 CHECK(red_gems>=0),
 vip_points integer NOT NULL DEFAULT 0 CHECK(vip_points>=0),
 premium_fund text CHECK(premium_fund IN('level','arena','blessing','adventure','artifact','dark_energy')),
 enabled boolean NOT NULL DEFAULT false,
 approval_reference text NOT NULL CHECK(length(approval_reference)>0),
 CHECK(gold>0 OR gems>0 OR red_gems>0 OR vip_points>0 OR premium_fund IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS territory_private.stars_orders_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES public.players(id), operation_id uuid NOT NULL,
 telegram_id bigint NOT NULL, sku text NOT NULL, title text NOT NULL, description text NOT NULL,
 amount integer NOT NULL CHECK(amount>0), currency text NOT NULL DEFAULT 'XTR' CHECK(currency='XTR'),
 reward jsonb NOT NULL CHECK(jsonb_typeof(reward)='object'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','prechecked','fulfilled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
 prechecked_at timestamptz, precheckout_id text UNIQUE, fulfilled_at timestamptz, charge_id text UNIQUE,
 UNIQUE(player_id,operation_id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['monetization_config_v1','vip_tiers_v1','vip_progress_v1','stars_catalog_v1','stars_orders_v1'] LOOP
 EXECUTE format('ALTER TABLE territory_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON territory_private.%I FROM PUBLIC,anon,authenticated',t);
END LOOP; END $$;

CREATE OR REPLACE FUNCTION public.territory_vip_status_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); p public.players%ROWTYPE; points bigint; enabled boolean; effective integer; rules jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 SELECT * INTO p FROM public.players WHERE id=u AND NOT banned;
 IF NOT FOUND THEN RAISE EXCEPTION 'player_unavailable'; END IF;
 SELECT v.points INTO points FROM territory_private.vip_progress_v1 v WHERE player_id=u;
 SELECT vip_enabled INTO enabled FROM territory_private.monetization_config_v1 WHERE id=1;
 effective:=territory_private.fortune_vip_v1(u);
 IF enabled THEN SELECT greatest(effective,coalesce(max(tier),0)) INTO effective FROM territory_private.vip_tiers_v1 WHERE required_points<=coalesce(points,0); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('tier',tier,'requiredPoints',required_points,'attackBps',attack_bps,'defenseBps',defense_bps,'hpBps',hp_bps) ORDER BY tier),'[]'::jsonb)
 INTO rules FROM territory_private.vip_tiers_v1 WHERE enabled;
 RETURN jsonb_build_object('permanentTier',p.vip_level,'tier',effective,'temporaryTier',1,'temporaryUntil',
 (SELECT vip_until FROM territory_private.fortune_inventory_v1 WHERE player_id=u),
 'points',coalesce(points,0),'serverNow',clock_timestamp(),'rules',rules,'bonusesConfigured',enabled AND EXISTS(SELECT 1 FROM territory_private.vip_tiers_v1 WHERE tier=effective));
END $$;
REVOKE ALL ON FUNCTION public.territory_vip_status_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_vip_status_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.territory_stars_catalog_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('enabled',coalesce((SELECT payments_enabled FROM territory_private.monetization_config_v1 WHERE id=1),false),
 'packs',coalesce((SELECT jsonb_agg(jsonb_build_object('sku',sku,'title',title,'description',description,'amount',stars,'currency','XTR','premiumFund',premium_fund) ORDER BY sku)
 FROM territory_private.stars_catalog_v1 WHERE enabled AND (SELECT payments_enabled FROM territory_private.monetization_config_v1 WHERE id=1)),'[]'::jsonb))
 WHERE auth.uid() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.territory_stars_catalog_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_stars_catalog_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.territory_stars_order_v1(p_sku text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); p public.players%ROWTYPE; c territory_private.stars_catalog_v1%ROWTYPE; o territory_private.stars_orders_v1%ROWTYPE;
BEGIN
 IF u IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 SELECT * INTO p FROM public.players WHERE id=u AND NOT banned AND telegram_id>0 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'verified_telegram_required'; END IF;
 SELECT * INTO o FROM territory_private.stars_orders_v1 WHERE player_id=u AND operation_id=p_operation;
 IF FOUND THEN
  IF o.sku IS DISTINCT FROM p_sku THEN RAISE EXCEPTION 'operation_id_reused'; END IF;
  IF o.state<>'pending' OR o.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'order_not_payable'; END IF;
 ELSE
  IF NOT coalesce((SELECT payments_enabled FROM territory_private.monetization_config_v1 WHERE id=1),false) THEN RAISE EXCEPTION 'payments_disabled'; END IF;
  SELECT * INTO c FROM territory_private.stars_catalog_v1 WHERE sku=p_sku AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'pack_not_approved'; END IF;
  INSERT INTO territory_private.stars_orders_v1(player_id,operation_id,telegram_id,sku,title,description,amount,reward)
  VALUES(u,p_operation,p.telegram_id,c.sku,c.title,c.description,c.stars,
   jsonb_build_object('gold',c.gold,'gems',c.gems,'redGems',c.red_gems,'vipPoints',c.vip_points,'premiumFund',c.premium_fund)) RETURNING * INTO o;
 END IF;
 RETURN jsonb_build_object('orderId',o.id,'payload','territory:'||o.id,'title',o.title,'description',o.description,'amount',o.amount,'currency','XTR');
END $$;
REVOKE ALL ON FUNCTION public.territory_stars_order_v1(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_stars_order_v1(text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.territory_stars_status_v1(p_order uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('orderId',id,'status',state,'fulfilledAt',fulfilled_at)
 FROM territory_private.stars_orders_v1 WHERE id=p_order AND player_id=auth.uid()
$$;
REVOKE ALL ON FUNCTION public.territory_stars_status_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_stars_status_v1(uuid) TO authenticated;

-- Backend only. The Edge Function verifies Telegram's webhook secret first.
CREATE OR REPLACE FUNCTION public.territory_stars_precheckout_v1(p_order uuid,p_telegram bigint,p_currency text,p_amount integer,p_query text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o territory_private.stars_orders_v1%ROWTYPE; progression_ready boolean;
BEGIN
 SELECT * INTO o FROM territory_private.stars_orders_v1 WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.telegram_id IS DISTINCT FROM p_telegram OR p_currency IS DISTINCT FROM 'XTR'
  OR p_query IS NULL OR length(p_query) NOT BETWEEN 1 AND 256 OR (o.state='prechecked' AND o.precheckout_id IS DISTINCT FROM p_query)
  OR o.amount IS DISTINCT FROM p_amount OR o.state='fulfilled' OR o.expires_at<=clock_timestamp()
  OR NOT coalesce((SELECT payments_enabled FROM territory_private.monetization_config_v1 WHERE id=1),false)
  OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=o.player_id AND NOT banned AND telegram_id=p_telegram) THEN RETURN false; END IF;
 -- Refuse a known undeliverable fund purchase before Telegram takes Stars.
 -- Delivery rechecks independently, preserving retry after a later outage.
 IF o.reward->>'premiumFund' IS NOT NULL THEN
  IF to_regprocedure('territory_private.v1_progression_event(uuid,uuid,text,jsonb)') IS NULL
   OR to_regclass('territory_private.v1_progression_config') IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT enabled FROM territory_private.v1_progression_config WHERE id=1' INTO progression_ready;
  IF progression_ready IS DISTINCT FROM true THEN RETURN false; END IF;
 END IF;
 UPDATE territory_private.stars_orders_v1 SET state='prechecked',prechecked_at=coalesce(prechecked_at,clock_timestamp()),precheckout_id=p_query WHERE id=p_order;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.territory_stars_precheckout_v1(uuid,bigint,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_stars_precheckout_v1(uuid,bigint,text,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.territory_stars_fulfill_v1(p_order uuid,p_telegram bigint,p_currency text,p_amount integer,p_charge text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o territory_private.stars_orders_v1%ROWTYPE; p public.players%ROWTYPE; st jsonb;
 v_gold integer; v_gems integer; red integer; points bigint; v_tier integer; rb integer; wallet_gold bigint; wallet_gems bigint; wallet_verified boolean;
BEGIN
 IF p_order IS NULL OR p_telegram IS NULL OR p_currency IS DISTINCT FROM 'XTR' OR p_amount IS NULL OR p_charge IS NULL OR length(p_charge) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'invalid_payment'; END IF;
 SELECT * INTO o FROM territory_private.stars_orders_v1 WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.telegram_id IS DISTINCT FROM p_telegram OR o.amount IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'payment_mismatch'; END IF;
 IF o.state='fulfilled' THEN
  IF o.charge_id IS DISTINCT FROM p_charge THEN RAISE EXCEPTION 'payment_charge_collision'; END IF;
  RETURN jsonb_build_object('orderId',o.id,'status','fulfilled','fulfilledAt',o.fulfilled_at,'replayed',true);
 END IF;
 IF o.state<>'prechecked' THEN RAISE EXCEPTION 'precheckout_required'; END IF;
 IF EXISTS(SELECT 1 FROM territory_private.stars_orders_v1 WHERE charge_id=p_charge) THEN RAISE EXCEPTION 'payment_charge_collision'; END IF;
 SELECT * INTO p FROM public.players WHERE id=o.player_id AND telegram_id=p_telegram FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'payment_player_missing'; END IF;
 -- Already-paid orders must survive app closure, expiry, pack edits and flag shutdown.
 st:=p.game_state;
 IF jsonb_typeof(st) IS DISTINCT FROM 'object' OR jsonb_typeof(st->'player') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_save'; END IF;
 v_gold:=(o.reward->>'gold')::integer; v_gems:=(o.reward->>'gems')::integer; red:=(o.reward->>'redGems')::integer;
 IF NOT coalesce((st#>>'{player,gold}')~'^[0-9]{1,10}$' AND (st#>>'{player,gems}')~'^[0-9]{1,10}$',false)
  OR (st#>>'{player,gold}')::bigint IS DISTINCT FROM p.gold::bigint
  OR (st#>>'{player,gems}')::bigint IS DISTINCT FROM p.gems::bigint THEN RAISE EXCEPTION 'wallet_reconciliation_required'; END IF;
 -- Stage3 may not have been installed. When present it must already be reconciled;
 -- paid Stars must never seed or bypass its verified authority.
 IF to_regclass('public.territory_wallet_v1') IS NOT NULL THEN
  EXECUTE 'SELECT gold,gems,verified FROM public.territory_wallet_v1 WHERE player_id=$1 FOR UPDATE'
   INTO wallet_gold,wallet_gems,wallet_verified USING p.id;
  IF wallet_verified IS DISTINCT FROM true OR wallet_gold IS DISTINCT FROM p.gold::bigint
   OR wallet_gems IS DISTINCT FROM p.gems::bigint THEN RAISE EXCEPTION 'wallet_reconciliation_required'; END IF;
 END IF;
 IF p.gold::bigint+v_gold>2147483647 OR p.gems::bigint+v_gems>2147483647 THEN RAISE EXCEPTION 'wallet_overflow'; END IF;
 IF v_gold>0 THEN st:=jsonb_set(st,'{player,gold}',to_jsonb(p.gold+v_gold),true); END IF;
 IF v_gems>0 THEN st:=jsonb_set(st,'{player,gems}',to_jsonb(p.gems+v_gems),true); END IF;
 IF red>0 THEN
  SELECT balance INTO rb FROM territory_private.territory_master_license_red_wallet_v1 WHERE player_id=p.id FOR UPDATE;
  IF NOT FOUND OR NOT coalesce((st#>>'{player,redGems}')~'^[0-9]{1,10}$',false)
   OR rb IS DISTINCT FROM (st#>>'{player,redGems}')::bigint THEN RAISE EXCEPTION 'red_wallet_reconciliation_required'; END IF;
  IF rb::bigint+red>2147483647 THEN RAISE EXCEPTION 'wallet_overflow'; END IF;
  UPDATE territory_private.territory_master_license_red_wallet_v1 SET balance=balance+red WHERE player_id=p.id;
  st:=jsonb_set(st,'{player,redGems}',to_jsonb(rb+red),true);
 END IF;
 INSERT INTO territory_private.vip_progress_v1(player_id,points) VALUES(p.id,(o.reward->>'vipPoints')::bigint)
 ON CONFLICT(player_id) DO UPDATE SET points=territory_private.vip_progress_v1.points+excluded.points RETURNING vip_progress_v1.points INTO points;
 v_tier:=p.vip_level;
 IF (SELECT vip_enabled FROM territory_private.monetization_config_v1 WHERE id=1) THEN
  SELECT greatest(v_tier,coalesce(max(t.tier),0)) INTO v_tier FROM territory_private.vip_tiers_v1 t WHERE required_points<=points;
 END IF;
 -- Premium-fund entitlement and the verified payment receipt share this transaction.
 -- A missing/disabled progression module rolls the entire delivery back for retry.
 IF o.reward->>'premiumFund' IS NOT NULL THEN
  IF to_regprocedure('territory_private.v1_progression_event(uuid,uuid,text,jsonb)') IS NULL THEN
   RAISE EXCEPTION 'premium_fund_delivery_unavailable';
  END IF;
  EXECUTE 'SELECT territory_private.v1_progression_event($1,$2,$3,$4)'
   USING p.id,md5(o.id::text||':fund')::uuid,'fund_purchase',jsonb_build_object('fund',o.reward->>'premiumFund');
 END IF;
 IF to_regclass('public.territory_wallet_v1') IS NOT NULL THEN
  EXECUTE 'UPDATE public.territory_wallet_v1 SET gold=gold+$1,gems=gems+$2,updated_at=clock_timestamp() WHERE player_id=$3'
   USING v_gold,v_gems,p.id;
 END IF;
 UPDATE public.players SET gold=p.gold+v_gold,gems=p.gems+v_gems,game_state=st,vip_level=v_tier,
 updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond') WHERE id=p.id;
 UPDATE territory_private.stars_orders_v1 SET state='fulfilled',charge_id=p_charge,fulfilled_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
 RETURN jsonb_build_object('orderId',o.id,'status','fulfilled','fulfilledAt',o.fulfilled_at,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.territory_stars_fulfill_v1(uuid,bigint,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_stars_fulfill_v1(uuid,bigint,text,integer,text) TO service_role;

-- Internal calculator for authoritative PvE/PvP snapshots. Never alters saves.
CREATE OR REPLACE FUNCTION territory_private.vip_combat_stats_v1(p_player uuid,p_stats jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tier integer; r territory_private.vip_tiers_v1%ROWTYPE; a bigint; d bigint; h bigint; mh bigint; nmh bigint; points bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=p_player) THEN RAISE EXCEPTION 'player_unavailable'; END IF;
 IF NOT coalesce((SELECT vip_enabled FROM territory_private.monetization_config_v1 WHERE id=1),false) THEN RETURN p_stats; END IF;
 v_tier:=territory_private.fortune_vip_v1(p_player);
 SELECT v.points INTO points FROM territory_private.vip_progress_v1 v WHERE player_id=p_player;
 SELECT greatest(v_tier,coalesce(max(t.tier),0)) INTO v_tier FROM territory_private.vip_tiers_v1 t WHERE required_points<=coalesce(points,0);
 SELECT * INTO r FROM territory_private.vip_tiers_v1 WHERE vip_tiers_v1.tier=v_tier;
 IF NOT FOUND THEN RETURN p_stats; END IF;
 IF NOT coalesce(p_stats->>'attack' ~ '^[0-9]{1,10}$' AND p_stats->>'defense' ~ '^[0-9]{1,10}$'
 AND p_stats->>'hp' ~ '^[0-9]{1,10}$' AND p_stats->>'maxHp' ~ '^[0-9]{1,10}$',false) THEN RAISE EXCEPTION 'invalid_combat_stats'; END IF;
 a:=(p_stats->>'attack')::bigint;d:=(p_stats->>'defense')::bigint;h:=(p_stats->>'hp')::bigint;mh:=(p_stats->>'maxHp')::bigint;
 IF mh<1 OR h>mh THEN RAISE EXCEPTION 'invalid_combat_stats'; END IF;
 a:=floor(a::numeric*(10000::bigint+r.attack_bps)/10000);d:=floor(d::numeric*(10000::bigint+r.defense_bps)/10000);
 nmh:=floor(mh::numeric*(10000::bigint+r.hp_bps)/10000);
 IF greatest(a,d,nmh)>2147483647 THEN RAISE EXCEPTION 'vip_stat_overflow'; END IF;
 RETURN p_stats||jsonb_build_object('attack',a,'defense',d,'maxHp',nmh,'hp',floor(h::numeric*nmh/mh));
END $$;
REVOKE ALL ON FUNCTION territory_private.vip_combat_stats_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.vip_combat_stats_v1(uuid,jsonb) TO service_role;
COMMIT;

