-- Read-only personalized reward progress. No rankings beyond public TOP-10.
-- RLS protected tables remain inaccessible to client; auth.uid() scopes every
-- response. The same status is returned for managed tester identities.
BEGIN;
CREATE OR REPLACE FUNCTION public.territory_mortarion_reward_status_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 v_uid uuid:=auth.uid();
 v_now timestamptz:=pg_catalog.clock_timestamp();
 v_event public.territory_mortarion_2026%ROWTYPE;
 v_part public.territory_mortarion_2026_players%ROWTYPE;
 v_claim territory_private.mortarion_reward_receipts_v1%ROWTYPE;
 v_hits integer:=0;
 v_days integer:=0;
 v_day integer:=1;
 v_needed integer:=5;
 v_tier text:='participant';
 v_closed boolean:=false;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'mortarion_auth_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_uid AND NOT COALESCE(banned,false))
 THEN RAISE EXCEPTION 'mortarion_player_unavailable'; END IF;
 SELECT * INTO v_event FROM public.territory_mortarion_2026 WHERE id='mortarion_2026';
 IF NOT FOUND THEN RAISE EXCEPTION 'mortarion_not_installed'; END IF;
 SELECT * INTO v_part FROM public.territory_mortarion_2026_players
 WHERE event_id=v_event.id AND player_id=v_uid;
 IF FOUND THEN
   v_hits:=v_part.total_hits;
   v_days:=pg_catalog.cardinality(v_part.hit_days);
 END IF;
 v_closed:=v_event.enabled AND (v_event.hp=0 OR v_now >= v_event.ends_at);
 IF v_event.hp=0 THEN
   v_needed:=GREATEST(1,LEAST(5,pg_catalog.ceil(
     pg_catalog.date_part('epoch',v_event.updated_at-v_event.starts_at)/86400
   )::integer));
 END IF;
 v_day:=GREATEST(1,LEAST(5,
   1+pg_catalog.floor(pg_catalog.date_part('epoch',v_now-v_event.starts_at)/86400)::integer));
 IF v_days>=v_needed AND v_hits>=15 THEN v_tier:='legendary';
 ELSIF v_days>=LEAST(3,v_needed) THEN v_tier:='hunter'; END IF;
 SELECT * INTO v_claim FROM territory_private.mortarion_reward_receipts_v1
 WHERE event_id=v_event.id AND player_id=v_uid;
 RETURN pg_catalog.jsonb_build_object(
   'active',v_event.enabled AND NOT v_closed,
   'closed',v_closed,
   'totalHits',v_hits,'activeDays',v_days,
   'hitDays',CASE WHEN v_part.player_id IS NULL THEN '[]'::jsonb
                  ELSE pg_catalog.to_jsonb(v_part.hit_days) END,
   'currentDay',v_day,'requiredDays',v_needed,
   'tier',v_tier,
   'collectiveVictory',v_event.hp=0,
   'canClaim',v_closed AND v_hits>0 AND v_claim.player_id IS NULL,
   'claimed',v_claim.player_id IS NOT NULL,
   'receipt',v_claim.receipt,
   'serverNow',v_now
 );
END; $fn$;
REVOKE ALL ON FUNCTION public.territory_mortarion_reward_status_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_mortarion_reward_status_v1() TO authenticated;
COMMIT;
