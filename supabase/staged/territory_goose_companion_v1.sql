-- PREPARED ONLY. Apply only after owner approves this specific server release.
-- Uses existing trusted red wallet; creates/seeds/reprices NO wallet.
CREATE TABLE IF NOT EXISTS territory_private.goose_entitlements_v1 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id),
 companion_id text NOT NULL DEFAULT 'follower_goose_obnimus' CHECK(companion_id='follower_goose_obnimus'),
 receipt uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('purchase','owner_gift')),
 price integer NOT NULL CHECK((source='purchase' AND price=30) OR (source='owner_gift' AND price=0)),
 title text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 mail_id uuid UNIQUE
);
ALTER TABLE territory_private.goose_entitlements_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.goose_entitlements_v1 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_goose_status_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e territory_private.goose_entitlements_v1%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'goose_login_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=auth.uid() AND NOT banned)
 THEN RAISE EXCEPTION 'goose_player_unavailable'; END IF;
 SELECT * INTO e FROM territory_private.goose_entitlements_v1 WHERE player_id=auth.uid();
 RETURN jsonb_build_object('companion_id','follower_goose_obnimus','price',30,
  'owned',e.player_id IS NOT NULL,'receipt',e.receipt,'title',e.title);
END $$;
REVOKE ALL ON FUNCTION public.territory_goose_status_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_goose_status_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.territory_goose_buy_v1(p_operation uuid,p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.players%ROWTYPE; e territory_private.goose_entitlements_v1%ROWTYPE;
 v_balance integer; legacy numeric;
BEGIN
 IF auth.uid() IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'goose_login_required'; END IF;
 -- Same lock order as crafting, license, clans: player then red wallet.
 SELECT * INTO p FROM public.players WHERE id=auth.uid() AND NOT banned AND telegram_id IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'goose_player_unavailable'; END IF;
 SELECT * INTO e FROM territory_private.goose_entitlements_v1 WHERE player_id=p.id;
 -- Existing ownership wins over stale revisions/different device operation IDs.
 IF NOT FOUND THEN
  IF p_expected IS NULL OR p.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'goose_reload_required'; END IF;
  IF to_regclass('territory_private.territory_master_license_red_wallet_v1') IS NULL THEN RAISE EXCEPTION 'goose_red_wallet_unavailable'; END IF;
  IF NOT coalesce((p.game_state #>> '{player,redGems}') ~ '^[0-9]{1,10}$',false)
   THEN RAISE EXCEPTION 'goose_invalid_wallet'; END IF;
  legacy:=(p.game_state #>> '{player,redGems}')::numeric;
  SELECT w.balance INTO v_balance FROM territory_private.territory_master_license_red_wallet_v1 w WHERE player_id=p.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'goose_red_wallet_unavailable'; END IF;
  -- Do not silently lower a paid balance when an older save disagrees with the trusted wallet.
  -- A disagreement needs an audited reconciliation, not an implicit adjustment during checkout.
  IF v_balance::numeric <> legacy THEN RAISE EXCEPTION 'goose_wallet_desync'; END IF;
  IF v_balance<30 THEN RAISE EXCEPTION 'goose_insufficient_red_gems'; END IF;
  UPDATE territory_private.territory_master_license_red_wallet_v1 SET balance=v_balance-30 WHERE player_id=p.id;
  UPDATE public.players SET game_state=jsonb_set(game_state,'{player,redGems}',to_jsonb(v_balance-30)),
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=p.id RETURNING * INTO p;
  INSERT INTO territory_private.goose_entitlements_v1(player_id,operation_id,source,price)
   VALUES(p.id,p_operation,'purchase',30) RETURNING * INTO e;
  INSERT INTO public.admin_audit_log(action,details) VALUES('goose_purchase',jsonb_build_object('player_id',p.id,'receipt',e.receipt,'price',30));
 END IF;
 RETURN jsonb_build_object('success',true,'companion_id',e.companion_id,'price',30,'owned',true,
  'receipt',e.receipt,'title',e.title,'game_state',p.game_state,'updated_at',p.updated_at,'wallet_gold',p.gold,'wallet_gems',p.gems);
END $$;
REVOKE ALL ON FUNCTION public.territory_goose_buy_v1(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_goose_buy_v1(uuid,timestamptz) TO authenticated;

-- Only the existing token-authenticated admin Edge may invoke this RPC.
-- Identity is checked AGAIN under the same player lock as purchases.
CREATE OR REPLACE FUNCTION public.territory_goose_gift_v1(p_player uuid,p_telegram bigint,p_username text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.players%ROWTYPE; e territory_private.goose_entitlements_v1%ROWTYPE; letter uuid;
BEGIN
 IF lower(p_username) IS DISTINCT FROM 'amiksor' THEN RAISE EXCEPTION 'goose_recipient_not_approved'; END IF;
 IF p_operation IS NULL OR p_telegram IS NULL OR p_username IS NULL THEN RAISE EXCEPTION 'goose_identity_required'; END IF;
 SELECT * INTO p FROM public.players WHERE id=p_player AND NOT banned FOR UPDATE;
 IF NOT FOUND OR p.telegram_id IS DISTINCT FROM p_telegram OR lower(p.username) IS DISTINCT FROM lower(p_username)
 THEN RAISE EXCEPTION 'goose_identity_changed'; END IF;
 SELECT * INTO e FROM territory_private.goose_entitlements_v1 WHERE player_id=p.id;
 IF NOT FOUND THEN
  INSERT INTO territory_private.goose_entitlements_v1(player_id,operation_id,source,price)
   VALUES(p.id,p_operation,'owner_gift',0) RETURNING * INTO e;
 END IF;
 -- Even if a purchase won the race, send the owner's one presentation letter;
 -- ownership remains one row and the purchase is never debited again.
 IF e.mail_id IS NULL THEN
  INSERT INTO public.admin_grants(player_id,kind,subject,body,payload)
  VALUES(p.id,'mail','ПОСТАНОВЛЕНИЕ ВЕРХОВНОГО СУДА TERRITORY №5000',
   E'Александр! Рассмотрев ваши 5000 побед, моральные страдания и многочисленные требования компенсации, администрация постановила выдать легендарного Гуся-Обнимуся!\n\nГусь назначается вашим личным адвокатом, телохранителем и специалистом по выбиванию компенсаций.\n\nВсе дальнейшие жалобы направлять непосредственно гусю. У него клюв, крылья и крайне скверный характер!\n\nС уважением, администрация TERRITORY. 🪿🤣',
   '{}'::jsonb) RETURNING id INTO letter;
  UPDATE territory_private.goose_entitlements_v1 SET mail_id=letter,title='Адвокат 5000 побед' WHERE player_id=p.id RETURNING * INTO e;
  INSERT INTO public.admin_audit_log(action,details) VALUES('goose_owner_gift',jsonb_build_object('player_id',p.id,'telegram_id',p_telegram,'username',p_username,'receipt',e.receipt,'operation_id',p_operation,'mail_id',letter,'price',0));
 END IF;
 RETURN jsonb_build_object('success',true,'owned',true,'companion_id',e.companion_id,'receipt',e.receipt,'mail_id',e.mail_id,'title',e.title);
END $$;
REVOKE ALL ON FUNCTION public.territory_goose_gift_v1(uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_goose_gift_v1(uuid,bigint,text,uuid) TO service_role;
