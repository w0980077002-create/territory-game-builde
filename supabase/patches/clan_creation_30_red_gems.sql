-- Run AFTER installing the clan schema and base function package.
-- One-time price 30 red diamonds; no gold is charged.
CREATE OR REPLACE FUNCTION public.clan_create(p_name text, p_tag text, p_emblem integer, p_color1 text, p_color2 text, p_description text, p_join_mode text, p_min_level integer, p_expected timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); p players%ROWTYPE;
v_name text; v_tag text; v_desc text; v_clan uuid;
BEGIN
IF v_uid IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT * INTO p FROM public.players WHERE id = v_uid AND NOT banned FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF p.updated_at <> p_expected THEN RAISE EXCEPTION 'clan_reload_save'; END IF;
IF p.level < 15 THEN RAISE EXCEPTION 'clan_level_required'; END IF;
IF EXISTS (SELECT 1 FROM clan_members WHERE player_id = v_uid) THEN RAISE EXCEPTION 'clan_already_member'; END IF;
IF (p.game_state->'player'->>'gold') !~ '^[0-9]{1,10}$'
  OR p.gold <> (p.game_state->'player'->>'gold')::integer
  OR (p.game_state->'player'->>'redGems') !~ '^[0-9]{1,10}$'
THEN RAISE EXCEPTION 'clan_invalid_wallet'; END IF;
IF (p.game_state->'player'->>'redGems')::bigint < 30
THEN RAISE EXCEPTION 'clan_not_enough_red_gems'; END IF;
v_name := regexp_replace(trim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
v_tag := upper(regexp_replace(trim(coalesce(p_tag, '')), '[[:space:]]', '', 'g'));
v_desc := left(regexp_replace(trim(coalesce(p_description, '')), E'[[:cntrl:]]', '', 'g'), 500);
IF char_length(v_name) < 3 OR char_length(v_name) > 20
OR v_name !~ '^[[:alpha:]][[:alnum:] ''-]*[[:alnum:]]$' THEN RAISE EXCEPTION 'clan_bad_name'; END IF;
IF char_length(v_tag) < 2 OR char_length(v_tag) > 5 OR v_tag !~ '^[A-ZА-ЯЁ0-9]+$' THEN RAISE EXCEPTION 'clan_bad_tag'; END IF;
IF p_join_mode NOT IN ('open','apply','closed') THEN RAISE EXCEPTION 'clan_bad_join_mode'; END IF;
IF p_min_level IS NULL OR p_min_level < 1 OR p_min_level > 50 THEN RAISE EXCEPTION 'clan_bad_min_level'; END IF;
IF p_emblem IS NULL OR p_emblem NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'clan_bad_emblem'; END IF;
IF p_color1 !~ '^#[0-9a-fA-F]{6}$' OR p_color2 !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'clan_bad_color'; END IF;
UPDATE players SET
game_state = jsonb_set(p.game_state, '{player,redGems}',
  to_jsonb((p.game_state->'player'->>'redGems')::integer - 30))
WHERE id = v_uid RETURNING * INTO p;
INSERT INTO clans(name, tag, emblem, color1, color2, description, join_mode, min_level, leader_id, buildings)
VALUES (v_name, v_tag, p_emblem, lower(p_color1), lower(p_color2), v_desc, p_join_mode, p_min_level, v_uid,
jsonb_build_object('hall', jsonb_build_object('lvl',1), 'forge', jsonb_build_object('lvl',0),
'library', jsonb_build_object('lvl',0), 'treasury', jsonb_build_object('lvl',0),
'tower', jsonb_build_object('lvl',0), 'heroes', jsonb_build_object('lvl',0)))
RETURNING id INTO v_clan;
INSERT INTO clan_members(clan_id, player_id, role, display_name, level, power)
VALUES (v_clan, v_uid, 'leader', coalesce(p.display_name, 'Hero'), p.level, p.attack + p.defense + p.level * 10);
INSERT INTO clan_treasury_log(clan_id, player_id, kind, gold, note)
VALUES (v_clan, v_uid, 'spend', 0, 'create_30_red_gems');
PERFORM clan_event(v_clan, 'create', 'clan_created');
RETURN jsonb_build_object('success', true, 'clan_id', v_clan, 'updated_at', p.updated_at,
'wallet_gold', p.gold, 'wallet_gems', p.gems, 'game_state', p.game_state);
END $function$;

