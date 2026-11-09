-- TERRITORY: Ten owner-controlled tester profiles must never impersonate chatters.
-- Preserve all live player's chat and existing Arena bot behavior.
-- Never suppress hit/block/crit/system/join/timeout battle messages.
CREATE OR REPLACE FUNCTION territory_private.silence_owner_testers_chat_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $tester_chat$
BEGIN
  IF NEW.kind IS DISTINCT FROM 'chat' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'arena_messages' THEN
    -- arena_chat sets author_id=arena_participants.id. The built-in
    -- bot-talk generator does not set author_id, only the room and name.
    IF EXISTS (
      SELECT 1
      FROM public.arena_participants ap
      JOIN territory_private.owner_test_bots_v1 controlled
        ON controlled.player_id = ap.user_id
      WHERE ap.room_id = NEW.room_id
        AND (
          (NEW.author_id IS NOT NULL AND NEW.author_id = ap.id)
          OR (NEW.author_id IS NULL AND NEW.author = ap.name)
        )
    ) THEN
      RETURN NULL;
    END IF;
  ELSIF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'clan_chat' THEN
    IF EXISTS (
      SELECT 1 FROM territory_private.owner_test_bots_v1 controlled
      WHERE controlled.player_id = NEW.author_id
    ) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$tester_chat$;

REVOKE ALL ON FUNCTION territory_private.silence_owner_testers_chat_v1()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS territory_silence_owner_testers_arena_chat_v1 ON public.arena_messages;
CREATE TRIGGER territory_silence_owner_testers_arena_chat_v1
BEFORE INSERT ON public.arena_messages
FOR EACH ROW
EXECUTE FUNCTION territory_private.silence_owner_testers_chat_v1();

DROP TRIGGER IF EXISTS territory_silence_owner_testers_clan_chat_v1 ON public.clan_chat;
CREATE TRIGGER territory_silence_owner_testers_clan_chat_v1
BEFORE INSERT ON public.clan_chat
FOR EACH ROW
EXECUTE FUNCTION territory_private.silence_owner_testers_chat_v1();
