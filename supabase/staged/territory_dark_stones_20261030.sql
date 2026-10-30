-- Territory 1.0: separate Dark Cave entrance currency, no changes to player saves.
-- First visit grants 5 stones. Each UTC day thereafter grants 3, up to 30.
CREATE TABLE IF NOT EXISTS territory_private.dark_stones_v1 (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 5 CHECK(balance >= 0),
  grant_day date NOT NULL DEFAULT (timezone('UTC',now())::date)
);
ALTER TABLE territory_private.dark_stones_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.dark_stones_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON territory_private.dark_stones_v1 TO service_role;

CREATE OR REPLACE FUNCTION territory_private.dark_stone_touch_v1(p_player uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $stone$
DECLARE today_utc date:=(timezone('UTC',now())::date); amount integer;
BEGIN
  INSERT INTO territory_private.dark_stones_v1(player_id,balance,grant_day)
    VALUES(p_player,5,today_utc) ON CONFLICT DO NOTHING;
  UPDATE territory_private.dark_stones_v1 SET
    balance=CASE WHEN balance<30 THEN least(30,balance+3) ELSE balance END,
    grant_day=today_utc
    WHERE player_id=p_player AND grant_day<today_utc;
  SELECT balance INTO amount FROM territory_private.dark_stones_v1 WHERE player_id=p_player FOR UPDATE;
  IF amount IS NULL THEN RAISE EXCEPTION 'combat_stone_balance_unavailable'; END IF;
  RETURN amount;
END $stone$;

CREATE OR REPLACE FUNCTION territory_private.dark_stone_take_v1(p_player uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $stone$
DECLARE after_debit integer;
BEGIN
  PERFORM territory_private.dark_stone_touch_v1(p_player);
  UPDATE territory_private.dark_stones_v1 SET balance=balance-1
    WHERE player_id=p_player AND balance>0 RETURNING balance INTO after_debit;
  IF NOT FOUND THEN RAISE EXCEPTION 'combat_no_dark_stones'; END IF;
  RETURN after_debit;
END $stone$;

REVOKE ALL ON FUNCTION territory_private.dark_stone_touch_v1(uuid),
  territory_private.dark_stone_take_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION territory_private.dark_stone_touch_v1(uuid),
  territory_private.dark_stone_take_v1(uuid) TO service_role;

-- The player's existing progress RPC now also supplies a server-owned stone balance.
CREATE OR REPLACE FUNCTION public.territory_adventure_progress_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $rpc$
DECLARE u uuid:=auth.uid(); completed integer; unlocked integer; stones integer;
BEGIN
  IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT coalesce(banned,false))
    THEN RAISE EXCEPTION 'adventure_account_unavailable'; END IF;
  stones:=territory_private.dark_stone_touch_v1(u);
  SELECT completed_stage,unlocked_stage INTO completed,unlocked
    FROM territory_private.adventure_progress_v1 WHERE player_id=u;
  RETURN jsonb_build_object('completed_stage',coalesce(completed,0),
    'unlocked_stage',coalesce(unlocked,1),'dark_stones',stones);
END $rpc$;
REVOKE ALL ON FUNCTION public.territory_adventure_progress_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_adventure_progress_v1() TO authenticated;

-- Patch only the obsolete battle-stone debit section of the deployed commit function.
-- Preserve all other live combat SQL and original receipt/replay transactions.
DO $patch$
DECLARE source_sql text; revised_sql text; marker text;
  start_at integer; end_at integer; rel_at integer;
  replacement text:=$replace$
    PERFORM territory_private.dark_stone_take_v1(p_player);
    SELECT * INTO wallet FROM public.players WHERE id=p_player FOR UPDATE;
    IF jsonb_typeof(wallet.game_state->'battleStones') IS DISTINCT FROM 'number'
      OR (wallet.game_state->>'battleStones')::numeric < 0
      OR (wallet.game_state->>'battleStones')::numeric > 2147483647
      OR trunc((wallet.game_state->>'battleStones')::numeric) <> (wallet.game_state->>'battleStones')::numeric
      THEN RAISE EXCEPTION 'combat_invalid_battle_stones'; END IF;
    available_stones := (wallet.game_state->>'battleStones')::bigint;
    UPDATE public.players SET updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond')
      WHERE id=p_player RETURNING * INTO wallet;$replace$;
BEGIN
  source_sql:=pg_get_functiondef('public.territory_combat_commit_v1(uuid,jsonb,jsonb,jsonb)'::regprocedure);
  IF position('dark_stone_take_v1' in source_sql)>0 THEN RETURN; END IF;
  IF position('adventure_no_battle_stones' in source_sql)=0 THEN
    RAISE EXCEPTION 'Unexpected combat version; no live code was replaced';
  END IF;
  start_at:=position('IF jsonb_typeof(wallet.game_state->''battleStones'')' in source_sql);
  marker:='WHERE id=p_player RETURNING * INTO wallet;';
  rel_at:=position(marker in substring(source_sql from start_at));
  IF start_at=0 OR rel_at=0 THEN RAISE EXCEPTION 'Could not identify legacy stone debit'; END IF;
  end_at:=start_at+rel_at-1+length(marker);
  revised_sql:=substring(source_sql from 1 for start_at-1)||replacement||substring(source_sql from end_at);
  revised_sql:=replace(revised_sql,'''battle_stones'',available_stones-1',
    '''battle_stones'',available_stones');
  IF revised_sql=source_sql OR position('adventure_no_battle_stones' in revised_sql)>0
    OR position('''battle_stones'',available_stones-1' in revised_sql)>0
    THEN RAISE EXCEPTION 'Legacy debit not completely replaced'; END IF;
  EXECUTE revised_sql;
END $patch$;
