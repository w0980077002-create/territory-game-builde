-- Applied to live Supabase by migration 20261116183223.
-- Skip physical UPDATE of public.leaderboard for no-op player saves. New rows
-- and genuine ranking/appearance/stat changes still upsert as before.
-- Original trigger, RLS, grants and economy receipts remain unchanged.
CREATE OR REPLACE FUNCTION public.update_leaderboard_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
INSERT INTO leaderboard (player_id, display_name, level, arena_rating, total_battles_won, arena_wins,
photo_url, attack, defense, max_hp, crit_chance)
VALUES (NEW.id, NEW.display_name, NEW.level, NEW.arena_rating, NEW.total_battles_won, NEW.arena_wins,
NEW.photo_url, NEW.attack, NEW.defense, NEW.max_hp, NEW.crit_chance)
ON CONFLICT (player_id) DO UPDATE SET
display_name = EXCLUDED.display_name,
level = EXCLUDED.level,
arena_rating = EXCLUDED.arena_rating,
total_battles_won = EXCLUDED.total_battles_won,
arena_wins = EXCLUDED.arena_wins,
photo_url = EXCLUDED.photo_url,
attack = EXCLUDED.attack,
defense = EXCLUDED.defense,
max_hp = EXCLUDED.max_hp,
crit_chance = EXCLUDED.crit_chance,
updated_at = now()
WHERE (leaderboard.display_name, leaderboard.level, leaderboard.arena_rating,
       leaderboard.total_battles_won, leaderboard.arena_wins, leaderboard.photo_url,
       leaderboard.attack, leaderboard.defense, leaderboard.max_hp, leaderboard.crit_chance)
  IS DISTINCT FROM
      (EXCLUDED.display_name, EXCLUDED.level, EXCLUDED.arena_rating,
       EXCLUDED.total_battles_won, EXCLUDED.arena_wins, EXCLUDED.photo_url,
       EXCLUDED.attack, EXCLUDED.defense, EXCLUDED.max_hp, EXCLUDED.crit_chance);
RETURN NEW;
END;
$function$
