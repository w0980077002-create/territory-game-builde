-- Owner test gear v2. Make an authorized test level visible to the admin immediately.
-- Old/current owner-only UI requests are both handled in admin-api.
-- Uses the v1 authorization and per-item database guard; no global cheat bypass.
-- Installation does not alter existing players, inventory, wallets, XP or VIP.
CREATE OR REPLACE FUNCTION public.territory_owner_apply_test_gear_v2(
  p_player uuid, p_slot text, p_level integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $fn$
DECLARE
  v_grant jsonb;
  v_item jsonb;
BEGIN
  -- v1 atomically validates player/item identity, writes a private approval,
  -- and queues a one-time notification for online players.
  v_grant := public.territory_owner_authorize_test_gear_v1(
    p_player, p_slot, p_level
  );

  -- Set the approved level directly in the canonical server save.
  -- The existing BEFORE UPDATE equipment guard independently verifies the
  -- approval, reconstructs bounded stats and recomputes combat columns.
  UPDATE public.players
    SET game_state = jsonb_set(
      game_state, ARRAY['player','equipped',p_slot,'level'],
      to_jsonb(p_level), true
    )
    WHERE id=p_player
    RETURNING game_state#>ARRAY['player','equipped',p_slot] INTO v_item;

  IF v_item IS NULL OR (v_item->>'level')::integer IS DISTINCT FROM p_level
    OR v_item->>'adminTestLevel' IS DISTINCT FROM 'true'
  THEN
    RAISE EXCEPTION 'admin_test_gear_apply_failed';
  END IF;

  RETURN v_grant || jsonb_build_object('applied',true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.territory_owner_apply_test_gear_v2(uuid,text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_owner_apply_test_gear_v2(uuid,text,integer)
  TO service_role;

COMMENT ON FUNCTION public.territory_owner_apply_test_gear_v2(uuid,text,integer) IS
  'Owner-only server test gear correction applied atomically to game_state; regular equipment restrictions remain in force for all other items.';
