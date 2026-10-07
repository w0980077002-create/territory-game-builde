/*
# Public player profile for the Top-100 list

1. Plain-English summary
   Lets any signed-in player open another player's card from the Top-100 list and see
   what they are wearing and their fighting stats. Wallet data (gold, blue gems, red gems,
   energy, inventory, quests) is never returned.

2. New functions
   - `public_player_profile(p_player uuid) returns jsonb`
     Returns: id, name, photo, level, vip, arena rating / wins / losses, attack, defense,
     max HP, crit chance, PvE wins, bosses defeated, current chapter, follower (name, level)
     and a sanitized list of equipped items (slot, name, rarity, level, attack, defense, hp, crit).
     Equipped data is rebuilt field by field from a whitelist: only the 7 known slots,
     only known rarities, text trimmed to 40 chars and numbers cast to integers.

3. Security
   - SECURITY DEFINER with a fixed search_path so it can read the owner-only `players` row,
     but it only ever returns the whitelisted public fields above.
   - EXECUTE revoked from PUBLIC/anon, granted to authenticated only.
   - No table privileges change.
*/

CREATE OR REPLACE FUNCTION public_player_profile(p_player uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v players%ROWTYPE;
  v_eq jsonb := '[]'::jsonb;
  v_slot text;
  v_item jsonb;
  v_follower jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v FROM players WHERE id = p_player;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  FOREACH v_slot IN ARRAY ARRAY['helmet','amulet','armor','weapon','shield','ring','boots'] LOOP
    v_item := v.game_state -> 'player' -> 'equipped' -> v_slot;
    IF v_item IS NOT NULL AND jsonb_typeof(v_item) = 'object' THEN
      v_eq := v_eq || jsonb_build_array(jsonb_build_object(
        'slot', v_slot,
        'name', left(COALESCE(v_item ->> 'name', ''), 40),
        'rarity', CASE WHEN v_item ->> 'rarity' IN ('common','rare','epic','legendary') THEN v_item ->> 'rarity' ELSE 'common' END,
        'level', CASE WHEN (v_item ->> 'level') ~ '^\d{1,4}$' THEN (v_item ->> 'level')::int ELSE 1 END,
        'attack', CASE WHEN (v_item ->> 'attack') ~ '^\d{1,5}$' THEN (v_item ->> 'attack')::int ELSE 0 END,
        'defense', CASE WHEN (v_item ->> 'defense') ~ '^\d{1,5}$' THEN (v_item ->> 'defense')::int ELSE 0 END,
        'hp', CASE WHEN (v_item ->> 'hp') ~ '^\d{1,6}$' THEN (v_item ->> 'hp')::int ELSE 0 END,
        'critChance', CASE WHEN (v_item ->> 'critChance') ~ '^\d{1,3}$' THEN (v_item ->> 'critChance')::int ELSE 0 END
      ));
    END IF;
  END LOOP;

  SELECT jsonb_build_object(
           'name', left(COALESCE(f ->> 'name', ''), 40),
           'level', CASE WHEN (f ->> 'level') ~ '^\d{1,4}$' THEN (f ->> 'level')::int ELSE 1 END)
    INTO v_follower
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.game_state -> 'followers') = 'array'
                                   THEN v.game_state -> 'followers' ELSE '[]'::jsonb END) f
   WHERE (f ->> 'unlocked') = 'true'
   LIMIT 1;

  RETURN jsonb_build_object(
    'id', v.id,
    'name', left(COALESCE(v.display_name, 'Воин'), 40),
    'photo', v.photo_url,
    'level', v.level,
    'vip', v.vip_level,
    'rating', v.arena_rating,
    'wins', v.arena_wins,
    'losses', v.arena_losses,
    'attack', v.attack,
    'defense', v.defense,
    'maxHp', v.max_hp,
    'critChance', v.crit_chance,
    'battlesWon', v.total_battles_won,
    'bosses', v.total_bosses_defeated,
    'chapter', v.current_chapter,
    'follower', v_follower,
    'equipped', v_eq
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public_player_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public_player_profile(uuid) TO authenticated;
