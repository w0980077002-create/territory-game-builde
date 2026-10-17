-- TERRITORY one-time, transactional, reversible inventory cleanup.
-- Executed ONLY after preflight and live dry-run. Full player snapshots
-- stay in non-API territory_private and can be used for targeted restoration.
CREATE SCHEMA IF NOT EXISTS territory_private;
CREATE TABLE IF NOT EXISTS territory_private.inventory_before_cleanup_20261017 (
  player_id uuid PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  original_row jsonb NOT NULL,
  original_gear_count integer NOT NULL
);
REVOKE ALL ON territory_private.inventory_before_cleanup_20261017 FROM PUBLIC, anon, authenticated;

DO $cleanup$
DECLARE
  old_total int; new_total int; expected_players int;
  updated_rows int; expected_removed int;
BEGIN
  PERFORM set_config('lock_timeout','15s',true);
  PERFORM set_config('statement_timeout','110s',true);
  LOCK TABLE public.players IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM territory_private.inventory_before_cleanup_20261017)
    THEN RAISE EXCEPTION 'territory_cleanup_already_applied'; END IF;
  SELECT count(*) INTO expected_players FROM public.players;
  IF expected_players < 1 THEN RAISE EXCEPTION 'territory_no_players_to_back_up'; END IF;
  IF EXISTS(SELECT 1 FROM public.players p WHERE
     jsonb_typeof(p.game_state->'inventory') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p.game_state->'player'->'equipped') IS DISTINCT FROM 'object'
     OR p.game_state->>'balanceVersion' IS DISTINCT FROM '4'
     OR p.game_state IS DISTINCT FROM public.territory_normalize_state_v4(p.game_state)
  ) THEN RAISE EXCEPTION 'territory_noncanonical_state_abort'; END IF;

  INSERT INTO territory_private.inventory_before_cleanup_20261017(player_id,original_row,original_gear_count)
    SELECT p.id, to_jsonb(p),
      (SELECT count(*) FROM jsonb_array_elements(p.game_state->'inventory') AS i
         WHERE i->>'type'='equipment')
    FROM public.players p;
  IF (SELECT count(*) FROM territory_private.inventory_before_cleanup_20261017) <> expected_players
     THEN RAISE EXCEPTION 'territory_backup_incomplete'; END IF;

  SELECT coalesce(sum(original_gear_count),0) INTO old_total
    FROM territory_private.inventory_before_cleanup_20261017;
  SELECT coalesce(sum(
    (SELECT count(*) FROM jsonb_array_elements(
      territory_private.trim_inventory_v1(p.game_state)->'inventory') e WHERE e->>'type'='equipment')
  ),0) INTO new_total FROM public.players p;
  expected_removed := old_total - new_total;
  IF expected_removed < 1 THEN RAISE EXCEPTION 'territory_no_spare_duplicates_to_clean'; END IF;

  UPDATE public.players p SET game_state=territory_private.trim_inventory_v1(p.game_state)
   WHERE p.game_state IS DISTINCT FROM territory_private.trim_inventory_v1(p.game_state);
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> expected_players THEN RAISE EXCEPTION 'territory_not_all_players_version_marked'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.players p
    JOIN territory_private.inventory_before_cleanup_20261017 b ON b.player_id=p.id
    WHERE (p.game_state - 'inventory' - 'inventoryCleanupVersion')
      IS DISTINCT FROM ((b.original_row->'game_state') - 'inventory' - 'inventoryCleanupVersion')
      OR p.game_state->'inventory' IS DISTINCT FROM
        (territory_private.trim_inventory_v1(b.original_row->'game_state')->'inventory')
      OR p.game_state->>'inventoryCleanupVersion' <> '1'
      OR (to_jsonb(p) - 'game_state' - 'updated_at')
           IS DISTINCT FROM (b.original_row - 'game_state' - 'updated_at')
      OR p.updated_at <= (b.original_row->>'updated_at')::timestamptz
  ) THEN RAISE EXCEPTION 'territory_inventory_or_character_integrity_failed'; END IF;

  SELECT coalesce(sum((SELECT count(*) FROM jsonb_array_elements(p.game_state->'inventory') e
      WHERE e->>'type'='equipment')),0) INTO new_total FROM public.players p;
  IF old_total-new_total<>expected_removed THEN RAISE EXCEPTION 'territory_inventory_remove_count_mismatch'; END IF;
  RAISE NOTICE 'TERRITORY inventory cleanup: % players, % spare equipment removed, % remain; full private backup saved',
     expected_players, expected_removed, new_total;
END
$cleanup$;
