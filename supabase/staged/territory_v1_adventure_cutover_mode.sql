-- TERRITORY 1.0: safe authenticated, read-only per-player cutover gate.
-- Never auto-enables combat or grants any reward. Existing legacy PvE remains
-- the fallback until the configured encounter, account profile and settlement
-- are all independently ready.
BEGIN;
CREATE OR REPLACE FUNCTION public.territory_adventure_mode_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid := auth.uid();
        st integer := 1;
        cfg territory_private.combat_config_v1%ROWTYPE;
BEGIN
 IF u IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.players p WHERE p.id=u AND NOT coalesce(p.banned,false)
 ) THEN RETURN jsonb_build_object('enabled',false); END IF;
 SELECT * INTO cfg FROM territory_private.combat_config_v1 WHERE id=true;
 IF NOT FOUND OR NOT coalesce(cfg.enabled,false) OR NOT coalesce(cfg.settlement_ready,false)
   OR nullif(btrim(cfg.approval_reference),'') IS NULL
   THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF NOT EXISTS (
   SELECT 1 FROM territory_private.combat_profiles_v1 h
   WHERE h.player_id=u AND h.verified AND h.approval_reference IS NOT NULL
 ) OR NOT territory_private.combat_profile_is_current_v1(u)
   THEN RETURN jsonb_build_object('enabled',false); END IF;
 SELECT ap.unlocked_stage INTO st FROM territory_private.adventure_progress_v1 ap
 WHERE ap.player_id=u;
 st:=coalesce(st,1);
 IF NOT EXISTS(
   SELECT 1 FROM territory_private.combat_encounters_v1 e
   JOIN territory_private.adventure_rewards_v1 r ON r.encounter_id=e.encounter_id
   WHERE e.enabled AND r.enabled AND e.stage=st AND r.stage=st
     AND r.items='[]'::jsonb
     AND e.mode=(CASE WHEN st%10=0 THEN 'boss' ELSE 'pve' END)
 ) THEN RETURN jsonb_build_object('enabled',false); END IF;
 RETURN jsonb_build_object('enabled',true);
END $$;
REVOKE ALL ON FUNCTION public.territory_adventure_mode_v1()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_adventure_mode_v1() TO authenticated;
COMMIT;
