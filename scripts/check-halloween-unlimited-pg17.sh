#!/usr/bin/env bash
set -euo pipefail
# Only disposable PostgreSQL 17 from Halloween CI; never connect to live.
docker exec halloween-before createdb -U postgres halloween_uncapped
docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_uncapped <<'SQL'
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE public.players (
  id uuid PRIMARY KEY, level integer NOT NULL, banned boolean NOT NULL DEFAULT false,
  display_name text
);
INSERT INTO public.players (id,level,display_name) VALUES
 ('00000000-0000-0000-0000-000000000001',50,'Test fighter'),
 ('00000000-0000-0000-0000-000000000002',10,'Uninvolved');
SQL
docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_uncapped < supabase/migrations/20261031090000_halloween_world_boss_2026.sql
docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_uncapped < supabase/migrations/20261101071516_halloween_2026_daily_attack_limit_100.sql
docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_uncapped <<'SQL'
INSERT INTO public.territory_halloween_boss_2026_players
 (event_id,player_id,total_damage,total_hits,hit_day_utc,hits_today,last_hit_at)
VALUES ('halloween_2026','00000000-0000-0000-0000-000000000001',10000,100,'2026-11-02',100,'2026-11-02 01:00:00+00');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$DECLARE s jsonb; BEGIN
 s := public.territory_halloween_boss_state_v1();
 IF s->>'maxHitsToday' <> '100' THEN RAISE EXCEPTION '100-hit prestate missing'; END IF;
 BEGIN
   PERFORM public.territory_halloween_boss_attack_v1();
   RAISE EXCEPTION '100-hit limit unexpectedly bypassed';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'halloween_boss_daily_limit' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
SQL
docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_uncapped < supabase/migrations/20261101220000_halloween_2026_unlimited_attacks.sql
docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_uncapped <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$DECLARE s jsonb; h0 bigint; h1 bigint; BEGIN
 s := public.territory_halloween_boss_state_v1();
 IF jsonb_typeof(s->'maxHitsToday') <> 'null' THEN RAISE EXCEPTION 'uncapped flag missing'; END IF;
 h0 := (s->>'hp')::bigint;
 s := public.territory_halloween_boss_attack_v1();
 IF (s->>'hitDamage')::int <= 0 THEN RAISE EXCEPTION 'no server attack after old limit'; END IF;
 h1 := (s->>'hp')::bigint;
 IF h1 >= h0 THEN RAISE EXCEPTION 'server HP unchanged'; END IF;
 BEGIN
   PERFORM public.territory_halloween_boss_attack_v1();
   RAISE EXCEPTION '8 sec cooldown unexpectedly bypassed';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'halloween_boss_cooldown' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT total_hits FROM public.territory_halloween_boss_2026_players
     WHERE player_id='00000000-0000-0000-0000-000000000001') <> 101 THEN
   RAISE EXCEPTION 'confirmed hits did not increase exactly once';
 END IF;
END $$;
UPDATE public.territory_halloween_boss_2026 SET hp=0 WHERE id='halloween_2026';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$DECLARE s jsonb; BEGIN
 s:=public.territory_halloween_boss_state_v1();
 IF (s->>'active')::boolean OR (s->>'hp')::bigint <> 0 THEN RAISE EXCEPTION 'boss 0 HP not terminal'; END IF;
 BEGIN
   PERFORM public.territory_halloween_boss_attack_v1();
   RAISE EXCEPTION 'defeated boss accepted hit';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'halloween_boss_defeated' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
SQL
echo 'Halloween uncapped PostgreSQL 17: cap removed, cooldown & 0-HP stop enforced, confirmed hits and HP consistent: PASS'
