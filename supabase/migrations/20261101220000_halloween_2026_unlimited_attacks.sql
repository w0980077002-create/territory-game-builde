-- Halloween 2026: owner-authorized unlimited daily strikes until event closure.
-- Guard exact LIVE function definitions. This changes ONLY two RPC definitions:
-- preserve HP, rankings, timestamps, reward rules, users, balances and 8s cooldown.
-- Existing historic migration 20261101071516 remains unchanged.
DO $halloween_unlimited$
DECLARE
  state_src text;
  attack_src text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.territory_halloween_boss_state_v1()'::regprocedure)
    INTO state_src;
  SELECT pg_catalog.pg_get_functiondef('public.territory_halloween_boss_attack_v1()'::regprocedure)
    INTO attack_src;

  IF pg_catalog.md5(state_src) <> 'c90ca0ebc55db1138f3d755a4c8d4668'
     OR pg_catalog.md5(attack_src) <> 'c7231efbaae5e21fa93337e141090a2f'
  THEN
    RAISE EXCEPTION 'Halloween unlimited strikes aborted: live RPC definitions changed';
  END IF;
  IF pg_catalog.position('''maxHitsToday'', 100' IN state_src) = 0
     OR pg_catalog.position('IF v_hits >= 100 THEN RAISE EXCEPTION ''halloween_boss_daily_limit''; END IF;' IN attack_src) = 0
     OR pg_catalog.position('INTERVAL ''8 seconds''' IN attack_src) = 0
     OR pg_catalog.position('IF v_event.hp <= 0' IN attack_src) = 0
  THEN
    RAISE EXCEPTION 'Halloween unlimited strikes aborted: critical guard absent';
  END IF;

  -- NULL in JSON signifies unlimited. The client must explicitly support it.
  state_src := pg_catalog.replace(state_src,
    '''maxHitsToday'', 100',
    '''maxHitsToday'', NULL');
  attack_src := pg_catalog.replace(attack_src,
    'IF v_hits >= 100 THEN RAISE EXCEPTION ''halloween_boss_daily_limit''; END IF;',
    '-- Daily cap removed by owner; 8-second authenticated cooldown remains.');
  EXECUTE state_src;
  EXECUTE attack_src;
END
$halloween_unlimited$;
