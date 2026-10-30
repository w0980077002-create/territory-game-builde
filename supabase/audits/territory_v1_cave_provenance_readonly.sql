-- TERRITORY 1.0: read-only release audit for cave combat provenance.
-- Safe to run against the live Supabase SQL editor: ONE SELECT only.
-- Never use player-writable game_state or player_inventory as proof of ownership.
-- No mutation, no user identifiers, no granting permissions, no output of item data.
--
-- Review criteria:
-- (1) A verified profile with empty equipped_item_ids is NOT an unequipped hero.
--     Match active combat_profile_attestations_v1.legacy_equipped_ids first.
-- (2) A live state/equipment difference is an alert for manual reconciliation,
--     NOT permission for automatic re-attestation or item minting.
-- (3) Any active server session must be resumable through the cutover.
-- (4) Before production release compare two contemporaneous snapshots;
--     live counts may change through normal play.
WITH live_equipment AS (
  SELECT p.id,
         CASE WHEN jsonb_typeof(p.game_state->'player'->'equipped')='object'
              THEN (p.game_state->'player'->'equipped') <> '{}'::jsonb
              ELSE false END AS has_legacy_equipped,
         CASE WHEN jsonb_typeof(p.game_state->'belt')='array'
              THEN EXISTS (SELECT 1 FROM jsonb_array_elements(p.game_state->'belt') AS slot(item)
                           WHERE slot.item <> 'null'::jsonb)
              ELSE false END AS has_belt
  FROM public.players p
), live_attestations AS (
  SELECT player_id, fighter, legacy_equipped_ids, equipped_item_ids
  FROM territory_private.combat_profile_attestations_v1
  WHERE revoked_at IS NULL
)
SELECT
  (SELECT count(*) FROM live_equipment)::int AS players,
  (SELECT count(*) FROM live_equipment WHERE has_legacy_equipped)::int AS with_equipment_in_save_untrusted,
  (SELECT count(*) FROM live_equipment WHERE has_belt)::int AS with_belt_in_save_untrusted,
  (SELECT count(*) FROM live_attestations)::int AS active_attestations,
  (SELECT count(*) FROM live_attestations WHERE cardinality(legacy_equipped_ids)>0)::int AS active_legacy_attestations,
  (SELECT count(*) FROM live_attestations WHERE cardinality(equipped_item_ids)>0)::int AS active_uuid_attestations,
  (SELECT count(*) FROM territory_private.combat_profiles_v1 WHERE verified)::int AS verified_profiles,
  (SELECT count(*) FROM territory_private.combat_profiles_v1 WHERE cardinality(legacy_equipped_ids)>0)::int AS profile_with_legacy_ids,
  (SELECT count(*) FROM live_attestations a JOIN territory_private.combat_profiles_v1 cp USING(player_id)
   WHERE a.fighter IS DISTINCT FROM cp.fighter)::int AS fighter_mismatches_to_review,
  (SELECT count(*) FROM territory_private.combat_profile_reconciliation_v1)::int AS pending_reconciliation,
  (SELECT count(*) FROM territory_private.combat_sessions_v1 WHERE state->>'status'='fighting')::int AS active_server_fights;
