-- TERRITORY stage 1: strictly READ-ONLY preflight, no private player data.
-- Safe for production audit: every statement is SELECT.
SELECT current_database() AS db_name,
  (SELECT count(*) FROM public.players) AS players,
  (SELECT count(*) FROM public.players WHERE game_state IS NULL) AS null_saves,
  (SELECT count(*) FROM public.players WHERE gold < 0 OR gems < 0) AS negative_wallets;

SELECT column_name AS sensitive_field,
 has_column_privilege('authenticated','public.players',column_name,'UPDATE') AS writable_by_player
FROM information_schema.columns
WHERE table_schema='public' AND table_name='players'
  AND column_name IN ('gold','gems','xp','level','game_state','forge_materials',
   'energy','max_energy','current_chapter','chapter_wins','updated_at')
ORDER BY column_name;

SELECT 'player_inventory' AS sensitive_table,
 has_table_privilege('authenticated','public.player_inventory','INSERT') AS can_insert,
 has_table_privilege('authenticated','public.player_inventory','UPDATE') AS can_update,
 has_table_privilege('authenticated','public.player_inventory','DELETE') AS can_delete;

SELECT required.rpc_name,
 EXISTS (SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname=required.rpc_name) AS installed
FROM (VALUES
 ('territory_shop_status_v1'), ('territory_shop_buy_stones_v1'),
 ('territory_craft_status_v1'), ('territory_craft_v1'),
 ('territory_auction_overview_v1'), ('territory_auction_trade_v1')
) required(rpc_name);

SELECT count(*) AS grants_total,
 count(*) FILTER (WHERE claimed_at IS NULL) AS grants_unclaimed
FROM public.admin_grants;

SELECT count(*) FILTER (WHERE
 (game_state->'player'->>'gold')::numeric IS DISTINCT FROM gold OR
 (game_state->'player'->>'gems')::numeric IS DISTINCT FROM gems OR
 (game_state->'player'->>'level')::numeric IS DISTINCT FROM level)
 AS wallet_mismatch_count
FROM public.players;

-- NOT A DEPLOY GATE BY ITSELF: after verified server gameplay cutover, ALL
-- sensitive write grants above must be false and gameplay tests must pass.
