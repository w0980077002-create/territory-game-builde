
-- Owner-directed 2026-11-14: Dark Cave must not require operator review
-- after level-up, equipment swap or forge. No player save/wallet mutations.
CREATE OR REPLACE FUNCTION territory_private.combat_profile_is_current_v1(p_player uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $body$
  -- Backward-compatible helper used by start and settlement. A verified
  -- server fighter exists; gear snapshots no longer gate PvE.
  SELECT EXISTS(SELECT 1 FROM public.players p
     JOIN territory_private.combat_profiles_v1 h ON h.player_id=p.id
     WHERE p.id=p_player AND NOT coalesce(p.banned,false) AND h.verified);
$body$;

CREATE OR REPLACE FUNCTION territory_private.prepare_combat_profile_v1(p_player uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $body$
DECLARE
 p public.players%ROWTYPE;
 h territory_private.combat_profiles_v1%ROWTYPE;
 v_fighter jsonb;
 v_stats jsonb;
 v_legacy text[];
 v_exists boolean;
 v_derived jsonb;
BEGIN
 SELECT * INTO p FROM public.players WHERE id=p_player FOR UPDATE;
 IF NOT FOUND OR coalesce(p.banned,false) THEN RAISE EXCEPTION 'combat_account_unavailable'; END IF;
 SELECT * INTO h FROM territory_private.combat_profiles_v1 WHERE player_id=p_player FOR UPDATE;
 v_exists:=FOUND;
 IF v_exists AND NOT h.verified THEN RAISE EXCEPTION 'combat_profile_not_verified'; END IF;
 IF EXISTS(SELECT 1 FROM territory_private.combat_sessions_v1 s
       WHERE s.player_id=p_player AND s.state->>'status'='fighting') THEN
  IF NOT v_exists THEN RAISE EXCEPTION 'combat_profile_not_verified'; END IF;
  RETURN jsonb_build_object('status','ready','profile_revision',h.version,'pinned_session',true);
 END IF;
 -- Existing player save trigger is authoritative for level and gear-derived
 -- numerical columns. Only validate the canonical values, never item identity
 -- or equality with an obsolete manual snapshot.
 IF p.level NOT BETWEEN 1 AND 100
  OR jsonb_typeof(p.game_state#>'{player,stats}')<>'object'
  OR jsonb_typeof(p.game_state#>'{player,equipped}')<>'object'
  OR p.game_state#>>'{player,level}' IS DISTINCT FROM p.level::text
  OR p.game_state#>>'{player,stats,attack}' IS DISTINCT FROM (20+5*(p.level-1))::text
  OR p.game_state#>>'{player,stats,defense}' IS DISTINCT FROM (5+2*(p.level-1))::text
  OR p.game_state#>>'{player,stats,maxHp}' IS DISTINCT FROM (100+20*(p.level-1))::text
  OR p.game_state#>>'{player,stats,hp}' IS DISTINCT FROM (100+20*(p.level-1))::text
  OR p.game_state#>>'{player,stats,critChance}' IS DISTINCT FROM '5'
  OR p.attack NOT BETWEEN 1 AND 1000000000
  OR p.defense NOT BETWEEN 0 AND 1000000000
  OR p.max_hp NOT BETWEEN 1 AND 1000000000
  OR p.crit_chance NOT BETWEEN 0 AND 75
 THEN RAISE EXCEPTION 'combat_invalid_profile'; END IF;
 v_derived:=public.territory_gear_recompute_columns_v4(p.game_state);
 IF NOT EXISTS(SELECT 1 FROM territory_private.owner_test_bots_v1 b WHERE b.player_id=p_player)
  AND (p.attack IS DISTINCT FROM (v_derived->>'attack')::int
    OR p.defense IS DISTINCT FROM (v_derived->>'defense')::int
    OR p.max_hp IS DISTINCT FROM (v_derived->>'max_hp')::int
    OR p.crit_chance IS DISTINCT FROM (v_derived->>'crit_chance')::int)
 THEN RAISE EXCEPTION 'combat_invalid_profile'; END IF;
 v_stats:=coalesce(CASE WHEN v_exists AND jsonb_typeof(h.fighter->'stats')='object'
    THEN h.fighter->'stats' END,
    '{"blockChance":0,"dodgeChance":0,"critMultiplier":1.5}'::jsonb)
   || jsonb_build_object('hp',p.max_hp,'maxHp',p.max_hp,
     'attack',p.attack,'defense',p.defense,'critChance',p.crit_chance::numeric/100);
 IF v_exists THEN
   v_fighter:=jsonb_set(h.fighter,'{stats}',v_stats);
   v_fighter:=jsonb_set(v_fighter,'{ownership,heroLevel}',to_jsonb(p.level),true);
 ELSE
   v_fighter:=jsonb_build_object('stats',v_stats,
     'ownership',jsonb_build_object('heroLevel',p.level,'runes','{}'::jsonb,
       'skills','{}'::jsonb,'passives','{}'::jsonb),
     'loadout',jsonb_build_object('skills','[]'::jsonb,'passives','[]'::jsonb));
 END IF;
 -- Gear ids kept only as legacy informational metadata, never a gate.
 v_legacy:=territory_private.combat_legacy_equipped_ids_v1(p.game_state);
 IF v_exists THEN
  IF v_fighter IS DISTINCT FROM h.fighter OR v_legacy IS DISTINCT FROM h.legacy_equipped_ids THEN
   UPDATE territory_private.combat_profiles_v1 AS cp
   SET fighter=v_fighter,legacy_equipped_ids=v_legacy,
       version=cp.version+1,updated_at=clock_timestamp()
   WHERE cp.player_id=p_player RETURNING * INTO h;
  END IF;
 ELSE
  INSERT INTO territory_private.combat_profiles_v1(
   player_id,verified,fighter,equipped_item_ids,legacy_equipped_ids,approval_reference)
  VALUES(p_player,true,v_fighter,ARRAY[]::uuid[],v_legacy,'auto-pve-combat-20261114')
  RETURNING * INTO h;
 END IF;
 DELETE FROM territory_private.combat_profile_reconciliation_v1 WHERE player_id=p_player;
 RETURN jsonb_build_object('status','ready','profile_revision',h.version);
END $body$;

CREATE OR REPLACE FUNCTION public.territory_combat_context_v1(p_player uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE c territory_private.combat_config_v1%ROWTYPE;
  h territory_private.combat_profiles_v1%ROWTYPE;
  e territory_private.combat_encounters_v1%ROWTYPE;
  d territory_private.combat_profiles_v1%ROWTYPE;
  s territory_private.combat_sessions_v1%ROWTYPE;
  r territory_private.combat_operations_v1%ROWTYPE;
  result jsonb; projected_stats jsonb; settlement jsonb;
BEGIN
  IF p_player IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=p_player AND NOT coalesce(banned,false))
    THEN RAISE EXCEPTION 'combat_account_unavailable'; END IF;
  IF p_request->>'action'<>'resume' THEN
    SELECT * INTO r FROM territory_private.combat_operations_v1
      WHERE player_id=p_player AND operation_id=(p_request->>'operationId')::uuid;
    IF FOUND THEN
      IF r.request<>p_request THEN RAISE EXCEPTION 'combat_operation_reused'; END IF;
      RETURN jsonb_build_object('replay',r.receipt);
    END IF;
  END IF;
  SELECT * INTO c FROM territory_private.combat_config_v1 WHERE id;
  -- No manual gear review on PvE start: refresh from server totals.
  IF p_request->>'action' IN ('start','loadout') THEN
    PERFORM territory_private.prepare_combat_profile_v1(p_player);
  END IF;
  SELECT * INTO h FROM territory_private.combat_profiles_v1 WHERE player_id=p_player;
  IF NOT FOUND OR NOT h.verified THEN RAISE EXCEPTION 'combat_profile_not_verified'; END IF;
  result:=jsonb_build_object('serverMs',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,
    'configVersion',c.version,'profileVersion',h.version,'catalog',c.catalog,'rules',c.rules,'hero',h.fighter);
  IF p_request->>'action' IN('advance','resume') THEN
    SELECT * INTO s FROM territory_private.combat_sessions_v1
      WHERE session_id=(p_request->>'sessionId')::uuid AND player_id=p_player;
    IF NOT FOUND THEN RAISE EXCEPTION 'combat_session_not_found'; END IF;
    result:=result||jsonb_build_object('session',jsonb_build_object('id',s.session_id,
      'revision',s.revision,'cursorMs',s.cursor_ms,'state',s.state));
    IF s.state->>'status'<>'fighting' THEN
      SELECT receipt INTO settlement FROM territory_private.adventure_settlements_v1
        WHERE session_id=s.session_id AND player_id=p_player;
      result:=result||jsonb_build_object('settlement',settlement);
    END IF;
  END IF;
  IF p_request->>'action'='resume' THEN RETURN result; END IF;
  IF NOT c.enabled OR c.approval_reference IS NULL THEN RAISE EXCEPTION 'combat_not_enabled'; END IF;
  IF p_request->>'action'='start' THEN
    IF NOT c.settlement_ready THEN RAISE EXCEPTION 'combat_settlement_not_ready'; END IF;
    SELECT * INTO e FROM territory_private.combat_encounters_v1 WHERE encounter_id=p_request->>'encounterId' AND enabled;
    IF NOT FOUND THEN RAISE EXCEPTION 'combat_encounter_not_available'; END IF;
    IF e.mode NOT IN ('pve','boss') THEN RAISE EXCEPTION 'combat_encounter_not_available'; END IF;
    IF e.mode='pvp' THEN
      IF e.enemy_player_id=p_player THEN RAISE EXCEPTION 'combat_self_battle'; END IF;
      SELECT * INTO d FROM territory_private.combat_profiles_v1 WHERE player_id=e.enemy_player_id AND verified;
      IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=e.enemy_player_id AND NOT coalesce(banned,false))
        THEN RAISE EXCEPTION 'combat_opponent_not_verified'; END IF;
      e.enemy:=d.fighter;
      IF to_regprocedure('territory_private.v1_gem_equipped_stats(uuid,jsonb,uuid[])') IS NOT NULL THEN
        EXECUTE 'SELECT territory_private.v1_gem_equipped_stats($1,$2,$3)' INTO projected_stats
          USING e.enemy_player_id,e.enemy->'stats',d.equipped_item_ids;
        e.enemy:=jsonb_set(e.enemy,'{stats}',projected_stats);
      END IF;
      IF to_regprocedure('territory_private.vip_combat_stats_v1(uuid,jsonb)') IS NOT NULL THEN
        EXECUTE 'SELECT territory_private.vip_combat_stats_v1($1,$2)' INTO projected_stats
          USING e.enemy_player_id,e.enemy->'stats';
        e.enemy:=jsonb_set(e.enemy,'{stats}',projected_stats);
      END IF;
    END IF;
    -- VIP is applied once to the authoritative unboosted projection, then pinned
    -- in the session. Resuming/advancing never reapplies it to boosted stats.
    IF to_regprocedure('territory_private.v1_gem_equipped_stats(uuid,jsonb,uuid[])') IS NOT NULL THEN
      EXECUTE 'SELECT territory_private.v1_gem_equipped_stats($1,$2,$3)' INTO projected_stats
        USING p_player,result->'hero'->'stats',h.equipped_item_ids;
      result:=jsonb_set(result,'{hero,stats}',projected_stats);
    END IF;
    IF to_regprocedure('territory_private.vip_combat_stats_v1(uuid,jsonb)') IS NOT NULL THEN
      EXECUTE 'SELECT territory_private.vip_combat_stats_v1($1,$2)' INTO projected_stats
        USING p_player,result->'hero'->'stats';
      result:=jsonb_set(result,'{hero,stats}',projected_stats);
    END IF;
    result:=result||jsonb_build_object('encounter',jsonb_build_object('id',e.encounter_id,'version',e.version,
      'stage',e.stage,'mode',e.mode,'enemy',e.enemy));
  END IF;
  RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION territory_private.combat_refresh_reward_v1(
 p_player uuid,p_before jsonb,p_old_level integer)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $body$
DECLARE p public.players%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.players WHERE id=p_player FOR UPDATE;
 IF NOT FOUND OR coalesce(p.banned,false)
   OR (p_before->>'level')::int IS DISTINCT FROM p_old_level
   OR p.level<p_old_level OR p.level>100
 THEN RAISE EXCEPTION 'combat_invalid_profile'; END IF;
 -- Server settlement already validated the award. Recompute only combat totals.
 PERFORM territory_private.prepare_combat_profile_v1(p_player);
END $body$;

DELETE FROM territory_private.combat_profile_reconciliation_v1;
