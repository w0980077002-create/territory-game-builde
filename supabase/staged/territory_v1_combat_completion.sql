-- REVIEW-ONLY. No production execution. Existing saves/wallets/arena remain intact.
-- Inputs are approved server projections, NEVER copied from a writable game_state.
BEGIN;
CREATE SCHEMA IF NOT EXISTS territory_private;
REVOKE ALL ON SCHEMA territory_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS territory_private.combat_config_v1 (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  catalog jsonb NOT NULL DEFAULT '{"skills":[],"runes":[],"passives":[]}',
  rules jsonb NOT NULL DEFAULT '{}',
  approval_reference text
);
INSERT INTO territory_private.combat_config_v1(id) VALUES(true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS territory_private.combat_profiles_v1 (
  player_id uuid PRIMARY KEY REFERENCES public.players(id),
  version integer NOT NULL DEFAULT 0 CHECK(version>=0),
  verified boolean NOT NULL DEFAULT false,
  fighter jsonb NOT NULL CHECK(jsonb_typeof(fighter)='object'),
  equipped_item_ids uuid[] NOT NULL DEFAULT '{}',
  approval_reference text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS territory_private.combat_encounters_v1 (
  encounter_id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL CHECK(mode IN('pve','boss','pvp')),
  stage integer NOT NULL CHECK(stage>0),
  enemy jsonb NOT NULL DEFAULT '{}',
  -- PvP snapshots use the same verified profile as the defender, never a client.
  enemy_player_id uuid REFERENCES public.players(id),
  approval_reference text NOT NULL,
  CHECK((mode='pvp')=(enemy_player_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS territory_private.combat_sessions_v1 (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id),
  encounter_id text NOT NULL REFERENCES territory_private.combat_encounters_v1,
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  state jsonb NOT NULL,
  cursor_ms bigint NOT NULL CHECK(cursor_ms>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS combat_one_active_session_v1
  ON territory_private.combat_sessions_v1(player_id) WHERE state->>'status'='fighting';
CREATE INDEX IF NOT EXISTS combat_session_owner_v1 ON territory_private.combat_sessions_v1(player_id,session_id);
CREATE TABLE IF NOT EXISTS territory_private.combat_operations_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id),
  operation_id uuid NOT NULL,
  request jsonb NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(player_id,operation_id)
);
-- A verified outcome is an integration event, not an automatic currency grant.
CREATE TABLE IF NOT EXISTS territory_private.combat_outcomes_v1 (
  session_id uuid PRIMARY KEY REFERENCES territory_private.combat_sessions_v1,
  player_id uuid NOT NULL REFERENCES public.players(id),
  mode text NOT NULL,
  encounter_id text NOT NULL,
  outcome text NOT NULL CHECK(outcome IN('hero_won','enemy_won','draw')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE territory_private.combat_config_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.combat_profiles_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.combat_encounters_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.combat_sessions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.combat_operations_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.combat_outcomes_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.combat_config_v1,territory_private.combat_profiles_v1,
  territory_private.combat_encounters_v1,territory_private.combat_sessions_v1,
  territory_private.combat_operations_v1,territory_private.combat_outcomes_v1 FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA territory_private TO service_role;
GRANT SELECT,INSERT,UPDATE ON territory_private.combat_config_v1,territory_private.combat_profiles_v1,
  territory_private.combat_encounters_v1,territory_private.combat_sessions_v1,
  territory_private.combat_operations_v1,territory_private.combat_outcomes_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.territory_combat_context_v1(p_player uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c territory_private.combat_config_v1%ROWTYPE;
  h territory_private.combat_profiles_v1%ROWTYPE;
  e territory_private.combat_encounters_v1%ROWTYPE;
  d territory_private.combat_profiles_v1%ROWTYPE;
  s territory_private.combat_sessions_v1%ROWTYPE;
  r territory_private.combat_operations_v1%ROWTYPE;
  result jsonb; projected_stats jsonb;
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
  END IF;
  IF p_request->>'action'='resume' THEN RETURN result; END IF;
  IF NOT c.enabled OR c.approval_reference IS NULL THEN RAISE EXCEPTION 'combat_not_enabled'; END IF;
  IF p_request->>'action'='start' THEN
    SELECT * INTO e FROM territory_private.combat_encounters_v1 WHERE encounter_id=p_request->>'encounterId' AND enabled;
    IF NOT FOUND THEN RAISE EXCEPTION 'combat_encounter_not_available'; END IF;
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
END $$;

CREATE OR REPLACE FUNCTION public.territory_combat_commit_v1(p_player uuid,p_request jsonb,p_context jsonb,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c territory_private.combat_config_v1%ROWTYPE;
  h territory_private.combat_profiles_v1%ROWTYPE;
  e territory_private.combat_encounters_v1%ROWTYPE;
  s territory_private.combat_sessions_v1%ROWTYPE;
  r territory_private.combat_operations_v1%ROWTYPE;
  receipt jsonb; a text:=p_request->>'action';
BEGIN
  -- One account lock serializes different sessions, build changes and request IDs.
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
  IF a='loadout' THEN
    IF h.version<>(p_request->>'revision')::integer OR p_result->'loadout' IS DISTINCT FROM p_request->'loadout'
      THEN RAISE EXCEPTION 'combat_revision_conflict'; END IF;
    UPDATE territory_private.combat_profiles_v1 SET fighter=jsonb_set(fighter,'{loadout}',p_result->'loadout'),
      version=version+1,updated_at=clock_timestamp() WHERE player_id=p_player;
    receipt:=jsonb_build_object('success',true,'profile_revision',h.version+1,'loadout',p_result->'loadout');
  ELSIF a='start' THEN
    SELECT * INTO e FROM territory_private.combat_encounters_v1 WHERE encounter_id=p_request->>'encounterId' FOR SHARE;
    IF NOT FOUND OR NOT e.enabled OR e.version<>(p_context->'encounter'->>'version')::integer
      THEN RAISE EXCEPTION 'combat_encounter_not_available'; END IF;
    IF EXISTS(SELECT 1 FROM territory_private.combat_sessions_v1 WHERE player_id=p_player AND state->>'status'='fighting')
      THEN RAISE EXCEPTION 'combat_active_session_exists'; END IF;
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
    END IF;
  ELSE RAISE EXCEPTION 'combat_invalid_action'; END IF;
  IF a<>'loadout' THEN
    receipt:=jsonb_build_object('success',true,'session_id',s.session_id,'revision',s.revision,
      'state',s.state,'events',coalesce(p_result->'events','[]'::jsonb),'rewards_claimed',false);
  END IF;
  INSERT INTO territory_private.combat_operations_v1(player_id,operation_id,request,receipt)
    VALUES(p_player,(p_request->>'operationId')::uuid,p_request,receipt);
  RETURN receipt;
END $$;

REVOKE ALL ON FUNCTION public.territory_combat_context_v1(uuid,jsonb),
  public.territory_combat_commit_v1(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_combat_context_v1(uuid,jsonb),
  public.territory_combat_commit_v1(uuid,jsonb,jsonb,jsonb) TO service_role;
COMMIT;
