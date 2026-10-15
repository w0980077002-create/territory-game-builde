-- STAGE6: apply ONLY after Stage3 tables, wallet reconciliation and true cutover.
-- Authentication, verified wallet, and immutable server daily cap.
BEGIN;
CREATE OR REPLACE FUNCTION public.territory_shop_status_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 v_uid uuid := (SELECT auth.uid());
 v_on boolean := false;
 v_wallet public.territory_wallet_v1%ROWTYPE;
 v_today date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
 SELECT shop_enabled INTO v_on FROM public.territory_release_flags_v1 WHERE id=1;
 IF NOT COALESCE(v_on,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF NOT EXISTS (SELECT 1 FROM public.players WHERE id=v_uid AND banned=false)
 THEN RAISE EXCEPTION 'player_unavailable'; END IF;
 SELECT * INTO v_wallet FROM public.territory_wallet_v1 WHERE player_id=v_uid AND verified=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_verified'; END IF;
 RETURN jsonb_build_object('enabled',true,'gems',v_wallet.gems,'stones',v_wallet.stones,
   'bought_today',CASE WHEN v_wallet.stone_day=v_today THEN v_wallet.stone_bought ELSE 0 END,
   'stone_day',v_today::text);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_shop_status_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_shop_status_v1() TO authenticated,service_role;
COMMIT;
