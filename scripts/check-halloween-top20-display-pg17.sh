#!/usr/bin/env bash
set -euo pipefail
# Isolated PG17 only; never touches live players. Reuses the unlimited-hit test DB.
docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_uncapped <<'SQL'
INSERT INTO public.players(id,level,display_name)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 15, 'Fighter '||n
FROM generate_series(3,26) n;
INSERT INTO public.territory_halloween_boss_2026_players
(event_id,player_id,total_damage,total_hits,hit_day_utc,hits_today,last_hit_at)
SELECT 'halloween_2026', ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  (10000 - n*200), 1, '2026-11-02'::date,1,'2026-11-02 06:00:00+00'::timestamptz
FROM generate_series(3,26) n;
SQL
docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_uncapped < supabase/staged/halloween_top20_visible_leaderboard.sql
# Applying twice should leave the function unchanged.
docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_uncapped < supabase/staged/halloween_top20_visible_leaderboard.sql
docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_uncapped <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $test$
DECLARE st jsonb;
BEGIN
 st := public.territory_halloween_boss_state_v1();
 IF jsonb_array_length(st->'top20')<>20 THEN RAISE EXCEPTION 'expected top20 got %',st; END IF;
 IF jsonb_array_length(st->'top10')<>10 THEN RAISE EXCEPTION 'cached client top10 compatibility lost'; END IF;
 IF st#>>'{top20,19,rank}' <> '20' OR st#>>'{top10,9,rank}' <> '10'
 THEN RAISE EXCEPTION 'rank boundaries wrong'; END IF;
 IF st#>>'{top20,0,name}' <> 'Test fighter'
 THEN RAISE EXCEPTION 'rank 1 replaced'; END IF;
 IF (st->>'myRank')::int<>1 OR st->>'maxHitsToday' IS NOT NULL
 THEN RAISE EXCEPTION 'my rank/uncapped state changed'; END IF;
 IF (st->>'hp')::bigint<>0 OR (st->>'active')::boolean
 THEN RAISE EXCEPTION 'boss state was changed'; END IF;
END
$test$;
RESET ROLE;
-- Lower-ranked player still gets his actual position even if not in top 20.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000026',false);
DO $test$
DECLARE st jsonb;
BEGIN
 st := public.territory_halloween_boss_state_v1();
 IF (st->>'myRank')::int<>25 OR jsonb_array_length(st->'top20')<>20
 THEN RAISE EXCEPTION 'outside top20 personal rank lost: %',st; END IF;
END
$test$;
RESET ROLE;
SQL
echo 'Halloween public leaderboard PG17: top20 correct, top10 legacy, below-prize personal rank and HP preserved: PASS'
