-- TERRITORY 1.0 / Stage8 — REVIEWED legacy-save reconciliation.
-- STAGING ONLY. Never auto-run on live players or trust client game_state as
-- independent anti-cheat proof. Owner/service-role review is mandatory.
-- Run AFTER territory_profession_stage8_backend.sql with release.enabled=false.

BEGIN;

DO $$ BEGIN
  IF pg_catalog.to_regclass('public.territory_profession_stage8_progress') IS NULL
    THEN RAISE EXCEPTION 'stage8_backend_required'; END IF;
  IF EXISTS(SELECT 1 FROM public.territory_profession_stage8_release WHERE enabled)
    THEN RAISE EXCEPTION 'pause_stage8_before_legacy_reconciliation'; END IF;
END $$;

-- Supports a deliberately distinct provenance from cryptographically verified
-- Stage3 mastery. Never present a historical browser snapshot as verified_v1.
ALTER TABLE public.territory_profession_stage8_progress
  DROP CONSTRAINT IF EXISTS territory_profession_stage8_progress_origin_check;
ALTER TABLE public.territory_profession_stage8_progress
  DROP CONSTRAINT IF EXISTS stage8_progress_origin_check;
ALTER TABLE public.territory_profession_stage8_progress
  ADD CONSTRAINT stage8_progress_origin_check CHECK (
    (origin IN ('verified_v1','reviewed_legacy_save')
      AND original_v1_level IS NOT NULL AND original_v1_xp IS NOT NULL)
    OR (origin='new_unlock' AND original_v1_level IS NULL AND original_v1_xp IS NULL)
  );

