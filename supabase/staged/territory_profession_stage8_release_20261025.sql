-- TERRITORY 1.0 — owner-authorized professions-only live switch.
-- Requires private backup, Stage8 backend and legacy bridge already installed.
-- Does NOT modify or gate PvE. Historical profession levels/items untouched.
-- A single transaction blocks concurrent legacy unlocks and holds each active
-- profession player's save row to prevent a cutover race.
BEGIN;
LOCK TABLE public.territory_profession_unlocks IN SHARE ROW EXCLUSIVE MODE;

DO $stage8_cutover$
DECLARE
  v_player record;
  v_preview jsonb;
  v_result jsonb;
  v_count integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM territory_private.professions_stage8_backup_players_20261025)
    THEN RAISE EXCEPTION 'private_player_backup_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.territory_profession_stage8_release WHERE enabled)
    THEN RAISE EXCEPTION 'already_enabled'; END IF;

  -- Only players with a server-recorded purchased unlock can be grandfathered.
  -- Lock their game_state so the historical XP cannot change mid-review.
  PERFORM p.id FROM public.players p
    JOIN public.territory_profession_unlocks u ON u.player_id=p.id
    ORDER BY p.id FOR UPDATE OF p;

  FOR v_player IN
    SELECT player_id FROM public.territory_profession_unlocks ORDER BY player_id
  LOOP
    IF EXISTS(SELECT 1 FROM public.territory_profession_stage8_progress
      WHERE player_id=v_player.player_id AND verified=true) THEN
      CONTINUE;
    END IF;
    v_preview:=public.territory_profession_stage8_legacy_preview(v_player.player_id);
    IF COALESCE(v_preview->>'eligible','false')<>'true' THEN
      RAISE EXCEPTION 'legacy_review_blocked: %',v_preview->>'reason'; END IF;
    -- First cutover is bounded to the observed beta cohort (maximum lv6).
    -- A surprise large level gain requires manual review, never a reset.
    IF (v_preview->>'mastery_level')::integer>10 THEN
      RAISE EXCEPTION 'unexpected_legacy_level_requires_review'; END IF;
    v_result:=public.territory_profession_stage8_legacy_approve(
      v_player.player_id,v_preview->>'source_digest',
      'Owner-approved initial beta cohort: existing unlock and level verified; preserve prior save and gear.');
    IF v_result->>'success'<>'true' THEN
      RAISE EXCEPTION 'legacy_review_failed'; END IF;
    v_count:=v_count+1;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.territory_profession_unlocks u
    LEFT JOIN public.territory_profession_stage8_progress p ON p.player_id=u.player_id
    WHERE p.player_id IS NULL OR p.verified IS DISTINCT FROM true
       OR p.profession<>u.profession
  ) THEN RAISE EXCEPTION 'not_all_unlocked_players_reconciled'; END IF;
  IF (SELECT count(*) FROM public.territory_profession_unlocks)
    < (SELECT count(*) FROM territory_private.professions_stage8_backup_unlocks_20261025)
    THEN RAISE EXCEPTION 'existing_unlocks_were_lost'; END IF;
END;
$stage8_cutover$;

-- Disable the old direct unlock path so any subsequent purchase must create
-- both the server unlock and its verified mastery row atomically.
REVOKE ALL ON FUNCTION public.territory_profession_unlock(text)
  FROM PUBLIC, anon, authenticated;
DO $preflight$
BEGIN
  IF NOT public.territory_profession_stage8_economy_ready()
    THEN RAISE EXCEPTION 'unsafe_profession_resource_or_unlock_acl'; END IF;
END;
$preflight$;

UPDATE public.territory_profession_stage8_release
  SET enabled=true,cutover_at=clock_timestamp() WHERE id=1 AND enabled=false;
COMMIT;
