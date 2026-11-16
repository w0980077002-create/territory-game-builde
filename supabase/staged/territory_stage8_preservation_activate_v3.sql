-- DANGEROUS ACTIVATION: NOT part of migrations, NOT called by CI deployment.
-- Separate owner authorization and fresh live definition/provenance review required.
BEGIN;
LOCK TABLE public.players IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.territory_profession_stage8_items IN SHARE ROW EXCLUSIVE MODE;

-- Freeze ONLY the three exact snapshots reviewed in read-only production
-- audit on 2026-11-16. A changed UUID, owner, registry gear, saved level,
-- location or item stat changes the fingerprint and ABORTS the transaction.
-- One is a claimed exact admin grant, the other two remain UNRESOLVED.
-- A freeze preserves the previous game state; it does NOT approve the upgrade.
LOCK TABLE territory_private.stage8_historical_quarantine_v1 IN SHARE ROW EXCLUSIVE MODE;
SELECT territory_private.stage8_prepare_historical_quarantine_v1('[
  {"fingerprint":"018bd54a8fb39f7f5b20549be4e81fa4","status":"unresolved"},
  {"fingerprint":"f08c9438ea0b3e4cae167d32bbea5323","status":"admin_approved"},
  {"fingerprint":"3d569f2a92375c0b8ee9f13a99f6b0ee","status":"unresolved"}
]'::jsonb);

CREATE TABLE territory_private.stage8_guard_backup_v3(signature text PRIMARY KEY, definition text NOT NULL, activated_definition text NOT NULL);
REVOKE ALL ON territory_private.stage8_guard_backup_v3 FROM PUBLIC,anon,authenticated;
ALTER TABLE territory_private.stage8_guard_backup_v3 ENABLE ROW LEVEL SECURITY;
DO $activate$
DECLARE v_def text; v_new text; v_expected text := 'territory_private.owner_cap_state_v1(
    public.territory_normalize_state_v4(
      territory_private.normalize_legacy_rare_state_20261108(NEW.game_state)),
    NEW.level,NEW.id)'; v_player record;
BEGIN
  -- Fail if either trigger body or historical provenance differs. This does
  -- not infer an upgrade from client state and does not rewrite existing rows.
  SELECT pg_get_functiondef('public.territory_gear_guard_v4()'::regprocedure) INTO v_def;
  IF length(v_def)-length(replace(v_def,v_expected,''))<>length(v_expected)
    THEN RAISE EXCEPTION 'stage8_unreviewed_live_guard_definition'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.players'::regclass
    AND tgfoid='public.territory_gear_guard_v4()'::regprocedure AND tgenabled='O')
    THEN RAISE EXCEPTION 'stage8_guard_trigger_missing'; END IF;
  FOR v_player IN SELECT p.id,p.game_state,p.level FROM public.players p
    WHERE EXISTS(SELECT 1 FROM public.territory_profession_stage8_items i WHERE i.player_id=p.id AND i.item_output->>'type'='equipment')
  LOOP
    PERFORM territory_private.stage8_preserve_state_v3(v_player.game_state,v_player.level,v_player.id);
  END LOOP;
  v_new:=replace(v_def,v_expected,'territory_private.stage8_preserve_state_v3(NEW.game_state,NEW.level,NEW.id)');
  INSERT INTO territory_private.stage8_guard_backup_v3 VALUES('public.territory_gear_guard_v4()',v_def,v_new);
  EXECUTE v_new;
  -- Defense in depth for any other private caller of the owner cap.
  SELECT pg_get_functiondef('territory_private.owner_cap_item_v1(jsonb,integer,uuid)'::regprocedure) INTO v_def;
  v_expected:='IF jsonb_typeof(p_item) IS DISTINCT FROM ''object'' THEN RETURN p_item; END IF;';
  IF length(v_def)-length(replace(v_def,v_expected,''))<>length(v_expected)
    THEN RAISE EXCEPTION 'stage8_unreviewed_owner_cap_definition'; END IF;
  v_new:=replace(v_def,v_expected,v_expected||'
  IF pg_catalog.left(p_item->>''id'',7)=''stage8_'' THEN
    RETURN territory_private.stage8_verified_gear_v2(p_item,p_player);
  END IF;');
  INSERT INTO territory_private.stage8_guard_backup_v3 VALUES('territory_private.owner_cap_item_v1(jsonb,integer,uuid)',v_def,v_new);
  EXECUTE v_new;
END $activate$;
-- Re-activation removes only the hold installed by this patch rollback.
DROP TRIGGER IF EXISTS aaa_stage8_maintenance_hold_v3 ON public.players;
COMMIT;
