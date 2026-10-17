-- TERRITORY Game Hall v1: 5 games, one server ticket wallet, free-only participation.
-- Fixed gold payouts, private challenge answers, one session/user, hard daily gold cap.
-- No red-gem purchases, money, betting, stake or client-controlled rewards.
CREATE TABLE territory_private.hall_accounts_v1 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
 tickets integer NOT NULL DEFAULT 4 CHECK(tickets BETWEEN 0 AND 20),
 points integer NOT NULL DEFAULT 0 CHECK(points BETWEEN 0 AND 100000000),
 played integer NOT NULL DEFAULT 0 CHECK(played BETWEEN 0 AND 10000000),
 wins integer NOT NULL DEFAULT 0 CHECK(wins BETWEEN 0 AND 10000000),
 pending_gold integer NOT NULL DEFAULT 0 CHECK(pending_gold BETWEEN 0 AND 100000),
 claimed_gold integer NOT NULL DEFAULT 0 CHECK(claimed_gold BETWEEN 0 AND 100000000),
 position integer NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 27),
 daily_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
 daily_gold integer NOT NULL DEFAULT 0 CHECK(daily_gold BETWEEN 0 AND 1000),
 daily_claimed date
);
CREATE TABLE territory_private.hall_sessions_v1 (
 player_id uuid PRIMARY KEY REFERENCES territory_private.hall_accounts_v1(player_id) ON DELETE CASCADE,
 token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 game text NOT NULL CHECK(game IN('monopoly','dice','tower','targets','treasury')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 question jsonb NOT NULL,
 correct_answer integer NOT NULL,
 gold_reward integer NOT NULL CHECK(gold_reward BETWEEN 0 AND 160),
 position_after integer
);
CREATE TABLE territory_private.hall_history_v1 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
 game text NOT NULL,
 won boolean NOT NULL,
 earned_gold integer NOT NULL CHECK(earned_gold >= 0),
 points integer NOT NULL CHECK(points >= 0),
 played_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX hall_history_player_idx_v1 ON territory_private.hall_history_v1(player_id,played_at DESC);
REVOKE ALL ON territory_private.hall_accounts_v1,territory_private.hall_sessions_v1,
 territory_private.hall_history_v1 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_hall_status_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_uid uuid:=auth.uid(); a territory_private.hall_accounts_v1%ROWTYPE;
 s territory_private.hall_sessions_v1%ROWTYPE; v_today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF v_uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_uid AND NOT banned)
 THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 INSERT INTO territory_private.hall_accounts_v1(player_id)
 VALUES(v_uid) ON CONFLICT(player_id) DO NOTHING;
 SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=v_uid;
 SELECT * INTO s FROM territory_private.hall_sessions_v1
 WHERE player_id=v_uid AND created_at>clock_timestamp()-interval '15 minutes';
 RETURN jsonb_build_object('tickets',a.tickets,'points',a.points,
 'played',a.played,'wins',a.wins,'pending_gold',a.pending_gold,
 'claimed_gold',a.claimed_gold,'position',a.position,
 'daily_remaining',greatest(0,1000-CASE WHEN a.daily_day=v_today THEN a.daily_gold ELSE 0 END),
 'free_ready',(a.daily_claimed IS DISTINCT FROM v_today AND a.tickets<=18),
 'active',CASE WHEN s.token IS NULL THEN NULL ELSE
 jsonb_build_object('token',s.token::text,'game',s.game,'question',s.question) END);
END $$;
REVOKE ALL ON FUNCTION public.territory_hall_status_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_hall_status_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.territory_hall_daily_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_uid uuid:=auth.uid(); a territory_private.hall_accounts_v1%ROWTYPE;
 v_today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF v_uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_uid AND NOT banned)
 THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 INSERT INTO territory_private.hall_accounts_v1(player_id)
 VALUES(v_uid) ON CONFLICT(player_id) DO NOTHING;
 SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=v_uid FOR UPDATE;
 IF a.daily_claimed=v_today THEN RAISE EXCEPTION 'hall_daily_already_claimed'; END IF;
 IF a.tickets>18 THEN RAISE EXCEPTION 'hall_ticket_wallet_full'; END IF;
 UPDATE territory_private.hall_accounts_v1 SET tickets=tickets+2,daily_claimed=v_today
 WHERE player_id=v_uid RETURNING * INTO a;
 RETURN jsonb_build_object('tickets',a.tickets,'added',2,'free_ready',false);
