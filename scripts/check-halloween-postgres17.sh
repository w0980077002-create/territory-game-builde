#!/usr/bin/env bash
set -euo pipefail
# Runs only against the two disposable containers created by the workflow.
# PostgreSQL sees a frozen clock via libfaketime; staged SQL is applied unchanged.
for db in halloween-before halloween-after; do
  docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA territory_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.players (id uuid PRIMARY KEY, game_state jsonb, gold integer, vip_level integer);
CREATE TABLE public.territory_halloween_boss_2026 (id text PRIMARY KEY, ends_at timestamptz NOT NULL);
CREATE TABLE public.territory_halloween_boss_2026_players (event_id text, player_id uuid, total_hits integer, PRIMARY KEY(event_id,player_id));
INSERT INTO public.players VALUES
 ('00000000-0000-0000-0000-000000000001','{"activeFollowerId":"follower_6","followers":[{"id":"follower_6","level":7}]}',123,3),
 ('00000000-0000-0000-0000-000000000002','{"inventory":[{"id":"keep"}]}',456,1),
 ('00000000-0000-0000-0000-000000000003','{}',789,2);
INSERT INTO public.territory_halloween_boss_2026 VALUES ('halloween_2026','2026-11-03 00:00:00+00');
INSERT INTO public.territory_halloween_boss_2026_players VALUES
 ('halloween_2026','00000000-0000-0000-0000-000000000001',1),
 ('halloween_2026','00000000-0000-0000-0000-000000000003',2),
 ('halloween_2026','00000000-0000-0000-0000-000000000002',0);
CREATE TABLE public.player_baseline AS TABLE public.players;
SQL
  docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres < supabase/staged/halloween_companion_reward_2026.sql
done

docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$BEGIN IF public.territory_halloween_companion_claim_v1()->>'reason' <> 'event_active' THEN RAISE EXCEPTION 'claim before deadline'; END IF; END$$;
RESET ROLE;
DO $$BEGIN
 BEGIN PERFORM public.territory_halloween_companion_snapshot_v1(); RAISE EXCEPTION 'snapshot unexpectedly allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'halloween_companion_event_active' THEN RAISE; END IF; END;
 BEGIN PERFORM public.territory_halloween_companion_bulk_v1('00000000-0000-0000-0000-000000000004',0,'d41d8cd98f00b204e9800998ecf8427e'); RAISE EXCEPTION 'bulk unexpectedly allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'halloween_companion_event_active' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM territory_private.halloween_companion_rewards_2026) THEN RAISE EXCEPTION 'early reward'; END IF;
END$$;
SQL

docker exec -i halloween-after psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
DO $$BEGIN
 IF current_setting('server_version_num')::int / 10000 <> 17 THEN RAISE EXCEPTION 'PostgreSQL 17 required'; END IF;
 IF has_function_privilege('anon','public.territory_halloween_companion_claim_v1()','EXECUTE') OR
    has_function_privilege('authenticated','public.territory_halloween_companion_bulk_v1(uuid,bigint,text)','EXECUTE') OR
    has_function_privilege('authenticated','public.territory_halloween_companion_snapshot_v1()','EXECUTE') OR
    has_table_privilege('authenticated','territory_private.halloween_companion_rewards_2026','SELECT') OR
    NOT has_function_privilege('service_role','public.territory_halloween_companion_bulk_v1(uuid,bigint,text)','EXECUTE') THEN
    RAISE EXCEPTION 'unexpected privileges';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='territory_private.halloween_companion_rewards_2026'::regclass) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
END$$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$BEGIN IF public.territory_halloween_companion_claim_v1()->>'reason' <> 'no_confirmed_hits' THEN RAISE EXCEPTION 'nonparticipant received reward'; END IF; END$$;
RESET ROLE;
DO $$DECLARE s jsonb; BEGIN
 s := public.territory_halloween_companion_snapshot_v1();
 IF (s->>'eligible')::int <> 2 OR (s->>'pending')::int <> 2 THEN RAISE EXCEPTION 'unexpected preview %',s; END IF;
 BEGIN PERFORM public.territory_halloween_companion_bulk_v1('00000000-0000-0000-0000-000000000004',1,s->>'digest'); RAISE EXCEPTION 'bad snapshot accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'halloween_companion_snapshot_changed' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM territory_private.halloween_companion_rewards_2026) THEN RAISE EXCEPTION 'failed batch wrote grants'; END IF;
END$$;
-- A transaction rollback must also roll back both receipts and grants.
BEGIN;
SELECT public.territory_halloween_companion_bulk_v1('00000000-0000-0000-0000-000000000005', (s->>'eligible')::bigint,s->>'digest') FROM (SELECT public.territory_halloween_companion_snapshot_v1() s) x;
ROLLBACK;
DO $$BEGIN IF EXISTS(SELECT 1 FROM territory_private.halloween_companion_rewards_2026) OR EXISTS(SELECT 1 FROM territory_private.halloween_companion_bulk_receipts_2026) THEN RAISE EXCEPTION 'rollback failed'; END IF; END$$;
SQL
# Two independent connections race claims for the same participant.
claim="SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false); SELECT public.territory_halloween_companion_claim_v1();"
docker exec halloween-after psql -X -v ON_ERROR_STOP=1 -U postgres -c "$claim" > /tmp/halloween-claim-one & p1=$!
docker exec halloween-after psql -X -v ON_ERROR_STOP=1 -U postgres -c "$claim" > /tmp/halloween-claim-two & p2=$!
wait "$p1"; wait "$p2"
# A second eligible player's claim races the guarded bulk.
claim2="SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false); SELECT public.territory_halloween_companion_claim_v1();"
docker exec halloween-after psql -X -v ON_ERROR_STOP=1 -U postgres -c "$claim2" > /tmp/halloween-claim-three & p3=$!
docker exec halloween-after psql -X -v ON_ERROR_STOP=1 -U postgres -c "SELECT public.territory_halloween_companion_bulk_v1('00000000-0000-0000-0000-000000000006',(s->>'eligible')::bigint,s->>'digest') FROM (SELECT public.territory_halloween_companion_snapshot_v1() s) x" > /tmp/halloween-bulk & p4=$!
wait "$p3"; wait "$p4"
docker exec -i halloween-after psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
DO $$DECLARE s jsonb; r jsonb; BEGIN
 s:=public.territory_halloween_companion_snapshot_v1();
 IF (s->>'eligible')::int <> 2 OR (s->>'granted')::int <> 2 OR (s->>'pending')::int <> 0 THEN RAISE EXCEPTION 'reconcile %',s; END IF;
 r:=public.territory_halloween_companion_bulk_v1('00000000-0000-0000-0000-000000000006',(s->>'eligible')::bigint,s->>'digest');
 IF r->>'alreadyProcessed' <> 'true' THEN RAISE EXCEPTION 'idempotency failed'; END IF;
 IF (SELECT count(*) FROM territory_private.halloween_companion_rewards_2026) <> 2 THEN RAISE EXCEPTION 'incorrect receipt count'; END IF;
 IF EXISTS ((SELECT * FROM public.players EXCEPT SELECT * FROM public.player_baseline) UNION ALL (SELECT * FROM public.player_baseline EXCEPT SELECT * FROM public.players)) THEN RAISE EXCEPTION 'players changed'; END IF;
 RAISE NOTICE 'PG17 preview/reconcile: eligible=2 granted=2 pending=0; duplicate=0; players unchanged';
END$$;
SQL
