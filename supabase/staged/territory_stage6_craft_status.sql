-- STAGE6: Apply ONLY after Stage3 secure catalog AND a reviewed server-economy cutover.
-- Does not grant craft writes or enable any features; never alters players.
BEGIN;
CREATE OR REPLACE FUNCTION public.territory_craft_status_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_enabled boolean := false;
  v_progress public.territory_profession_mastery_v1%ROWTYPE;
  v_resources jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  SELECT craft_enabled INTO v_enabled FROM public.territory_release_flags_v1 WHERE id=1;
  IF NOT COALESCE(v_enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=v_uid AND banned=false)
    THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  SELECT * INTO v_progress FROM public.territory_profession_mastery_v1 WHERE player_id=v_uid AND verified=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'mastery_not_verified'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.territory_profession_unlocks
                 WHERE player_id=v_uid AND profession=v_progress.profession)
    THEN RAISE EXCEPTION 'profession_disagreement'; END IF;
  SELECT COALESCE(jsonb_object_agg(resource_id, quantity),'{}'::jsonb)
    INTO v_resources FROM public.territory_resource_wallet WHERE player_id=v_uid;
  RETURN jsonb_build_object('enabled',true,'profession',v_progress.profession,
    'mastery_level',v_progress.mastery_level,'mastery_xp',v_progress.mastery_xp,
    'resources',v_resources);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_craft_status_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_craft_status_v1() TO authenticated, service_role;
COMMIT;
