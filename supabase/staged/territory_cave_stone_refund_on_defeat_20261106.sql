-- TERRITORY Cave: consumed at start, refunded exactly once at an authenticated
-- terminal loss/draw. Winner pays one stone. NOT a retroactive grant.
--
-- Safe rollout: replace only the existing private settlement function; keep
-- every existing server receipt and all player/equipment data unchanged.
-- Must run only after disposable PostgreSQL integration tests pass.
BEGIN;
DO $patch$
DECLARE
  original text;
  updated text;
  anchor text := $anchor$
 SELECT jsonb_build_object('success',true,'session_id',p_session,'outcome',outcome,'stage',r.stage,
$anchor$;
  refund_block text := $refund$
 -- cave_stone_refund_on_failed_terminal_20261106
 -- This runs before the durable unique session receipt is INSERTed. Retry exits
 -- at RETURN existing.receipt, so repeated resume/advance cannot mint stones.
 IF outcome <> 'hero_won' THEN
   UPDATE territory_private.dark_stones_v1 AS stones
     SET balance=stones.balance+1
     WHERE stones.player_id=p_player AND stones.balance < 2147483647;
   IF NOT FOUND THEN RAISE EXCEPTION 'cave_stone_refund_unavailable'; END IF;
 END IF;
$refund$;
  old_receipt text := $old$
   'completed_stage',completed_stage,'unlocked_stage',unlocked_stage,
$old$;
  new_receipt text := $new$
   'dark_stone_refunded',(outcome <> 'hero_won'),
   'completed_stage',completed_stage,'unlocked_stage',unlocked_stage,
$new$;
BEGIN
  IF to_regclass('territory_private.dark_stones_v1') IS NULL
    OR to_regclass('territory_private.adventure_settlements_v1') IS NULL
    THEN RAISE EXCEPTION 'Cave settlement/wallet schema missing'; END IF;

  original := pg_get_functiondef('territory_private.adventure_settle_v1(uuid,uuid)'::regprocedure);
  IF position('cave_stone_refund_on_failed_terminal_20261106' in original) > 0 THEN
    -- Idempotent reapplication; never re-credit any past sessions.
    RETURN;
  END IF;

  IF position('RETURN existing.receipt;' IN original) = 0
    OR position('INSERT INTO territory_private.adventure_settlements_v1' IN original) = 0
    OR position('outcome:=s.state->>''status'';' IN original) = 0
    THEN RAISE EXCEPTION 'Cave receipt protections changed; refuse patch'; END IF;

  IF length(original)-length(replace(original,anchor,'')) <> length(anchor)
    OR length(original)-length(replace(original,old_receipt,'')) <> length(old_receipt)
    THEN RAISE EXCEPTION 'Cave settlement anchors changed; refuse patch'; END IF;

  updated := replace(original,anchor,refund_block||anchor);
  updated := replace(updated,old_receipt,new_receipt);

  IF updated = original OR position('cave_stone_refund_on_failed_terminal_20261106' IN updated)=0
    THEN RAISE EXCEPTION 'Cave refund patch was not installed'; END IF;
  EXECUTE updated;
END $patch$;
COMMIT;
