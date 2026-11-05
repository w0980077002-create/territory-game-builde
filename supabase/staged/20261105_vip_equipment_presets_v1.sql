-- STAGED ONLY. Requires 20261105_vip_entitlements_v1.sql.
-- No player state or existing item is changed during installation.
-- Deploy only after native PG17/JWT/RLS and owner-reviewed rollback validation.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS territory_private.vip_equipment_presets_v1 (
 player_id uuid NOT NULL REFERENCES public.players(id),
 preset_no smallint NOT NULL CHECK (preset_no IN (1,2)),
 equipment_ids jsonb NOT NULL CHECK (jsonb_typeof(equipment_ids)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(player_id,preset_no)
);
CREATE TABLE IF NOT EXISTS territory_private.vip_equipment_preset_receipts_v1 (
 operation_id uuid PRIMARY KEY,
 player_id uuid NOT NULL REFERENCES public.players(id),
 preset_no smallint NOT NULL CHECK (preset_no IN (1,2)),
 updated_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS vip_equipment_receipts_player_v1
 ON territory_private.vip_equipment_preset_receipts_v1(player_id,created_at);
ALTER TABLE territory_private.vip_equipment_presets_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.vip_equipment_preset_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.vip_equipment_presets_v1,
 territory_private.vip_equipment_preset_receipts_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON territory_private.vip_equipment_presets_v1,
 territory_private.vip_equipment_preset_receipts_v1 TO service_role;

-- No client-supplied gear IDs are accepted: save copies only the CURRENT
-- equipment already present in the authenticated player's cloud snapshot.
CREATE OR REPLACE FUNCTION public.territory_vip_equipment_preset_save_v1(
 p_slot integer,p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_save$
DECLARE
 u uuid:=auth.uid();
 p public.players%ROWTYPE;
 v_tier integer;
 v_eq jsonb;
 v_ids jsonb:='{}'::jsonb;
 v_slot text;
 v_gear jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'vip_preset_login_required'; END IF;
 IF p_slot IS NULL OR p_slot NOT IN (1,2) OR p_expected IS NULL
 THEN RAISE EXCEPTION 'vip_preset_invalid_request'; END IF;
 SELECT * INTO p FROM public.players WHERE id=u AND NOT banned FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'vip_preset_player_unavailable'; END IF;
 IF p.updated_at IS DISTINCT FROM p_expected
 THEN RAISE EXCEPTION 'vip_preset_stale_save'; END IF;
 v_tier:=(territory_private.vip_entitlement_status_v1(u)->>'vip')::integer;
 IF v_tier < (CASE WHEN p_slot=1 THEN 4 ELSE 6 END)
 THEN RAISE EXCEPTION 'vip_preset_locked'; END IF;
 v_eq:=p.game_state#>'{player,equipped}';
 IF jsonb_typeof(v_eq) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'vip_preset_invalid_equipment'; END IF;
 FOREACH v_slot IN ARRAY ARRAY['helmet','amulet','armor','weapon','shield','ring','boots'] LOOP
   v_gear:=v_eq->v_slot;
   IF v_gear IS NOT NULL AND v_gear<>'null'::jsonb THEN
     IF jsonb_typeof(v_gear) IS DISTINCT FROM 'object'
       OR v_gear->>'slot' IS DISTINCT FROM v_slot
       OR NULLIF(v_gear->>'id','') IS NULL
       OR length(v_gear->>'id')>160
     THEN RAISE EXCEPTION 'vip_preset_invalid_equipment'; END IF;
     v_ids:=v_ids||jsonb_build_object(v_slot,v_gear->>'id');
   ELSE
     v_ids:=v_ids||jsonb_build_object(v_slot,NULL);
   END IF;
 END LOOP;
 INSERT INTO territory_private.vip_equipment_presets_v1(player_id,preset_no,equipment_ids)
 VALUES(u,p_slot,v_ids)
 ON CONFLICT(player_id,preset_no) DO UPDATE
 SET equipment_ids=excluded.equipment_ids,updated_at=clock_timestamp();
 RETURN jsonb_build_object('success',true,'preset_no',p_slot,'equipment_ids',v_ids,
   'updated_at',p.updated_at);
END $vip_save$;

-- Switching does not add or subtract gold, XP, inventory quantities or
-- equipment levels. A permanent guest/gift VIP is eligible if effective VIP
-- meets the saved preset threshold.
CREATE OR REPLACE FUNCTION public.territory_vip_equipment_preset_apply_v1(
 p_slot integer,p_expected timestamptz,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_apply$
DECLARE
 u uuid:=auth.uid();
 p public.players%ROWTYPE;
 v_tier integer;
 v_recipe jsonb;
 v_equipped jsonb;
 v_inventory jsonb;
 v_new_inventory jsonb:='[]'::jsonb;
 v_new_equipped jsonb:='{}'::jsonb;
 v_slot text;
 v_id text;
 v_gear jsonb;
 v_element jsonb;
 v_current jsonb;
 v_selected text[]:='{}'::text[];
 v_seen integer;
 v_existing territory_private.vip_equipment_preset_receipts_v1%ROWTYPE;
 v_state jsonb;
 v_token timestamptz;
 v_return_id text;
 v_arena_busy boolean:=false;
 v_cave_busy boolean:=false;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'vip_preset_login_required'; END IF;
 IF p_slot IS NULL OR p_slot NOT IN (1,2)
   OR p_expected IS NULL OR p_operation IS NULL
 THEN RAISE EXCEPTION 'vip_preset_invalid_request'; END IF;

 -- Uniform lock order for all retry paths: player row, preset, receipt.
 SELECT * INTO p FROM public.players WHERE id=u AND NOT banned FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'vip_preset_player_unavailable'; END IF;
 SELECT * INTO v_existing FROM territory_private.vip_equipment_preset_receipts_v1
 WHERE operation_id=p_operation;
 IF FOUND THEN
   IF v_existing.player_id<>u OR v_existing.preset_no<>p_slot
     THEN RAISE EXCEPTION 'vip_preset_operation_conflict'; END IF;
   -- A replay returns CURRENT cloud state, never a stale snapshot from an old
   -- receipt, and never attempts a second equipment transfer.
   RETURN jsonb_build_object('success',true,'already_applied',true,
     'operation_id',p_operation,'updated_at',p.updated_at,
     'game_state',p.game_state,'wallet_gold',p.gold,'wallet_gems',p.gems);
 END IF;
 IF p.updated_at IS DISTINCT FROM p_expected
   THEN RAISE EXCEPTION 'vip_preset_stale_save'; END IF;
 v_tier:=(territory_private.vip_entitlement_status_v1(u)->>'vip')::integer;
 IF v_tier < (CASE WHEN p_slot=1 THEN 4 ELSE 6 END)
   THEN RAISE EXCEPTION 'vip_preset_locked'; END IF;

 -- The server must prove no active Arena or Cave battle. If either schema is
 -- missing, refuse the switch instead of guessing that combat is inactive.
 IF to_regclass('public.arena_participants') IS NULL
   OR to_regclass('public.arena_rooms') IS NULL
   OR to_regclass('territory_private.combat_sessions_v1') IS NULL
 THEN RAISE EXCEPTION 'vip_preset_combat_gate_unavailable'; END IF;
 EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.arena_participants a
    JOIN public.arena_rooms r ON r.id=a.room_id
    WHERE a.user_id=$1 AND a.left_at IS NULL
      AND r.status IN (''waiting'',''active''))' INTO v_arena_busy USING u;
 EXECUTE 'SELECT EXISTS(SELECT 1 FROM territory_private.combat_sessions_v1
    WHERE player_id=$1 AND state->>''status''=''fighting'')'
    INTO v_cave_busy USING u;
 IF v_arena_busy OR v_cave_busy
   THEN RAISE EXCEPTION 'vip_preset_combat_active'; END IF;

 SELECT equipment_ids INTO v_recipe
 FROM territory_private.vip_equipment_presets_v1
 WHERE player_id=u AND preset_no=p_slot FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'vip_preset_not_saved'; END IF;

 v_equipped:=p.game_state#>'{player,equipped}';
 v_inventory:=p.game_state->'inventory';
 IF jsonb_typeof(v_recipe) IS DISTINCT FROM 'object'
   OR (SELECT count(*) FROM jsonb_object_keys(v_recipe))<>7
   OR jsonb_typeof(v_equipped) IS DISTINCT FROM 'object'
   OR jsonb_typeof(v_inventory) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'vip_preset_invalid_state'; END IF;
 -- Limit pathological legacy inventory size without truncating it.
 IF jsonb_array_length(v_inventory)>5000
 THEN RAISE EXCEPTION 'vip_preset_inventory_too_large'; END IF;

 FOREACH v_slot IN ARRAY ARRAY['helmet','amulet','armor','weapon','shield','ring','boots'] LOOP
   IF NOT v_recipe ? v_slot OR
     jsonb_typeof(v_recipe->v_slot) NOT IN ('string','null')
   THEN RAISE EXCEPTION 'vip_preset_invalid_recipe'; END IF;
   v_id:=v_recipe->>v_slot;
   IF v_id IS NULL THEN CONTINUE; END IF;
   IF length(v_id)<1 OR length(v_id)>160 OR v_id=ANY(v_selected)
   THEN RAISE EXCEPTION 'vip_preset_duplicate_or_invalid_gear'; END IF;
   v_selected:=array_append(v_selected,v_id);
   v_gear:=NULL;
   v_seen:=0;
   FOR v_element IN SELECT value FROM jsonb_each(v_equipped) LOOP
     IF v_element->>'id'=v_id THEN
       v_gear:=v_element;
       v_seen:=v_seen+1;
     END IF;
   END LOOP;
   FOR v_element IN SELECT value FROM jsonb_array_elements(v_inventory) LOOP
     IF v_element->'equipment'->>'id'=v_id THEN
       IF v_element->>'type'<>'equipment' OR
         v_element->>'qty'<>'1'
       THEN RAISE EXCEPTION 'vip_preset_invalid_inventory_gear'; END IF;
       v_gear:=v_element->'equipment';
       v_seen:=v_seen+1;
     END IF;
   END LOOP;
   IF v_seen<>1 OR jsonb_typeof(v_gear) IS DISTINCT FROM 'object'
     OR v_gear->>'slot' IS DISTINCT FROM v_slot
     OR (v_gear->>'level') IS NULL
     OR NOT (v_gear->>'level') ~ '^[0-9]{1,3}     OR (v_gear->>'level')::int> (p.game_state#>>'{player,level}')::int
   THEN RAISE EXCEPTION 'vip_preset_gear_missing_or_invalid'; END IF;
   v_new_equipped:=v_new_equipped||jsonb_build_object(v_slot,v_gear);
 END LOOP;

 -- Keep all unrelated inventory lots byte-for-byte; only remove the exact
 -- selected equipment wrapper. Reject duplicates instead of minting items.
 FOR v_element IN SELECT value FROM jsonb_array_elements(v_inventory) LOOP
   IF v_element->>'type'='equipment'
      AND v_element->'equipment'->>'id'=ANY(v_selected) THEN CONTINUE; END IF;
   v_new_inventory:=v_new_inventory||jsonb_build_array(v_element);
 END LOOP;
 FOREACH v_slot IN ARRAY ARRAY['helmet','amulet','armor','weapon','shield','ring','boots'] LOOP
   v_current:=v_equipped->v_slot;
   IF v_current IS NULL OR v_current='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(v_current) IS DISTINCT FROM 'object'
     OR v_current->>'slot' IS DISTINCT FROM v_slot
     OR NULLIF(v_current->>'id','') IS NULL
   THEN RAISE EXCEPTION 'vip_preset_invalid_equipment'; END IF;
   IF v_current->>'id'=ANY(v_selected) THEN CONTINUE; END IF;
   v_return_id:='inv_vip_preset_'||replace(p_operation::text,'-','')||'_'||v_slot;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_new_inventory) i
      WHERE i->>'id'=v_return_id) THEN
     RAISE EXCEPTION 'vip_preset_inventory_id_conflict'; END IF;
   v_new_inventory:=v_new_inventory||jsonb_build_array(jsonb_build_object(
     'id',v_return_id,'name',v_current->>'name','icon',v_current->>'icon',
     'type','equipment','rarity',v_current->>'rarity','qty',1,
     'description','VIP preset • preserved equipment','equipment',v_current));
 END LOOP;

 v_state:=jsonb_set(jsonb_set(p.game_state,'{inventory}',v_new_inventory),
    '{player,equipped}',v_new_equipped);
 v_token:=greatest(clock_timestamp(),p_expected+interval '1 microsecond');
 UPDATE public.players SET game_state=v_state,updated_at=v_token WHERE id=u
 RETURNING * INTO p;
 INSERT INTO territory_private.vip_equipment_preset_receipts_v1
   (operation_id,player_id,preset_no,updated_at)
 VALUES (p_operation,u,p_slot,p.updated_at);
 RETURN jsonb_build_object('success',true,'already_applied',false,
    'operation_id',p_operation,'updated_at',p.updated_at,'game_state',p.game_state,
    'wallet_gold',p.gold,'wallet_gems',p.gems);
