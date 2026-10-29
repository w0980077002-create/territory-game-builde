-- TERRITORY 1.0 - owner-adjusted gear is an INITIAL authoritative correction,
-- not an eternal exact-level lock. Keep all player rows, balances and receipts.
-- One normal forge step after the currently persisted server item is accepted;
-- stale snapshots cannot reverse a confirmed level. Owner can still relevel
-- the same item up OR down via territory_owner_apply_test_gear_v2.
BEGIN;

CREATE OR REPLACE FUNCTION territory_private.owner_cap_item_v1(
  p_item jsonb, p_hero integer, p_player uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog'
AS $owner_gear$
DECLARE
  v_approved integer;
  v_saved jsonb;
  v_item jsonb;
  v_old jsonb;
  v_state jsonb;
  v_slot text;
  v_id text;
  v_requested integer;
  v_oldlevel integer;
  v_stats jsonb;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN RETURN p_item; END IF;
  v_slot:=p_item->>'slot';
  v_id:=p_item->>'id';
  v_item:=p_item-'adminTestLevel';
  SELECT a.target_level,a.approved_equipment INTO v_approved,v_saved
  FROM territory_private.owner_test_gear_v1 a
  WHERE a.player_id=p_player AND a.slot=v_slot AND a.equipment_id=v_id;

  -- Ordinary equipment stays under the hero-level cap; the marker alone
  -- can never grant a bypass.
  IF v_approved IS NULL THEN
    RETURN territory_private.cap_overlevel_item_20261018(v_item,p_hero);
  END IF;

  -- Compare against the already-committed version, never against the historic
  -- owner receipt. Items may move between equipped, bag and belt.
  SELECT game_state INTO v_state FROM public.players WHERE id=p_player;
  IF jsonb_typeof(v_state#>'{player,equipped}')='object' THEN
    SELECT x.value INTO v_old FROM jsonb_each(v_state#>'{player,equipped}') x
    WHERE x.value->>'id'=v_id LIMIT 1;
  END IF;
  IF v_old IS NULL AND jsonb_typeof(v_state->'inventory')='array' THEN
    SELECT x.value->'equipment' INTO v_old
    FROM jsonb_array_elements(v_state->'inventory') x(value)
    WHERE x.value#>>'{equipment,id}'=v_id LIMIT 1;
  END IF;
  IF v_old IS NULL AND jsonb_typeof(v_state->'belt')='array' THEN
    SELECT x.value->'equipment' INTO v_old
    FROM jsonb_array_elements(v_state->'belt') x(value)
    WHERE x.value#>>'{equipment,id}'=v_id LIMIT 1;
  END IF;

  IF (v_item->>'level') ~ '^[0-9]{1,3}$'
    AND (v_old->>'level') ~ '^[0-9]{1,3}$' THEN
    v_requested:=(v_item->>'level')::integer;
    v_oldlevel:=(v_old->>'level')::integer;

    -- Last owner command was already applied. Accept one legitimate forge
    -- upgrade to the next level (max 500), but do not replace it on later saves.
    -- A new owner correction downwards bypasses this branch and is applied
    -- by the owner-authorized transaction below.
    IF v_oldlevel >= v_approved THEN
      IF v_requested = v_oldlevel + 1
        AND v_requested <= p_hero AND v_requested <= 500 THEN
        RETURN public.territory_normalize_gear_v4(v_item)
          || jsonb_build_object('adminTestLevel',true);
      END IF;
      IF v_requested = v_oldlevel
        OR v_saved IS NOT NULL
        OR v_requested < v_oldlevel THEN
        RETURN v_old || jsonb_build_object('adminTestLevel',true);
      END IF;
      -- Old approvals without a receipt also retain the current level if
      -- the submitted jump is not the single validated forge step.
      IF v_requested > v_oldlevel + 1 THEN
        RETURN v_old || jsonb_build_object('adminTestLevel',true);
      END IF;
    END IF;
  END IF;

  -- Owner correction / one-time compatibility with old receipt-free grants.
  IF jsonb_typeof(v_saved)='object'
    AND v_saved->>'id'=v_id AND v_saved->>'slot'=v_slot
    AND v_saved->>'level'=v_approved::text
    AND v_saved->'adminTestLevel'='true'::jsonb
  THEN RETURN v_saved; END IF;

  v_item:=jsonb_set(v_item,'{level}',to_jsonb(v_approved),true);
  IF v_item->>'name'='Клинок победителя' AND v_slot='weapon' THEN
    v_stats:=jsonb_build_object('attack',10+v_approved*3,'defense',0,'hp',0);
    v_item:=v_item||v_stats||jsonb_build_object('baseLevel',v_approved,'baseStats',v_stats,'upgradeCount',0);
  ELSIF v_item->>'name'='Доспех воина' AND v_slot='armor' THEN
    v_stats:=jsonb_build_object('attack',0,'defense',5+v_approved*2,'hp',20+v_approved*5);
    v_item:=v_item||v_stats||jsonb_build_object('baseLevel',v_approved,'baseStats',v_stats,'upgradeCount',0);
  END IF;
  v_item:=public.territory_normalize_gear_v4(v_item);
  RETURN territory_private.cap_overlevel_item_20261018(v_item,v_approved)
    || jsonb_build_object('adminTestLevel',true);
END;
$owner_gear$;

REVOKE ALL ON FUNCTION territory_private.owner_cap_item_v1(jsonb,integer,uuid)
FROM PUBLIC,anon,authenticated;

-- An admin level grant is only a notification: the owner command already
-- updated public.players atomically. Claiming it later must NOT reapply old
-- gear, particularly after normal forge upgrades or a newer admin command.
DO $patch_grant$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.territory_admin_claim_grant_v2(uuid)'::regprocedure)
  INTO v_definition;
  IF position('v_equipped:=jsonb_set(v_equipped,ARRAY[v_slot],v_gear,true);' IN v_definition)=0
    OR position('OR v_equipped->v_slot->>''id'' IS DISTINCT FROM v_gear_id' IN v_definition)=0
  THEN
    RAISE EXCEPTION 'Unexpected admin-grant implementation; refusing non-atomic patch';
  END IF;
  v_definition:=replace(v_definition,
    'OR v_equipped->v_slot->>''id'' IS DISTINCT FROM v_gear_id',
    '');
  v_definition:=replace(v_definition,
    'v_equipped:=jsonb_set(v_equipped,ARRAY[v_slot],v_gear,true);',
    'NULL; -- Owner already applied item atomically. Never replay outdated item.');
  EXECUTE v_definition;
END;
$patch_grant$;

REVOKE ALL ON FUNCTION public.territory_admin_claim_grant_v2(uuid)
FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_admin_claim_grant_v2(uuid)
TO authenticated,service_role;
COMMIT;
