-- REVIEW / ISOLATED TEST ONLY. Not a production migration or an enablement.
-- Requires the existing combat/settlement/Dark Stone and belt-attestation SQL.
-- No backfill, grants of items, config updates, or player rewrites.
BEGIN;

CREATE OR REPLACE FUNCTION territory_private.cave_belt_projection_v1(p_player uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT jsonb_agg(CASE WHEN territory_private.cave_belt_attestation_valid_v1(p_player,slots.slot_id)
   THEN jsonb_build_object('item',a.slot_snapshot,'sourceReference',a.source_reference,'used',0)
   ELSE 'null'::jsonb END ORDER BY slots.slot_id)
 FROM generate_series(0,6) AS slots(slot_id)
 LEFT JOIN territory_private.cave_belt_attestations_v1 a ON a.player_id=p_player AND a.slot=slots.slot_id;
$fn$;

-- Called by commit AFTER the owner/session/revision/replay gates, under the
-- existing players lock. Both debit and battle state roll back on any error.
CREATE OR REPLACE FUNCTION territory_private.cave_belt_debit_v1(p_player uuid,p_state jsonb,p_debit jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE slot_id integer; used_count integer; charge jsonb; original_item jsonb;
 current_item jsonb; next_item jsonb; qty integer; wallet public.players%ROWTYPE;
BEGIN
 IF jsonb_typeof(p_debit->'slot') IS DISTINCT FROM 'number'
   OR (p_debit->>'slot')::numeric NOT BETWEEN 0 AND 6
   OR trunc((p_debit->>'slot')::numeric)<>(p_debit->>'slot')::numeric
   THEN RAISE EXCEPTION 'combat_belt_unavailable'; END IF;
 slot_id:=(p_debit->>'slot')::integer;
 charge:=p_state->'caveRuntime'->'belt'->slot_id;
 original_item:=charge->'item'; used_count:=(charge->>'used')::integer;
 IF p_state->>'status'<>'fighting' OR p_state->'caveRuntime'->>'paused'<>'false'
   OR charge IS NULL OR charge='null'::jsonb OR used_count IS NULL
   OR used_count NOT BETWEEN 0 AND 4 OR used_count>=(original_item->>'qty')::integer
   OR original_item IS DISTINCT FROM p_debit->'snapshot'
   OR charge->>'sourceReference' IS DISTINCT FROM p_debit->>'sourceReference'
   OR used_count IS DISTINCT FROM (p_debit->>'usedBefore')::integer
   THEN RAISE EXCEPTION 'combat_belt_unavailable'; END IF;
 SELECT * INTO wallet FROM public.players WHERE id=p_player AND NOT coalesce(banned,false) FOR UPDATE;
 IF NOT FOUND OR NOT territory_private.cave_belt_attestation_valid_v1(p_player,slot_id)
   THEN RAISE EXCEPTION 'combat_belt_changed'; END IF;
 current_item:=wallet.game_state->'belt'->slot_id;
 qty:=(current_item->>'qty')::integer;
 IF (current_item-'qty') IS DISTINCT FROM (original_item-'qty')
   OR qty IS DISTINCT FROM (original_item->>'qty')::integer-used_count
   OR NOT EXISTS(SELECT 1 FROM territory_private.cave_belt_attestations_v1
     WHERE player_id=p_player AND slot=slot_id AND source_reference=charge->>'sourceReference')
   THEN RAISE EXCEPTION 'combat_belt_changed'; END IF;
 next_item:=CASE WHEN qty=1 THEN 'null'::jsonb ELSE jsonb_set(current_item,'{qty}',to_jsonb(qty-1)) END;
 UPDATE public.players SET game_state=jsonb_set(game_state,ARRAY['belt',slot_id::text],next_item),
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=p_player;
 -- Preserve the reviewed provenance as charges are consumed. Replenishing or
 -- moving a writable slot never grants fresh charges to the pinned battle.
 UPDATE territory_private.cave_belt_attestations_v1 SET slot_snapshot=next_item
   WHERE player_id=p_player AND slot=slot_id AND qty>1;
 UPDATE territory_private.cave_belt_attestations_v1 SET revoked_at=clock_timestamp()
   WHERE player_id=p_player AND slot=slot_id AND qty=1;
 IF NOT EXISTS (SELECT 1 FROM public.players WHERE id=p_player
   AND game_state=jsonb_set(wallet.game_state,ARRAY['belt',slot_id::text],next_item)
   AND gold IS NOT DISTINCT FROM wallet.gold AND gems IS NOT DISTINCT FROM wallet.gems
   AND xp IS NOT DISTINCT FROM wallet.xp AND level IS NOT DISTINCT FROM wallet.level
   AND max_energy IS NOT DISTINCT FROM wallet.max_energy)
   THEN RAISE EXCEPTION 'combat_belt_changed'; END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION territory_private.cave_belt_projection_v1(uuid),
 territory_private.cave_belt_debit_v1(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.cave_belt_projection_v1(uuid),
 territory_private.cave_belt_debit_v1(uuid,jsonb,jsonb) TO service_role;
GRANT UPDATE(slot_snapshot,revoked_at) ON territory_private.cave_belt_attestations_v1 TO service_role;

-- Guarded surgical patch: retain the deployed receipt/reward code. Abort on
-- missing markers or a second application; never silently replace live SQL.
DO $patch$
DECLARE source_sql text; revised text;
 marker text:='  RETURN result;';
 debit_marker text:='    UPDATE territory_private.combat_sessions_v1 SET state=p_result->''state'',revision=revision+1,';
 receipt_marker text:='    IF a=''start'' THEN';
BEGIN
 source_sql:=pg_get_functiondef('public.territory_combat_context_v1(uuid,jsonb)'::regprocedure);
 IF position('cave_belt_projection_v1' IN source_sql)>0
   OR (length(source_sql)-length(replace(source_sql,marker,'')))/length(marker)<>1
   THEN RAISE EXCEPTION 'Cave runtime context drift'; END IF;
 revised:=replace(source_sql,marker,$code$
  IF p_request->>'action'='start' AND c.rules->>'caveActiveClock'='true'
    AND p_request->>'encounterId' ~ '^adventure_v1_stage_[0-9]+$' THEN
    result:=result||jsonb_build_object('caveBelt',territory_private.cave_belt_projection_v1(p_player));
  END IF;
  RETURN result;$code$);
 EXECUTE revised;
 source_sql:=pg_get_functiondef('public.territory_combat_commit_v1(uuid,jsonb,jsonb,jsonb)'::regprocedure);
 IF position('cave_belt_debit_v1' IN source_sql)>0
   OR (length(source_sql)-length(replace(source_sql,debit_marker,'')))/length(debit_marker)<>1
   OR (length(source_sql)-length(replace(source_sql,receipt_marker,'')))/length(receipt_marker)<>1
   OR position('combat_revision_conflict' IN source_sql)=0
   THEN RAISE EXCEPTION 'Cave runtime commit drift'; END IF;
 revised:=replace(source_sql,debit_marker,$code$
    IF p_request ? 'beltSlot' THEN
      IF p_result->'beltDebit'->>'slot' IS DISTINCT FROM p_request->>'beltSlot'
        THEN RAISE EXCEPTION 'combat_belt_unavailable'; END IF;
      PERFORM territory_private.cave_belt_debit_v1(p_player,s.state,p_result->'beltDebit');
    ELSIF p_result ? 'beltDebit' THEN RAISE EXCEPTION 'combat_belt_unavailable'; END IF;
    UPDATE territory_private.combat_sessions_v1 SET state=p_result->'state',revision=revision+1,$code$);
 revised:=replace(revised,receipt_marker,$code$
    IF a='advance' AND p_request ? 'beltSlot' THEN
      SELECT * INTO wallet FROM public.players WHERE id=p_player;
      receipt:=receipt||jsonb_build_object('belt_save',jsonb_build_object(
        'success',true,'session_id',s.session_id,'updated_at',wallet.updated_at,
        'wallet_gold',wallet.gold,'wallet_gems',wallet.gems,
        'battle_stones',(wallet.game_state->>'battleStones')::bigint,'game_state',wallet.game_state));
    END IF;
    IF a='start' THEN$code$);
 EXECUTE revised;
END;
$patch$;
COMMIT;
