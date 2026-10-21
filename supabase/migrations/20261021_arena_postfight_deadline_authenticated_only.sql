-- Arena post-fight deadline is a private, authenticated participant RPC.
-- This only fixes the access grant, without changing its 30-minute behavior.
REVOKE ALL ON FUNCTION public.arena_postfight_deadline(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.arena_postfight_deadline(uuid)
  TO authenticated;
