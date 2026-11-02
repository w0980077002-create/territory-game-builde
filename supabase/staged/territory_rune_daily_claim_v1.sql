-- Staged safe daily rune claim: one server-authorized claim per UTC day.
-- Nothing touches the legacy hero state, wallets, premium currency or inventory.
-- Install after territory_rune_slots_v1.sql. Feature disabled by default.
BEGIN;
CREATE TABLE IF NOT EXISTS territory_private.rune_daily_config_v1 (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 enabled boolean NOT NULL DEFAULT false
);
INSERT INTO territory_private.rune_daily_config_v1(id) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE territory_private.rune_daily_config_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.rune_daily_config_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS territory_private.rune_daily_claims_v1 (
 player_id uuid NOT NULL REFERENCES public.players(id),
 day_utc date NOT NULL,
 rune_id text NOT NULL REFERENCES territory_private.rune_catalog_v1(rune_id),
 previous_level integer NOT NULL CHECK(previous_level BETWEEN 0 AND 2),
 level integer NOT NULL CHECK(level BETWEEN 1 AND 3),
 receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(player_id, day_utc)
);
ALTER TABLE territory_private.rune_daily_claims_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.rune_daily_claims_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.territory_runes_claim_daily_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $claim$
DECLARE
 u uuid := (SELECT auth.uid());
 d date := (now() AT TIME ZONE 'UTC')::date;
 prior territory_private.rune_daily_claims_v1%ROWTYPE;
 chosen text; current_rank integer; new_rank integer; receipt_body jsonb;
BEGIN
 IF u IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.players WHERE id=u AND NOT coalesce(banned,false) FOR UPDATE
 ) THEN RAISE EXCEPTION 'rune_account_unavailable'; END IF;
 IF NOT (SELECT enabled FROM territory_private.rune_daily_config_v1 WHERE id=true)
 THEN RAISE EXCEPTION 'rune_daily_not_available'; END IF;
 SELECT * INTO prior FROM territory_private.rune_daily_claims_v1
  WHERE player_id=u AND day_utc=d;
 IF FOUND THEN RETURN prior.receipt; END IF;

 -- Prefer collecting all 45 distinct runes before increasing levels.
 -- Stable player/date hash removes client-controlled selection and RNG farming.
 SELECT c.rune_id,coalesce(o.level,0) INTO chosen,current_rank
 FROM territory_private.rune_catalog_v1 c
 LEFT JOIN territory_private.rune_ownership_v1 o ON o.player_id=u AND o.rune_id=c.rune_id
 WHERE coalesce(o.level,0)<3
 ORDER BY coalesce(o.level,0), md5(u::text || ':' || d::text || ':' || c.rune_id)
 LIMIT 1;
 IF chosen IS NULL THEN RAISE EXCEPTION 'rune_daily_collection_complete'; END IF;
 new_rank := current_rank+1;
 INSERT INTO territory_private.rune_ownership_v1(player_id,rune_id,level,source)
 VALUES(u,chosen,new_rank,'daily-login')
 ON CONFLICT(player_id,rune_id) DO UPDATE SET
 level=EXCLUDED.level,source='daily-login',updated_at=clock_timestamp();
 receipt_body := jsonb_build_object(
 'schema','territory-rune-daily/1','dayUtc',d,'runeId',chosen,
 'previousLevel',current_rank,'level',new_rank);
 INSERT INTO territory_private.rune_daily_claims_v1
 (player_id,day_utc,rune_id,previous_level,level,receipt)
 VALUES(u,d,chosen,current_rank,new_rank,receipt_body);
 RETURN receipt_body;
END $claim$;
REVOKE ALL ON FUNCTION public.territory_runes_claim_daily_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.territory_runes_claim_daily_v1() TO authenticated;
COMMIT;
