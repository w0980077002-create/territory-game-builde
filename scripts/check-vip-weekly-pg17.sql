\set ON_ERROR_STOP on
-- Isolated PostgreSQL 17 instance only. NEVER point this file at production.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE SCHEMA territory_private;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
CREATE TABLE public.players(
  id uuid PRIMARY KEY, banned boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  vip_level int NOT NULL DEFAULT 0, level int NOT NULL DEFAULT 40,
  gold int NOT NULL DEFAULT 100, gems int NOT NULL DEFAULT 20,
  game_state jsonb NOT NULL
);
CREATE FUNCTION territory_private.fortune_vip_v1(u uuid) RETURNS int
  LANGUAGE sql STABLE AS 'SELECT vip_level FROM public.players WHERE id=u';

INSERT INTO public.players(id,vip_level,game_state)
VALUES (
  '10000000-0000-0000-0000-000000000001',5,
  '{"player":{"gold":100,"gems":20,"redGems":7,"level":40},"inventory":[],"belt":[null,null,null,null,null,null,null],"battleStones":8,"forgeMaterials":0}'::jsonb
),(
  '10000000-0000-0000-0000-000000000002',1,
  '{"player":{"gold":100,"gems":20,"redGems":7,"level":40},"inventory":[],"belt":[null,null,null,null,null,null,null],"battleStones":8,"forgeMaterials":0}'::jsonb
);
\i supabase/staged/20261105_vip_weekly_chest_v1.sql

DO $guard$
BEGIN
  IF (SELECT NOT relrowsecurity FROM pg_class
      WHERE oid='territory_private.vip_weekly_claims_v1'::regclass) THEN
    RAISE EXCEPTION 'Weekly private ledger must enforce RLS';
  END IF;
  IF has_function_privilege('anon','public.territory_vip_weekly_v1(text,uuid,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous execution of weekly RPC must be revoked';
  END IF;
  IF has_table_privilege('authenticated','territory_private.vip_weekly_claims_v1','SELECT') THEN
    RAISE EXCEPTION 'Client must not select weekly ledger directly';
  END IF;
  IF NOT has_function_privilege('authenticated','public.territory_vip_weekly_v1(text,uuid,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated caller missing execute permission';
  END IF;
END $guard$;

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
DO $test$
DECLARE
  a jsonb; b jsonb; c jsonb;
  n integer;
BEGIN
  a:=public.territory_vip_weekly_v1('status');
  IF a->>'vip'<>'5' OR a->>'claimed_this_week'<>'false' THEN
    RAISE EXCEPTION 'VIP5 claim state is not ready: %',a;
  END IF;
  IF extract(isodow FROM (a->>'server_week')::date)<>1
    OR ((a->>'next_reset_at')::timestamptz - (a->>'server_week')::date)<>interval '7 days' THEN
    RAISE EXCEPTION 'UTC Monday reset incorrect: %',a;
  END IF;
  b:=public.territory_vip_weekly_v1('claim',
    '30000000-0000-0000-0000-000000000001',(a->>'updated_at')::timestamptz);
  IF (b->'reward'->>'gold')::int<>600 OR (b->'reward'->>'gems')::int<>5
     OR (b->'reward'->>'stones')::int<>2 OR (b->'reward'->>'materials')::int<>2
     OR (b->'reward'->>'vip')::int<>5
     OR b->'reward'->>'week'<>a->>'server_week' THEN
    RAISE EXCEPTION 'VIP5 rewards incorrect: %',b->'reward';
  END IF;
  IF b->'game_state'->>'forgeMaterials'<>'2'
     OR b->'game_state'->'player'->>'redGems'<>'7' THEN
    RAISE EXCEPTION 'Forge or withdrawable wallet mismatch: %',b;
  END IF;
  c:=public.territory_vip_weekly_v1('claim',
    '30000000-0000-0000-0000-000000000001',(a->>'updated_at')::timestamptz);
  IF c->>'replayed'<>'true' OR c->'game_state'<>b->'game_state' THEN
    RAISE EXCEPTION 'Receipt replay generated new reward';
  END IF;
  BEGIN
    c:=public.territory_vip_weekly_v1('claim',
      '30000000-0000-0000-0000-000000000002',(b->>'updated_at')::timestamptz);
    RAISE EXCEPTION 'Second claim unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'vip_weekly_already_claimed' THEN RAISE; END IF;
  END;
END $test$;
RESET ROLE;
DO $ledger$
BEGIN
  IF (SELECT count(*) FROM territory_private.vip_weekly_claims_v1)<>1 THEN
    RAISE EXCEPTION 'Expected one authoritative ledger row';
  END IF;
  IF (SELECT gold FROM public.players WHERE id='10000000-0000-0000-0000-000000000001')<>700 THEN
    RAISE EXCEPTION 'Unexpected real wallet grant';
  END IF;
END $ledger$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SET ROLE authenticated;
DO $denied$
DECLARE r jsonb;
BEGIN
  BEGIN
    r:=public.territory_vip_weekly_v1('claim',
      '30000000-0000-0000-0000-000000000003',
      (public.territory_vip_weekly_v1('status')->>'updated_at')::timestamptz);
    RAISE EXCEPTION 'VIP1 incorrectly claimed weekly chest';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'vip_weekly_vip2_required' THEN RAISE; END IF;
  END;
END $denied$;
RESET ROLE;
DO $wallet$
BEGIN
  IF (SELECT gold FROM public.players WHERE id='10000000-0000-0000-0000-000000000002')<>100 THEN
    RAISE EXCEPTION 'VIP1 denial changed wallet';
  END IF;
END $wallet$;
SELECT 'VIP weekly on PostgreSQL 17: auth/RLS/UTC/CAS/replay/expiry/deny PASS' AS verified;
