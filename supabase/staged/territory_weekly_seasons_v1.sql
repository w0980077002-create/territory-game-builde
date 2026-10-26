-- STAGED ONLY. Reviewed infrastructure deployment required. No legacy balances are seeded.
-- Configure approved gold/gems prizes and enable explicitly AFTER atomic mail claim v2 deployment.
BEGIN;
CREATE TABLE IF NOT EXISTS territory_private.weekly_season_config_v1 (
 id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false,
 prizes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(prizes)='array')
);
INSERT INTO territory_private.weekly_season_config_v1(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS territory_private.weekly_seasons_v1 (
 week date PRIMARY KEY, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 prizes jsonb NOT NULL, finished_at timestamptz,
 CHECK(ends_at>starts_at), CHECK(extract(dow FROM week)=0)
);
CREATE TABLE IF NOT EXISTS territory_private.weekly_season_results_v1 (
 week date NOT NULL REFERENCES territory_private.weekly_seasons_v1(week),
 player_id uuid NOT NULL REFERENCES public.players(id), display_name text NOT NULL,
 points integer NOT NULL CHECK(points>0), rank integer NOT NULL CHECK(rank>0),
 reward jsonb NOT NULL, grant_id uuid UNIQUE REFERENCES public.admin_grants(id) ON DELETE SET NULL,
 PRIMARY KEY(week,player_id), UNIQUE(week,rank)
);
ALTER TABLE territory_private.weekly_season_config_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.weekly_seasons_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.weekly_season_results_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.weekly_season_config_v1,territory_private.weekly_seasons_v1,
 territory_private.weekly_season_results_v1 FROM PUBLIC,anon,authenticated;

-- Gold and blue diamonds only, validated again on the server for owner edits.
CREATE OR REPLACE FUNCTION territory_private.weekly_season_validate_prizes_v1(p_prizes jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='pg_catalog' AS $$
DECLARE v_reward jsonb;
BEGIN
 IF p_prizes IS NULL OR jsonb_typeof(p_prizes)<>'array' THEN
   RAISE EXCEPTION 'season_invalid_prize'; END IF;
 IF jsonb_array_length(p_prizes) NOT BETWEEN 1 AND 50 THEN
   RAISE EXCEPTION 'season_prizes_required'; END IF;
 FOR v_reward IN SELECT value FROM jsonb_array_elements(p_prizes) LOOP
   IF jsonb_typeof(v_reward)<>'object' OR v_reward='{}'::jsonb
     OR EXISTS(SELECT FROM jsonb_each(v_reward) e WHERE e.key NOT IN ('gold','gems')
       OR jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^[0-9]{1,10}$'
       OR (e.value::text)::bigint NOT BETWEEN 1 AND 2147483647) THEN RAISE EXCEPTION 'season_invalid_prize'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION territory_private.weekly_season_validate_prizes_v1(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION territory_private.weekly_season_tick_v1()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $$
DECLARE
 v_config territory_private.weekly_season_config_v1%ROWTYPE;
 v_season territory_private.weekly_seasons_v1%ROWTYPE;
 v_row record; v_week date; v_reward jsonb; v_grant uuid;
BEGIN
 -- Both cron overlap and repeated recovery runs are safe; all work is one transaction.
 IF NOT pg_try_advisory_xact_lock(14601,701) THEN RETURN; END IF;
 SELECT * INTO v_config FROM territory_private.weekly_season_config_v1 WHERE id=1 FOR UPDATE;
 FOR v_season IN SELECT * FROM territory_private.weekly_seasons_v1
   WHERE finished_at IS NULL AND ends_at<=now() ORDER BY week FOR UPDATE
 LOOP
   FOR v_row IN
     SELECT w.player_id,COALESCE(NULLIF(btrim(left(p.display_name,70)),''),'Герой') AS display_name,
       count(*)::integer AS points,
       row_number() OVER(ORDER BY count(*) DESC,max(w.won_at),w.player_id)::integer AS rank
     FROM public.arena_weekly_wins_v1 w JOIN public.players p ON p.id=w.player_id
     WHERE w.won_at>=v_season.starts_at AND w.won_at<v_season.ends_at
       AND p.telegram_id IS NOT NULL AND p.banned IS DISTINCT FROM true
     GROUP BY w.player_id,p.display_name
   LOOP
     v_reward:=COALESCE(v_season.prizes->(v_row.rank-1),'{}'::jsonb);
     v_grant:=NULL;
     IF v_reward<>'{}'::jsonb THEN
       INSERT INTO public.admin_grants(player_id,kind,subject,body,payload)
       VALUES(v_row.player_id,'mail','Недельный чемпионат · '||v_season.week,
         'Место #'||v_row.rank||'. Подтверждённые победы: '||v_row.points||'.',v_reward)
       RETURNING id INTO v_grant;
     END IF;
     INSERT INTO territory_private.weekly_season_results_v1
       (week,player_id,display_name,points,rank,reward,grant_id)
     VALUES(v_season.week,v_row.player_id,v_row.display_name,v_row.points,v_row.rank,v_reward,v_grant);
   END LOOP;
   UPDATE territory_private.weekly_seasons_v1 SET finished_at=clock_timestamp() WHERE week=v_season.week;
 END LOOP;
 IF NOT COALESCE(v_config.enabled,false) THEN RETURN; END IF;
 PERFORM territory_private.weekly_season_validate_prizes_v1(v_config.prizes);
 IF to_regprocedure('public.territory_admin_claim_grant_v2(uuid)') IS NULL THEN
   RAISE EXCEPTION 'season_atomic_mail_required'; END IF;
 v_week:=(now() AT TIME ZONE 'Europe/Kyiv')::date;
 v_week:=v_week-extract(dow FROM v_week)::integer;
 INSERT INTO territory_private.weekly_seasons_v1(week,starts_at,ends_at,prizes)
 VALUES(v_week,v_week::timestamp AT TIME ZONE 'Europe/Kyiv',
   (v_week+7)::timestamp AT TIME ZONE 'Europe/Kyiv',v_config.prizes)
 ON CONFLICT(week) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION territory_private.weekly_season_tick_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.weekly_season_tick_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.territory_season_status_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $$
DECLARE v_week date; v_season territory_private.weekly_seasons_v1%ROWTYPE;
 v_leaders jsonb; v_history jsonb; v_points integer; v_rank integer;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT FROM public.players
   WHERE id=auth.uid() AND telegram_id IS NOT NULL AND banned IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'season_verified_login_required' USING ERRCODE='42501'; END IF;
 v_week:=(now() AT TIME ZONE 'Europe/Kyiv')::date;
 v_week:=v_week-extract(dow FROM v_week)::integer;
 SELECT * INTO v_season FROM territory_private.weekly_seasons_v1 WHERE week=v_week;
 WITH ranked AS (
   SELECT w.player_id,COALESCE(NULLIF(btrim(left(p.display_name,70)),''),'Герой') AS display_name,
     count(*)::integer AS points,
     row_number() OVER(ORDER BY count(*) DESC,max(w.won_at),w.player_id)::integer AS rank
   FROM public.arena_weekly_wins_v1 w JOIN public.players p ON p.id=w.player_id
   WHERE w.won_at>=v_season.starts_at AND w.won_at<v_season.ends_at
     AND p.telegram_id IS NOT NULL AND p.banned IS DISTINCT FROM true
   GROUP BY w.player_id,p.display_name
 ) SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY rank) FILTER(WHERE rank<=50),'[]'),
   COALESCE(max(points) FILTER(WHERE player_id=auth.uid()),0),
   max(rank) FILTER(WHERE player_id=auth.uid()) INTO v_leaders,v_points,v_rank FROM ranked r;
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY week DESC,rank),'[]') INTO v_history
 FROM (SELECT week,player_id,display_name,points,rank,reward
   FROM territory_private.weekly_season_results_v1 WHERE rank<=3
   AND week IN(SELECT week FROM territory_private.weekly_seasons_v1
     WHERE finished_at IS NOT NULL ORDER BY week DESC LIMIT 10)) r;
 RETURN jsonb_build_object('enabled',v_season.week IS NOT NULL,'week',v_week::text,
   'server_now',now(),'ends_at',COALESCE(v_season.ends_at,(v_week+7)::timestamp AT TIME ZONE 'Europe/Kyiv'),
   'my_points',v_points,'my_rank',v_rank,'leaders',v_leaders,'history',v_history,
   'prizes',COALESCE(v_season.prizes,'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.territory_season_status_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_season_status_v1() TO authenticated;
COMMIT;
-- Deployment after approval: schedule the private tick with pg_cron every minute.
-- SELECT cron.schedule('territory-weekly-seasons-v1','* * * * *',
--   'SELECT territory_private.weekly_season_tick_v1();');
