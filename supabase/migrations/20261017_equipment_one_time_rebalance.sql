-- One-time production migration, run only AFTER:
-- 1. territory_private.gear_pre_normalize_20261017 exists and has 43 players
-- 2. public.territory_gear_guard_v4() deployed
-- 3. a no-write dry-run has confirmed reasonable limits.
--
-- DML runs inside a single DO transaction; any invariant failure rolls back all rows.
-- NEVER decrement XP, levels, wins, wallet, item counts or ownership.
DO $normalize$
DECLARE
  v_rows int;
  v_expected int;
BEGIN
  PERFORM set_config('lock_timeout','12s',true);
  PERFORM set_config('statement_timeout','100s',true);
  LOCK TABLE public.players IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO v_expected FROM territory_private.gear_pre_normalize_20261017;
  IF v_expected <> 43 THEN RAISE EXCEPTION 'missing_complete_private_player_backup'; END IF;
  CREATE TEMP TABLE _equipment_save_before ON COMMIT DROP AS
    SELECT id,game_state,level,xp,gold,gems,arena_wins,arena_losses,arena_rating,
       current_chapter,total_battles_won,total_bosses_defeated
    FROM public.players;

  IF (SELECT count(*) FROM _equipment_save_before) <> v_expected
    THEN RAISE EXCEPTION 'player_count_changed_since_backup'; END IF;

  UPDATE public.players p
    SET game_state = public.territory_normalize_state_v4(p.game_state)
    WHERE jsonb_typeof(p.game_state)='object';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> v_expected THEN RAISE EXCEPTION 'not_all_player_saves_migrated'; END IF;

  IF EXISTS (
    SELECT 1 FROM _equipment_save_before s JOIN public.players p USING(id)
    WHERE (p.level,p.xp,p.gold,p.gems,p.arena_wins,p.arena_losses,p.arena_rating,
      p.current_chapter,p.total_battles_won,p.total_bosses_defeated)
      IS DISTINCT FROM
      (s.level,s.xp,s.gold,s.gems,s.arena_wins,s.arena_losses,s.arena_rating,
        s.current_chapter,s.total_battles_won,s.total_bosses_defeated)
      OR ((p.game_state->'player') - 'equipped'::text - 'stats'::text)
        IS DISTINCT FROM ((s.game_state->'player') - 'equipped'::text - 'stats'::text)
      OR (p.game_state - 'player' - 'inventory' - 'belt' - 'balanceVersion')
        IS DISTINCT FROM (s.game_state - 'player' - 'inventory' - 'belt' - 'balanceVersion')
      OR jsonb_array_length(p.game_state->'inventory') <>
         jsonb_array_length(s.game_state->'inventory')
      OR jsonb_path_query_array(p.game_state,'$.inventory[*].id') IS DISTINCT FROM
         jsonb_path_query_array(s.game_state,'$.inventory[*].id')
      OR jsonb_path_query_array(p.game_state,'$.inventory[*].qty') IS DISTINCT FROM
         jsonb_path_query_array(s.game_state,'$.inventory[*].qty')
      OR jsonb_array_length(p.game_state->'belt') <>
         jsonb_array_length(s.game_state->'belt')
  ) THEN RAISE EXCEPTION 'progress_wallet_or_inventory_integrity_check_failed'; END IF;

  IF EXISTS (
    SELECT 1 FROM _equipment_save_before s JOIN public.players p USING(id)
      CROSS JOIN LATERAL jsonb_each(s.game_state->'player'->'equipped') e
    WHERE (p.game_state->'player'->'equipped'->e.key->>'id') IS DISTINCT FROM (e.value->>'id')
       OR (p.game_state->'player'->'equipped'->e.key->>'level') IS DISTINCT FROM (e.value->>'level')
       OR (p.game_state->'player'->'equipped'->e.key->>'rarity') IS DISTINCT FROM (e.value->>'rarity')
       OR (p.game_state->'player'->'equipped'->e.key->>'name') IS DISTINCT FROM (e.value->>'name')
  ) THEN RAISE EXCEPTION 'equipped_item_identity_or_level_changed'; END IF;

  IF EXISTS (SELECT 1 FROM public.players p WHERE
    p.attack <> (public.territory_gear_recompute_columns_v4(p.game_state)->>'attack')::integer
    OR p.defense <> (public.territory_gear_recompute_columns_v4(p.game_state)->>'defense')::integer
    OR p.max_hp <> (public.territory_gear_recompute_columns_v4(p.game_state)->>'max_hp')::integer
    OR p.max_hp > 100000)
  THEN RAISE EXCEPTION 'derived_character_stats_not_synchronized'; END IF;

  RAISE NOTICE 'Safely normalized % player saves; balances, equipment IDs, loot inventory and levels preserved', v_rows;
END
$normalize$;
