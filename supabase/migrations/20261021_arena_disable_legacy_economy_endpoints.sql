-- The new app calls public.arena_secure_v1 with an exact save revision.
-- Deny the five obsolete direct reward, energy and belt APIs.
-- SECURITY DEFINER arena_secure_v1 can still call these internal functions.
REVOKE ALL ON FUNCTION public.arena_join(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arena_use_item(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arena_time_potion(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arena_revive(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arena_claim_reward(uuid) FROM PUBLIC, anon, authenticated;
