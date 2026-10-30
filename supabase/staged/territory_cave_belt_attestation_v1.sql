-- REVIEW ONLY. Provenance gate for future cave consumable transactions.
-- This is NOT an inventory, a backfill, a consumer RPC, or an enablement switch.
-- No records are created automatically from player-writable game_state.
BEGIN;
CREATE TABLE IF NOT EXISTS territory_private.cave_belt_attestations_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id),
  slot integer NOT NULL CHECK (slot BETWEEN 0 AND 6),
  source_reference text NOT NULL CHECK (length(btrim(source_reference)) > 0),
  reviewed_by text NOT NULL CHECK (length(btrim(reviewed_by)) > 0),
  -- Exact slot at review, including identity, type, effect and quantity.
  slot_snapshot jsonb NOT NULL CHECK (jsonb_typeof(slot_snapshot) = 'object'),
  -- Server-attested expiry, not parsed from the writable save.
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (player_id, slot),
  UNIQUE (source_reference)
);
ALTER TABLE territory_private.cave_belt_attestations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.cave_belt_attestations_v1 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON territory_private.cave_belt_attestations_v1 TO service_role;

-- Called only under the same players row lock as a future atomic debit. This
-- function itself does not authorize consumption or modify any player data.
-- Any move, quantity change, expiry, revocation or slot lock fails closed.
CREATE OR REPLACE FUNCTION territory_private.cave_belt_attestation_valid_v1(p_player uuid, p_slot integer)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT EXISTS (
   SELECT 1 FROM public.players p
   JOIN territory_private.cave_belt_attestations_v1 a ON a.player_id=p.id AND a.slot=p_slot
   WHERE p.id=p_player AND NOT coalesce(p.banned,false)
     AND p_slot BETWEEN 0 AND 6
     AND coalesce(p.arena_wins,0) >= (ARRAY[0,100,500,1000,2000,3500,5000])[p_slot+1]
     AND jsonb_typeof(p.game_state->'belt')='array'
     AND CASE WHEN jsonb_typeof(p.game_state->'belt')='array' THEN jsonb_array_length(p.game_state->'belt')=7 ELSE false END
     AND p.game_state->'belt'->p_slot = a.slot_snapshot
     AND a.revoked_at IS NULL AND a.expires_at > clock_timestamp()
     AND a.slot_snapshot->>'type' IN ('potion','elixir')
     AND jsonb_typeof(a.slot_snapshot->'qty')='number'
     AND CASE WHEN jsonb_typeof(a.slot_snapshot->'qty')='number'
       THEN (a.slot_snapshot->>'qty')::numeric BETWEEN 1 AND 5
         AND trunc((a.slot_snapshot->>'qty')::numeric)=(a.slot_snapshot->>'qty')::numeric
       ELSE false END
 );
$fn$;
REVOKE ALL ON FUNCTION territory_private.cave_belt_attestation_valid_v1(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION territory_private.cave_belt_attestation_valid_v1(uuid,integer) TO service_role;
COMMIT;