END $$;
REVOKE ALL ON FUNCTION public.territory_hall_daily_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_hall_daily_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.territory_hall_start_v1(p_game text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_uid uuid:=auth.uid(); a territory_private.hall_accounts_v1%ROWTYPE;
 s territory_private.hall_sessions_v1%ROWTYPE;
 v_n int; v_x int; v_y int; v_z int; v_correct int;
 v_opts jsonb; v_question jsonb; v_gold int; v_newposition int:=NULL;
BEGIN
 IF v_uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_uid AND NOT banned)
 THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 IF p_game NOT IN('monopoly','dice','tower','targets','treasury') OR p_game IS NULL
 THEN RAISE EXCEPTION 'hall_unknown_game'; END IF;
 INSERT INTO territory_private.hall_accounts_v1(player_id)
 VALUES(v_uid) ON CONFLICT(player_id) DO NOTHING;
 SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=v_uid FOR UPDATE;
 SELECT * INTO s FROM territory_private.hall_sessions_v1 WHERE player_id=v_uid FOR UPDATE;
 IF s.token IS NOT NULL THEN
  IF s.created_at>clock_timestamp()-interval '15 minutes'
  THEN RETURN jsonb_build_object('token',s.token::text,'game',s.game,
        'question',s.question,'tickets',a.tickets,'resumed',true); END IF;
  DELETE FROM territory_private.hall_sessions_v1 WHERE player_id=v_uid;
 END IF;
 IF a.tickets<1 THEN RAISE EXCEPTION 'hall_no_tickets'; END IF;
 v_x:=1+floor(random()*6)::int;
 v_y:=1+floor(random()*6)::int;
 v_z:=1+floor(random()*6)::int;
 v_n:=floor(random()*3)::int;
 IF p_game='monopoly' THEN
  v_newposition:=(a.position+v_x)%28;
  v_correct:=0;
  v_gold:=50+v_x*12+CASE WHEN v_newposition=0 THEN 35 ELSE 0 END;
  v_question:=jsonb_build_object('roll',v_x,'old_position',a.position,
                'new_position',v_newposition,'board_size',28);
 ELSIF p_game='dice' THEN
  -- Pick the two dice whose sum is closest to seven; ties prefer leftmost.
  v_correct:=0;
  IF abs(v_y+v_z-7)<abs(v_x+v_y-7) THEN v_correct:=1; END IF;
  IF abs(v_x+v_z-7)<least(abs(v_x+v_y-7),abs(v_y+v_z-7)) THEN v_correct:=2; END IF;
  v_question:=jsonb_build_object('dice',jsonb_build_array(v_x,v_y,v_z),
      'options',jsonb_build_array(v_x+v_y,v_y+v_z,v_x+v_z),'target',7);
  v_gold:=110;
 ELSIF p_game='tower' THEN
  v_x:=1+floor(random()*9)::int;v_y:=v_x+1+floor(random()*5)::int;
  v_z:=v_y+1+floor(random()*5)::int;
  IF v_n=0 THEN v_opts:=jsonb_build_array(v_z,v_x,v_y);
  ELSIF v_n=1 THEN v_opts:=jsonb_build_array(v_x,v_z,v_y);
  ELSE v_opts:=jsonb_build_array(v_x,v_y,v_z); END IF;
  v_correct:=v_n;
  v_question:=jsonb_build_object('doors',v_opts,'goal','strongest');
  v_gold:=120;
 ELSIF p_game='targets' THEN
  v_x:=2+floor(random()*5)::int;
  v_y:=v_x+1;v_z:=v_x+2;
  IF v_n=0 THEN v_opts:=jsonb_build_array(v_y,v_x,v_z);
  ELSIF v_n=1 THEN v_opts:=jsonb_build_array(v_z,v_y,v_x);
  ELSE v_opts:=jsonb_build_array(v_x,v_z,v_y); END IF;
  v_correct:=v_n;
  v_question:=jsonb_build_object('targets',v_opts,'goal','middle');
  v_gold:=100;
 ELSE
  -- Treasury: choose the chest whose inscription matches the rune sum.
  v_x:=1+floor(random()*5)::int;v_y:=1+floor(random()*5)::int;
  IF v_n=0 THEN v_opts:=jsonb_build_array(v_x+v_y,v_x+v_y+2,v_x+v_y+1);
  ELSIF v_n=1 THEN v_opts:=jsonb_build_array(v_x+v_y+2,v_x+v_y,v_x+v_y+1);
  ELSE v_opts:=jsonb_build_array(v_x+v_y+2,v_x+v_y+1,v_x+v_y); END IF;
  v_correct:=v_n;
  v_question:=jsonb_build_object('runes',jsonb_build_array(v_x,v_y),
       'chests',v_opts,'goal','rune_sum');
  v_gold:=150;
 END IF;
 UPDATE territory_private.hall_accounts_v1 SET tickets=tickets-1
 WHERE player_id=v_uid RETURNING * INTO a;
 INSERT INTO territory_private.hall_sessions_v1(player_id,game,question,correct_answer,gold_reward,position_after)
 VALUES(v_uid,p_game,v_question,v_correct,v_gold,v_newposition)
 RETURNING * INTO s;
 RETURN jsonb_build_object('token',s.token::text,'game',p_game,
 'question',v_question,'tickets',a.tickets,'resumed',false);
