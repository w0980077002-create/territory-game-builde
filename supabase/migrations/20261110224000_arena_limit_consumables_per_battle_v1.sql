-- TERRITORY: enforce at most five uses of each consumable kind per player per arena room.
-- Existing battle records are retained; no player inventory, wallets, VIP, or progress is changed.
-- public.arena_secure_v1 locks arena_rooms before item use, serializing actions within a room.
CREATE INDEX IF NOT EXISTS arena_consumable_usage_room_kind_v1_idx
  ON territory_private.arena_consumable_usage_v1 (room_id, player_id, item_kind);

CREATE OR REPLACE FUNCTION territory_private.arena_limit_consumables_per_battle_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF (
    SELECT count(*)
    FROM territory_private.arena_consumable_usage_v1
    WHERE room_id = NEW.room_id
      AND player_id = NEW.player_id
      AND item_kind = NEW.item_kind
  ) >= 5 THEN
    RAISE EXCEPTION 'arena_item_kind_limit';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS arena_limit_consumables_per_battle_v1_trg
  ON territory_private.arena_consumable_usage_v1;
CREATE TRIGGER arena_limit_consumables_per_battle_v1_trg
  BEFORE INSERT ON territory_private.arena_consumable_usage_v1
  FOR EACH ROW
  EXECUTE FUNCTION territory_private.arena_limit_consumables_per_battle_v1();
