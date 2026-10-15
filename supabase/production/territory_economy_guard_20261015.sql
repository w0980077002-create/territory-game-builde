-- TERRITORY: first production-compatible server-side guard.
-- Additive only: no player row is deleted, reset or migrated.
-- This does NOT make legacy client-authored currency trustworthy.
-- It does enforce structural consistency, monotonic save revisions, and
-- append-only forensic accounting for every balance/progression mutation.
BEGIN;

CREATE TABLE IF NOT EXISTS public.territory_economy_audit_v1 (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id uuid NOT NULL,
  actor_id uuid,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  tx bigint NOT NULL DEFAULT txid_current(),
  gold_old bigint,
  gold_new bigint,
  gems_old bigint,
  gems_new bigint,
  level_old integer,
  level_new integer,
  stones_old bigint,
  stones_new bigint,
  bought_old integer,
  bought_new integer,
  chapter_old integer,
  chapter_new integer,
  suspicious boolean NOT NULL DEFAULT false,
  reason text,
  CHECK (reason IS NULL OR length(reason) <= 120)
);
CREATE INDEX IF NOT EXISTS territory_economy_audit_player_time_idx
  ON public.territory_economy_audit_v1(player_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS territory_economy_audit_suspicious_idx
  ON public.territory_economy_audit_v1(changed_at DESC)
  WHERE suspicious;
ALTER TABLE public.territory_economy_audit_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.territory_economy_audit_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.territory_economy_audit_v1_audit_id_seq FROM PUBLIC, anon, authenticated;

-- This invoker check runs on every economic save. It does not trust the browser's
-- clock and it rejects internally inconsistent JSON without altering prior state.
CREATE OR REPLACE FUNCTION public.territory_economy_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $guard$
DECLARE
 v_state jsonb := NEW.game_state;
 v_p jsonb := v_state->'player';
 v_gold numeric;
 v_gems numeric;
 v_level numeric;
 v_stones numeric;
 v_bought numeric;
BEGIN
 IF NEW.game_state IS DISTINCT FROM OLD.game_state THEN
   IF pg_catalog.jsonb_typeof(v_state) IS DISTINCT FROM 'object'
      OR pg_catalog.jsonb_typeof(v_p) IS DISTINCT FROM 'object'
   THEN RAISE EXCEPTION 'territory_invalid_game_state'; END IF;
   IF pg_catalog.jsonb_typeof(v_p->'gold') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(v_p->'gems') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(v_p->'level') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(v_state->'battleStones') IS DISTINCT FROM 'number'
   THEN RAISE EXCEPTION 'territory_invalid_wallet_type'; END IF;
   v_gold := (v_p->>'gold')::numeric;
   v_gems := (v_p->>'gems')::numeric;
   v_level := (v_p->>'level')::numeric;
   v_stones := (v_state->>'battleStones')::numeric;
   IF v_gold IS DISTINCT FROM NEW.gold OR v_gems IS DISTINCT FROM NEW.gems
      OR v_level IS DISTINCT FROM NEW.level
      OR v_stones NOT BETWEEN 0 AND 2147483647
      OR pg_catalog.trunc(v_stones) <> v_stones
   THEN RAISE EXCEPTION 'territory_wallet_snapshot_mismatch'; END IF;
   IF v_state ? 'dailyStonesBought' THEN
     IF pg_catalog.jsonb_typeof(v_state->'dailyStonesBought') IS DISTINCT FROM 'number'
     THEN RAISE EXCEPTION 'territory_invalid_stone_counter'; END IF;
     v_bought := (v_state->>'dailyStonesBought')::numeric;
     IF v_bought NOT BETWEEN 0 AND 25 OR pg_catalog.trunc(v_bought) <> v_bought
     THEN RAISE EXCEPTION 'territory_invalid_stone_counter'; END IF;
   END IF;
 END IF;
 IF NEW.game_state IS DISTINCT FROM OLD.game_state
    OR NEW.gold IS DISTINCT FROM OLD.gold
    OR NEW.gems IS DISTINCT FROM OLD.gems
    OR NEW.level IS DISTINCT FROM OLD.level THEN
   -- No client can set a misleading timestamp for an economic change.
   NEW.updated_at := GREATEST(pg_catalog.clock_timestamp(), OLD.updated_at + interval '1 microsecond');
 END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.territory_economy_guard_v1() FROM PUBLIC, anon, authenticated;

-- An isolated audit trigger has no data-changing business side effects.
-- The SECURITY DEFINER surface has no RPC arguments and no public EXECUTE grant.
CREATE OR REPLACE FUNCTION public.territory_economy_audit_trigger_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $audit$
DECLARE
 v_stones_old bigint;
 v_stones_new bigint;
 v_bought_old integer;
 v_bought_new integer;
 v_chapter_old integer;
 v_chapter_new integer;
 v_alert text := NULL;
BEGIN
 -- Some historical saves may have null/missing JSON. Never fail to audit.
 IF (OLD.game_state->>'battleStones') ~ '^[0-9]{1,10}$' THEN
   v_stones_old := (OLD.game_state->>'battleStones')::bigint;
 END IF;
 IF (NEW.game_state->>'battleStones') ~ '^[0-9]{1,10}$' THEN
   v_stones_new := (NEW.game_state->>'battleStones')::bigint;
 END IF;
 IF (OLD.game_state->>'dailyStonesBought') ~ '^[0-9]{1,2}$' THEN
   v_bought_old := (OLD.game_state->>'dailyStonesBought')::integer;
 END IF;
 IF (NEW.game_state->>'dailyStonesBought') ~ '^[0-9]{1,2}$' THEN
   v_bought_new := (NEW.game_state->>'dailyStonesBought')::integer;
 END IF;
 IF (OLD.game_state->>'currentChapter') ~ '^[0-9]{1,9}$' THEN
   v_chapter_old := (OLD.game_state->>'currentChapter')::integer;
 END IF;
 IF (NEW.game_state->>'currentChapter') ~ '^[0-9]{1,9}$' THEN
   v_chapter_new := (NEW.game_state->>'currentChapter')::integer;
 END IF;
 IF NEW.gold IS DISTINCT FROM OLD.gold OR NEW.gems IS DISTINCT FROM OLD.gems
   OR NEW.level IS DISTINCT FROM OLD.level
   OR v_stones_new IS DISTINCT FROM v_stones_old
   OR v_bought_new IS DISTINCT FROM v_bought_old
   OR v_chapter_new IS DISTINCT FROM v_chapter_old
 THEN
   IF NEW.gems > OLD.gems + 500 THEN v_alert := 'large_gem_gain';
   ELSIF NEW.gold > OLD.gold + 250000 THEN v_alert := 'large_gold_gain';
   ELSIF v_stones_old IS NOT NULL AND v_stones_new > v_stones_old + 25 THEN v_alert := 'large_stone_gain';
   ELSIF NEW.level > OLD.level + 5 THEN v_alert := 'large_level_jump';
   END IF;
   INSERT INTO public.territory_economy_audit_v1 (
     player_id, actor_id, gold_old, gold_new, gems_old, gems_new,
     level_old, level_new, stones_old, stones_new,
     bought_old, bought_new, chapter_old, chapter_new, suspicious, reason
   ) VALUES (
     NEW.id, auth.uid(), OLD.gold, NEW.gold, OLD.gems, NEW.gems,
     OLD.level, NEW.level, v_stones_old, v_stones_new,
     v_bought_old, v_bought_new, v_chapter_old, v_chapter_new,
     v_alert IS NOT NULL, v_alert
   );
 END IF;
 RETURN NULL;
END;
$audit$;
REVOKE ALL ON FUNCTION public.territory_economy_audit_trigger_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS territory_economy_guard_before_v1 ON public.players;
CREATE TRIGGER territory_economy_guard_before_v1
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.territory_economy_guard_v1();
DROP TRIGGER IF EXISTS territory_economy_audit_after_v1 ON public.players;
CREATE TRIGGER territory_economy_audit_after_v1
  AFTER UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.territory_economy_audit_trigger_v1();
COMMIT;
