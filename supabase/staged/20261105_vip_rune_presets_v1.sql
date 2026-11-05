-- STAGED ONLY: depends on the trusted 15-slot rune ledger and
-- vip_entitlement_status_v1. Installation never edits an existing rune build.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS territory_private.vip_rune_presets_v1(
 player_id uuid NOT NULL REFERENCES public.players(id),
 preset_no smallint NOT NULL CHECK(preset_no IN (1,2)),
 slots jsonb NOT NULL CHECK(jsonb_typeof(slots)='array' AND jsonb_array_length(slots)=15),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(player_id,preset_no)
);
CREATE TABLE IF NOT EXISTS territory_private.vip_rune_preset_receipts_v1(
 operation_id uuid PRIMARY KEY,
 player_id uuid NOT NULL REFERENCES public.players(id),
 preset_no smallint NOT NULL CHECK(preset_no IN (1,2)),
 revision bigint NOT NULL CHECK(revision>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE territory_private.vip_rune_presets_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.vip_rune_preset_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.vip_rune_presets_v1,
 territory_private.vip_rune_preset_receipts_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON territory_private.vip_rune_presets_v1,
 territory_private.vip_rune_preset_receipts_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.territory_vip_rune_presets_status_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_rune_status$
DECLARE
 u uuid:=auth.uid();
 v_tier integer;
 v_presets jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'vip_rune_login_required'; END IF;
 v_tier:=(territory_private.vip_entitlement_status_v1(u)->>'vip')::integer;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'slot',preset_no,'slots',slots) ORDER BY preset_no),'[]'::jsonb)
 INTO v_presets FROM territory_private.vip_rune_presets_v1 WHERE player_id=u;
 RETURN jsonb_build_object('vip',v_tier,'presets',v_presets);
END $vip_rune_status$;

