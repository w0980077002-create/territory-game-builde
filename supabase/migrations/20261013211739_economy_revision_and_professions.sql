-- STAGED FOUNDATION ONLY. Do not apply to production before approved cutover.
-- This migration does NOT revoke legacy column grants; see ECONOMY_SECURITY_RU.md.
-- Only a trusted game service may use this commit API. Never forward client state
-- to it without replaying/validating the action on the server.
BEGIN;
ALTER TABLE public.players ADD COLUMN save_revision bigint NOT NULL DEFAULT 0;
CREATE FUNCTION public.territory_bump_save_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.game_state IS DISTINCT FROM OLD.game_state OR NEW.gems IS DISTINCT FROM OLD.gems THEN
    NEW.save_revision := OLD.save_revision + 1;
  ELSE
    NEW.save_revision := OLD.save_revision;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER territory_save_revision BEFORE UPDATE ON public.players
FOR EACH ROW EXECUTE FUNCTION public.territory_bump_save_revision();
REVOKE ALL ON FUNCTION public.territory_bump_save_revision() FROM PUBLIC, anon, authenticated;

-- Retain previously opened professions. A disagreement requires manual review,
-- never silently choose a profession or charge a second time.
DO $$ BEGIN
 IF EXISTS (
   SELECT 1 FROM public.players p JOIN public.territory_profession_unlocks u ON u.player_id=p.id
   WHERE p.game_state->'professions'->>'active' IS NOT NULL
     AND p.game_state->'professions'->>'active' <> u.profession
 ) THEN RAISE EXCEPTION 'profession_conflict_requires_review'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.players p
   WHERE p.game_state->'professions'->>'active' IS NOT NULL
   AND p.game_state->'professions'->>'active' NOT IN ('smith','alchemist','artisan','jeweler','engineer')
 ) THEN RAISE EXCEPTION 'unknown_legacy_profession_requires_review'; END IF;
END $$;
INSERT INTO public.territory_profession_unlocks(player_id,profession)
SELECT id, game_state->'professions'->>'active' FROM public.players
WHERE game_state->'professions'->>'active' IN ('smith','alchemist','artisan','jeweler','engineer')
ON CONFLICT(player_id) DO NOTHING;

CREATE TABLE public.territory_economy_receipts (
 player_id uuid NOT NULL REFERENCES public.players(id),
 operation_id uuid NOT NULL,
 action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
 expected_revision bigint NOT NULL,
 proposed_state jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(player_id,operation_id)
);
ALTER TABLE public.territory_economy_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_economy_receipts FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.territory_commit_validated_state(
 p_player uuid, p_operation uuid, p_action text, p_revision bigint, p_state jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_player public.players%ROWTYPE;
 v_receipt public.territory_economy_receipts%ROWTYPE;
 v_profession text;
 v_result jsonb;
 v_revision bigint;
 v_gems numeric;
BEGIN
 IF p_player IS NULL OR p_operation IS NULL OR p_revision IS NULL OR p_revision < 0
   OR p_action IS NULL OR length(p_action) NOT BETWEEN 1 AND 80
 THEN RAISE EXCEPTION 'invalid_operation'; END IF;
 SELECT * INTO v_player FROM public.players WHERE id=p_player FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'player_not_found'; END IF;
 IF v_player.banned THEN RAISE EXCEPTION 'player_banned'; END IF;
 SELECT * INTO v_receipt FROM public.territory_economy_receipts
 WHERE player_id=p_player AND operation_id=p_operation;
 IF FOUND THEN
   IF v_receipt.action IS DISTINCT FROM p_action
      OR v_receipt.expected_revision IS DISTINCT FROM p_revision
      OR v_receipt.proposed_state IS DISTINCT FROM p_state
   THEN RAISE EXCEPTION 'operation_id_reused'; END IF;
   RETURN v_receipt.result;
 END IF;
 IF v_player.save_revision <> p_revision THEN
   RETURN jsonb_build_object('error','save_conflict','revision',v_player.save_revision);
 END IF;
 IF jsonb_typeof(p_state) IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_state->'player'->'gems') IS DISTINCT FROM 'number'
   OR jsonb_typeof(p_state->'inventory') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'invalid_state'; END IF;
 v_gems := (p_state->'player'->>'gems')::numeric;
 IF v_gems < 0 OR v_gems > 2147483647 OR trunc(v_gems) <> v_gems
 THEN RAISE EXCEPTION 'invalid_gems'; END IF;
 SELECT profession INTO v_profession FROM public.territory_profession_unlocks WHERE player_id=p_player;
 IF (p_state->'professions'->>'active') IS DISTINCT FROM v_profession
 THEN RAISE EXCEPTION 'immutable_profession'; END IF;
 IF p_state->'professions' IS NOT NULL AND (
   jsonb_typeof(p_state->'professions'->'masteryLevel') IS DISTINCT FROM 'number'
   OR (p_state->'professions'->>'masteryLevel')::numeric NOT BETWEEN 1 AND 300
   OR trunc((p_state->'professions'->>'masteryLevel')::numeric) <> (p_state->'professions'->>'masteryLevel')::numeric
 ) THEN RAISE EXCEPTION 'invalid_mastery'; END IF;
 UPDATE public.players SET game_state=p_state, gems=v_gems::integer, updated_at=clock_timestamp()
 WHERE id=p_player RETURNING save_revision INTO v_revision;
 v_result := jsonb_build_object('success',true,'revision',v_revision,'gems',v_gems);
 INSERT INTO public.territory_economy_receipts(player_id,operation_id,action,expected_revision,proposed_state,result)
 VALUES(p_player,p_operation,p_action,p_revision,p_state,v_result);
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.territory_commit_validated_state(uuid,uuid,text,bigint,jsonb)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_commit_validated_state(uuid,uuid,text,bigint,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.territory_gather_start(p_resource_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_finish timestamptz; v_now timestamptz;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
 IF p_resource_id IS NULL OR p_resource_id NOT IN ('gather-wood','gather-herb','gather-ore','gather-crystal','gather-hide')
 THEN RETURN jsonb_build_object('error','invalid_resource'); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text),7724);
 IF EXISTS (SELECT 1 FROM public.territory_gather_jobs WHERE player_id=v_uid)
 THEN RETURN jsonb_build_object('error','already_gathering'); END IF;
 v_now:=clock_timestamp();
 v_finish:=v_now+interval '4 hours';
 INSERT INTO public.territory_gather_jobs(player_id,resource_id,started_at,finishes_at)
 VALUES(v_uid,p_resource_id,v_now,v_finish);
 RETURN jsonb_build_object('success',true,'resource_id',p_resource_id,'finishes_at',v_finish);
END;
$function$
;
REVOKE ALL ON FUNCTION public.territory_gather_start(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.territory_gather_start(text) TO authenticated, service_role;
COMMIT;
