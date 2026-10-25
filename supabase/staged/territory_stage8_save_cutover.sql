-- TERRITORY 1.0 — PROTECTED SAVE/CUTOVER COMPONENT (STAGING ONLY).
-- This is NOT the finished game-economy transition. In particular, legacy
-- client combat, quests and achievements still mint gold/XP locally.
-- NEVER revoke the existing live grants or enable Stage8 until ALL reward
-- sources have authenticated, replay-safe server-side implementations.

BEGIN;

-- A canonical, versioned, idempotent write channel for genuinely cosmetic
-- fields. Money, hero XP/level, professions, resources, inventory, VIP and
-- battle rewards CANNOT be changed through this RPC, even in nested JSON.
CREATE TABLE IF NOT EXISTS public.territory_stage8_cosmetic_receipts (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(length(request_hash)=32),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(player_id,operation_id)
);
ALTER TABLE public.territory_stage8_cosmetic_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_stage8_cosmetic_receipts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_stage8_cosmetic_save(
  p_expected_updated_at timestamptz,p_operation uuid,
  p_speed integer,p_auto boolean,p_appearance text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_player public.players%ROWTYPE;
  v_prior public.territory_stage8_cosmetic_receipts%ROWTYPE;
  v_after public.players%ROWTYPE;
  v_request_hash text;
  v_new_state jsonb;
  v_updated timestamptz;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF p_operation IS NULL OR p_expected_updated_at IS NULL
      OR p_speed NOT IN (1,2) OR p_auto IS NULL
      OR p_appearance IS NULL OR p_appearance NOT IN ('m1','m2','f1','f2')
    THEN RAISE EXCEPTION 'invalid_cosmetic_request'; END IF;
  v_request_hash:=pg_catalog.md5(
    p_expected_updated_at::text||'|'||p_speed::text||'|'||
    p_auto::text||'|'||p_appearance);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text),7724);
  SELECT * INTO v_prior FROM public.territory_stage8_cosmetic_receipts
    WHERE player_id=v_uid AND operation_id=p_operation;
  IF FOUND THEN
    IF v_prior.request_hash<>v_request_hash THEN RAISE EXCEPTION 'operation_id_conflict'; END IF;
    RETURN v_prior.result;
  END IF;

  SELECT * INTO v_player FROM public.players WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND OR v_player.banned THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  IF v_player.updated_at IS DISTINCT FROM p_expected_updated_at
    THEN RAISE EXCEPTION 'stale_save_revision'; END IF;
  IF pg_catalog.jsonb_typeof(v_player.game_state) IS DISTINCT FROM 'object'
      OR pg_catalog.jsonb_typeof(v_player.game_state->'player') IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'invalid_existing_save'; END IF;

  v_new_state:=pg_catalog.jsonb_set(v_player.game_state,'{settings}',
    pg_catalog.jsonb_build_object('speed',p_speed,'auto',p_auto),true);
  v_new_state:=pg_catalog.jsonb_set(v_new_state,'{appearance}',
    pg_catalog.to_jsonb(p_appearance),true);
  UPDATE public.players
    SET game_state=v_new_state,
        updated_at=GREATEST(pg_catalog.clock_timestamp(),v_player.updated_at+interval '1 microsecond')
    WHERE id=v_uid AND updated_at=p_expected_updated_at
    RETURNING * INTO v_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale_save_revision'; END IF;
  -- Other production save triggers must NOT piggyback on this cosmetic RPC to
  -- rebalance equipment, add rewards or modify private currency columns.
  -- Any such side effect rejects and rolls back the whole transaction.
  IF (v_after.game_state-'settings'-'appearance')
       IS DISTINCT FROM (v_player.game_state-'settings'-'appearance')
     OR v_after.gold IS DISTINCT FROM v_player.gold
     OR v_after.gems IS DISTINCT FROM v_player.gems
     OR v_after.level IS DISTINCT FROM v_player.level
     OR v_after.xp IS DISTINCT FROM v_player.xp
     OR v_after.forge_materials IS DISTINCT FROM v_player.forge_materials
    THEN RAISE EXCEPTION 'cosmetic_affected_gameplay'; END IF;
  v_updated:=v_after.updated_at;
  v_result:=pg_catalog.jsonb_build_object('success',true,
    'updated_at',v_updated,'settings',v_new_state->'settings',
    'appearance',p_appearance);
  INSERT INTO public.territory_stage8_cosmetic_receipts(
    player_id,operation_id,request_hash,result)
  VALUES(v_uid,p_operation,v_request_hash,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.territory_stage8_cosmetic_save(
  timestamptz,uuid,integer,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_stage8_cosmetic_save(
  timestamptz,uuid,integer,boolean,text) TO authenticated, service_role;

-- A readable and intentionally conservative release preflight. Stage8 cannot
-- be represented as secure while direct browser grants, legacy unlock RPC, or
-- server-verified game reward contracts are missing. It NEVER flips a flag.
CREATE OR REPLACE FUNCTION public.territory_stage8_save_cutover_preflight()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_missing jsonb := '[]'::jsonb;
  v_col text;
  v_role text;
  v_old_rpc oid := pg_catalog.to_regprocedure('public.territory_profession_unlock(text)');
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_col IN ARRAY ARRAY['game_state','gems','gold','level','xp',
      'forge_materials','updated_at'] LOOP
      IF pg_catalog.has_column_privilege(v_role,'public.players',v_col,'UPDATE') THEN
        v_missing:=v_missing||pg_catalog.to_jsonb(v_role||'_direct_'||v_col||'_update');
      END IF;
    END LOOP;
    IF pg_catalog.has_table_privilege(v_role,'public.players','INSERT') THEN
      v_missing:=v_missing||pg_catalog.to_jsonb(v_role||'_direct_players_insert');
    END IF;
    IF pg_catalog.has_column_privilege(v_role,'public.territory_resource_wallet','quantity','UPDATE')
      OR pg_catalog.has_table_privilege(v_role,'public.territory_resource_wallet','INSERT')
      OR pg_catalog.has_table_privilege(v_role,'public.territory_resource_wallet','DELETE') THEN
      v_missing:=v_missing||pg_catalog.to_jsonb(v_role||'_resource_wallet_write');
    END IF;
    IF v_old_rpc IS NOT NULL AND pg_catalog.has_function_privilege(v_role,v_old_rpc,'EXECUTE') THEN
      v_missing:=v_missing||pg_catalog.to_jsonb(v_role||'_old_profession_rpc');
    END IF;
  END LOOP;
  -- These verified gameplay reward functions are not implemented yet. Their
  -- absence is an objective HARD STOP; never allow an operator to bypass it by
  -- merely editing a cosmetic release flag or passing an arbitrary boolean.
  IF pg_catalog.to_regprocedure('public.territory_server_pve_reward(uuid)') IS NULL
    THEN v_missing:=v_missing||'"server_pve_reward_missing"'::jsonb; END IF;
  IF pg_catalog.to_regprocedure('public.territory_server_quest_claim(text,uuid)') IS NULL
    THEN v_missing:=v_missing||'"server_quest_claim_missing"'::jsonb; END IF;
  IF pg_catalog.to_regprocedure('public.territory_server_achievement_claim(text,uuid)') IS NULL
    THEN v_missing:=v_missing||'"server_achievement_claim_missing"'::jsonb; END IF;
  IF pg_catalog.to_regprocedure('public.territory_server_inventory_use(uuid,uuid)') IS NULL
    THEN v_missing:=v_missing||'"server_inventory_use_missing"'::jsonb; END IF;
  -- Mere function *names* cannot establish the legitimacy of rewards. The
  -- final release migration must replace this deliberate HOLD with reviewed
  -- evidence and end-to-end tests for every source of XP, gems and gold.
  v_missing:=v_missing||'"independent_economy_cutover_review_required"'::jsonb;
  RETURN pg_catalog.jsonb_build_object('ready',pg_catalog.jsonb_array_length(v_missing)=0,
    'blockers',v_missing);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_stage8_save_cutover_preflight()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_stage8_save_cutover_preflight()
  TO service_role;

-- No RELEASE flag, no grants revoked from players, no existing balances or
-- games altered by executing this staged file. It may be deployed to a copy
-- for testing; live usage still requires independent infrastructure review.
COMMIT;
