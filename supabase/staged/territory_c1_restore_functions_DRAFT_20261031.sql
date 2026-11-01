-- C1 phase B: REVIEW/CLONE ONLY. No production use without separate approval.
-- EXTERNAL PRECONDITIONS: ingress closed, phase A applied, every client-side
-- pending operation reconciled, no deployment changing these functions.
-- This script cannot independently prove external ingress or client queues.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $c1_phase_b$
DECLARE cfg territory_private.combat_config_v1%ROWTYPE;
BEGIN
 SELECT * INTO cfg FROM territory_private.combat_config_v1 WHERE id=true FOR UPDATE;
 IF NOT FOUND OR cfg.starts_enabled IS DISTINCT FROM false OR cfg.canary_only IS DISTINCT FROM true
   THEN RAISE EXCEPTION 'C1 phase B requires phase A'; END IF;
 IF EXISTS (SELECT 1 FROM territory_private.combat_sessions_v1 WHERE state->>'status'='fighting')
   THEN RAISE EXCEPTION 'C1 phase B requires drained sessions'; END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.territory_combat_commit_v1(uuid,jsonb,jsonb,jsonb)'))) IS DISTINCT FROM '8436dbde58b588bdda919d7aae16351e'
   OR md5(pg_get_functiondef(to_regprocedure('territory_private.adventure_settle_v1(uuid,uuid)'))) IS DISTINCT FROM '6473e9aa6b62b72a9c629608b401ee46'
   OR md5(pg_get_functiondef(to_regprocedure('territory_private.combat_refresh_reward_v1(uuid,jsonb,integer)'))) IS DISTINCT FROM 'aaaf1b1503de900bc17b9adacf7e365a'
   OR md5(pg_get_functiondef(to_regprocedure('public.territory_adventure_progress_v1()'))) IS DISTINCT FROM 'b1acc63a1d92ccf92b1b05974c31ab9a'
   THEN RAISE EXCEPTION 'C1 phase B refuses changed functions'; END IF;
 -- The old commit has no start gate. After drain, keep combat disabled until a
 -- separately reviewed rollout; context still serves resume and receipt replay.
 UPDATE territory_private.combat_config_v1 SET enabled=false WHERE id=true;