-- Saving copies the existing owner-verified rune loadout; it does not trust
-- any editable client-side rune selection or invent any rune ownership.
CREATE OR REPLACE FUNCTION public.territory_vip_rune_preset_save_v1(
 p_slot integer,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_rune_save$
DECLARE
 u uuid:=auth.uid();
 v_tier integer;
 v_live territory_private.rune_loadouts_v1%ROWTYPE;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'vip_rune_login_required'; END IF;
 IF p_slot IS NULL OR p_slot NOT IN (1,2) OR p_revision IS NULL OR p_revision<0
 THEN RAISE EXCEPTION 'vip_rune_invalid_request'; END IF;
 PERFORM 1 FROM public.players WHERE id=u AND NOT banned FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'vip_rune_player_unavailable'; END IF;
 v_tier:=(territory_private.vip_entitlement_status_v1(u)->>'vip')::integer;
 IF v_tier < (CASE WHEN p_slot=1 THEN 3 ELSE 6 END)
 THEN RAISE EXCEPTION 'vip_rune_preset_locked'; END IF;
 SELECT * INTO v_live FROM territory_private.rune_loadouts_v1
 WHERE player_id=u FOR SHARE;
 IF NOT FOUND OR v_live.revision<>p_revision
 THEN RAISE EXCEPTION 'vip_rune_revision_conflict'; END IF;
 INSERT INTO territory_private.vip_rune_presets_v1(player_id,preset_no,slots)
 VALUES(u,p_slot,v_live.slots)
 ON CONFLICT(player_id,preset_no) DO UPDATE
 SET slots=excluded.slots,updated_at=clock_timestamp();
 RETURN jsonb_build_object('success',true,'preset_no',p_slot,
   'revision',p_revision,'slots',v_live.slots);
END $vip_rune_save$;

CREATE OR REPLACE FUNCTION public.territory_vip_rune_preset_apply_v1(
 p_slot integer,p_revision bigint,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $vip_rune_apply$
DECLARE
 u uuid:=auth.uid();
 v_tier integer;
 v_live territory_private.rune_loadouts_v1%ROWTYPE;
 v_saved jsonb;
 v_old territory_private.vip_rune_preset_receipts_v1%ROWTYPE;
 v_arena_busy boolean:=false;
 v_cave_busy boolean:=false;
 v_entry jsonb;
 v_choice text;
 v_pos integer:=0;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'vip_rune_login_required'; END IF;
 IF p_slot IS NULL OR p_slot NOT IN (1,2)
   OR p_revision IS NULL OR p_revision<0 OR p_operation IS NULL
 THEN RAISE EXCEPTION 'vip_rune_invalid_request'; END IF;
 -- Same lock order as the original 15-slot rune save/admin grants.
 PERFORM 1 FROM public.players WHERE id=u AND NOT banned FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'vip_rune_player_unavailable'; END IF;
 SELECT * INTO v_old FROM territory_private.vip_rune_preset_receipts_v1
 WHERE operation_id=p_operation;
 IF FOUND THEN
   IF v_old.player_id<>u OR v_old.preset_no<>p_slot
   THEN RAISE EXCEPTION 'vip_rune_operation_conflict'; END IF;
   SELECT * INTO v_live FROM territory_private.rune_loadouts_v1 WHERE player_id=u;
   IF NOT FOUND THEN RAISE EXCEPTION 'vip_rune_loadout_unavailable'; END IF;
   RETURN jsonb_build_object('schema','territory-rune-slots/1',
     'operationId',p_operation,'alreadyApplied',true,
     'revision',v_live.revision,'slots',v_live.slots);
 END IF;
 v_tier:=(territory_private.vip_entitlement_status_v1(u)->>'vip')::integer;
 IF v_tier < (CASE WHEN p_slot=1 THEN 3 ELSE 6 END)
 THEN RAISE EXCEPTION 'vip_rune_preset_locked'; END IF;
 SELECT * INTO v_live FROM territory_private.rune_loadouts_v1
 WHERE player_id=u FOR UPDATE;
 IF NOT FOUND OR v_live.revision<>p_revision
 THEN RAISE EXCEPTION 'vip_rune_revision_conflict'; END IF;
 -- Switching in combat must not rewrite a pinned server battle build.
 IF to_regclass('public.arena_participants') IS NULL
   OR to_regclass('public.arena_rooms') IS NULL
   OR to_regclass('territory_private.combat_sessions_v1') IS NULL
 THEN RAISE EXCEPTION 'vip_rune_combat_gate_unavailable'; END IF;
 EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.arena_participants a
    JOIN public.arena_rooms r ON r.id=a.room_id
    WHERE a.user_id=$1 AND a.left_at IS NULL AND r.status IN (''waiting'',''active''))'
 INTO v_arena_busy USING u;
 EXECUTE 'SELECT EXISTS(SELECT 1 FROM territory_private.combat_sessions_v1
   WHERE player_id=$1 AND state->>''status''=''fighting'')'
 INTO v_cave_busy USING u;
 IF v_arena_busy OR v_cave_busy THEN RAISE EXCEPTION 'vip_rune_combat_active'; END IF;
 SELECT slots INTO v_saved FROM territory_private.vip_rune_presets_v1
 WHERE player_id=u AND preset_no=p_slot FOR SHARE;
 IF NOT FOUND OR jsonb_typeof(v_saved) IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_saved)<>15
 THEN RAISE EXCEPTION 'vip_rune_preset_not_saved'; END IF;
 -- Revalidate ALL 15 independent choices against CURRENT ownership and
 -- catalog, including null slots. One revoked rune rejects the whole switch.
 FOR v_entry IN SELECT value FROM jsonb_array_elements(v_saved) LOOP
   v_pos:=v_pos+1;
   IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_entry))<>2
     OR NOT (v_entry ? 'slotId' AND v_entry ? 'runeId')
     OR v_entry->>'slotId' IS DISTINCT FROM
       'rune_slot_'||lpad(v_pos::text,2,'0')
     OR jsonb_typeof(v_entry->'runeId') NOT IN ('string','null')
   THEN RAISE EXCEPTION 'vip_rune_invalid_saved_slot'; END IF;
   v_choice:=v_entry->>'runeId';
   IF v_choice IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM territory_private.rune_catalog_v1 c
     JOIN territory_private.rune_ownership_v1 o ON o.rune_id=c.rune_id
     WHERE o.player_id=u AND c.rune_id=v_choice
       AND c.slot_id=v_entry->>'slotId'
       AND o.level BETWEEN 1 AND c.max_level
   ) THEN RAISE EXCEPTION 'vip_rune_not_owned'; END IF;
 END LOOP;
 UPDATE territory_private.rune_loadouts_v1
 SET slots=v_saved,revision=revision+1,updated_at=clock_timestamp()
 WHERE player_id=u RETURNING * INTO v_live;
 INSERT INTO territory_private.vip_rune_preset_receipts_v1(
   operation_id,player_id,preset_no,revision)
 VALUES(p_operation,u,p_slot,v_live.revision);
 RETURN jsonb_build_object('schema','territory-rune-slots/1',
   'operationId',p_operation,'alreadyApplied',false,
   'revision',v_live.revision,'slots',v_live.slots);
END $vip_rune_apply$;

REVOKE ALL ON FUNCTION public.territory_vip_rune_presets_status_v1(),
 public.territory_vip_rune_preset_save_v1(integer,bigint),
 public.territory_vip_rune_preset_apply_v1(integer,bigint,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_vip_rune_presets_status_v1(),
 public.territory_vip_rune_preset_save_v1(integer,bigint),
 public.territory_vip_rune_preset_apply_v1(integer,bigint,uuid)
 TO authenticated;
COMMIT;
