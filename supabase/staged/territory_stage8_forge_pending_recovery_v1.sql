-- Stage8 forge: read-only recovery of a previously authorized operation.
-- Never launches a new roll or charges resources; only returns the current
-- authenticated owner's latest canonical snapshot and receipt metadata.
CREATE OR REPLACE FUNCTION public.territory_stage8_forge_pending_recovery_v1(
  p_item uuid, p_expected_level integer, p_operation uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $recovery$
DECLARE
  v_uid uuid := auth.uid();
  v_player public.players%ROWTYPE;
  v_item_level integer;
  v_receipt territory_private.stage8_forge_receipts_v1%ROWTYPE;
  v_found boolean := false;
BEGIN
  IF v_uid IS NULL OR p_item IS NULL OR p_operation IS NULL
     OR p_expected_level NOT BETWEEN 1 AND 499
  THEN RAISE EXCEPTION 'stage8_forge_recovery_bad_request'; END IF;

  SELECT * INTO v_player FROM public.players WHERE id=v_uid;
  IF NOT FOUND OR v_player.banned THEN
    RAISE EXCEPTION 'stage8_forge_recovery_account_unavailable';
  END IF;

  SELECT (i.item_output#>>'{equipment,level}')::integer INTO v_item_level
  FROM public.territory_profession_stage8_items i
  WHERE i.player_id=v_uid AND i.item_id=p_item
    AND i.item_output->>'type'='equipment';
  IF NOT FOUND OR v_item_level IS NULL THEN
    RAISE EXCEPTION 'stage8_forge_recovery_item_not_owned';
  END IF;

  SELECT * INTO v_receipt
  FROM territory_private.stage8_forge_receipts_v1
  WHERE player_id=v_uid AND operation_id=p_operation;
  v_found := FOUND;
  IF v_found AND (v_receipt.item_id<>p_item OR v_receipt.expected_level<>p_expected_level) THEN
    RAISE EXCEPTION 'stage8_forge_recovery_operation_conflict';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success',true,'found',v_found,'item_id',p_item::text,
    'expected_level',p_expected_level,'current_level',v_item_level,
    'result',CASE WHEN v_found THEN v_receipt.result ELSE NULL END,
    'updated_at',v_player.updated_at,
    'wallet_gold',v_player.gold,'wallet_gems',v_player.gems,
    'game_state',v_player.game_state
  );
END;
$recovery$;

REVOKE ALL ON FUNCTION public.territory_stage8_forge_pending_recovery_v1(uuid,integer,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_stage8_forge_pending_recovery_v1(uuid,integer,uuid)
  TO authenticated;