END $c1_phase_b$;
-- Read-only live function definitions captured for synthetic PG17 fixture; no player data.
CREATE OR REPLACE FUNCTION territory_private.adventure_settle_v1(p_player uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE s territory_private.combat_sessions_v1%ROWTYPE; e territory_private.combat_encounters_v1%ROWTYPE;
 r territory_private.adventure_rewards_v1%ROWTYPE; p public.players%ROWTYPE;
 existing territory_private.adventure_settlements_v1%ROWTYPE;
 st jsonb; stats jsonb; followers jsonb; receipt jsonb; outcome text;
 lv integer; v_max_energy integer; balance bigint; threshold bigint; before_projection jsonb; old_level integer; old_updated_at timestamptz;
BEGIN
 SELECT * INTO p FROM public.players WHERE id=p_player FOR UPDATE;
 IF NOT FOUND OR coalesce(p.banned,false) THEN RAISE EXCEPTION 'adventure_account_unavailable'; END IF;
 SELECT * INTO s FROM territory_private.combat_sessions_v1 WHERE session_id=p_session AND player_id=p_player FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'adventure_session_missing'; END IF;
 SELECT * INTO existing FROM territory_private.adventure_settlements_v1 WHERE session_id=p_session;
 IF FOUND THEN RETURN existing.receipt; END IF;
 outcome:=s.state->>'status';
 IF outcome NOT IN ('hero_won','enemy_won','draw') OR outcome IS NULL THEN RAISE EXCEPTION 'adventure_not_finished'; END IF;
 SELECT * INTO e FROM territory_private.combat_encounters_v1 WHERE encounter_id=s.encounter_id FOR SHARE;
 SELECT * INTO r FROM territory_private.adventure_rewards_v1 WHERE encounter_id=s.encounter_id AND enabled FOR SHARE;
 IF NOT FOUND OR r.items <> '[]'::jsonb OR e.stage<>r.stage OR e.mode<>(CASE WHEN r.stage%10=0 THEN 'boss' ELSE 'pve' END)
   THEN RAISE EXCEPTION 'adventure_reward_not_ready'; END IF;
 INSERT INTO territory_private.adventure_progress_v1(player_id) VALUES(p_player) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM territory_private.adventure_progress_v1 WHERE player_id=p_player AND r.stage=unlocked_stage AND completed_stage<r.stage FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'adventure_stage_locked'; END IF;
 IF outcome='hero_won' THEN
   -- The player row was locked above. A browser-side equipment or stat change
   -- during the fight must not be silently trusted by reward settlement.
   IF NOT territory_private.combat_profile_is_current_v1(p_player)
     THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
   before_projection:=territory_private.combat_source_projection_v1(p);
   old_level:=p.level;
   old_updated_at:=p.updated_at;
   IF old_updated_at IS NULL THEN RAISE EXCEPTION 'adventure_save_needs_reconciliation'; END IF;
   st:=p.game_state; stats:=st#>'{player,stats}';
   IF jsonb_typeof(st->'player') IS DISTINCT FROM 'object' OR jsonb_typeof(stats) IS DISTINCT FROM 'object'
     OR (st#>>'{player,gold}')::bigint IS DISTINCT FROM p.gold::bigint
     OR (st#>>'{player,xp}')::bigint IS DISTINCT FROM p.xp::bigint
     OR (st#>>'{player,level}')::int IS DISTINCT FROM p.level
     OR (st#>>'{player,maxEnergy}')::int IS DISTINCT FROM p.max_energy
     OR p.level NOT BETWEEN 1 AND 100 OR p.xp<0 OR p.gold<0
     OR coalesce((stats->>'maxHp')::int,0) <=0 OR coalesce((stats->>'attack')::int,-1)<0 OR coalesce((stats->>'defense')::int,-1)<0
     OR (st#>>'{player,xpToNext}')::bigint IS DISTINCT FROM (CASE WHEN p.level>=100 THEN 0 ELSE floor(floor(100*power(1.15::double precision,p.level-1))*(CASE WHEN p.level>=83 THEN 3::double precision+0.12::double precision*(p.level-83) ELSE 1 END))::bigint END)
     THEN RAISE EXCEPTION 'adventure_save_needs_reconciliation'; END IF;
   IF p.gold::bigint+r.gold>2147483647 THEN RAISE EXCEPTION 'adventure_wallet_limit'; END IF;
   lv:=p.level; v_max_energy:=p.max_energy; balance:=p.xp::bigint+r.xp;
   WHILE lv<100 LOOP
     threshold:=coalesce((st#>>'{player,xpToNext}')::bigint,0);
     IF threshold<=0 THEN threshold:=floor(floor(100*power(1.15::double precision,lv-1))*(CASE WHEN lv>=83 THEN 3::double precision+0.12::double precision*(lv-83) ELSE 1 END))::bigint; END IF;
     EXIT WHEN balance<threshold;
     balance:=balance-threshold; lv:=lv+1;
     threshold:=CASE WHEN lv>=100 THEN 0 ELSE floor(floor(100*power(1.15::double precision,lv-1))*(CASE WHEN lv>=83 THEN 3::double precision+0.12::double precision*(lv-83) ELSE 1 END))::bigint END;
     st:=jsonb_set(st,'{player,xpToNext}',to_jsonb(threshold));
     stats:=jsonb_set(stats,'{maxHp}',to_jsonb((stats->>'maxHp')::int+20));
     stats:=jsonb_set(stats,'{hp}',stats->'maxHp');
     stats:=jsonb_set(stats,'{attack}',to_jsonb((stats->>'attack')::int+5));
     stats:=jsonb_set(stats,'{defense}',to_jsonb((stats->>'defense')::int+2));
     v_max_energy:=v_max_energy+1;
   END LOOP;
   IF lv>=100 THEN balance:=0; st:=jsonb_set(st,'{player,xpToNext}','0'::jsonb); END IF;
   IF balance>2147483647 THEN RAISE EXCEPTION 'adventure_xp_limit'; END IF;
   st:=jsonb_set(st,'{player,gold}',to_jsonb(p.gold+r.gold));
   st:=jsonb_set(st,'{player,xp}',to_jsonb(balance));
   st:=jsonb_set(st,'{player,level}',to_jsonb(lv));
   st:=jsonb_set(st,'{player,maxEnergy}',to_jsonb(v_max_energy));
   st:=jsonb_set(st,'{player,stats}',stats);
   IF lv>p.level AND jsonb_typeof(st->'followers')='array' THEN
     SELECT coalesce(jsonb_agg(CASE WHEN (f.value->>'id') IN ('follower_1','follower_2','follower_3','follower_4','follower_5')
       AND lv >= (CASE f.value->>'id' WHEN 'follower_1' THEN 3 WHEN 'follower_2' THEN 8 WHEN 'follower_3' THEN 15 WHEN 'follower_4' THEN 25 ELSE 40 END)
       THEN jsonb_set(f.value,'{unlocked}','true'::jsonb) ELSE f.value END ORDER BY f.ordinality),'[]'::jsonb) INTO followers
       FROM jsonb_array_elements(st->'followers') WITH ORDINALITY f(value,ordinality);
     st:=jsonb_set(st,'{followers}',followers);
   END IF;
   UPDATE public.players SET game_state=st,gold=p.gold+r.gold,xp=balance::integer,level=lv,max_energy=v_max_energy,
     updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 millisecond')
     WHERE id=p_player RETURNING * INTO p;
   IF p.updated_at IS NULL OR p.updated_at<=old_updated_at THEN RAISE EXCEPTION 'adventure_save_needs_reconciliation'; END IF;
   PERFORM territory_private.combat_refresh_reward_v1(p_player,before_projection,old_level);
   UPDATE territory_private.adventure_progress_v1 SET completed_stage=greatest(completed_stage,r.stage),
     unlocked_stage=least(100,greatest(completed_stage,r.stage)+1) WHERE player_id=p_player;
 END IF;
 SELECT jsonb_build_object('success',true,'session_id',p_session,'outcome',outcome,'stage',r.stage,
   'reward',jsonb_build_object('gold',CASE WHEN outcome='hero_won' THEN r.gold ELSE 0 END,
     'xp',CASE WHEN outcome='hero_won' THEN r.xp ELSE 0 END,'items','[]'::jsonb),
   'completed_stage',completed_stage,'unlocked_stage',unlocked_stage,
   'updated_at',p.updated_at,'wallet_gold',p.gold,'wallet_gems',p.gems,'game_state',p.game_state)
   INTO receipt FROM territory_private.adventure_progress_v1 WHERE player_id=p_player;
 INSERT INTO territory_private.adventure_settlements_v1(session_id,player_id,stage,outcome,receipt)
   VALUES(p_session,p_player,r.stage,outcome,receipt);
 RETURN receipt;
END $function$;

CREATE OR REPLACE FUNCTION territory_private.combat_refresh_reward_v1(p_player uuid, p_before jsonb, p_old_level integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE p public.players%ROWTYPE; h territory_private.combat_profiles_v1%ROWTYPE;
 src territory_private.combat_profile_sources_v1%ROWTYPE; after_projection jsonb;
 expected_stats jsonb; v_fighter jsonb; levels integer; col text; inc integer;
BEGIN
 SELECT * INTO p FROM public.players WHERE id=p_player FOR UPDATE;
 SELECT * INTO h FROM territory_private.combat_profiles_v1 WHERE player_id=p_player FOR UPDATE;
 SELECT * INTO src FROM territory_private.combat_profile_sources_v1 WHERE player_id=p_player FOR UPDATE;
 IF NOT FOUND OR src.projection IS DISTINCT FROM p_before OR NOT h.verified
    OR h.approval_reference IS DISTINCT FROM src.attestation_id::text
    OR h.fighter-'loadout' IS DISTINCT FROM src.fighter
    OR NOT EXISTS(SELECT 1 FROM territory_private.combat_profile_attestations_v1 a
       WHERE a.attestation_id=src.attestation_id AND a.player_id=p_player AND a.revoked_at IS NULL)
    OR (p_before->>'level')::int IS DISTINCT FROM p_old_level
    OR (h.fighter#>>'{ownership,heroLevel}')::int IS DISTINCT FROM p_old_level
 THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
 levels:=p.level-p_old_level;
 IF levels<0 OR p.level>100 THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
 after_projection:=territory_private.combat_source_projection_v1(p);
 IF after_projection->'equipped' IS DISTINCT FROM p_before->'equipped'
    OR after_projection->'inventory' IS DISTINCT FROM p_before->'inventory'
 THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
 expected_stats:=p_before->'stats';
 IF levels>0 THEN
   expected_stats:=jsonb_set(expected_stats,'{maxHp}',to_jsonb((expected_stats->>'maxHp')::numeric+20*levels));
   expected_stats:=jsonb_set(expected_stats,'{hp}',expected_stats->'maxHp');
   expected_stats:=jsonb_set(expected_stats,'{attack}',to_jsonb((expected_stats->>'attack')::numeric+5*levels));
   expected_stats:=jsonb_set(expected_stats,'{defense}',to_jsonb((expected_stats->>'defense')::numeric+2*levels));
 END IF;
 IF after_projection->'stats' IS DISTINCT FROM expected_stats THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
 FOREACH col IN ARRAY ARRAY['attack','defense','max_hp','crit_chance'] LOOP
   inc:=CASE col WHEN 'attack' THEN 5 WHEN 'defense' THEN 2 WHEN 'max_hp' THEN 20 ELSE 0 END;
   IF p_before->col='null'::jsonb THEN
     IF after_projection->col IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
   ELSIF jsonb_typeof(p_before->col)<>'number' OR jsonb_typeof(after_projection->col)<>'number'
      OR (after_projection->>col)::numeric IS DISTINCT FROM (p_before->>col)::numeric + levels*inc
   THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
 END LOOP;
 v_fighter:=h.fighter;
 IF levels>0 THEN
   v_fighter:=jsonb_set(v_fighter,'{stats,maxHp}',to_jsonb((v_fighter#>>'{stats,maxHp}')::numeric+20*levels));
   v_fighter:=jsonb_set(v_fighter,'{stats,hp}',v_fighter#>'{stats,maxHp}');
   v_fighter:=jsonb_set(v_fighter,'{stats,attack}',to_jsonb((v_fighter#>>'{stats,attack}')::numeric+5*levels));
   v_fighter:=jsonb_set(v_fighter,'{stats,defense}',to_jsonb((v_fighter#>>'{stats,defense}')::numeric+2*levels));
   v_fighter:=jsonb_set(v_fighter,'{ownership,heroLevel}',to_jsonb(p.level));
 END IF;
 UPDATE territory_private.combat_profiles_v1 SET fighter=v_fighter,version=version+1,updated_at=clock_timestamp() WHERE player_id=p_player;
 UPDATE territory_private.combat_profile_sources_v1 SET projection=after_projection,fighter=v_fighter-'loadout' WHERE player_id=p_player;
END $function$;

CREATE OR REPLACE FUNCTION public.territory_adventure_progress_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid:=auth.uid(); completed integer; unlocked integer; stones integer;
BEGIN
  IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT coalesce(banned,false))
    THEN RAISE EXCEPTION 'adventure_account_unavailable'; END IF;
  stones:=territory_private.dark_stone_touch_v1(u);
  SELECT completed_stage,unlocked_stage INTO completed,unlocked
    FROM territory_private.adventure_progress_v1 WHERE player_id=u;
  RETURN jsonb_build_object('completed_stage',coalesce(completed,0),
    'unlocked_stage',coalesce(unlocked,1),'dark_stones',stones);
END $function$;

CREATE OR REPLACE FUNCTION public.territory_combat_commit_v1(p_player uuid, p_request jsonb, p_context jsonb, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE c territory_private.combat_config_v1%ROWTYPE;
  h territory_private.combat_profiles_v1%ROWTYPE;
  e territory_private.combat_encounters_v1%ROWTYPE;
  s territory_private.combat_sessions_v1%ROWTYPE;
  r territory_private.combat_operations_v1%ROWTYPE;
  receipt jsonb; settlement jsonb; a text:=p_request->>'action';
  wallet public.players%ROWTYPE;
  available_stones bigint;
BEGIN
  -- Serialize with existing player saves before taking any combat-specific lock.
  PERFORM 1 FROM public.players WHERE id=p_player AND NOT coalesce(banned,false) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'combat_account_unavailable'; END IF;
  SELECT * INTO h FROM territory_private.combat_profiles_v1 WHERE player_id=p_player FOR UPDATE;
  IF NOT FOUND OR NOT h.verified THEN RAISE EXCEPTION 'combat_profile_not_verified'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=p_player AND NOT coalesce(banned,false))
    THEN RAISE EXCEPTION 'combat_account_unavailable'; END IF;
  SELECT * INTO r FROM territory_private.combat_operations_v1
    WHERE player_id=p_player AND operation_id=(p_request->>'operationId')::uuid;
  IF FOUND THEN
    IF r.request<>p_request THEN RAISE EXCEPTION 'combat_operation_reused'; END IF;
    RETURN r.receipt;
  END IF;
  SELECT * INTO c FROM territory_private.combat_config_v1 WHERE id FOR SHARE;
  IF NOT c.enabled OR c.approval_reference IS NULL THEN RAISE EXCEPTION 'combat_not_enabled'; END IF;
  IF c.version<>(p_context->>'configVersion')::integer OR h.version<>(p_context->>'profileVersion')::integer
    THEN RAISE EXCEPTION 'combat_revision_conflict'; END IF;
  IF a IN ('start','loadout') AND NOT territory_private.combat_profile_is_current_v1(p_player)
    THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
  IF a='loadout' THEN
    IF h.version<>(p_request->>'revision')::integer OR p_result->'loadout' IS DISTINCT FROM p_request->'loadout'
      THEN RAISE EXCEPTION 'combat_revision_conflict'; END IF;
    UPDATE territory_private.combat_profiles_v1 SET fighter=jsonb_set(fighter,'{loadout}',p_result->'loadout'),
      version=version+1,updated_at=clock_timestamp() WHERE player_id=p_player;
    receipt:=jsonb_build_object('success',true,'profile_revision',h.version+1,'loadout',p_result->'loadout');
  ELSIF a='start' THEN
    IF NOT c.settlement_ready THEN RAISE EXCEPTION 'combat_settlement_not_ready'; END IF;
    SELECT * INTO e FROM territory_private.combat_encounters_v1 WHERE encounter_id=p_request->>'encounterId' FOR SHARE;
    IF NOT FOUND OR NOT e.enabled OR e.version<>(p_context->'encounter'->>'version')::integer
      THEN RAISE EXCEPTION 'combat_encounter_not_available'; END IF;
    IF e.mode NOT IN ('pve','boss') THEN RAISE EXCEPTION 'combat_encounter_not_available'; END IF;
    PERFORM territory_private.adventure_check_start_v1(p_player,e.encounter_id);
    IF EXISTS(SELECT 1 FROM territory_private.combat_sessions_v1 WHERE player_id=p_player AND state->>'status'='fighting')
      THEN RAISE EXCEPTION 'combat_active_session_exists'; END IF;
    -- The real V1 PvE consumes one battle stone per accepted start. Debit
    -- only after all stage/profile/session checks, inside the same operation
    -- transaction as the session and its durable replay receipt.
    SELECT * INTO wallet FROM public.players WHERE id=p_player FOR UPDATE;
    
    PERFORM territory_private.dark_stone_take_v1(p_player);
    SELECT * INTO wallet FROM public.players WHERE id=p_player FOR UPDATE;
    IF jsonb_typeof(wallet.game_state->'battleStones') IS DISTINCT FROM 'number'
      OR (wallet.game_state->>'battleStones')::numeric < 0
      OR (wallet.game_state->>'battleStones')::numeric > 2147483647
      OR trunc((wallet.game_state->>'battleStones')::numeric) <> (wallet.game_state->>'battleStones')::numeric
      THEN RAISE EXCEPTION 'combat_invalid_battle_stones'; END IF;
    available_stones := (wallet.game_state->>'battleStones')::bigint;
    UPDATE public.players SET updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond')
      WHERE id=p_player RETURNING * INTO wallet;
    -- If a live trigger unexpectedly alters combat-relevant fields, fail
    -- the entire transaction instead of spending currency with stale stats.
    IF NOT territory_private.combat_profile_is_current_v1(p_player)
      THEN RAISE EXCEPTION 'combat_profile_needs_reconciliation'; END IF;
    INSERT INTO territory_private.combat_sessions_v1(player_id,encounter_id,state,cursor_ms)
      VALUES(p_player,e.encounter_id,p_result->'state',(p_result->>'cursorMs')::bigint) RETURNING * INTO s;
  ELSIF a='advance' THEN
    SELECT * INTO s FROM territory_private.combat_sessions_v1 WHERE session_id=(p_request->>'sessionId')::uuid AND player_id=p_player FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'combat_session_not_found'; END IF;
    IF s.revision<>(p_request->>'revision')::integer OR s.revision<>(p_context->'session'->>'revision')::integer
      THEN RAISE EXCEPTION 'combat_revision_conflict'; END IF;
    IF s.state->>'status'<>'fighting' THEN RAISE EXCEPTION 'combat_already_finished'; END IF;
    IF (p_result->>'cursorMs')::bigint<s.cursor_ms OR (p_result->>'cursorMs')::bigint>(p_context->>'serverMs')::bigint
      THEN RAISE EXCEPTION 'combat_invalid_clock'; END IF;
    UPDATE territory_private.combat_sessions_v1 SET state=p_result->'state',revision=revision+1,
      cursor_ms=(p_result->>'cursorMs')::bigint WHERE session_id=s.session_id RETURNING * INTO s;
    IF s.state->>'status'<>'fighting' THEN
      INSERT INTO territory_private.combat_outcomes_v1(session_id,player_id,mode,encounter_id,outcome)
        VALUES(s.session_id,p_player,s.state->'input'->>'mode',s.encounter_id,s.state->>'status') ON CONFLICT DO NOTHING;
      settlement:=territory_private.adventure_settle_v1(p_player,s.session_id);
    END IF;
  ELSE RAISE EXCEPTION 'combat_invalid_action'; END IF;
  IF a<>'loadout' THEN
    receipt:=jsonb_build_object('success',true,'session_id',s.session_id,'revision',s.revision,
      'state',s.state,'events',coalesce(p_result->'events','[]'::jsonb),
      'rewards_claimed',coalesce(settlement->>'outcome'='hero_won',false),'settlement',settlement);
    IF a='start' THEN
      receipt:=receipt||jsonb_build_object('start_save',jsonb_build_object(
        'success',true,'session_id',s.session_id,'updated_at',wallet.updated_at,
        'wallet_gold',wallet.gold,'wallet_gems',wallet.gems,
        'battle_stones',available_stones,'game_state',wallet.game_state));
    END IF;
  END IF;
  INSERT INTO territory_private.combat_operations_v1(player_id,operation_id,request,receipt)
    VALUES(p_player,(p_request->>'operationId')::uuid,p_request,receipt);
  RETURN receipt;
END $function$;


DO $c1_phase_b_post$
BEGIN
 IF md5(pg_get_functiondef(to_regprocedure('public.territory_combat_commit_v1(uuid,jsonb,jsonb,jsonb)'))) IS DISTINCT FROM 'aff68eb71dd065e460829a592fa5eea7'
   OR md5(pg_get_functiondef(to_regprocedure('territory_private.adventure_settle_v1(uuid,uuid)'))) IS DISTINCT FROM '058a19289423a5c4e02b91a98191ba03'
   OR md5(pg_get_functiondef(to_regprocedure('territory_private.combat_refresh_reward_v1(uuid,jsonb,integer)'))) IS DISTINCT FROM '4da08c91d5bdd4c6b8b5d83a45dcfa26'
   OR md5(pg_get_functiondef(to_regprocedure('public.territory_adventure_progress_v1()'))) IS DISTINCT FROM 'ef9fb43c85eb220540dd79d7a87b99e2'
   THEN RAISE EXCEPTION 'C1 phase B restore verification failed'; END IF;
END $c1_phase_b_post$;
COMMIT;
-- No tables, receipts, wallet rows, player saves or canary entries are deleted.