-- The inline origin enum CHECK is omitted here intentionally: the Stage8
-- backend must already be the reviewed version that accepts this provenance.
CREATE TABLE IF NOT EXISTS public.territory_profession_stage8_legacy_reviews (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  profession text NOT NULL CHECK (profession IN ('smith','alchemist','artisan','jeweler','engineer')),
  source_revision timestamptz NOT NULL,
  source_digest text NOT NULL CHECK (length(source_digest)=32),
  original_level integer NOT NULL CHECK (original_level BETWEEN 1 AND 300),
  original_xp integer NOT NULL CHECK (original_xp BETWEEN 0 AND 100000),
  stage8_xp integer NOT NULL CHECK (stage8_xp BETWEEN 0 AND 100000),
  review_note text NOT NULL CHECK (length(review_note) BETWEEN 20 AND 500),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.territory_profession_stage8_legacy_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_profession_stage8_legacy_reviews FROM PUBLIC, anon, authenticated;

-- Preview gives a reviewer a snapshot fingerprint, NOT a certification. It
-- reads a player's historic save solely when a server-verified unlock exists
-- and the selected profession matches that unlock. It never writes anything.
CREATE OR REPLACE FUNCTION public.territory_profession_stage8_legacy_preview(p_player uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_player public.players%ROWTYPE;
  v_unlock text;
  v_prof text;
  v_level_n numeric;
  v_xp_n numeric;
  v_old_threshold integer;
  v_level integer;
  v_xp integer;
BEGIN
  IF p_player IS NULL THEN RAISE EXCEPTION 'invalid_player'; END IF;
  SELECT * INTO v_player FROM public.players WHERE id=p_player AND banned=false;
  IF NOT FOUND THEN RETURN jsonb_build_object('eligible',false,'reason','player_unavailable'); END IF;
  SELECT profession INTO v_unlock FROM public.territory_profession_unlocks WHERE player_id=p_player;
  IF NOT FOUND THEN RETURN jsonb_build_object('eligible',false,'reason','server_unlock_missing'); END IF;
  IF EXISTS(SELECT 1 FROM public.territory_profession_stage8_progress WHERE player_id=p_player)
    THEN RETURN jsonb_build_object('eligible',false,'reason','already_reconciled'); END IF;

  v_prof:=v_player.game_state->'professions'->>'active';
  IF v_prof IS DISTINCT FROM v_unlock
    THEN RETURN jsonb_build_object('eligible',false,'reason','profession_disagreement'); END IF;
  IF jsonb_typeof(v_player.game_state->'professions'->'masteryLevel') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_player.game_state->'professions'->'masteryXp') IS DISTINCT FROM 'number'
    THEN RETURN jsonb_build_object('eligible',false,'reason','mastery_missing'); END IF;

  v_level_n:=(v_player.game_state->'professions'->>'masteryLevel')::numeric;
  v_xp_n:=(v_player.game_state->'professions'->>'masteryXp')::numeric;
  IF v_level_n NOT BETWEEN 1 AND 300 OR trunc(v_level_n)<>v_level_n
     OR v_xp_n NOT BETWEEN 0 AND 100000 OR trunc(v_xp_n)<>v_xp_n
    THEN RETURN jsonb_build_object('eligible',false,'reason','mastery_invalid'); END IF;
  v_level:=v_level_n::integer;
  v_xp:=v_xp_n::integer;
  v_old_threshold:=100+(v_level-1)*25;
  IF (v_level=300 AND v_xp<>0) OR (v_level<300 AND v_xp>=v_old_threshold)
    THEN RETURN jsonb_build_object('eligible',false,'reason','xp_out_of_range'); END IF;
  RETURN jsonb_build_object('eligible',true,'player_id',p_player,
    'profession',v_unlock,'mastery_level',v_level,'mastery_xp',v_xp,
    'source_revision',v_player.updated_at,
    'source_digest',md5(p_player::text||'|'||v_player.updated_at::text||'|'||v_unlock||'|'||v_level||'|'||v_xp));
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_legacy_preview(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_legacy_preview(uuid) TO service_role;

-- A service-role reviewer explicitly authorizes each historical account.
-- expected digest protects against a concurrent old-client update between
-- review and import. No loss, no overwrite, no gems/resource debits.
CREATE OR REPLACE FUNCTION public.territory_profession_stage8_legacy_approve(
  p_player uuid,p_expected_digest text,p_review_note text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_candidate jsonb;
  v_source public.players%ROWTYPE;
  v_level integer;
  v_xp integer;
  v_old_threshold integer;
  v_new_threshold integer;
  v_stage8_xp integer;
  v_profession text;
BEGIN
  IF p_player IS NULL OR p_expected_digest IS NULL OR length(p_expected_digest)<>32
     OR p_review_note IS NULL OR length(p_review_note) NOT BETWEEN 20 AND 500
    THEN RAISE EXCEPTION 'review_required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_player::text),7724);
  IF EXISTS(SELECT 1 FROM public.territory_profession_stage8_release WHERE enabled)
    THEN RAISE EXCEPTION 'pause_stage8_before_legacy_reconciliation'; END IF;
  SELECT * INTO v_source FROM public.players WHERE id=p_player FOR UPDATE;
  IF NOT FOUND OR v_source.banned THEN RAISE EXCEPTION 'player_unavailable'; END IF;
  v_candidate:=public.territory_profession_stage8_legacy_preview(p_player);
  IF v_candidate->>'eligible' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION 'legacy_review_failed: %',v_candidate->>'reason'; END IF;
  IF v_candidate->>'source_digest' IS DISTINCT FROM p_expected_digest
    THEN RAISE EXCEPTION 'stale_legacy_snapshot'; END IF;
  v_level:=(v_candidate->>'mastery_level')::integer;
  v_xp:=(v_candidate->>'mastery_xp')::integer;
  v_profession:=v_candidate->>'profession';
  v_old_threshold:=100+(v_level-1)*25;
  IF v_level=300 THEN v_stage8_xp:=0;
  ELSE
    SELECT xp_to_next INTO v_new_threshold FROM public.territory_profession_stage8_bands
      WHERE v_level BETWEEN from_level AND to_level;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_mastery_band'; END IF;
    v_stage8_xp:=floor(v_xp::numeric/v_old_threshold*v_new_threshold)::integer;
  END IF;
  INSERT INTO public.territory_profession_stage8_progress(
    player_id,profession,mastery_level,mastery_xp,verified,origin,
    original_v1_level,original_v1_xp,reconciled_at)
  VALUES(p_player,v_profession,v_level,v_stage8_xp,true,
    'reviewed_legacy_save',v_level,v_xp,clock_timestamp());
  INSERT INTO public.territory_profession_stage8_legacy_reviews(
    player_id,profession,source_revision,source_digest,original_level,
    original_xp,stage8_xp,review_note)
  VALUES(p_player,v_profession,v_source.updated_at,p_expected_digest,v_level,
    v_xp,v_stage8_xp,p_review_note);
  RETURN jsonb_build_object('success',true,'profession',v_profession,
    'mastery_level',v_level,'mastery_xp',v_stage8_xp);
END;
$$;
REVOKE ALL ON FUNCTION public.territory_profession_stage8_legacy_approve(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_profession_stage8_legacy_approve(uuid,text,text) TO service_role;

COMMIT;
