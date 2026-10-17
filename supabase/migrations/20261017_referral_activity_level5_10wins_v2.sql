-- TERRITORY Founders v2: reward for 5th level + 10 SERVER-RECORDED PvE victories.
-- No next-day login requirement. This ledger is bounded and replay-resistant.
-- It does NOT change existing game_state, balances, player progress or existing chests.
CREATE TABLE territory_private.referral_activity_v2 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
 credited_wins integer NOT NULL DEFAULT 0 CHECK (credited_wins BETWEEN 0 AND 10000),
 credited_xp integer NOT NULL DEFAULT 0 CHECK (credited_xp BETWEEN 0 AND 10000000),
 stage_wins integer NOT NULL DEFAULT 0 CHECK(stage_wins BETWEEN 0 AND 10000),
 trial_wins integer NOT NULL DEFAULT 0 CHECK(trial_wins BETWEEN 0 AND 10000),
 boss_wins integer NOT NULL DEFAULT 0 CHECK(boss_wins BETWEEN 0 AND 10000),
 last_win_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE territory_private.referral_fight_tickets_v2 (
 player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
 ticket uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 fight_kind text NOT NULL CHECK(fight_kind IN('stage','trial')),
 enemy_id text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON territory_private.referral_activity_v2,
 territory_private.referral_fight_tickets_v2 FROM PUBLIC,anon,authenticated;

-- Accept progress only after the account has been attributed using HMAC-signed
-- Telegram start_param, and when it has an actual matching battle attempt.
-- Gameplay is still client-driven; these attestations limit spoofing and farm
-- velocity but DO NOT constitute authoritative server combat.
CREATE OR REPLACE FUNCTION public.territory_referral_fight_start_v2(
 p_kind text, p_enemy_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_uid uuid:=auth.uid(); v_old territory_private.referral_fight_tickets_v2%ROWTYPE;
 v_activity territory_private.referral_activity_v2%ROWTYPE;
 v_ticket uuid; v_ok boolean;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'referral_login_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM territory_private.referral_invites_v1 i
  JOIN public.players p ON p.id=i.invited_id
  WHERE i.invited_id=v_uid AND p.telegram_id IS NOT NULL AND NOT p.banned
  AND i.qualified_at IS NULL)
 THEN RETURN jsonb_build_object('tracked',false); END IF;
 v_ok:=(p_kind='stage' AND p_enemy_id ~ '^ch[1-9][0-9]{0,4}_(enemy_[0-4]|boss)$')
   OR (p_kind='trial' AND p_enemy_id ~ '^trial_[1-9][0-9]{0,4}$');
 IF NOT v_ok THEN RETURN jsonb_build_object('tracked',false); END IF;
 INSERT INTO territory_private.referral_activity_v2(player_id)
 VALUES(v_uid) ON CONFLICT(player_id) DO NOTHING;
 SELECT * INTO v_activity FROM territory_private.referral_activity_v2
  WHERE player_id=v_uid FOR UPDATE;
 IF v_activity.last_win_at IS NOT NULL AND
    v_activity.last_win_at>clock_timestamp()-interval '4 seconds'
 THEN RETURN jsonb_build_object('tracked',false); END IF;
 -- The old ticket is invalidated. A replay cannot credit a new battle.
 DELETE FROM territory_private.referral_fight_tickets_v2 WHERE player_id=v_uid;
 INSERT INTO territory_private.referral_fight_tickets_v2(player_id,fight_kind,enemy_id)
 VALUES(v_uid,p_kind,p_enemy_id) RETURNING ticket INTO v_ticket;
 RETURN jsonb_build_object('tracked',true,'ticket',v_ticket::text);
END $$;
REVOKE ALL ON FUNCTION public.territory_referral_fight_start_v2(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_referral_fight_start_v2(text,text) TO authenticated;

-- Atomic, one-time receipt with a short real-world cadence and input validation.
-- No caller-supplied XP, level, damage, or reward can be credited.
CREATE OR REPLACE FUNCTION public.territory_referral_fight_finish_v2(
 p_ticket uuid, p_won boolean, p_rounds jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_uid uuid:=auth.uid();
 v_ticket territory_private.referral_fight_tickets_v2%ROWTYPE;
 v_activity territory_private.referral_activity_v2%ROWTYPE;
 v_round jsonb; v_zone text; v_blocks jsonb;
 v_count int:=0; v_chapter int:=0; v_trial int:=0;
 v_is_boss boolean:=false; v_xp int:=0;
BEGIN
 IF v_uid IS NULL OR p_ticket IS NULL THEN RAISE EXCEPTION 'referral_login_required'; END IF;
 SELECT * INTO v_ticket FROM territory_private.referral_fight_tickets_v2
 WHERE player_id=v_uid AND ticket=p_ticket FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('credited',false,'reason','ticket_missing'); END IF;
 IF clock_timestamp()-v_ticket.started_at > interval '45 minutes'
 THEN
  DELETE FROM territory_private.referral_fight_tickets_v2 WHERE player_id=v_uid;
  RETURN jsonb_build_object('credited',false,'reason','expired');
 END IF;
 IF p_won IS DISTINCT FROM true THEN
  DELETE FROM territory_private.referral_fight_tickets_v2 WHERE player_id=v_uid;
  RETURN jsonb_build_object('credited',false,'reason','not_won');
 END IF;
 IF jsonb_typeof(p_rounds) IS DISTINCT FROM 'array'
 THEN RETURN jsonb_build_object('credited',false,'reason','bad_rounds'); END IF;
 v_count:=jsonb_array_length(p_rounds);
 IF v_count<1 OR v_count>40
 THEN RETURN jsonb_build_object('credited',false,'reason','bad_round_count'); END IF;
 -- Bosses lose no more than 40% HP; Trials 34% per round.
 -- Under three rounds for either combat is impossible.
 IF v_count<3 AND (v_ticket.fight_kind='trial' OR v_ticket.enemy_id ~ '_boss$')
 THEN RETURN jsonb_build_object('credited',false,'reason','elite_rounds'); END IF;
 FOR v_round IN SELECT value FROM jsonb_array_elements(p_rounds) LOOP
  v_zone:=v_round->>'attack'; v_blocks:=v_round->'blocks';
  IF v_zone IS NULL OR v_zone NOT IN ('head','chest','belly','legs')
    OR jsonb_typeof(v_blocks) IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_blocks)<>2
    OR v_blocks->>0 NOT IN ('head','chest','belly','legs')
    OR v_blocks->>1 NOT IN ('head','chest','belly','legs')
    OR v_blocks->>0=v_blocks->>1
  THEN RETURN jsonb_build_object('credited',false,'reason','bad_actions'); END IF;
 END LOOP;
 IF clock_timestamp()-v_ticket.started_at < interval '1 second'
 THEN RETURN jsonb_build_object('credited',false,'reason','too_fast'); END IF;
 SELECT * INTO v_activity FROM territory_private.referral_activity_v2
 WHERE player_id=v_uid FOR UPDATE;
 IF v_activity.last_win_at IS NOT NULL AND
    v_activity.last_win_at>clock_timestamp()-interval '4 seconds'
 THEN RETURN jsonb_build_object('credited',false,'reason','too_fast'); END IF;
 IF v_ticket.fight_kind='stage' THEN
   v_chapter:=substring(v_ticket.enemy_id FROM '^ch([0-9]+)')::integer;
   v_is_boss:=(v_ticket.enemy_id ~ '_boss$');
   -- Protect against unrealistic high-floor XP by using a chapter<=5 cap.
   IF v_is_boss THEN v_xp:=80+least(v_chapter,5)*20;
   ELSE v_xp:=20+least(v_chapter,5)*8; END IF;
 ELSE
   v_trial:=substring(v_ticket.enemy_id FROM '^trial_([0-9]+)')::integer;
   v_xp:=40+least(v_trial,5)*10;
 END IF;
 UPDATE territory_private.referral_activity_v2
 SET credited_wins=credited_wins+1,
     stage_wins=stage_wins+CASE WHEN v_ticket.fight_kind='stage' THEN 1 ELSE 0 END,
     trial_wins=trial_wins+CASE WHEN v_ticket.fight_kind='trial' THEN 1 ELSE 0 END,
     boss_wins=boss_wins+CASE WHEN v_is_boss THEN 1 ELSE 0 END,
     credited_xp=credited_xp+v_xp,
     last_win_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE player_id=v_uid;
 DELETE FROM territory_private.referral_fight_tickets_v2 WHERE player_id=v_uid;
 PERFORM territory_private.referral_try_qualify_v2(v_uid);
 RETURN jsonb_build_object('credited',true,'credited_xp',v_xp,
  'wins',(SELECT credited_wins FROM territory_private.referral_activity_v2 WHERE player_id=v_uid));
END $$;
REVOKE ALL ON FUNCTION public.territory_referral_fight_finish_v2(uuid,boolean,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_referral_fight_finish_v2(uuid,boolean,jsonb) TO authenticated;

-- Reconstruct milestone XP from the independently recorded completed encounters.
-- Quest XP is counted conservatively only after the 3rd PvE win / boss.
CREATE OR REPLACE FUNCTION territory_private.referral_try_qualify_v2(p_uid uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_wins int; v_xp int; v_level int; v_bonus int;
BEGIN
 SELECT a.credited_wins,a.credited_xp,
   CASE WHEN a.stage_wins>=3 THEN 30 ELSE 0 END +
   CASE WHEN a.boss_wins>=1 THEN 80 ELSE 0 END
 INTO v_wins,v_xp,v_bonus
 FROM territory_private.referral_activity_v2 a WHERE a.player_id=p_uid;
 IF coalesce(v_wins,0)<10 OR coalesce(v_xp,0)+coalesce(v_bonus,0)<450
 THEN RETURN false; END IF;
 SELECT CASE WHEN (game_state->'player'->>'level') ~ '^[0-9]{1,5}$'
   THEN (game_state->'player'->>'level')::integer ELSE 0 END
 INTO v_level FROM public.players
 WHERE id=p_uid AND telegram_id IS NOT NULL AND NOT banned;
 IF coalesce(v_level,0)<5 THEN RETURN false; END IF;
 UPDATE territory_private.referral_invites_v1
 SET qualified_at=clock_timestamp()
 WHERE invited_id=p_uid AND qualified_at IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO territory_private.referral_chests_v1(invited_id,inviter_id)
 SELECT invited_id,inviter_id FROM territory_private.referral_invites_v1
 WHERE invited_id=p_uid AND qualified_at IS NOT NULL
 ON CONFLICT(invited_id) DO NOTHING;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION territory_private.referral_try_qualify_v2(uuid) FROM PUBLIC,anon,authenticated;
-- No public grants; invoked internally by the definer functions only.

-- Finalize a reward on the actual server cloud SAVE of level five; do not
-- require the newcomer to open their own Friends page after winning.
CREATE OR REPLACE FUNCTION territory_private.referral_after_save_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
BEGIN
 IF NEW.game_state IS DISTINCT FROM OLD.game_state
    AND EXISTS(SELECT 1 FROM territory_private.referral_invites_v1
      WHERE invited_id=NEW.id AND qualified_at IS NULL)
 THEN PERFORM territory_private.referral_try_qualify_v2(NEW.id); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION territory_private.referral_after_save_v2() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS territory_referral_after_save_v2 ON public.players;
CREATE TRIGGER territory_referral_after_save_v2
 AFTER UPDATE OF game_state ON public.players
 FOR EACH ROW EXECUTE FUNCTION territory_private.referral_after_save_v2();

-- Preserve existing HMAC Telegram verification but drop 24-hour eligibility gate.
CREATE OR REPLACE FUNCTION public.territory_referral_qualify_v1(
 p_invited uuid,p_telegram_id bigint,p_auth_date bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
BEGIN
 IF p_invited IS NULL OR p_telegram_id IS NULL OR p_auth_date IS NULL
    OR p_auth_date < extract(epoch from clock_timestamp()-interval '10 minutes')
    OR p_auth_date > extract(epoch from clock_timestamp()+interval '1 minute')
 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.players
  WHERE id=p_invited AND telegram_id=p_telegram_id AND NOT banned)
 THEN RETURN false; END IF;
 RETURN territory_private.referral_try_qualify_v2(p_invited);
END $$;
REVOKE ALL ON FUNCTION public.territory_referral_qualify_v1(uuid,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_referral_qualify_v1(uuid,bigint,bigint) TO service_role;

-- Inviter can ONLY see their invited characters and progress, never Telegram IDs,
-- emails, auth IDs, inventories or other private details.
CREATE OR REPLACE FUNCTION public.territory_referral_friends_v2()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_uid uuid:=auth.uid(); v_items jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'referral_login_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.players
  WHERE id=v_uid AND telegram_id IS NOT NULL AND NOT banned)
 THEN RAISE EXCEPTION 'referral_verified_telegram_required'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'name',left(coalesce(nullif(trim(p.display_name),''),'Герой'),32),
   'level',CASE WHEN (p.game_state->'player'->>'level')~'^[0-9]{1,5}$'
       THEN least((p.game_state->'player'->>'level')::integer,999) ELSE 1 END,
   'wins',least(coalesce(a.credited_wins,0),999),
   'verified_xp',coalesce(a.credited_xp,0) +
    CASE WHEN coalesce(a.stage_wins,0)>=3 THEN 30 ELSE 0 END +
    CASE WHEN coalesce(a.boss_wins,0)>=1 THEN 80 ELSE 0 END,
   'qualified',i.qualified_at IS NOT NULL,
   'joined_at',i.created_at
 ) ORDER BY i.created_at DESC),'[]'::jsonb) INTO v_items
 FROM (
  SELECT invited_id,qualified_at,created_at FROM territory_private.referral_invites_v1
  WHERE inviter_id=v_uid ORDER BY created_at DESC LIMIT 100
 ) i
 JOIN public.players p ON p.id=i.invited_id
 LEFT JOIN territory_private.referral_activity_v2 a ON a.player_id=i.invited_id;
 RETURN v_items;
END $$;
REVOKE ALL ON FUNCTION public.territory_referral_friends_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_referral_friends_v2() TO authenticated;

-- Status also gives credit when a delayed cloud autosave reaches level 5.
CREATE OR REPLACE FUNCTION public.territory_referral_status_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_uid uuid:=auth.uid(); v_code text; v_founder bigint;
 v_total int; v_active int; v_unclaimed int; v_chests int; v_paid int; v_red_paid int;
 v_welcome boolean; v_pending_red int;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'referral_login_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_uid AND telegram_id IS NOT NULL AND NOT banned)
 THEN RAISE EXCEPTION 'referral_verified_telegram_required'; END IF;
 -- Qualification depends on server-recorded activity, never a client level alone.
 PERFORM territory_private.referral_try_qualify_v2(v_uid);
 -- Profile sequence is private, immutable and seeded for existing verified players.
 INSERT INTO territory_private.referral_profiles_v1(player_id)
 SELECT v_uid WHERE NOT EXISTS(
   SELECT 1 FROM territory_private.referral_profiles_v1 WHERE player_id=v_uid
 ) ON CONFLICT(player_id) DO NOTHING;
 SELECT code,founder_number INTO v_code,v_founder
 FROM territory_private.referral_profiles_v1 WHERE player_id=v_uid;
 SELECT count(*),count(*) FILTER(WHERE qualified_at IS NOT NULL),
   count(*) FILTER(WHERE qualified_at IS NOT NULL AND reward_claimed_at IS NULL)
 INTO v_total,v_active,v_unclaimed FROM territory_private.referral_invites_v1 WHERE inviter_id=v_uid;
 SELECT count(*) INTO v_chests FROM territory_private.referral_chests_v1 WHERE inviter_id=v_uid;
 SELECT coalesce(red_paid,0),coalesce(claimed_friends,0) INTO v_red_paid,v_paid
 FROM territory_private.referral_claim_cursor_v1 WHERE player_id=v_uid;
 v_red_paid:=coalesce(v_red_paid,0);
 v_paid:=coalesce(v_paid,0);
 v_pending_red:=greatest(0,v_active/5-v_red_paid);
 SELECT EXISTS (SELECT 1 FROM territory_private.referral_invites_v1
  WHERE invited_id=v_uid AND welcome_claimed_at IS NULL) INTO v_welcome;
 RETURN jsonb_build_object(
  'code',v_code,'founder_number',CASE WHEN v_founder<=300 THEN v_founder ELSE NULL END,
  'places_left',greatest(0,300-(SELECT count(*) FROM territory_private.referral_profiles_v1 WHERE founder_number<=300)),
  'registered',v_total,'qualified',v_active,'pending_claims',v_unclaimed,
  'red_fragments',v_active % 5,'red_pending',v_pending_red,
  'red_earned_tenths',v_active*2,
  'sealed_chests',v_chests,'welcome_pending',v_welcome,
  'rank',CASE WHEN v_active>=25 THEN 'ambassador'
       WHEN v_active>=10 THEN 'gold'
       WHEN v_active>=5 THEN 'silver'
       WHEN v_active>=3 THEN 'bronze' ELSE 'recruit' END);
END $$;
