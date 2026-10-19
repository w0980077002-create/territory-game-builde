-- Controlled public release gate for reviewed Monopoly v2 RPCs.
-- Safe default: OFF. Enable separately after client checks and deployment.
-- Does not alter existing hall tables, player balances, or player saves.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $guard$
BEGIN
 IF to_regclass('territory_private.monopoly_launch_v2') IS NOT NULL
 THEN RAISE EXCEPTION 'monopoly_launch_gate_already_installed'; END IF;
 IF to_regprocedure('public.territory_monopoly_v2(text,integer,uuid)') IS NULL
 OR to_regprocedure('public.territory_monopoly_claim_v2(timestamptz,jsonb)') IS NULL
 THEN RAISE EXCEPTION 'monopoly_v2_not_installed'; END IF;
END $guard$;

CREATE TABLE territory_private.monopoly_launch_v2(
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE territory_private.monopoly_launch_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.monopoly_launch_v2 FROM PUBLIC, anon, authenticated;
INSERT INTO territory_private.monopoly_launch_v2(id, enabled) VALUES (true, false);

-- Preserve precise reviewed bodies and privilege/security settings.
-- Replace ONLY existing allowlist guards; keep both wallet and bans checks unchanged.
DO $patch$
DECLARE old_def text; new_def text;
BEGIN
 SELECT pg_get_functiondef('public.territory_monopoly_v2(text,integer,uuid)'::regprocedure) INTO old_def;
 IF old_def IS NULL OR
 (SELECT NOT p.prosecdef OR NOT ('search_path=pg_catalog'=ANY(coalesce(p.proconfig, ARRAY[]::text[])))
  FROM pg_proc p WHERE p.oid='public.territory_monopoly_v2(text,integer,uuid)'::regprocedure)
 THEN RAISE EXCEPTION 'monopoly_public_rpc_security_mismatch'; END IF;

 new_def:=replace(old_def,
  'IF NOT EXISTS(SELECT 1 FROM territory_private.monopoly_testers_v2 WHERE player_id=u)',
  'IF NOT EXISTS(SELECT 1 FROM territory_private.monopoly_testers_v2 WHERE player_id=u) AND NOT coalesce((SELECT enabled FROM territory_private.monopoly_launch_v2 WHERE id=true),false)');
 IF new_def=old_def THEN RAISE EXCEPTION 'monopoly_public_rpc_allowlist_guard_mismatch'; END IF;
 EXECUTE new_def;

 SELECT pg_get_functiondef('public.territory_monopoly_claim_v2(timestamptz,jsonb)'::regprocedure) INTO old_def;
 IF old_def IS NULL OR
 (SELECT NOT p.prosecdef OR NOT ('search_path=pg_catalog'=ANY(coalesce(p.proconfig, ARRAY[]::text[])))
  FROM pg_proc p WHERE p.oid='public.territory_monopoly_claim_v2(timestamptz,jsonb)'::regprocedure)
 THEN RAISE EXCEPTION 'monopoly_claim_rpc_security_mismatch'; END IF;

 new_def:=replace(old_def,
  'IF u IS NULL OR NOT EXISTS(SELECT 1 FROM territory_private.monopoly_testers_v2 WHERE player_id=u)',
  'IF u IS NULL OR (NOT EXISTS(SELECT 1 FROM territory_private.monopoly_testers_v2 WHERE player_id=u) AND NOT coalesce((SELECT enabled FROM territory_private.monopoly_launch_v2 WHERE id=true),false))');
 IF new_def=old_def THEN RAISE EXCEPTION 'monopoly_claim_rpc_allowlist_guard_mismatch'; END IF;
 EXECUTE new_def;
END $patch$;

COMMIT;
