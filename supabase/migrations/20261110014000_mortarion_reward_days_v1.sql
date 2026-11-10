-- Mortarion rewards: participation days tracked for humans AND owner-controlled testers.
-- Event is already live; preserve every hit/HP/ranking entry. 24-hour windows
-- start at the real event starts_at, rather than using midnight calendar dates.
BEGIN;
SET LOCAL lock_timeout='4s';
ALTER TABLE public.territory_mortarion_2026_players
  ADD COLUMN IF NOT EXISTS hit_days integer[] NOT NULL DEFAULT '{}'::integer[];

CREATE OR REPLACE FUNCTION territory_private.mortarion_reward_hit_day_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_starts timestamptz; v_day integer;
BEGIN
  IF NEW.total_hits <= COALESCE(OLD.total_hits,0) OR NEW.last_hit_at IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT e.starts_at INTO v_starts FROM public.territory_mortarion_2026 e
   WHERE e.id=NEW.event_id;
  IF v_starts IS NULL THEN RETURN NULL; END IF;
  v_day:=1+pg_catalog.floor(pg_catalog.date_part('epoch', NEW.last_hit_at-v_starts)/86400)::integer;
  IF v_day BETWEEN 1 AND 5 AND NOT (v_day=ANY(NEW.hit_days)) THEN
    -- Updating ONLY hit_days does not recurse into this total_hits trigger.
    UPDATE public.territory_mortarion_2026_players
      SET hit_days=pg_catalog.array_append(hit_days,v_day)
    WHERE event_id=NEW.event_id AND player_id=NEW.player_id
      AND NOT (v_day=ANY(hit_days));
  END IF;
  RETURN NULL;
END; $fn$;
REVOKE ALL ON FUNCTION territory_private.mortarion_reward_hit_day_v1()
 FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS territory_mortarion_reward_day_v1
 ON public.territory_mortarion_2026_players;
CREATE TRIGGER territory_mortarion_reward_day_v1
AFTER INSERT OR UPDATE OF total_hits ON public.territory_mortarion_2026_players
FOR EACH ROW EXECUTE FUNCTION territory_private.mortarion_reward_hit_day_v1();

-- The active raid began on 09 Nov 2026 and this feature was added during its
-- FIRST 24-hour window. Existing server-confirmed hits belong to that window;
-- compensate the participants rather than starting them at zero today.
UPDATE public.territory_mortarion_2026_players s
 SET hit_days=ARRAY[1]::integer[]
FROM public.territory_mortarion_2026 e
WHERE e.id=s.event_id AND e.id='mortarion_2026'
 AND s.total_hits>0 AND cardinality(s.hit_days)=0
 AND pg_catalog.clock_timestamp() < e.starts_at+interval '1 day';

CREATE TABLE IF NOT EXISTS territory_private.mortarion_reward_receipts_v1(
  event_id text NOT NULL REFERENCES public.territory_mortarion_2026(id),
  player_id uuid NOT NULL REFERENCES public.players(id),
  tier text NOT NULL CHECK(tier IN ('participant','hunter','legendary')),
  place integer CHECK (place IS NULL OR place BETWEEN 1 AND 10),
  receipt jsonb NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY(event_id,player_id)
);
ALTER TABLE territory_private.mortarion_reward_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.mortarion_reward_receipts_v1 FROM PUBLIC,anon,authenticated;
COMMIT;
