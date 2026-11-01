-- Halloween 2026: expand daily hits from 40 to 100 without touching raid/player data.
-- Applied to live Supabase as migration 20261101071516; keep this copy in Git.
-- Guard the exact previous RPC definitions; rollback requires separate audited migration.
DO $halloween_limit_100$
DECLARE
  state_src text;
  attack_src text;
BEGIN
  SELECT pg_get_functiondef('public.territory_halloween_boss_state_v1()'::regprocedure)
    INTO state_src;
  SELECT pg_get_functiondef('public.territory_halloween_boss_attack_v1()'::regprocedure)
    INTO attack_src;

  IF md5(state_src) <> 'c97996c0e197a393000ea0a9d9716bee'
     OR md5(attack_src) <> 'd771f67455e3af4c407cab6666a1f326'
  THEN
    RAISE EXCEPTION 'Halloween 2026 RPC definitions changed; abort limit migration';
  END IF;

  IF position('''maxHitsToday'', 40' IN state_src) = 0
     OR position('IF v_hits >= 40 THEN' IN attack_src) = 0
  THEN
    RAISE EXCEPTION 'Expected Halloween 40-hit expressions missing; abort';
  END IF;

  state_src := replace(state_src, '''maxHitsToday'', 40', '''maxHitsToday'', 100');
  attack_src := replace(attack_src, 'IF v_hits >= 40 THEN', 'IF v_hits >= 100 THEN');

  EXECUTE state_src;
  EXECUTE attack_src;
END
$halloween_limit_100$;
