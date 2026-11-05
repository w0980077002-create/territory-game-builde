-- STAGED / REVIEW ONLY. Do not execute against the production database until
-- a verified backup + independently tested restore, security review and client
-- receipt integration are approved. No paid checkout or VIP grants here.
--
-- VIP daily chest: one UTC day / player, server-verified VIP entitlement,
-- one transaction, idempotent operation UUID and exact CAS save revision.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS territory_private.vip_daily_claims_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  claim_day date NOT NULL,
  operation_id uuid NOT NULL,
  granted_vip integer NOT NULL CHECK (granted_vip BETWEEN 1 AND 10),
  reward_gold integer NOT NULL CHECK (reward_gold BETWEEN 0 AND 5000),
  reward_gems integer NOT NULL CHECK (reward_gems BETWEEN 0 AND 100),
  reward_stones integer NOT NULL CHECK (reward_stones BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (player_id,claim_day),
  UNIQUE (player_id,operation_id)
);
ALTER TABLE territory_private.vip_daily_claims_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.vip_daily_claims_v1 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_vip_daily_v1(
  p_action text DEFAULT 'status', p_operation uuid DEFAULT NULL,
  p_expected timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_daily$
DECLARE
  u uuid:=auth.uid();
  p public.players%ROWTYPE;
  r territory_private.vip_daily_claims_v1%ROWTYPE;
  v_day date:=(statement_timestamp() AT TIME ZONE 'UTC')::date;
  v_tier integer;
  v_gold integer;
  v_gems integer;
  v_stones integer;
  v_old_stones bigint;
  v_gold_next bigint;
  v_gems_next bigint;
  v_stones_next bigint;
  st jsonb;
  hero jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'vip_login_required'; END IF;
  IF p_action IS NULL OR p_action NOT IN('status','claim') THEN
    RAISE EXCEPTION 'vip_invalid_action';
  END IF;
  IF p_action='status' THEN
    SELECT * INTO p FROM public.players WHERE id=u AND NOT banned;
  ELSE
    SELECT * INTO p FROM public.players WHERE id=u AND NOT banned FOR NO KEY UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'vip_player_not_found'; END IF;
  -- Install the staged VIP entitlement ledger first. Fail closed if absent.
  v_tier:=(territory_private.vip_entitlement_status_v1(u)->>'vip')::integer;
  IF v_tier IS NULL OR v_tier NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION 'vip_invalid_entitlement';
  END IF;
  IF p_action='status' THEN
    RETURN jsonb_build_object('success',true,'vip',v_tier,
      'server_day',v_day,'next_reset_at',(v_day+1)::timestamp AT TIME ZONE 'UTC',
      'claimed_today',EXISTS(SELECT 1 FROM territory_private.vip_daily_claims_v1
        WHERE player_id=u AND claim_day=v_day),
      'updated_at',p.updated_at,'game_state',p.game_state,
      'wallet_gold',p.gold,'wallet_gems',p.gems);
  END IF;
  IF p_operation IS NULL THEN RAISE EXCEPTION 'vip_missing_operation'; END IF;

  -- Replays are checked before the revision comparison: a lost HTTP response
  -- can be retried without a second grant or stale-save overwrite.
  SELECT * INTO r FROM territory_private.vip_daily_claims_v1
    WHERE player_id=u AND operation_id=p_operation;
  IF FOUND THEN
    RETURN jsonb_build_object('success',true,'replayed',true,
      'updated_at',p.updated_at,'game_state',p.game_state,
      'wallet_gold',p.gold,'wallet_gems',p.gems,
      'reward',jsonb_build_object('gold',r.reward_gold,'gems',r.reward_gems,
        'stones',r.reward_stones,'vip',r.granted_vip,'day',r.claim_day));
  END IF;
  IF v_tier<1 THEN RAISE EXCEPTION 'vip_required'; END IF;
  IF EXISTS(SELECT 1 FROM territory_private.vip_daily_claims_v1
      WHERE player_id=u AND claim_day=v_day) THEN
    RAISE EXCEPTION 'vip_daily_already_claimed';
  END IF;
  IF p_expected IS NULL OR p.updated_at IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'vip_reload_required';
  END IF;

  st:=p.game_state;
  hero:=st->'player';
  IF jsonb_typeof(st) IS DISTINCT FROM 'object'
    OR jsonb_typeof(hero) IS DISTINCT FROM 'object'
    OR jsonb_typeof(st->'inventory') IS DISTINCT FROM 'array'
    OR (hero->>'gold')::integer IS DISTINCT FROM p.gold
    OR (hero->>'gems')::integer IS DISTINCT FROM p.gems
    OR (hero->>'level')::integer IS DISTINCT FROM p.level
    OR coalesce(st->>'battleStones','') !~ '^[0-9]{1,10}$'
  THEN RAISE EXCEPTION 'vip_invalid_save'; END IF;
  v_old_stones:=(st->>'battleStones')::bigint;
  IF v_old_stones>2147483647 THEN RAISE EXCEPTION 'vip_invalid_wallet'; END IF;

  -- Capped bonuses are modest convenience gifts, not red diamonds or cash.
  v_gold:=(ARRAY[0,100,150,200,250,350,500,750,950,1250,1600])[v_tier+1];
  v_gems:=(ARRAY[0,1,2,2,3,4,5,6,7,9,10])[v_tier+1];
  v_stones:=(ARRAY[0,0,0,1,1,1,2,2,2,3,3])[v_tier+1];
  v_gold_next:=p.gold::bigint+v_gold;
  v_gems_next:=p.gems::bigint+v_gems;
  v_stones_next:=v_old_stones+v_stones;
  IF v_gold_next>2147483647 OR v_gems_next>2147483647 OR v_stones_next>2147483647
  THEN RAISE EXCEPTION 'vip_wallet_overflow'; END IF;

  hero:=jsonb_set(hero,'{gold}',to_jsonb(v_gold_next::integer),true);
  hero:=jsonb_set(hero,'{gems}',to_jsonb(v_gems_next::integer),true);
  st:=jsonb_set(st,'{player}',hero,true);
  st:=jsonb_set(st,'{battleStones}',to_jsonb(v_stones_next::integer),true);
  UPDATE public.players SET gold=v_gold_next::integer,gems=v_gems_next::integer,
    game_state=st,updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond')
    WHERE id=u RETURNING * INTO p;
  INSERT INTO territory_private.vip_daily_claims_v1
    (player_id,claim_day,operation_id,granted_vip,reward_gold,reward_gems,reward_stones)
    VALUES(u,v_day,p_operation,v_tier,v_gold,v_gems,v_stones);

  RETURN jsonb_build_object('success',true,'replayed',false,
    'updated_at',p.updated_at,'game_state',p.game_state,
    'wallet_gold',p.gold,'wallet_gems',p.gems,
    'reward',jsonb_build_object('gold',v_gold,'gems',v_gems,
      'stones',v_stones,'vip',v_tier,'day',v_day));
END $vip_daily$;
REVOKE ALL ON FUNCTION public.territory_vip_daily_v1(text,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_vip_daily_v1(text,uuid,timestamptz) TO authenticated;
COMMIT;
