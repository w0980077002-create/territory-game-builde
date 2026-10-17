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
 OR to_regprocedure('public.territory_monopoly_claim_v2(timestamptz,jsonb)') IS NOT NULL
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
 pending_rewards jsonb NOT NULL DEFAULT '{"gems":0,"stones":0,"materials":0,"potions":0,"elixirs":0}',
 claimed text[] NOT NULL DEFAULT '{}',
 last_token uuid,
 last_result jsonb,
 ends_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '72 hours'
);
ALTER TABLE territory_private.monopoly_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.monopoly_v2 FROM PUBLIC,anon,authenticated;
-- Fixed server-owned reward catalogue. No client amount or item definition accepted.
CREATE FUNCTION territory_private.monopoly_cell_prize_v2(p_cell integer,p_mult integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='pg_catalog' AS $prize$
 SELECT CASE WHEN p_cell=0 OR p_cell IN(6,14,21) THEN '{}'::jsonb
 WHEN p_cell%6=1 THEN jsonb_build_object('gems',2*p_mult)
 WHEN p_cell%6=2 THEN jsonb_build_object('stones',5*p_mult)
 WHEN p_cell%6=3 THEN jsonb_build_object('materials',3*p_mult)
 WHEN p_cell%6=4 THEN jsonb_build_object('potions',p_mult)
 WHEN p_cell%6=5 THEN jsonb_build_object('elixirs',p_mult)
 ELSE '{}'::jsonb END;
$prize$;
REVOKE ALL ON FUNCTION territory_private.monopoly_cell_prize_v2(integer,integer) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION territory_private.monopoly_accrue_v2(p_uid uuid,p_prize jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='pg_catalog' AS $accrue$
DECLARE k text; v integer;
BEGIN
 FOR k IN SELECT unnest(ARRAY['gems','stones','materials','potions','elixirs']) LOOP
  v:=coalesce((p_prize->>k)::int,0);
  IF v<0 OR v>1000 THEN RAISE EXCEPTION 'monopoly_invalid_prize'; END IF;
  UPDATE territory_private.monopoly_v2 SET pending_rewards=jsonb_set(pending_rewards,ARRAY[k],
   to_jsonb(coalesce((pending_rewards->>k)::int,0)+v)) WHERE player_id=p_uid
   AND coalesce((pending_rewards->>k)::int,0)+v<=100000;
  IF NOT FOUND THEN RAISE EXCEPTION 'monopoly_reward_storage_full'; END IF;
 END LOOP;
END $accrue$;
REVOKE ALL ON FUNCTION territory_private.monopoly_accrue_v2(uuid,jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.territory_monopoly_v2(
 p_action text DEFAULT 'status',p_value integer DEFAULT 1,p_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE
 u uuid:=auth.uid(); a territory_private.hall_accounts_v1%ROWTYPE;
 m territory_private.monopoly_v2%ROWTYPE; s territory_private.hall_sessions_v1%ROWTYPE;
 h jsonb; r jsonb; v_prize jsonb:='{}'; v_roll int; v_steps int; v_pos int; v_event text;
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
     'multiplier',v_cost,'gold',v_gold*v_cost,'doubled',m.double_next,
     'prize',territory_private.monopoly_cell_prize_v2(v_pos,v_cost))
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
  v_prize:=coalesce(s.question->'prize','{}'::jsonb);
  IF v_event='gift' THEN v_prize:=v_prize || jsonb_build_object('gems',coalesce((v_prize->>'gems')::int,0)+3*coalesce((s.question->>'multiplier')::int,1)); END IF;
  PERFORM territory_private.monopoly_accrue_v2(u,v_prize);
  r:=r || jsonb_build_object('awards',v_prize,'earned_gold',(r->>'earned_gold')::int+v_extra,'event',v_event,'laps_added',v_laps);
  UPDATE territory_private.monopoly_v2 SET laps=laps+v_laps,rolls=rolls+1,
   events=events+CASE WHEN v_event IS NULL THEN 0 ELSE 1 END,
   double_next=(v_event='double') IS TRUE,lucky_next=(v_event='lucky') IS TRUE,
   last_token=p_token,last_result=jsonb_build_object('result',r) WHERE player_id=u;
 ELSIF p_action='gift' THEN
  h:=public.territory_hall_daily_v1();
  v_prize:=jsonb_build_object('potions',1);
  PERFORM territory_private.monopoly_accrue_v2(u,v_prize);
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
  v_prize:=CASE p_action
   WHEN 'milestone' THEN jsonb_build_object('gems',p_value*2,'stones',p_value*4,'materials',p_value,'potions',p_value/5,'elixirs',p_value/5)
   WHEN 'quest' THEN jsonb_build_object('stones',p_value*5,'materials',p_value*2,'potions',1)
   ELSE jsonb_build_object('gems',p_value*3,'elixirs',1) END;
  PERFORM territory_private.monopoly_accrue_v2(u,v_prize);
  UPDATE territory_private.monopoly_v2 SET claimed=array_append(claimed,v_key) WHERE player_id=u;
 ELSIF p_action<>'status' OR p_action IS NULL THEN RAISE EXCEPTION 'monopoly_bad_action';
 END IF;
 SELECT * INTO m FROM territory_private.monopoly_v2 WHERE player_id=u;
 RETURN jsonb_build_object('hall',public.territory_hall_status_v1(),
  'progress',to_jsonb(m)-'player_id'-'last_result'-'last_token','result',r,'added',v_reward,'awards',v_prize);
END $$;
REVOKE ALL ON FUNCTION public.territory_monopoly_v2(text,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_monopoly_v2(text,integer,uuid) TO authenticated;

-- Isolated redemption. Lock player before hall/progress, matching existing wallet claims.
-- Exact snapshot + revision protects unsaved changes; refresh client after receipt so
-- existing autosave token caches cannot overwrite the server credit.
CREATE FUNCTION public.territory_monopoly_claim_v2(p_expected timestamptz,p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog' AS $claim$
DECLARE u uuid:=auth.uid(); p public.players%ROWTYPE; m territory_private.monopoly_v2%ROWTYPE;
 st jsonb; inv jsonb; prize jsonb; item jsonb; idx integer; qty integer; k text;
 v_gems integer; stones integer; materials integer;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM territory_private.monopoly_testers_v2 WHERE player_id=u)
 THEN RAISE EXCEPTION 'monopoly_test_only'; END IF;
 SELECT * INTO p FROM public.players WHERE id=u AND NOT banned FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 IF p_expected IS NULL OR p.updated_at IS DISTINCT FROM p_expected OR p.game_state IS DISTINCT FROM p_snapshot
 THEN RAISE EXCEPTION 'monopoly_reload_required'; END IF;
 PERFORM 1 FROM territory_private.hall_accounts_v1 WHERE player_id=u FOR UPDATE;
 SELECT * INTO m FROM territory_private.monopoly_v2 WHERE player_id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'monopoly_nothing_to_claim'; END IF;
 prize:=m.pending_rewards;
 IF NOT EXISTS(SELECT 1 FROM jsonb_each_text(prize) WHERE value::int>0) THEN RAISE EXCEPTION 'monopoly_nothing_to_claim'; END IF;
 st:=p.game_state; inv:=st->'inventory';
 IF jsonb_typeof(st->'player') IS DISTINCT FROM 'object' OR jsonb_typeof(inv) IS DISTINCT FROM 'array'
 OR coalesce(st->'player'->>'gems','')!~'^[0-9]{1,10}$'
 OR coalesce(st->>'battleStones','')!~'^[0-9]{1,10}$'
 OR coalesce(st->>'forgeMaterials','')!~'^[0-9]{1,10}$'
 OR (st->'player'->>'gems')::bigint<>p.gems
 THEN RAISE EXCEPTION 'monopoly_invalid_save'; END IF;
 IF p.gems::bigint+(prize->>'gems')::int>2147483647
 OR (st->>'battleStones')::bigint+(prize->>'stones')::int>2147483647
 OR (st->>'forgeMaterials')::bigint+(prize->>'materials')::int>2147483647
 THEN RAISE EXCEPTION 'monopoly_balance_full'; END IF;
 v_gems:=p.gems+(prize->>'gems')::int;
 stones:=(st->>'battleStones')::int+(prize->>'stones')::int;
 materials:=(st->>'forgeMaterials')::int+(prize->>'materials')::int;
 FOR k IN SELECT unnest(ARRAY['potions','elixirs']) LOOP
  qty:=(prize->>k)::int;
  IF qty=0 THEN CONTINUE; END IF;
  item:=CASE k WHEN 'potions' THEN
   '{"name":"Зелье здоровья","icon":"🧪","type":"potion","rarity":"common","description":"Восстанавливает 50 HP мгновенно","effect":{"stat":"hp","value":50,"duration":"instant"}}'::jsonb
  ELSE '{"name":"Эликсир силы","icon":"💪","type":"elixir","rarity":"rare","description":"+10 к атаке на один бой","effect":{"stat":"attack","value":10,"duration":"battle"}}'::jsonb END;
  SELECT (ordinality-1)::int INTO idx FROM jsonb_array_elements(inv) WITH ORDINALITY
   WHERE value->>'name'=item->>'name' AND value->>'type'=item->>'type' AND value->'effect'=item->'effect'
   AND value->>'qty'~'^[0-9]{1,6}$' LIMIT 1;
  IF idx IS NULL THEN
   inv:=inv||jsonb_build_array(item||jsonb_build_object('id','mono_'||gen_random_uuid()::text,'qty',qty));
  ELSE
   inv:=jsonb_set(inv,ARRAY[idx::text,'qty'],to_jsonb((inv->idx->>'qty')::int+qty));
  END IF;
 END LOOP;
 st:=jsonb_set(st,'{player,gems}',to_jsonb(v_gems));
 st:=jsonb_set(st,'{battleStones}',to_jsonb(stones));
 st:=jsonb_set(st,'{forgeMaterials}',to_jsonb(materials));
 st:=jsonb_set(st,'{inventory}',inv);
 UPDATE public.players SET game_state=st,gems=v_gems,forge_materials=materials,
 updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond') WHERE id=u;
 UPDATE territory_private.monopoly_v2 SET pending_rewards='{"gems":0,"stones":0,"materials":0,"potions":0,"elixirs":0}' WHERE player_id=u;
 RETURN jsonb_build_object('success',true,'awards',prize);
END $claim$;
REVOKE ALL ON FUNCTION public.territory_monopoly_claim_v2(timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_monopoly_claim_v2(timestamptz,jsonb) TO authenticated;

COMMIT;
