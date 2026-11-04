-- STAGED / REVIEW ONLY: no production execution. Requires reviewed backup,
-- PostgreSQL 17 JWT/RLS/concurrency testing and rollback validation.
-- Weekly VIP chest: one MON 00:00 UTC period per authenticated player.
-- All rewards are issued atomically from the server with a unique receipt.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS territory_private.vip_weekly_claims_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  operation_id uuid NOT NULL,
  granted_vip integer NOT NULL CHECK (granted_vip BETWEEN 2 AND 10),
  reward_gold integer NOT NULL CHECK (reward_gold BETWEEN 0 AND 5000),
  reward_gems integer NOT NULL CHECK (reward_gems BETWEEN 0 AND 100),
  reward_stones integer NOT NULL CHECK (reward_stones BETWEEN 0 AND 10),
  reward_materials integer NOT NULL CHECK (reward_materials BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (player_id,week_start),
  UNIQUE (player_id,operation_id)
);
ALTER TABLE territory_private.vip_weekly_claims_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.vip_weekly_claims_v1 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_vip_weekly_v1(
  p_action text DEFAULT 'status', p_operation uuid DEFAULT NULL,
  p_expected timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_weekly$
DECLARE
  u uuid:=auth.uid();
  p public.players%ROWTYPE;
  r territory_private.vip_weekly_claims_v1%ROWTYPE;
  v_today date:=(statement_timestamp() AT TIME ZONE 'UTC')::date;
  v_week date;
  v_tier integer;
  v_bucket integer;
  v_gold integer;
  v_gems integer;
  v_stones integer;
  v_materials integer;
  v_gold_next bigint;
  v_gems_next bigint;
  v_stones_next bigint;
  v_material_next bigint;
  v_old_materials bigint;
  v_old_stones bigint;
  v_batch_total numeric;
  v_batches jsonb;
  v_new_batch jsonb;
  v_now timestamptz:=statement_timestamp();
  st jsonb;
  hero jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'vip_weekly_login_required'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('status','claim') THEN
    RAISE EXCEPTION 'vip_weekly_invalid_action';
  END IF;
  v_week:=v_today-(extract(isodow from v_today)::integer-1);
  IF p_action='status' THEN
    SELECT * INTO p FROM public.players WHERE id=u AND NOT banned;
  ELSE
    SELECT * INTO p FROM public.players WHERE id=u AND NOT banned FOR NO KEY UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'vip_weekly_player_not_found'; END IF;
  v_tier:=territory_private.fortune_vip_v1(u);
  IF v_tier IS NULL OR v_tier NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION 'vip_weekly_invalid_entitlement';
  END IF;
  IF p_action='status' THEN
    RETURN jsonb_build_object('success',true,'vip',v_tier,
      'server_week',v_week,'next_reset_at',(v_week+7)::timestamp AT TIME ZONE 'UTC',
      'claimed_this_week',EXISTS(SELECT 1 FROM territory_private.vip_weekly_claims_v1
        WHERE player_id=u AND week_start=v_week),
      'updated_at',p.updated_at,'game_state',p.game_state,
      'wallet_gold',p.gold,'wallet_gems',p.gems);
  END IF;
  IF p_operation IS NULL THEN RAISE EXCEPTION 'vip_weekly_missing_operation'; END IF;
  -- Retry the same operation before checking the current revision or entitlement.
  SELECT * INTO r FROM territory_private.vip_weekly_claims_v1
    WHERE player_id=u AND operation_id=p_operation;
  IF FOUND THEN
    RETURN jsonb_build_object('success',true,'replayed',true,
      'updated_at',p.updated_at,'game_state',p.game_state,
      'wallet_gold',p.gold,'wallet_gems',p.gems,
      'reward',jsonb_build_object('gold',r.reward_gold,'gems',r.reward_gems,
        'stones',r.reward_stones,'materials',r.reward_materials,
        'vip',r.granted_vip,'week',r.week_start));
  END IF;
  IF v_tier<2 THEN RAISE EXCEPTION 'vip_weekly_vip2_required'; END IF;
  IF EXISTS(SELECT 1 FROM territory_private.vip_weekly_claims_v1
     WHERE player_id=u AND week_start=v_week) THEN
    RAISE EXCEPTION 'vip_weekly_already_claimed';
  END IF;
  IF p_expected IS NULL OR p.updated_at IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'vip_weekly_reload_required';
  END IF;
  st:=p.game_state;
  hero:=st->'player';
  IF jsonb_typeof(st) IS DISTINCT FROM 'object'
    OR jsonb_typeof(hero) IS DISTINCT FROM 'object'
    OR jsonb_typeof(st->'inventory') IS DISTINCT FROM 'array'
    OR coalesce(hero->>'gold','') !~ '^[0-9]{1,10}$'
    OR coalesce(hero->>'gems','') !~ '^[0-9]{1,10}$'
    OR coalesce(hero->>'level','') !~ '^[0-9]{1,10}$'
    OR coalesce(st->>'battleStones','') !~ '^[0-9]{1,10}$'
    OR coalesce(st->>'forgeMaterials','') !~ '^[0-9]{1,10}$'
  THEN RAISE EXCEPTION 'vip_weekly_invalid_save'; END IF;
  IF (hero->>'gold')::bigint IS DISTINCT FROM p.gold
    OR (hero->>'gems')::bigint IS DISTINCT FROM p.gems
    OR (hero->>'level')::bigint IS DISTINCT FROM p.level THEN
    RAISE EXCEPTION 'vip_weekly_wallet_mismatch';
  END IF;
  v_old_stones:=(st->>'battleStones')::bigint;
  v_old_materials:=(st->>'forgeMaterials')::bigint;
  IF v_old_stones>2147483647 OR v_old_materials>2147483647 THEN
    RAISE EXCEPTION 'vip_weekly_invalid_wallet';
  END IF;

  -- Existing material batches must be valid and reconcile with the saved wallet.
  -- Legacy no-batch saves receive the same seven-day grace as the client.
  IF st ? 'forgeMaterialBatches' THEN
    IF jsonb_typeof(st->'forgeMaterialBatches') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'vip_weekly_material_batches_invalid';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(st->'forgeMaterialBatches') e
      WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
         OR coalesce(e->>'qty','') !~ '^[1-9][0-9]{0,9}$'
         OR (e->>'expiresAt') IS NULL
         OR (e->>'expiresAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T') THEN
      RAISE EXCEPTION 'vip_weekly_material_batches_invalid';
    END IF;
    SELECT COALESCE(sum((e->>'qty')::numeric),0) INTO v_batch_total
      FROM jsonb_array_elements(st->'forgeMaterialBatches') e;
    IF v_batch_total IS DISTINCT FROM v_old_materials THEN
      RAISE EXCEPTION 'vip_weekly_material_batches_mismatch';
    END IF;
    -- Expired material batches must be reconciled before taking new prizes.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(st->'forgeMaterialBatches') e
      WHERE (e->>'expiresAt')::timestamptz <= v_now) THEN
      RAISE EXCEPTION 'vip_weekly_materials_expired_reload';
    END IF;
    v_batches:=st->'forgeMaterialBatches';
  ELSE
    v_batches:=CASE WHEN v_old_materials>0
      THEN jsonb_build_array(jsonb_build_object('qty',v_old_materials,
        'expiresAt',v_now+interval '7 days'))
      ELSE '[]'::jsonb END;
  END IF;

  v_bucket:=CASE
    WHEN v_tier BETWEEN 2 AND 3 THEN 1
    WHEN v_tier BETWEEN 4 AND 5 THEN 2
    WHEN v_tier=6 THEN 3
    WHEN v_tier BETWEEN 7 AND 8 THEN 4
    ELSE 5 END;
  v_gold:=(ARRAY[0,250,600,1000,1800,3000])[v_bucket+1];
  v_gems:=(ARRAY[0,2,5,8,12,20])[v_bucket+1];
  v_stones:=(ARRAY[0,1,2,3,4,5])[v_bucket+1];
  v_materials:=(ARRAY[0,1,2,3,4,6])[v_bucket+1];
  v_gold_next:=p.gold::bigint+v_gold;
  v_gems_next:=p.gems::bigint+v_gems;
  v_stones_next:=v_old_stones+v_stones;
  v_material_next:=v_old_materials+v_materials;
  IF v_gold_next>2147483647 OR v_gems_next>2147483647
    OR v_stones_next>2147483647 OR v_material_next>2147483647 THEN
    RAISE EXCEPTION 'vip_weekly_wallet_overflow';
  END IF;
  v_new_batch:=jsonb_build_object('qty',v_materials,
    'expiresAt',v_now+interval '7 days');
  v_batches:=v_batches||jsonb_build_array(v_new_batch);
  hero:=jsonb_set(hero,'{gold}',to_jsonb(v_gold_next::integer),true);
  hero:=jsonb_set(hero,'{gems}',to_jsonb(v_gems_next::integer),true);
  st:=jsonb_set(st,'{player}',hero,true);
  st:=jsonb_set(st,'{battleStones}',to_jsonb(v_stones_next::integer),true);
  st:=jsonb_set(st,'{forgeMaterials}',to_jsonb(v_material_next::integer),true);
  st:=jsonb_set(st,'{forgeMaterialBatches}',v_batches,true);
  UPDATE public.players SET gold=v_gold_next::integer,gems=v_gems_next::integer,
    game_state=st,updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond')
    WHERE id=u RETURNING * INTO p;
  INSERT INTO territory_private.vip_weekly_claims_v1
    (player_id,week_start,operation_id,granted_vip,
      reward_gold,reward_gems,reward_stones,reward_materials)
    VALUES(u,v_week,p_operation,v_tier,
      v_gold,v_gems,v_stones,v_materials);
  RETURN jsonb_build_object('success',true,'replayed',false,
    'updated_at',p.updated_at,'game_state',p.game_state,
    'wallet_gold',p.gold,'wallet_gems',p.gems,
    'reward',jsonb_build_object('gold',v_gold,'gems',v_gems,
      'stones',v_stones,'materials',v_materials,'vip',v_tier,'week',v_week));
END $vip_weekly$;
REVOKE ALL ON FUNCTION public.territory_vip_weekly_v1(text,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_vip_weekly_v1(text,uuid,timestamptz) TO authenticated;
COMMIT;
