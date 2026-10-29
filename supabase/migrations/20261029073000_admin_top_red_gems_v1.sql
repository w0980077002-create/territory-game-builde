-- TERRITORY 1.0. Owner-only Top 100 by current red-diamond balance.
-- Blue diamonds come directly from public.players.gems; red diamonds live
-- in the authoritative player state at game_state.player.redGems.
-- Read only: never alters players, balances, or admin authentication.
CREATE OR REPLACE FUNCTION public.territory_admin_top_red_gems_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ranked.id,
      'telegramId', ranked.telegram_id,
      'username', ranked.username,
      'name', ranked.display_name,
      'value', ranked.red_gems
    ) ORDER BY ranked.red_gems DESC, ranked.id ASC
  ), '[]'::jsonb)
  FROM (
    SELECT p.id, p.telegram_id, p.username, p.display_name,
      CASE WHEN jsonb_typeof(p.game_state->'player'->'redGems') = 'number'
        THEN (p.game_state->'player'->>'redGems')::numeric
        ELSE 0::numeric
      END AS red_gems
    FROM public.players AS p
    ORDER BY red_gems DESC, p.id ASC
    LIMIT 100
  ) AS ranked;
$$;
REVOKE ALL ON FUNCTION public.territory_admin_top_red_gems_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_top_red_gems_v1() TO service_role;