END $vip_apply$;

REVOKE ALL ON FUNCTION public.territory_vip_equipment_preset_save_v1(integer,timestamptz),
 public.territory_vip_equipment_preset_apply_v1(integer,timestamptz,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_vip_equipment_preset_save_v1(integer,timestamptz),
 public.territory_vip_equipment_preset_apply_v1(integer,timestamptz,uuid)
 TO authenticated;
COMMIT;

     OR (v_gear->>'level')::int> (p.game_state#>>'{player,level}')::int
   THEN RAISE EXCEPTION 'vip_preset_gear_missing_or_invalid'; END IF;
   v_new_equipped:=v_new_equipped||jsonb_build_object(v_slot,v_gear);
 END LOOP;

 -- Keep all unrelated inventory lots byte-for-byte; only remove the exact
 -- selected equipment wrapper. Reject duplicates instead of minting items.
 FOR v_element IN SELECT value FROM jsonb_array_elements(v_inventory) LOOP
   IF v_element->>'type'='equipment'
      AND v_element->'equipment'->>'id'=ANY(v_selected) THEN CONTINUE; END IF;
   v_new_inventory:=v_new_inventory||jsonb_build_array(v_element);
 END LOOP;
 FOREACH v_slot IN ARRAY ARRAY['helmet','amulet','armor','weapon','shield','ring','boots'] LOOP
   v_current:=v_equipped->v_slot;
   IF v_current IS NULL OR v_current='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(v_current) IS DISTINCT FROM 'object'
     OR v_current->>'slot' IS DISTINCT FROM v_slot
     OR NULLIF(v_current->>'id','') IS NULL
   THEN RAISE EXCEPTION 'vip_preset_invalid_equipment'; END IF;
   IF v_current->>'id'=ANY(v_selected) THEN CONTINUE; END IF;
   v_return_id:='inv_vip_preset_'||replace(p_operation::text,'-','')||'_'||v_slot;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_new_inventory) i
      WHERE i->>'id'=v_return_id) THEN
     RAISE EXCEPTION 'vip_preset_inventory_id_conflict'; END IF;
   v_new_inventory:=v_new_inventory||jsonb_build_array(jsonb_build_object(
     'id',v_return_id,'name',v_current->>'name','icon',v_current->>'icon',
     'type','equipment','rarity',v_current->>'rarity','qty',1,
     'description','VIP preset • preserved equipment','equipment',v_current));
 END LOOP;

 v_state:=jsonb_set(jsonb_set(p.game_state,'{inventory}',v_new_inventory),
    '{player,equipped}',v_new_equipped);
 v_token:=greatest(clock_timestamp(),p_expected+interval '1 microsecond');
 UPDATE public.players SET game_state=v_state,updated_at=v_token WHERE id=u
 RETURNING * INTO p;
 INSERT INTO territory_private.vip_equipment_preset_receipts_v1
   (operation_id,player_id,preset_no,updated_at)
 VALUES (p_operation,u,p_slot,p.updated_at);
 RETURN jsonb_build_object('success',true,'already_applied',false,
    'operation_id',p_operation,'updated_at',p.updated_at,'game_state',p.game_state,
    'wallet_gold',p.gold,'wallet_gems',p.gems);
END $vip_apply$;

REVOKE ALL ON FUNCTION public.territory_vip_equipment_preset_save_v1(integer,timestamptz),
 public.territory_vip_equipment_preset_apply_v1(integer,timestamptz,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_vip_equipment_preset_save_v1(integer,timestamptz),
 public.territory_vip_equipment_preset_apply_v1(integer,timestamptz,uuid)
 TO authenticated;
COMMIT;
