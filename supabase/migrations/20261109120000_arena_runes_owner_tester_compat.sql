-- 2026-11-09 Arena hotfix: owner-managed testers are genuine linked player profiles
-- even when their Arena actions are AI-controlled (arena_participants.is_bot=true).
-- Preserve the established rune snapshot CHECK and ordinary NPC behavior: the
-- rune snapshot is_bot flag denotes an unlinked/generated NPC rune loadout.
-- Does not touch players, balances, existing battle results or matchmaking.
CREATE OR REPLACE FUNCTION territory_private.runes_pin_arena_room_v1(p_room uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $pin$
DECLARE
  fighter record;
  snap jsonb;
  effects jsonb;
  existing territory_private.rune_arena_fighters_v1%ROWTYPE;
BEGIN
  IF p_room IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.arena_rooms WHERE id=p_room AND status='waiting'
  ) THEN
    RAISE EXCEPTION 'rune_arena_invalid_start';
  END IF;

  FOR fighter IN
    SELECT id,user_id,is_bot FROM public.arena_participants
    WHERE room_id=p_room ORDER BY user_id NULLS LAST,id
  LOOP
    SELECT * INTO existing
    FROM territory_private.rune_arena_fighters_v1
    WHERE room_id=p_room AND participant_id=fighter.id;

    IF FOUND THEN
      IF existing.player_id IS DISTINCT FROM fighter.user_id
         OR existing.is_bot IS DISTINCT FROM (fighter.user_id IS NULL)
      THEN
        RAISE EXCEPTION 'rune_arena_participant_changed';
      END IF;
      CONTINUE;
    END IF;

    IF fighter.user_id IS NULL THEN
      IF NOT fighter.is_bot THEN
        RAISE EXCEPTION 'rune_arena_invalid_participant';
      END IF;
      -- Generated NPC with no player account: explicitly empty rune build.
      SELECT jsonb_build_object('schema','territory-rune-bot-snapshot/1','slots',
        jsonb_agg(jsonb_build_object('slotId',slot_id,'runeId',NULL,'level',0)
                  ORDER BY slot_id))
      INTO snap
      FROM (SELECT DISTINCT slot_id FROM territory_private.rune_catalog_v1) slots;
      effects:='{}'::jsonb;
    ELSE
      -- A bot-controlled, account-linked fighter must be a registered owner
      -- tester. It uses its own legitimate owned runes, never forged ownership.
      IF fighter.is_bot AND NOT EXISTS (
        SELECT 1 FROM territory_private.owner_test_bots_v1
        WHERE player_id=fighter.user_id
      ) THEN
        RAISE EXCEPTION 'rune_arena_invalid_participant';
      END IF;
      snap:=public.territory_runes_pin_battle_v1(fighter.user_id,p_room,'arena');
      effects:=public.territory_runes_battle_effects_v1(fighter.user_id,p_room,'arena')->'totals';
    END IF;

    INSERT INTO territory_private.rune_arena_fighters_v1
      (room_id,participant_id,player_id,is_bot,snapshot,totals)
    VALUES
      (p_room,fighter.id,fighter.user_id,(fighter.user_id IS NULL),snap,effects);
  END LOOP;
END
$pin$;

REVOKE ALL ON FUNCTION territory_private.runes_pin_arena_room_v1(uuid)
FROM PUBLIC,anon,authenticated,service_role;
