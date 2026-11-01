#!/usr/bin/env bash
set -euo pipefail
# Disposable PG17 environments only. Exact staged SQL; no changes to live Supabase.
for db in halloween-before halloween-after; do
  docker exec "$db" createdb -U postgres halloween_bonus
  docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_bonus <<'SQL'
CREATE TABLE public.players(id uuid PRIMARY KEY,game_state jsonb DEFAULT '{}',gold integer DEFAULT 0,vip_level integer DEFAULT 0);
CREATE TABLE public.admin_grants(
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id),
  kind text NOT NULL,subject text NOT NULL,body text NOT NULL,
  payload jsonb NOT NULL,claimed_at timestamptz
);
CREATE SCHEMA territory_private;
CREATE TABLE public.territory_halloween_boss_2026(id text PRIMARY KEY,ends_at timestamptz NOT NULL);
CREATE TABLE public.territory_halloween_boss_2026_players(
 event_id text NOT NULL,player_id uuid NOT NULL,
 total_hits integer NOT NULL,total_damage bigint NOT NULL,
 last_hit_at timestamptz,
 PRIMARY KEY(event_id,player_id)
);
INSERT INTO public.players(id,game_state,gold,vip_level)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
       '{"followers":[{"id":"follower_6"}]}'::jsonb,200,2
FROM generate_series(1,13) n;
INSERT INTO public.territory_halloween_boss_2026 VALUES ('halloween_2026','2026-11-03 00:00:00+00');
INSERT INTO public.territory_halloween_boss_2026_players
(event_id,player_id,total_hits,total_damage,last_hit_at)
SELECT 'halloween_2026',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  n, (13-n)*1000,'2026-11-01 10:00:00+00'::timestamptz
FROM generate_series(1,12) n;
CREATE TABLE public.before_players AS TABLE public.players;
SQL
  docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_bonus < supabase/staged/halloween_top10_bonus_2026.sql
done

docker exec -i halloween-before psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_bonus <<'SQL'
DO $$ BEGIN
 BEGIN
   PERFORM public.territory_halloween_top10_preview_v1();
   RAISE EXCEPTION 'preview before event ended';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'halloween_top10_event_active' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.territory_halloween_top10_bulk_v1(
   '00000000-0000-0000-0000-000000000040',10,'d41d8cd98f00b204e9800998ecf8427e');
   RAISE EXCEPTION 'top10 bulk before event ended';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'halloween_top10_event_active' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.admin_grants) THEN RAISE EXCEPTION 'premature mail'; END IF;
END $$;
SQL

docker exec -i halloween-after psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_bonus <<'SQL'
DO $$ DECLARE p jsonb; r jsonb; n integer; g integer; golds integer; stones integer; BEGIN
 IF (current_setting('server_version_num')::int/10000)<>17 THEN
   RAISE EXCEPTION 'PG17 expected'; END IF;
 IF has_function_privilege('authenticated','public.territory_halloween_top10_bulk_v1(uuid,bigint,text)','EXECUTE')
 OR has_function_privilege('anon','public.territory_halloween_top10_preview_v1()','EXECUTE')
 OR NOT has_function_privilege('service_role','public.territory_halloween_top10_bulk_v1(uuid,bigint,text)','EXECUTE')
 THEN RAISE EXCEPTION 'top10 exposed to client'; END IF;
 p:=public.territory_halloween_top10_preview_v1();
 IF (p->>'eligible')::int<>10 OR (p->>'pending')::int<>10
 OR (p->>'sent')::int<>0 OR LENGTH(p->>'digest')<>32
 THEN RAISE EXCEPTION 'invalid preview %',p; END IF;
 BEGIN
   PERFORM public.territory_halloween_top10_bulk_v1(
     '00000000-0000-0000-0000-000000000041',10,'d41d8cd98f00b204e9800998ecf8427e');
   RAISE EXCEPTION 'mismatched digest accepted';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'halloween_top10_snapshot_changed' THEN RAISE; END IF;
 END;
 r:=public.territory_halloween_top10_bulk_v1('00000000-0000-0000-0000-000000000042',10,p->>'digest');
 IF (r->>'inserted')::int<>10 OR (r->>'alreadyProcessed')::boolean
 THEN RAISE EXCEPTION 'initial payout failed %',r; END IF;
 r:=public.territory_halloween_top10_bulk_v1('00000000-0000-0000-0000-000000000042',10,p->>'digest');
 IF NOT (r->>'alreadyProcessed')::boolean OR (r->>'inserted')::int<>10
 THEN RAISE EXCEPTION 'receipt replay failed %',r; END IF;
 SELECT count(*),sum((payload->>'gems')::int),sum((payload->>'gold')::int),sum((payload->>'stones')::int)
 INTO n,g,golds,stones FROM public.admin_grants;
 IF n<>10 OR g<>1175 OR golds<>23500 OR stones<>43 THEN
   RAISE EXCEPTION 'incorrect reward quantity % % % %',n,g,golds,stones; END IF;
 IF EXISTS(SELECT 1 FROM public.admin_grants WHERE payload ? 'redGems') THEN
   RAISE EXCEPTION 'premium currency introduced'; END IF;
 IF EXISTS(SELECT 1 FROM territory_private.halloween_top10_bonus_2026 WHERE place>10)
 OR EXISTS(SELECT 1 FROM public.admin_grants WHERE player_id='00000000-0000-0000-0000-000000000013')
 THEN RAISE EXCEPTION 'prize awarded to non-top10'; END IF;
 IF EXISTS(SELECT 1 FROM public.players p JOIN public.before_players b ON p.id=b.id
 WHERE p.game_state IS DISTINCT FROM b.game_state OR p.gold IS DISTINCT FROM b.gold
 OR p.vip_level IS DISTINCT FROM b.vip_level) THEN
   RAISE EXCEPTION 'player state changed'; END IF;
 UPDATE public.admin_grants SET claimed_at=pg_catalog.clock_timestamp()
 WHERE id=(SELECT mail_id FROM territory_private.halloween_top10_bonus_2026 WHERE place=1);
 p:=public.territory_halloween_top10_preview_v1();
 IF (p->>'pending')::int<>0 OR (p->>'unexpected')::int<>0
 OR (p->>'claimed')::int<>1 THEN RAISE EXCEPTION 'reconcile failed %',p; END IF;
 RAISE NOTICE 'Halloween top10: 10 individualized emails, all resource budgets correct, repeat safe, no player saves changed';
END $$;
SQL
echo "Halloween top10 PostgreSQL 17 gated mail and bonus ledger: PASS"
