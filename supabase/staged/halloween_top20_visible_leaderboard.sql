-- Read-only Halloween ranking display. Independent of prize issuance (#224).
-- Guarded patch to the live October event state function: no changes to HP, damage,
-- save data, wallet, event deadline, rank tie breaks, or authenticated access.
-- Keep top10 output for cached Telegram clients; add top20 for new clients.
DO $halloween_top20_display$
DECLARE
  state_src text;
  old_limit text := E'    LIMIT 10\n  ) ranked;';
  old_json text := E'''top10'', v_top, ''serverNow'', v_now';
  new_json text := E'''top10'', (SELECT COALESCE(jsonb_agg(e.item ORDER BY e.pos), ''[]''::jsonb)\n                  FROM jsonb_array_elements(v_top) WITH ORDINALITY AS e(item,pos)\n                  WHERE e.pos <= 10),\n    ''top20'', v_top, ''serverNow'', v_now';
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.territory_halloween_boss_state_v1()'::regprocedure)
    INTO state_src;
  IF pg_catalog.strpos(state_src, '''top20'', v_top') > 0 THEN
    -- Already upgraded. Do not rewrite a possibly later version.
    RETURN;
  END IF;
  IF pg_catalog.md5(state_src) <> '8a3048388f87586d8c1ee328054a6d89'
    OR pg_catalog.strpos(state_src, old_limit) = 0
    OR pg_catalog.strpos(state_src, old_json) = 0
    OR pg_catalog.strpos(state_src, '''maxHitsToday'', NULL') = 0
    OR pg_catalog.strpos(state_src, 'auth.uid()') = 0
  THEN
    RAISE EXCEPTION 'halloween_top20_display_version_mismatch';
  END IF;
  state_src := pg_catalog.replace(state_src, old_limit, E'    LIMIT 20\n  ) ranked;');
  state_src := pg_catalog.replace(state_src, old_json, new_json);
  EXECUTE state_src;
END
$halloween_top20_display$;
-- Preserve the exact previous grants: only authenticated fighters may view.
REVOKE ALL ON FUNCTION public.territory_halloween_boss_state_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.territory_halloween_boss_state_v1() TO authenticated;
