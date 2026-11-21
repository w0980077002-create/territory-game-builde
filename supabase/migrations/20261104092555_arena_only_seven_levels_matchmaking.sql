-- Already applied to live on 2026-11-04 (Supabase migration 20261104092555).
-- Match real Arena players by level only, inclusive +/-7.
-- Keep the old 10-argument signature to preserve arena_join compatibility.
-- Ratings, HP, attack and defense are used for combat but NEVER for matchmaking.
-- Bot fallback/timers from arena_start_room stay unchanged. No player data modified.

CREATE OR REPLACE FUNCTION public.arena_match_compatible(
  a_level integer, a_hp integer, a_attack integer, a_defense integer, a_rating integer,
  b_level integer, b_hp integer, b_attack integer, b_defense integer, b_rating integer
)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT abs(greatest(1, coalesce(a_level, 1)) - greatest(1, coalesce(b_level, 1))) <= 7;
$function$;

COMMENT ON FUNCTION public.arena_match_compatible(integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)
IS 'Arena REAL player matchmaking: level difference <= 7 only; ignores rating, HP, attack and defense. Existing enabled bot fallback remains unchanged.';

DO $verify$
BEGIN
  IF NOT public.arena_match_compatible(50,1,1,0,-999999,57,200000000,200000000,200000000,999999999) THEN
    RAISE EXCEPTION 'level +/-7 must be accepted despite extreme power and rating mismatch';
  END IF;
  IF NOT public.arena_match_compatible(57,200000000,200000000,200000000,999999999,50,1,1,0,-999999) THEN
    RAISE EXCEPTION 'matching must be symmetric';
  END IF;
  IF public.arena_match_compatible(50,1,1,0,1000,58,1,1,0,1000) THEN
    RAISE EXCEPTION 'level +8 must be rejected';
  END IF;
  IF public.arena_match_compatible(50,1,1,0,1000,42,1,1,0,1000) THEN
    RAISE EXCEPTION 'level -8 must be rejected';
  END IF;
END;
$verify$;
