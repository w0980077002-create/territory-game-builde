-- Read-only pg_get_functiondef snapshot verified on 2026-11-15.
-- ISOLATED TEST INPUT ONLY. Do not deploy or replace this live wallet helper.
CREATE OR REPLACE FUNCTION territory_private.dark_stone_touch_v1(p_player uuid)
RETURNS integer LANGUAGE plpgsql SET search_path='' AS $$
DECLARE today_utc date:=(timezone('UTC',now())::date); amount integer;
BEGIN
  INSERT INTO territory_private.dark_stones_v1(player_id,balance,grant_day)
    VALUES(p_player,5,today_utc) ON CONFLICT DO NOTHING;
  UPDATE territory_private.dark_stones_v1 SET
    balance=CASE WHEN balance<30 THEN least(30,balance+3) ELSE balance END,
    grant_day=today_utc WHERE player_id=p_player AND grant_day<today_utc;
  SELECT balance INTO amount FROM territory_private.dark_stones_v1 WHERE player_id=p_player FOR UPDATE;
  IF amount IS NULL THEN RAISE EXCEPTION 'combat_stone_balance_unavailable'; END IF;
  RETURN amount;
END $$;
