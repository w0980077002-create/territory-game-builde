-- v3: return real server-calculated stats and deliver the canonical equipment
-- in owner-only one-time grants so an online Telegram client cannot display
-- a stale/approximate item after the admin changes its level.
-- No changes to existing players on installation.
CREATE OR REPLACE FUNCTION public.territory_owner_apply_test_gear_v2(
  p_player uuid, p_slot text, p_level integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $fn$
DECLARE
  v_grant jsonb;
  v_item jsonb;
  v_combat jsonb;
  v_grant_id uuid;
BEGIN
  v_grant := public.territory_owner_authorize_test_gear_v1(p_player,p_slot,p_level);
  v_grant_id := (v_grant->>'grantId')::uuid;
  UPDATE public.players
    SET game_state=jsonb_set(game_state,ARRAY['player','equipped',p_slot,'level'],
       to_jsonb(p_level),true)
  WHERE id=p_player
  RETURNING game_state#>ARRAY['player','equipped',p_slot],
    jsonb_build_object('attack',attack,'defense',defense,'hp',max_hp,
                       'critChance',crit_chance)
  INTO v_item,v_combat;

  IF v_item IS NULL OR (v_item->>'level')::integer IS DISTINCT FROM p_level
    OR v_item->>'adminTestLevel' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'admin_test_gear_apply_failed'; END IF;

  -- The one-time receipt carries precisely the server's normalized numbers;
  -- validation still happens independently by item ID in every database save.
  UPDATE public.admin_grants
     SET payload=payload||jsonb_build_object('adminTestEquipment',v_item)
   WHERE id=v_grant_id AND player_id=p_player AND claimed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_test_gear_grant_missing'; END IF;

  RETURN v_grant || jsonb_build_object('applied',true,
    'gear',jsonb_build_object('level',(v_item->>'level')::integer,
      'attack',coalesce((v_item->>'attack')::numeric,0),
      'defense',coalesce((v_item->>'defense')::numeric,0),
      'hp',coalesce((v_item->>'hp')::numeric,0),
      'critChance',coalesce((v_item->>'critChance')::numeric,0)),
    'combat',v_combat);
END;
$fn$;

REVOKE ALL ON FUNCTION public.territory_owner_apply_test_gear_v2(uuid,text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_owner_apply_test_gear_v2(uuid,text,integer)
  TO service_role;
