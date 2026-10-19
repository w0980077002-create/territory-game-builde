-- One universal server-authoritative daily share incentive for TERRITORY.
-- Telegram cannot prove delivery of a message: this awards for an explicit share-picker tap.
-- No automatic messages, no click-through/referral qualification required.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';

CREATE TABLE territory_private.daily_share_tasks_v1(
 task text PRIMARY KEY CHECK (task IN ('monopoly','trials')),
 reward_kind text NOT NULL CHECK (reward_kind IN ('tickets','stones')),
 reward_amount integer NOT NULL CHECK (reward_amount BETWEEN 1 AND 5),
 enabled boolean NOT NULL DEFAULT true
);
INSERT INTO territory_private.daily_share_tasks_v1(task,reward_kind,reward_amount) VALUES
 ('monopoly','tickets',2),('trials','stones',2);
CREATE TABLE territory_private.daily_share_claims_v1(
 player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
 task text NOT NULL REFERENCES territory_private.daily_share_tasks_v1(task),
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(player_id,task)
);
ALTER TABLE territory_private.daily_share_tasks_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.daily_share_claims_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.daily_share_tasks_v1,territory_private.daily_share_claims_v1 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_daily_share_v1(
 p_action text DEFAULT 'status',p_task text DEFAULT NULL,p_expected timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $fn$
DECLARE
 v_uid uuid:=auth.uid();
 p public.players%ROWTYPE;
 a territory_private.hall_accounts_v1%ROWTYPE;
 t territory_private.daily_share_tasks_v1%ROWTYPE;
 v_previous timestamptz; v_claimed timestamptz:=clock_timestamp();
 v_next timestamptz; v_stones bigint; v_state jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'daily_share_login_required'; END IF;
 IF p_action NOT IN ('status','claim') THEN RAISE EXCEPTION 'daily_share_bad_action'; END IF;
 -- Lock the player's row for claims so simultaneous requests and other CAS writes serialize.
 IF p_action='claim' THEN
  SELECT * INTO p FROM public.players WHERE id=v_uid FOR UPDATE;
 ELSE
  SELECT * INTO p FROM public.players WHERE id=v_uid;
 END IF;
 IF NOT FOUND OR p.banned OR p.telegram_id IS NULL
 THEN RAISE EXCEPTION 'daily_share_verified_telegram_required'; END IF;

 IF p_action='status' THEN
  RETURN jsonb_build_object(
   'server_time',v_claimed,
   'tasks',COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
     'task',cfg.task,'reward_kind',cfg.reward_kind,'reward_amount',cfg.reward_amount,
     'enabled',cfg.enabled,
     'next_at',CASE WHEN cl.claimed_at IS NULL THEN NULL ELSE cl.claimed_at+interval '24 hours' END,
     'ready',(cfg.enabled AND (cl.claimed_at IS NULL OR cl.claimed_at+interval '24 hours'<=v_claimed))
    ) ORDER BY cfg.task)
    FROM territory_private.daily_share_tasks_v1 cfg
    LEFT JOIN territory_private.daily_share_claims_v1 cl
     ON cl.player_id=v_uid AND cl.task=cfg.task
   ),'[]'::jsonb),
   'tickets',(SELECT tickets FROM territory_private.hall_accounts_v1 WHERE player_id=v_uid)
  );
 END IF;

 SELECT * INTO t FROM territory_private.daily_share_tasks_v1
  WHERE task=p_task AND enabled=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'daily_share_unavailable'; END IF;
 SELECT claimed_at INTO v_previous FROM territory_private.daily_share_claims_v1
 WHERE player_id=v_uid AND task=t.task;
 IF v_previous IS NOT NULL AND v_previous+interval '24 hours'>v_claimed
 THEN RAISE EXCEPTION 'daily_share_cooldown'; END IF;

 IF t.reward_kind='tickets' THEN
  INSERT INTO territory_private.hall_accounts_v1(player_id)
   VALUES (v_uid) ON CONFLICT(player_id) DO NOTHING;
  SELECT * INTO a FROM territory_private.hall_accounts_v1
   WHERE player_id=v_uid FOR UPDATE;
  IF a.tickets>20-t.reward_amount THEN
   RAISE EXCEPTION 'daily_share_ticket_wallet_full';
  END IF;
  UPDATE territory_private.hall_accounts_v1
  SET tickets=tickets+t.reward_amount
  WHERE player_id=v_uid RETURNING * INTO a;
 ELSIF t.reward_kind='stones' THEN
  IF p_expected IS NULL OR p.updated_at IS DISTINCT FROM p_expected
   OR jsonb_typeof(p.game_state) IS DISTINCT FROM 'object'
   OR (p.game_state->>'battleStones') !~ '^[0-9]{1,10}$'
   OR (p.game_state->>'battleStones')::bigint > 2147483647-t.reward_amount
   OR jsonb_typeof(p.game_state->'player') IS DISTINCT FROM 'object'
   OR (p.game_state->'player'->>'gold') !~ '^[0-9]{1,10}$'
   OR (p.game_state->'player'->>'gems') !~ '^[0-9]{1,10}$'
   OR (p.game_state->'player'->>'gold')::bigint IS DISTINCT FROM p.gold
   OR (p.game_state->'player'->>'gems')::bigint IS DISTINCT FROM p.gems
  THEN RAISE EXCEPTION 'daily_share_reload_required'; END IF;
  v_stones:=(p.game_state->>'battleStones')::bigint;
  v_state:=jsonb_set(p.game_state,'{battleStones}',to_jsonb(v_stones+t.reward_amount));
  UPDATE public.players SET game_state=v_state,
   updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond')
   WHERE id=v_uid RETURNING * INTO p;
 ELSE
  RAISE EXCEPTION 'daily_share_invalid_reward';
 END IF;
 INSERT INTO territory_private.daily_share_claims_v1(player_id,task,claimed_at)
 VALUES(v_uid,t.task,v_claimed)
 ON CONFLICT (player_id,task) DO UPDATE SET claimed_at=EXCLUDED.claimed_at;
 v_next:=v_claimed+interval '24 hours';
 RETURN jsonb_build_object('success',true,'task',t.task,'reward_kind',t.reward_kind,
  'added',t.reward_amount,'next_at',v_next,
  'tickets',CASE WHEN t.reward_kind='tickets' THEN a.tickets ELSE NULL END,
  'updated_at',CASE WHEN t.reward_kind='stones' THEN to_jsonb(p.updated_at) ELSE NULL END,
  'wallet_gold',CASE WHEN t.reward_kind='stones' THEN to_jsonb(p.gold) ELSE NULL END,
  'wallet_gems',CASE WHEN t.reward_kind='stones' THEN to_jsonb(p.gems) ELSE NULL END,
  'game_state',CASE WHEN t.reward_kind='stones' THEN p.game_state ELSE NULL END
 );
END
$fn$;
REVOKE ALL ON FUNCTION public.territory_daily_share_v1(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_daily_share_v1(text,text,timestamptz) TO authenticated;
COMMIT;
