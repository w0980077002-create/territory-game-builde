-- STAGED ONLY: authenticated, read-only history of already committed VIP claims.
-- Requires approved daily and weekly VIP claim tables. Does not issue rewards.
BEGIN;
CREATE OR REPLACE FUNCTION public.territory_vip_claim_history_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_history$
DECLARE
  u uuid:=auth.uid();
  result jsonb;
BEGIN
  IF u IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.players WHERE id=u AND NOT banned
  ) THEN RAISE EXCEPTION 'vip_history_login_required'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'source',source,'period',period,'vip',vip,'gold',gold,
    'gems',gems,'stones',stones,'materials',materials,'claimedAt',claimed_at
  ) ORDER BY claimed_at DESC,source),'[]'::jsonb)
  INTO result
  FROM (
    SELECT source,period,vip,gold,gems,stones,materials,claimed_at
    FROM (
      SELECT 'daily'::text AS source,d.claim_day::text AS period,
        d.granted_vip AS vip,d.reward_gold AS gold,d.reward_gems AS gems,
        d.reward_stones AS stones,0::integer AS materials,d.created_at AS claimed_at
      FROM territory_private.vip_daily_claims_v1 d WHERE d.player_id=u
      UNION ALL
      SELECT 'weekly',w.week_start::text,w.granted_vip,w.reward_gold,
        w.reward_gems,w.reward_stones,w.reward_materials,w.created_at
      FROM territory_private.vip_weekly_claims_v1 w WHERE w.player_id=u
    ) recent ORDER BY claimed_at DESC,source LIMIT 14
  ) limited;
  RETURN jsonb_build_object('success',true,'claims',result);
END $vip_history$;
REVOKE ALL ON FUNCTION public.territory_vip_claim_history_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_vip_claim_history_v1() TO authenticated;
COMMIT;