END $$;
REVOKE ALL ON FUNCTION public.territory_hall_start_v1(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_hall_start_v1(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.territory_hall_finish_v1(p_token uuid,p_choice integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_uid uuid:=auth.uid(); a territory_private.hall_accounts_v1%ROWTYPE;
 s territory_private.hall_sessions_v1%ROWTYPE;
 v_win boolean;v_gold int;v_pts int;v_day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
 v_total_today int;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=v_uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'hall_no_account'; END IF;
 SELECT * INTO s FROM territory_private.hall_sessions_v1
 WHERE player_id=v_uid AND token=p_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'hall_ticket_used_or_missing'; END IF;
 IF s.created_at<clock_timestamp()-interval '15 minutes'
 THEN
  DELETE FROM territory_private.hall_sessions_v1 WHERE player_id=v_uid;
  RAISE EXCEPTION 'hall_session_expired';
 END IF;
 IF p_choice IS NULL OR p_choice NOT BETWEEN 0 AND 2
 THEN RAISE EXCEPTION 'hall_bad_choice'; END IF;
 v_win:=(s.correct_answer=p_choice);
 v_pts:=CASE WHEN v_win THEN 10 ELSE 2 END;
 v_total_today:=CASE WHEN a.daily_day=v_day THEN a.daily_gold ELSE 0 END;
 v_gold:=CASE WHEN v_win THEN least(s.gold_reward,greatest(0,1000-v_total_today)) ELSE 0 END;
 UPDATE territory_private.hall_accounts_v1
 SET wins=wins+CASE WHEN v_win THEN 1 ELSE 0 END,
     played=played+1,points=points+v_pts,
     pending_gold=pending_gold+v_gold,
     position=coalesce(s.position_after,position),
     daily_gold=v_total_today+v_gold,daily_day=v_day
 WHERE player_id=v_uid;
 INSERT INTO territory_private.hall_history_v1(player_id,game,won,earned_gold,points)
 VALUES(v_uid,s.game,v_win,v_gold,v_pts);
 DELETE FROM territory_private.hall_sessions_v1 WHERE player_id=v_uid;
 RETURN jsonb_build_object('won',v_win,'earned_gold',v_gold,'points',v_pts,
 'daily_remaining',greatest(0,1000-v_total_today-v_gold),'tickets',a.tickets,
 'game',s.game,'new_position',s.position_after);
END $$;
REVOKE ALL ON FUNCTION public.territory_hall_finish_v1(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_hall_finish_v1(uuid,integer) TO authenticated;

-- Gold is collected ONLY via a revision-checked server credit; snapshot and
-- indexed wallet change in the same transaction, with no client-set amount.
CREATE OR REPLACE FUNCTION public.territory_hall_claim_v1(p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_uid uuid:=auth.uid(); p public.players%ROWTYPE;
 a territory_private.hall_accounts_v1%ROWTYPE; v_state jsonb; v_gold int;
BEGIN
 IF v_uid IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 SELECT * INTO p FROM public.players WHERE id=v_uid AND NOT banned FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'hall_login_required'; END IF;
 IF p.updated_at<>p_expected OR jsonb_typeof(p.game_state) IS DISTINCT FROM 'object'
  OR jsonb_typeof(p.game_state->'player') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'hall_reload_save'; END IF;
 SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=v_uid FOR UPDATE;
 IF NOT FOUND OR a.pending_gold<1 THEN RAISE EXCEPTION 'hall_nothing_to_claim'; END IF;
 IF (p.game_state->'player'->>'gold') !~ '^[0-9]{1,10}$'
  OR p.gold<>(p.game_state->'player'->>'gold')::integer
  OR p.gold::bigint+a.pending_gold>2147483647
 THEN RAISE EXCEPTION 'hall_invalid_wallet'; END IF;
 v_gold:=a.pending_gold;
 v_state:=jsonb_set(p.game_state,'{player,gold}',to_jsonb(p.gold+v_gold));
 UPDATE public.players SET game_state=v_state,gold=p.gold+v_gold
 WHERE id=v_uid RETURNING * INTO p;
 UPDATE territory_private.hall_accounts_v1
 SET pending_gold=0,claimed_gold=claimed_gold+v_gold WHERE player_id=v_uid;
 RETURN jsonb_build_object('success',true,'awarded',v_gold,
 'updated_at',p.updated_at,'wallet_gold',p.gold,
 'wallet_gems',p.gems,'game_state',p.game_state);
END $$;
REVOKE ALL ON FUNCTION public.territory_hall_claim_v1(timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_hall_claim_v1(timestamptz) TO authenticated;
