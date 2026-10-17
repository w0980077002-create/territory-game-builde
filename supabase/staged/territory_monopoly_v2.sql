-- Monopoly only. Apply after 20261017_game_hall_five_v1.sql.
-- Keeps the existing shared wallet, revision-safe gold claim and daily 1000 cap.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
-- Stop rather than overwrite an already installed or incompatible version.
DO $guard$
BEGIN
 IF to_regclass('territory_private.monopoly_v2') IS NOT NULL
 OR to_regprocedure('public.territory_monopoly_v2(text,integer,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'monopoly_already_installed_review_required'; END IF;
 IF to_regclass('territory_private.hall_accounts_v1') IS NULL
 OR to_regprocedure('public.territory_hall_start_v1(text)') IS NULL
 OR to_regprocedure('public.territory_hall_finish_v1(uuid,integer)') IS NULL
 OR to_regprocedure('public.territory_hall_daily_v1()') IS NULL
 OR to_regprocedure('public.territory_hall_status_v1()') IS NULL
 OR to_regprocedure('public.territory_hall_claim_v1(timestamp with time zone)') IS NULL
 THEN RAISE EXCEPTION 'monopoly_missing_hall_dependencies'; END IF;
END $guard$;
-- Closed test: empty allowlist, no ordinary player is enabled by installation.
CREATE TABLE territory_private.monopoly_testers_v2 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE
);
ALTER TABLE territory_private.monopoly_testers_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.monopoly_testers_v2 FROM PUBLIC,anon,authenticated;
CREATE TABLE territory_private.monopoly_v2 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
 laps integer NOT NULL DEFAULT 0 CHECK(laps>=0),
 rolls integer NOT NULL DEFAULT 0 CHECK(rolls>=0),
 events integer NOT NULL DEFAULT 0 CHECK(events>=0),
 double_next boolean NOT NULL DEFAULT false,
 lucky_next boolean NOT NULL DEFAULT false,
 claimed text[] NOT NULL DEFAULT '{}',
 last_token uuid,
 last_result jsonb,
 ends_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '72 hours'
);
ALTER TABLE territory_private.monopoly_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.monopoly_v2 FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.territory_monopoly_v2(
 p_action text DEFAULT 'status',p_value integer DEFAULT 1,p_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE
 u uuid:=auth.uid(); a territory_private.hall_accounts_v1%ROWTYPE;
 m territory_private.monopoly_v2%ROWTYPE; s territory_private.hall_sessions_v1%ROWTYPE;
 h jsonb; r jsonb; v_roll int; v_steps int; v_pos int; v_event text;
 v_cost int; v_gold int; v_extra int; v_laps int; v_reward int:=0;
 v_key text; v_target int; v_progress int; v_day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT banned)
 THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM territory_private.monopoly_testers_v2 WHERE player_id=u)
 THEN RAISE EXCEPTION 'monopoly_test_only'; END IF;
 -- Same lock order as the hall: wallet before session, then Monopoly record.
 h:=public.territory_hall_status_v1();
 SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=u FOR UPDATE;
 SELECT * INTO s FROM territory_private.hall_sessions_v1 WHERE player_id=u FOR UPDATE;
 INSERT INTO territory_private.monopoly_v2(player_id) VALUES(u) ON CONFLICT DO NOTHING;
 SELECT * INTO m FROM territory_private.monopoly_v2 WHERE player_id=u FOR UPDATE;
 IF m.ends_at<=clock_timestamp() AND (s.token IS NULL OR s.created_at<clock_timestamp()-interval '15 minutes') THEN
  UPDATE territory_private.monopoly_v2 SET laps=0,rolls=0,events=0,double_next=false,
   lucky_next=false,claimed='{}',last_token=NULL,last_result=NULL,
   ends_at=clock_timestamp()+interval '72 hours' WHERE player_id=u RETURNING * INTO m;
 END IF;
 IF p_action='roll' THEN
  IF s.token IS NOT NULL AND s.created_at>clock_timestamp()-interval '15 minutes' THEN
   IF s.game<>'monopoly' THEN RAISE EXCEPTION 'monopoly_other_game'; END IF;
  ELSE
   IF p_value NOT IN(1,10,101,102,103,104,105,106) OR p_value IS NULL THEN RAISE EXCEPTION 'monopoly_bad_roll'; END IF;
   IF p_value>100 AND NOT m.lucky_next THEN RAISE EXCEPTION 'monopoly_no_lucky'; END IF;
   v_cost:=CASE WHEN p_value=10 THEN 10 ELSE 1 END;
   IF a.tickets<v_cost THEN RAISE EXCEPTION 'hall_no_tickets'; END IF;
   h:=public.territory_hall_start_v1('monopoly');
   SELECT * INTO s FROM territory_private.hall_sessions_v1 WHERE player_id=u;
   v_roll:=CASE WHEN p_value>100 THEN p_value-100 ELSE (s.question->>'roll')::int END;
   v_steps:=v_roll*CASE WHEN m.double_next THEN 2 ELSE 1 END;
   v_pos:=(a.position+v_steps)%28;
   v_event:=NULL;
   IF v_pos IN(6,14,21) THEN
    v_event:=(ARRAY['gift','teleport','double','lucky'])[1+floor(random()*4)::int];
    IF v_event='teleport' THEN v_steps:=v_steps+3; END IF;
   END IF;
   v_pos:=(a.position+v_steps)%28;
   v_laps:=(a.position+v_steps)/28;
   v_gold:=CASE WHEN v_pos=0 THEN 100 ELSE 35+(v_pos%5)*20 END;
   IF v_event='gift' THEN v_gold:=v_gold+25; END IF;
   UPDATE territory_private.hall_accounts_v1 SET tickets=tickets-(v_cost-1) WHERE player_id=u;
   UPDATE territory_private.hall_sessions_v1 SET position_after=v_pos,gold_reward=v_gold,
    question=jsonb_build_object('roll',v_roll,'steps',v_steps,'old_position',a.position,
     'new_position',v_pos,'board_size',28,'event',v_event,'laps',v_laps,
     'multiplier',v_cost,'gold',v_gold*v_cost,'doubled',m.double_next)
    WHERE player_id=u RETURNING * INTO s;
   UPDATE territory_private.monopoly_v2 SET double_next=false,lucky_next=false WHERE player_id=u;
  END IF;
 ELSIF p_action='finish' THEN
  IF p_token IS NOT NULL AND m.last_token=p_token THEN
   RETURN m.last_result || jsonb_build_object('hall',public.territory_hall_status_v1(),'progress',to_jsonb(m)-'player_id'-'last_result'-'last_token');
  END IF;
  IF s.token IS NULL OR s.token IS DISTINCT FROM p_token OR s.game<>'monopoly' THEN RAISE EXCEPTION 'hall_ticket_used_or_missing'; END IF;
  r:=public.territory_hall_finish_v1(p_token,0);
  -- Support an in-progress v1 round as well as v2 rounds.
  v_laps:=coalesce((s.question->>'laps')::int,CASE WHEN s.position_after<a.position THEN 1 ELSE 0 END);
  v_event:=s.question->>'event';
  SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=u;
  v_extra:=least(greatest(0,coalesce((s.question->>'gold')::int,s.gold_reward)-(r->>'earned_gold')::int),1000-a.daily_gold,100000-a.pending_gold);
  UPDATE territory_private.hall_accounts_v1 SET pending_gold=pending_gold+v_extra,daily_gold=daily_gold+v_extra WHERE player_id=u;
  UPDATE territory_private.hall_history_v1 SET earned_gold=earned_gold+v_extra
   WHERE id=(SELECT id FROM territory_private.hall_history_v1 WHERE player_id=u AND game='monopoly' ORDER BY id DESC LIMIT 1);
  r:=r || jsonb_build_object('earned_gold',(r->>'earned_gold')::int+v_extra,'event',v_event,'laps_added',v_laps);
  UPDATE territory_private.monopoly_v2 SET laps=laps+v_laps,rolls=rolls+1,
   events=events+CASE WHEN v_event IS NULL THEN 0 ELSE 1 END,
   double_next=(v_event='double') IS TRUE,lucky_next=(v_event='lucky') IS TRUE,
   last_token=p_token,last_result=jsonb_build_object('result',r) WHERE player_id=u;
 ELSIF p_action='gift' THEN
  h:=public.territory_hall_daily_v1();
 ELSIF p_action IN('quest','offer','milestone') THEN
  IF p_action='quest' THEN
   IF p_value NOT BETWEEN 1 AND 3 OR p_value IS NULL THEN RAISE EXCEPTION 'monopoly_bad_claim'; END IF;
   v_target:=(ARRAY[5,3,1])[p_value];
   v_progress:=CASE p_value WHEN 1 THEN m.rolls WHEN 2 THEN m.events ELSE m.laps END;
   v_reward:=(ARRAY[2,2,3])[p_value];
  ELSIF p_action='offer' THEN
   IF p_value NOT BETWEEN 1 AND 3 OR p_value IS NULL THEN RAISE EXCEPTION 'monopoly_bad_claim'; END IF;
   v_target:=(ARRAY[0,3,10])[p_value];
   v_progress:=CASE WHEN p_value=2 THEN m.laps ELSE m.rolls END;
   v_reward:=(ARRAY[1,2,3])[p_value];
  ELSE
   IF p_value NOT IN(5,10,15,20,25) OR p_value IS NULL THEN RAISE EXCEPTION 'monopoly_bad_claim'; END IF;
   v_target:=p_value;v_progress:=m.laps;v_reward:=p_value/5+1;
  END IF;
  v_key:=p_action||':'||p_value;
  IF v_key=ANY(m.claimed) THEN RAISE EXCEPTION 'monopoly_already_claimed'; END IF;
  IF v_progress<v_target THEN RAISE EXCEPTION 'monopoly_not_ready'; END IF;
  IF a.tickets+v_reward>1000 THEN RAISE EXCEPTION 'hall_ticket_wallet_full'; END IF;
  UPDATE territory_private.hall_accounts_v1 SET tickets=tickets+v_reward WHERE player_id=u;
  UPDATE territory_private.monopoly_v2 SET claimed=array_append(claimed,v_key) WHERE player_id=u;
 ELSIF p_action<>'status' OR p_action IS NULL THEN RAISE EXCEPTION 'monopoly_bad_action';
 END IF;
 SELECT * INTO m FROM territory_private.monopoly_v2 WHERE player_id=u;
 RETURN jsonb_build_object('hall',public.territory_hall_status_v1(),
  'progress',to_jsonb(m)-'player_id'-'last_result'-'last_token','result',r,'added',v_reward);
END $$;
REVOKE ALL ON FUNCTION public.territory_monopoly_v2(text,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_monopoly_v2(text,integer,uuid) TO authenticated;
COMMIT;
