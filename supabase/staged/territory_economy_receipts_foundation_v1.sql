-- TERRITORY Stage 1 / 2026-10-21
-- STAGED ONLY: NOT a production migration or a complete economy protection.
-- This ledger DOES NOT grant currency, update players, modify saved games,
-- change access to old APIs, or enable a public RPC.
-- Receipts must always be stored in the SAME SQL TRANSACTION as verified rewards.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $check$
BEGIN
 IF to_regclass('public.players') IS NULL
  OR to_regnamespace('territory_private') IS NULL THEN
  RAISE EXCEPTION 'territory_economy_foundation_missing_dependencies';
 END IF;
END
$check$;

CREATE TABLE IF NOT EXISTS territory_private.economy_receipts_v1 (
 player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 operation_kind text NOT NULL
  CHECK (char_length(operation_kind) BETWEEN 3 AND 60
   AND operation_kind ~ '^[a-z][a-z0-9_]*$'),
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 server_result jsonb NOT NULL CHECK (jsonb_typeof(server_result) = 'object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (player_id, operation_id)
);

ALTER TABLE territory_private.economy_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE territory_private.economy_receipts_v1 FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA territory_private TO service_role;
GRANT SELECT, INSERT ON territory_private.economy_receipts_v1 TO service_role;

-- Trusted server-only SQL helper. Not a credit/grant endpoint.
-- Caller MUST calculate and commit the verified balance change in the SAME
-- PostgreSQL transaction. Separate HTTP RPC calls are NOT atomic.
CREATE OR REPLACE FUNCTION territory_private.economy_receipt_store_v1(
 p_player uuid, p_operation uuid, p_kind text, p_request_hash text, p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $body$
DECLARE
 v_saved territory_private.economy_receipts_v1%ROWTYPE;
BEGIN
 IF p_player IS NULL OR p_operation IS NULL
  OR p_kind IS NULL OR char_length(p_kind) NOT BETWEEN 3 AND 60
  OR p_kind !~ '^[a-z][a-z0-9_]*$'
  OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$'
  OR p_result IS NULL OR jsonb_typeof(p_result) <> 'object' THEN
  RAISE EXCEPTION 'territory_invalid_economy_receipt';
 END IF;

 INSERT INTO territory_private.economy_receipts_v1
  (player_id, operation_id, operation_kind, request_hash, server_result)
 VALUES (p_player, p_operation, p_kind, p_request_hash, p_result)
 ON CONFLICT (player_id, operation_id) DO NOTHING;

 SELECT * INTO v_saved
 FROM territory_private.economy_receipts_v1
 WHERE player_id=p_player AND operation_id=p_operation;

 IF NOT FOUND
  OR v_saved.operation_kind IS DISTINCT FROM p_kind
  OR v_saved.request_hash IS DISTINCT FROM p_request_hash THEN
  RAISE EXCEPTION 'territory_economy_receipt_collision';
 END IF;

 RETURN v_saved.server_result;
END
$body$;

REVOKE ALL ON FUNCTION territory_private.economy_receipt_store_v1(
 uuid,uuid,text,text,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION territory_private.economy_receipt_store_v1(
 uuid,uuid,text,text,jsonb
) TO service_role;
COMMIT;
