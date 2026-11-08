-- STAGED ONLY: #366. Requires exact live trigger/dependency verification and a
-- clean provenance preflight; never apply directly to production. No data updates.
-- Preserve the existing legacy cap while resolving Stage8 from its owned registry.
BEGIN;
-- Refuse installation while any saved Stage8 level exceeds its registry value.
-- This gate does not certify historical provenance or authorize deployment.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.territory_profession_stage8_items i
    JOIN public.players p ON p.id=i.player_id
    CROSS JOIN LATERAL (
      SELECT x.value->'equipment' AS gear FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p.game_state->'inventory')='array' THEN p.game_state->'inventory' ELSE '[]'::jsonb END) x
      UNION ALL
      SELECT x.value FROM jsonb_each(
        CASE WHEN jsonb_typeof(p.game_state#>'{player,equipped}')='object' THEN p.game_state#>'{player,equipped}' ELSE '{}'::jsonb END) x
      UNION ALL
      SELECT x.value->'equipment' FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p.game_state->'belt')='array' THEN p.game_state->'belt' ELSE '[]'::jsonb END) x
    ) s
    WHERE i.item_output->>'type'='equipment'
      AND s.gear->>'id'='stage8_'||i.item_id::text
      AND ((s.gear->>'level') ~ '^[0-9]{1,3}$') IS TRUE
      AND (((i.item_output#>>'{equipment,level}') ~ '^[0-9]{1,3}$') IS NOT TRUE
        OR (s.gear->>'level')::integer > (i.item_output#>>'{equipment,level}')::integer)
  ) THEN
    RAISE EXCEPTION 'stage8_reconciliation_required' USING ERRCODE='23514';
  END IF;
END;
$preflight$;
-- TERRITORY #366: STAGED, NOT DEPLOYED.
-- Internal, read-only canonical lookup for server-owned crafted equipment.
-- Do not wire into production player-save triggers until the registry-vs-save
-- preflight is clean and the currently divergent items are reconciled.
-- Never infer ownership or a higher level from editable game_state data.
--
-- Returns NULL for all non-Stage8 gear so the established legacy owner cap
-- stays in force. Raises on stolen/unknown/corrupt Stage8 gear rather than
-- accepting forged ownership or silently deleting real upgrades.
CREATE OR REPLACE FUNCTION territory_private.stage8_verified_gear_v2(
  p_item jsonb,
  p_player uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $stage8$
DECLARE
  v_client_id text;
  v_canonical jsonb;
  v_saved_level integer;
  v_canonical_level integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  v_client_id := p_item->>'id';
  IF v_client_id IS NULL OR pg_catalog.left(v_client_id,7) <> 'stage8_' THEN
    RETURN NULL;
  END IF;
  IF p_player IS NULL OR v_client_id !~ '^stage8_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'stage8_invalid_item_reference' USING ERRCODE='23514';
  END IF;
  SELECT i.item_output->'equipment' INTO v_canonical
    FROM public.territory_profession_stage8_items i
   WHERE i.item_id = pg_catalog.substr(v_client_id,8)::uuid
     AND i.player_id = p_player
     AND i.item_output->>'type' = 'equipment';
  IF NOT FOUND OR pg_catalog.jsonb_typeof(v_canonical) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'stage8_item_not_owned' USING ERRCODE='23514';
  END IF;
  IF ((p_item->>'level') ~ '^[0-9]{1,3}$') IS NOT TRUE
     OR ((v_canonical->>'level') ~ '^[0-9]{1,3}$') IS NOT TRUE THEN
    RAISE EXCEPTION 'stage8_invalid_level' USING ERRCODE='23514';
  END IF;
  v_saved_level := (p_item->>'level')::integer;
  v_canonical_level := (v_canonical->>'level')::integer;
  IF v_saved_level > v_canonical_level THEN
    -- Three historical items presently have upgrades that predate the
    -- server ledger. Never silently replace or trust these levels.
    RAISE EXCEPTION 'stage8_reconciliation_required' USING ERRCODE='23514';
  END IF;
  IF v_saved_level < 1 OR v_canonical_level NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'stage8_invalid_level' USING ERRCODE='23514';
  END IF;
  -- Client-supplied attacks, levels and upgradeCount are NEVER an authority.
  -- Return registry fields verbatim, with exactly the one verified item ID.
  RETURN v_canonical || pg_catalog.jsonb_build_object('id',v_client_id);
END;
$stage8$;

REVOKE ALL ON FUNCTION territory_private.stage8_verified_gear_v2(jsonb,uuid)
  FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION territory_private.owner_cap_item_v1(p_item jsonb, p_hero integer, p_player uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_approved integer;
  v_approval_at timestamptz;
  v_player_at timestamptz;
  v_saved jsonb;
  v_item jsonb;
  v_old jsonb;
  v_state jsonb;
  v_slot text;
  v_id text;
  v_requested integer;
  v_oldlevel integer;
  v_stats jsonb;
  v_verified jsonb;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN RETURN p_item; END IF;
  IF left(p_item->>'id',7)='stage8_' THEN
    v_verified:=territory_private.stage8_verified_gear_v2(p_item,p_player);
    RETURN v_verified;
  END IF;
  v_slot:=p_item->>'slot';
  v_id:=p_item->>'id';
  v_item:=p_item-'adminTestLevel';
  SELECT a.target_level,a.approved_equipment,a.updated_at INTO v_approved,v_saved,v_approval_at
  FROM territory_private.owner_test_gear_v1 a
  WHERE a.player_id=p_player AND a.slot=v_slot AND a.equipment_id=v_id;

  -- Ordinary equipment stays under the hero-level cap; the marker alone
  -- can never grant a bypass.
  IF v_approved IS NULL THEN
    RETURN territory_private.cap_overlevel_item_20261018(v_item,p_hero);
  END IF;

  -- Compare against the already-committed version, never against the historic
  -- owner receipt. Items may move between equipped, bag and belt.
  SELECT game_state,updated_at INTO v_state,v_player_at FROM public.players WHERE id=p_player;
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
      -- During an explicit OWNER relevel, the approval row has been refreshed
      -- with a NULL receipt. A requested correction DOWN to its new target
      -- must win over any older server value.
      IF v_saved IS NULL AND v_requested = v_approved
        AND v_oldlevel <> v_approved
        AND v_approval_at >= v_player_at THEN
        NULL; -- fall through to the owner's requested canonical relevel below
      ELSIF v_requested = v_oldlevel + 1
        AND v_requested <= p_hero AND v_requested <= 500 THEN
        RETURN public.territory_normalize_gear_v4(v_item)
          || jsonb_build_object('adminTestLevel',true);
      END IF;
      IF (v_saved IS NOT NULL OR v_requested <> v_approved
          OR v_oldlevel = v_approved OR v_approval_at < v_player_at)
        AND (v_requested = v_oldlevel OR v_saved IS NOT NULL
            OR v_requested < v_oldlevel) THEN
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
$function$;

CREATE OR REPLACE FUNCTION territory_private.owner_cap_state_v1(p_state jsonb, p_hero integer, p_player uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_state jsonb:=p_state;
  v_equipped jsonb;
  v_inventory jsonb;
  v_belt jsonb;
  v_previous jsonb;
  v_entry record;
  v_seen text[] := ARRAY[]::text[];
  v_id text;
BEGIN
  -- Inspect the committed snapshot before accepting a replacement. In particular,
  -- a stale client cannot erase a higher, historically disputed saved level.
  SELECT game_state INTO v_previous FROM public.players WHERE id=p_player;
  FOR v_entry IN
    SELECT x.value AS gear FROM jsonb_each(CASE WHEN jsonb_typeof(v_previous#>'{player,equipped}')='object' THEN v_previous#>'{player,equipped}' ELSE '{}'::jsonb END) x
    UNION ALL
    SELECT x.value->'equipment' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_previous->'inventory')='array' THEN v_previous->'inventory' ELSE '[]'::jsonb END) x
    UNION ALL
    SELECT x.value->'equipment' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_previous->'belt')='array' THEN v_previous->'belt' ELSE '[]'::jsonb END) x
  LOOP
    IF left(v_entry.gear->>'id',7)='stage8_' THEN
      PERFORM territory_private.stage8_verified_gear_v2(v_entry.gear,p_player);
    END IF;
  END LOOP;

  IF jsonb_typeof(v_state) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_state->'player') IS DISTINCT FROM 'object' THEN
    RETURN p_state;
  END IF;

  -- One Stage8 identity may appear once, and a bag wrapper may not disguise it.
  FOR v_entry IN
    SELECT x.key AS slot, NULL::text AS wrapper_id, x.value AS gear
      FROM jsonb_each(CASE WHEN jsonb_typeof(v_state#>'{player,equipped}')='object' THEN v_state#>'{player,equipped}' ELSE '{}'::jsonb END) x
    UNION ALL
    SELECT NULL::text, x.value->>'id', x.value->'equipment' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_state->'inventory')='array' THEN v_state->'inventory' ELSE '[]'::jsonb END) x
    UNION ALL
    SELECT NULL::text, x.value->>'id', x.value->'equipment' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_state->'belt')='array' THEN v_state->'belt' ELSE '[]'::jsonb END) x
  LOOP
    v_id:=v_entry.gear->>'id';
    IF left(v_id,7)='stage8_' OR left(v_entry.wrapper_id,7)='stage8_' THEN
      IF v_id IS NULL OR left(v_id,7)<>'stage8_' OR (v_entry.wrapper_id IS NOT NULL AND v_entry.wrapper_id<>v_id) OR v_id=ANY(v_seen) THEN
        RAISE EXCEPTION 'stage8_duplicate_or_mismatched_item' USING ERRCODE='23514';
      END IF;
      v_seen:=array_append(v_seen,v_id);
      v_entry.gear:=territory_private.stage8_verified_gear_v2(v_entry.gear,p_player);
      IF v_entry.slot IS NOT NULL AND (p_hero IS NULL OR v_entry.gear->>'slot' IS DISTINCT FROM v_entry.slot OR (v_entry.gear->>'level')::integer>p_hero) THEN
        RAISE EXCEPTION 'stage8_equip_requirement' USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  IF jsonb_typeof(v_state#>'{player,equipped}')='object' THEN
    SELECT coalesce(jsonb_object_agg(e.key,
      CASE WHEN jsonb_typeof(e.value)='object'
        THEN territory_private.owner_cap_item_v1(e.value,p_hero,p_player)
        ELSE e.value END),'{}'::jsonb)
      INTO v_equipped FROM jsonb_each(v_state#>'{player,equipped}') e;
    v_state:=jsonb_set(v_state,'{player,equipped}',v_equipped);
  END IF;
  IF jsonb_typeof(v_state->'inventory')='array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(x.value->'equipment')='object'
        THEN jsonb_set(x.value,'{equipment}',
          territory_private.owner_cap_item_v1(x.value->'equipment',p_hero,p_player))
        ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
    INTO v_inventory FROM jsonb_array_elements(v_state->'inventory') WITH ORDINALITY x(value,ord);
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory);
  END IF;
  IF jsonb_typeof(v_state->'belt')='array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(x.value->'equipment')='object'
        THEN jsonb_set(x.value,'{equipment}',
          territory_private.owner_cap_item_v1(x.value->'equipment',p_hero,p_player))
        ELSE x.value END ORDER BY x.ord),'[]'::jsonb)
    INTO v_belt FROM jsonb_array_elements(v_state->'belt') WITH ORDINALITY x(value,ord);
    v_state:=jsonb_set(v_state,'{belt}',v_belt);
  END IF;
  RETURN v_state;
END;
$function$;

REVOKE ALL ON FUNCTION territory_private.owner_cap_item_v1(jsonb,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION territory_private.owner_cap_state_v1(jsonb,integer,uuid) FROM PUBLIC,anon,authenticated;
COMMIT;
