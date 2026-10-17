CREATE OR REPLACE FUNCTION public.clan_accept_app(p_player uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_clan uuid;
BEGIN
IF v_uid IS NULL OR p_player IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT role, clan_id INTO v_role, v_clan FROM clan_members WHERE player_id = v_uid;
IF v_clan IS NULL OR v_role NOT IN ('leader','deputy','officer') THEN RAISE EXCEPTION 'clan_no_permission'; END IF;
IF NOT EXISTS (SELECT 1 FROM clan_applications WHERE clan_id = v_clan AND player_id = p_player) THEN
RAISE EXCEPTION 'clan_no_application';
END IF;
DELETE FROM clan_applications WHERE clan_id = v_clan AND player_id = p_player;
PERFORM clan_join_internal(v_clan, p_player);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_accept_invite(p_clan uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
IF v_uid IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF EXISTS (SELECT 1 FROM clan_members WHERE player_id = v_uid) THEN RAISE EXCEPTION 'clan_already_member'; END IF;
IF NOT EXISTS (SELECT 1 FROM clan_invites WHERE clan_id = p_clan AND player_id = v_uid) THEN
RAISE EXCEPTION 'clan_no_invite';
END IF;
DELETE FROM clan_invites WHERE clan_id = p_clan AND player_id = v_uid;
PERFORM clan_join_internal(p_clan, v_uid);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_apply(p_clan uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); c clans%ROWTYPE;
BEGIN
IF v_uid IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF EXISTS (SELECT 1 FROM clan_members WHERE player_id = v_uid) THEN RAISE EXCEPTION 'clan_already_member'; END IF;
SELECT * INTO c FROM clans WHERE id = p_clan;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_not_found'; END IF;
IF c.join_mode = 'closed' THEN RAISE EXCEPTION 'clan_closed'; END IF;
IF c.join_mode = 'open' THEN
PERFORM clan_join_internal(p_clan, v_uid);
RETURN;
END IF;
INSERT INTO clan_applications(clan_id, player_id) VALUES (p_clan, v_uid);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_boss_attack(p_clan uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); p players%ROWTYPE; b clan_bosses%ROWTYPE;
v_dmg bigint; v_today int; v_cap int; v_frge int; v_hp bigint; v_killed boolean;
BEGIN
IF v_uid IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF NOT EXISTS (SELECT 1 FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid) THEN
RAISE EXCEPTION 'clan_not_member';
END IF;
PERFORM clan_boss_sync(p_clan);
SELECT * INTO p FROM players WHERE id = v_uid AND NOT banned FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT * INTO b FROM clan_bosses WHERE clan_id = p_clan FOR UPDATE;
IF NOT FOUND OR b.killed_at IS NOT NULL OR b.expires_at <= now() THEN RAISE EXCEPTION 'clan_boss_gone'; END IF;
v_today := (SELECT count(*) FROM clan_boss_damage WHERE clan_id = p_clan AND player_id = v_uid AND day = current_date);
v_cap := 5 + CASE WHEN COALESCE((SELECT (buildings->'heroes'->>'lvl')::int FROM clans WHERE id = p_clan), 0) >= 5 THEN 1 ELSE 0 END;
IF v_today >= v_cap THEN RAISE EXCEPTION 'clan_boss_limit'; END IF;
SELECT COALESCE((buildings->'forge'->>'lvl')::int, 0) INTO v_frge FROM clans WHERE id = p_clan;
v_dmg := round((p.attack + p.defense * 0.5 + p.level * 10) * (0.9 + random() * 0.25) * (1 + v_frge * 0.01))::bigint;
v_dmg := greatest(50, least(v_dmg, b.hp));
UPDATE clan_bosses SET hp = hp - v_dmg,
phase = greatest(1, least(3, 1 + floor((max_hp - (hp - v_dmg)) * 3 / max_hp)::int)),
killed_at = CASE WHEN hp - v_dmg <= 0 THEN now() ELSE killed_at END
WHERE clan_id = p_clan
RETURNING hp, killed_at IS NOT NULL INTO v_hp, v_killed;
INSERT INTO clan_boss_damage(clan_id, boss_no, player_id, damage) VALUES (p_clan, b.boss_no, v_uid, v_dmg);
PERFORM clan_xp_add(p_clan, 5);
RETURN jsonb_build_object('damage', v_dmg, 'boss_hp', v_hp, 'max_hp', b.max_hp,
'killed', v_killed, 'attacks_left', v_cap - v_today - 1, 'boss_no', b.boss_no);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_boss_claim(p_clan uuid, p_expected timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); p players%ROWTYPE; b clan_bosses%ROWTYPE;
v_mine bigint; v_total bigint; v_pool int; v_gold int; v_pts int; m clan_members%ROWTYPE;
BEGIN
IF v_uid IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT * INTO m FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_not_member'; END IF;
SELECT * INTO b FROM clan_bosses WHERE clan_id = p_clan;
IF NOT FOUND OR b.killed_at IS NULL THEN RAISE EXCEPTION 'clan_boss_alive'; END IF;
SELECT COALESCE(sum(damage), 0) INTO v_mine FROM clan_boss_damage
WHERE clan_id = p_clan AND boss_no = b.boss_no AND player_id = v_uid;
SELECT COALESCE(sum(damage), 0) INTO v_total FROM clan_boss_damage
WHERE clan_id = p_clan AND boss_no = b.boss_no;
IF v_mine < 1 THEN RAISE EXCEPTION 'clan_boss_no_damage'; END IF;
IF EXISTS (SELECT 1 FROM clan_boss_claims WHERE clan_id = p_clan AND boss_no = b.boss_no AND player_id = v_uid) THEN
RAISE EXCEPTION 'clan_boss_claimed';
END IF;
SELECT * INTO p FROM public.players WHERE id = v_uid AND NOT banned FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF p.updated_at <> p_expected THEN RAISE EXCEPTION 'clan_reload_save'; END IF;
IF (p.game_state->'player'->>'gold') !~ '^[0-9]{1,10}$' OR p.gold <> (p.game_state->'player'->>'gold')::integer THEN
RAISE EXCEPTION 'clan_invalid_wallet';
END IF;
v_pool := 500 * b.boss_no;
v_gold := greatest(50, round(v_pool * v_mine / greatest(v_total, 1)))::int;
IF p.gold::bigint + v_gold > 2147483647 THEN RAISE EXCEPTION 'clan_invalid_wallet'; END IF;
v_pts := 50 * b.boss_no;
UPDATE players SET game_state = jsonb_set(p.game_state, '{player,gold}', to_jsonb(p.gold + v_gold)),
gold = p.gold + v_gold WHERE id = v_uid RETURNING * INTO p;
INSERT INTO clan_boss_claims(clan_id, boss_no, player_id, gold) VALUES (p_clan, b.boss_no, v_uid, v_gold);
UPDATE clans SET treasury_points = treasury_points + v_pts, updated_at = now() WHERE id = p_clan;
INSERT INTO clan_treasury_log(clan_id, player_id, kind, gold, points, note) VALUES (p_clan, NULL, 'reward', 0, v_pts, 'boss_kill');
PERFORM clan_xp_add(p_clan, 100 + 10 * b.boss_no);
PERFORM clan_level_recheck(p_clan);
RETURN jsonb_build_object('success', true, 'gold', v_gold, 'updated_at', p.updated_at,
'wallet_gold', p.gold, 'wallet_gems', p.gems, 'game_state', p.game_state);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_boss_max_hp(p_no integer)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
SELECT round(50000 * power(p_no::numeric, 1.3));
$function$;

CREATE OR REPLACE FUNCTION public.clan_boss_sync(p_clan uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c clans%ROWTYPE; b clan_bosses%ROWTYPE;
BEGIN
SELECT * INTO c FROM clans WHERE id = p_clan FOR UPDATE;
IF NOT FOUND THEN RETURN; END IF;
SELECT * INTO b FROM clan_bosses WHERE clan_id = p_clan FOR UPDATE;
IF FOUND AND b.killed_at IS NULL AND b.expires_at > now() THEN RETURN; END IF;
IF FOUND AND b.killed_at IS NOT NULL AND c.boss_no = b.boss_no THEN
UPDATE clans SET boss_no = c.boss_no + 1 WHERE id = p_clan;
c.boss_no := c.boss_no + 1;
END IF;
INSERT INTO clan_bosses(clan_id, boss_no, max_hp, hp, spawned_at, expires_at)
VALUES (p_clan, c.boss_no, clan_boss_max_hp(c.boss_no), clan_boss_max_hp(c.boss_no),
now(), now() + interval '3 days')
ON CONFLICT (clan_id) DO UPDATE SET boss_no = EXCLUDED.boss_no, max_hp = EXCLUDED.max_hp,
hp = EXCLUDED.hp, phase = 1, spawned_at = EXCLUDED.spawned_at, expires_at = EXCLUDED.expires_at,
killed_at = NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.clan_building_collect(p_clan uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b jsonb; k text; v_done boolean := false; v_now timestamptz := now();
BEGIN
SELECT buildings INTO b FROM clans WHERE id = p_clan FOR UPDATE;
IF NOT FOUND THEN RETURN; END IF;
FOR k IN SELECT jsonb_object_keys(b) LOOP
IF b->k ? 'until' AND (b->k->>'until')::timestamptz <= v_now THEN
b := jsonb_set(b, ARRAY[k,'lvl'], to_jsonb(COALESCE(b->k->>'lvl','0')::int + 1));
b := jsonb_set(b, ARRAY[k], (b->k) - 'until');
v_done := true;
END IF;
END LOOP;
IF v_done THEN
UPDATE clans SET buildings = b, updated_at = now() WHERE id = p_clan;
PERFORM clan_event(p_clan, 'build', 'building_done');
END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.clan_building_upgrade(p_clan uuid, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; b jsonb; c clans%ROWTYPE;
v_lvl int; v_gold int; v_pts int; v_min int;
BEGIN
IF v_uid IS NULL OR p_key IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF p_key NOT IN ('hall','forge','library','treasury','tower','heroes') THEN RAISE EXCEPTION 'clan_bad_building'; END IF;
SELECT role INTO v_role FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid;
IF v_role NOT IN ('leader','deputy') THEN RAISE EXCEPTION 'clan_no_permission'; END IF;
PERFORM clan_building_collect(p_clan);
SELECT * INTO c FROM clans WHERE id = p_clan FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_not_found'; END IF;
b := c.buildings;
IF b->p_key ? 'until' THEN RAISE EXCEPTION 'clan_building_busy'; END IF;
v_lvl := COALESCE((b->p_key->>'lvl')::int, 0);
IF v_lvl >= 10 THEN RAISE EXCEPTION 'clan_building_max'; END IF;
v_min := CASE WHEN p_key = 'hall' THEN v_lvl ELSE COALESCE((b->'hall'->>'lvl')::int, 1) END;
IF c.level < v_min OR v_lvl >= v_min THEN RAISE EXCEPTION 'clan_building_locked'; END IF;
v_gold := (v_lvl + 1) * 800;
v_pts := (v_lvl + 1) * 20;
IF c.treasury_gold < v_gold OR c.treasury_points < v_pts THEN RAISE EXCEPTION 'clan_treasury_low'; END IF;
UPDATE clans SET
treasury_gold = treasury_gold - v_gold, treasury_points = treasury_points - v_pts,
buildings = jsonb_set(b, ARRAY[p_key,'until'], to_jsonb(now() + ((v_lvl + 1) * 10) * interval '1 minute')),
updated_at = now()
WHERE id = p_clan;
INSERT INTO clan_treasury_log(clan_id, player_id, kind, gold, points, note)
VALUES (p_clan, v_uid, 'spend', -v_gold, -v_pts, p_key);
PERFORM clan_event(p_clan, 'build', 'building_started:' || p_key);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_cancel_application(p_clan uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DELETE FROM clan_applications WHERE clan_id = p_clan AND player_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.clan_capacity(p_hall integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
SELECT least(100, 20 + 8 * greatest(0, p_hall - 1));
$function$;

CREATE OR REPLACE FUNCTION public.clan_chat_mute(p_clan uuid, p_player uuid, p_minutes integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_target text;
BEGIN
IF v_uid IS NULL OR p_player IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF p_minutes IS NULL OR p_minutes < 5 OR p_minutes > 1440 THEN RAISE EXCEPTION 'clan_bad_mute'; END IF;
SELECT role INTO v_role FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid;
SELECT role INTO v_target FROM clan_members WHERE clan_id = p_clan AND player_id = p_player;
IF v_role IS NULL OR v_target IS NULL OR v_target = 'leader' THEN RAISE EXCEPTION 'clan_no_permission'; END IF;
IF NOT (v_role = 'leader' OR (v_role = 'deputy' AND v_target <> 'deputy')
OR (v_role = 'officer' AND v_target IN ('veteran','member'))) THEN
RAISE EXCEPTION 'clan_no_permission';
END IF;
INSERT INTO clan_chat_mutes(clan_id, player_id, until) VALUES (p_clan, p_player, now() + p_minutes * interval '1 minute')
ON CONFLICT (clan_id, player_id) DO UPDATE SET until = now() + p_minutes * interval '1 minute';
END $function$;

CREATE OR REPLACE FUNCTION public.clan_chat_send(p_clan uuid, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_name text; v_body text; v_mute timestamptz;
BEGIN
IF v_uid IS NULL OR p_body IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT role, display_name INTO v_role, v_name FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid;
IF v_role IS NULL THEN RAISE EXCEPTION 'clan_not_member'; END IF;
SELECT until INTO v_mute FROM clan_chat_mutes WHERE clan_id = p_clan AND player_id = v_uid;
IF v_mute IS NOT NULL AND v_mute > now() THEN RAISE EXCEPTION 'clan_muted'; END IF;
IF (SELECT count(*) FROM clan_chat WHERE author_id = v_uid AND created_at > now() - interval '30 seconds') >= 5 THEN
RAISE EXCEPTION 'clan_chat_slow';
END IF;
v_body := trim(regexp_replace(p_body, E'[[:cntrl:]]', '', 'g'));
IF char_length(v_body) < 1 OR char_length(v_body) > 300 THEN RAISE EXCEPTION 'clan_chat_bad'; END IF;
INSERT INTO clan_chat(clan_id, author_id, author_name, author_role, kind, body)
VALUES (p_clan, v_uid, coalesce(v_name, 'Hero'), v_role, 'chat', v_body);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_contribute(p_clan uuid, p_gold integer, p_materials integer, p_expected timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); p players%ROWTYPE; c clans%ROWTYPE; m clan_members%ROWTYPE;
v_points int; v_eff numeric; v_tr int; v_base int;
BEGIN
IF v_uid IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF p_gold IS NULL OR p_gold < 0 OR p_gold > 1000000 THEN RAISE EXCEPTION 'clan_bad_amount'; END IF;
IF p_materials IS NULL OR p_materials < 0 OR p_materials > 10000 THEN RAISE EXCEPTION 'clan_bad_amount'; END IF;
IF p_gold = 0 AND p_materials = 0 THEN RAISE EXCEPTION 'clan_bad_amount'; END IF;
SELECT * INTO m FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_not_member'; END IF;
SELECT * INTO c FROM clans WHERE id = p_clan FOR UPDATE;
SELECT * INTO p FROM public.players WHERE id = v_uid AND NOT banned FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF p.updated_at <> p_expected THEN RAISE EXCEPTION 'clan_reload_save'; END IF;
IF (p.game_state->'player'->>'gold') !~ '^[0-9]{1,10}$' OR p.gold <> (p.game_state->'player'->>'gold')::integer
OR p.gold < p_gold THEN RAISE EXCEPTION 'clan_not_enough_gold'; END IF;
IF (p.game_state->>'forgeMaterials') !~ '^[0-9]{1,8}$'
OR p.forge_materials <> (p.game_state->>'forgeMaterials')::integer
OR p.forge_materials < p_materials THEN RAISE EXCEPTION 'clan_not_enough_materials'; END IF;

UPDATE players SET
game_state = jsonb_set(jsonb_set(p.game_state, '{player,gold}', to_jsonb(p.gold - p_gold)),
'{forgeMaterials}', to_jsonb(p.forge_materials - p_materials)),
gold = p.gold - p_gold,
forge_materials = p.forge_materials - p_materials
WHERE id = v_uid RETURNING * INTO p;

SELECT COALESCE((c.buildings->'treasury'->>'lvl')::int, 0) INTO v_tr;
v_eff := 1 + v_tr * 0.02;
v_points := round(p_gold::numeric / 100.0 * v_eff)::int + floor(p_materials / 2.0)::int;
v_base := least(floor(p_gold::numeric / 200.0 + p_materials / 20.0)::int, 5000);

UPDATE clans SET treasury_gold = treasury_gold + p_gold, treasury_points = treasury_points + v_points,
updated_at = now() WHERE id = p_clan;
UPDATE clan_members SET contributed_gold = contributed_gold + p_gold,
contributed_points = contributed_points + v_points WHERE clan_id = p_clan AND player_id = v_uid;
INSERT INTO clan_treasury_log(clan_id, player_id, kind, gold, points, note)
VALUES (p_clan, v_uid, 'deposit', p_gold, v_points, 'contribution');
PERFORM clan_xp_add(p_clan, v_base);
PERFORM clan_level_recheck(p_clan);
RETURN jsonb_build_object('success', true, 'updated_at', p.updated_at,
'wallet_gold', p.gold, 'wallet_gems', p.gems, 'game_state', p.game_state,
'treasury_gold', c.treasury_gold + p_gold, 'treasury_points', c.treasury_points + v_points);
END $function$;

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

CREATE OR REPLACE FUNCTION public.clan_decline_invite(p_clan uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DELETE FROM clan_invites WHERE clan_id = p_clan AND player_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.clan_directory(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_q text; v_uid uuid := auth.uid();
BEGIN
PERFORM clan_season_ensure();
PERFORM clan_war_resolve_if_done();
v_q := lower(coalesce(trim(p_query), ''));
RETURN jsonb_build_object(
'my_clan_id', (SELECT clan_id FROM clan_members WHERE player_id = v_uid),
'my_invites', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'clan_id', i.clan_id, 'name', c.name,
'tag', c.tag, 'emblem', c.emblem, 'color1', c.color1, 'color2', c.color2, 'members',
(SELECT count(*) FROM clan_members cm WHERE cm.clan_id = i.clan_id)) ORDER BY i.id)
, '[]'::jsonb)
FROM clan_invites i JOIN clans c ON c.id = i.clan_id WHERE i.player_id = v_uid),
'my_applications', (SELECT COALESCE(jsonb_agg(i.clan_id), '[]'::jsonb) FROM clan_applications i WHERE i.player_id = v_uid),
'clans', (
SELECT COALESCE(jsonb_agg(x ORDER BY x.rating DESC), '[]'::jsonb) FROM (
SELECT jsonb_build_object('id', c.id, 'name', c.name, 'tag', c.tag, 'emblem', c.emblem,
'color1', c.color1, 'color2', c.color2, 'level', c.level, 'rating', c.rating,
'season_medal', c.season_medal, 'join_mode', c.join_mode, 'min_level', c.min_level,
'description', c.description,
'members', (SELECT count(*) FROM clan_members cm WHERE cm.clan_id = c.id),
'capacity', clan_capacity(COALESCE((c.buildings->'hall'->>'lvl')::int, 1)),
'online', (SELECT count(*) FROM clan_members cm WHERE cm.clan_id = c.id AND cm.last_active_at > now() - interval '5 minutes')
) AS x
FROM clans c
WHERE v_q = '' OR lower(c.name) LIKE '%' || v_q || '%' OR lower(c.tag) LIKE '%' || v_q || '%'
ORDER BY c.rating DESC LIMIT 50
) t
)
);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_event(p_clan uuid, p_kind text, p_body text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
INSERT INTO clan_events(clan_id, kind, body) VALUES (p_clan, p_kind, p_body);
$function$;

CREATE OR REPLACE FUNCTION public.clan_invite_player(p_player uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_clan uuid;
BEGIN
IF v_uid IS NULL OR p_player IS NULL OR p_player = v_uid THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT role, clan_id INTO v_role, v_clan FROM clan_members WHERE player_id = v_uid;
IF v_clan IS NULL OR v_role NOT IN ('leader','deputy','officer') THEN RAISE EXCEPTION 'clan_no_permission'; END IF;
IF EXISTS (SELECT 1 FROM clan_members WHERE player_id = p_player) THEN RAISE EXCEPTION 'clan_already_member'; END IF;
INSERT INTO clan_invites(clan_id, player_id, invited_by) VALUES (v_clan, p_player, v_uid);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_join_internal(p_clan uuid, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c clans%ROWTYPE; p players%ROWTYPE; v_count int;
BEGIN
SELECT * INTO c FROM clans WHERE id = p_clan FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_not_found'; END IF;
SELECT count(*) INTO v_count FROM clan_members WHERE clan_id = p_clan;
IF v_count >= clan_capacity(COALESCE((c.buildings->'hall'->>'lvl')::int, 1)) THEN RAISE EXCEPTION 'clan_full'; END IF;
SELECT * INTO p FROM players WHERE id = p_uid AND NOT banned;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF p.level < c.min_level THEN RAISE EXCEPTION 'clan_level_required'; END IF;
INSERT INTO clan_members(clan_id, player_id, role, display_name, level, power)
VALUES (p_clan, p_uid, 'member', coalesce(p.display_name, 'Hero'), p.level, p.attack + p.defense + p.level * 10);
DELETE FROM clan_applications WHERE clan_id = p_clan AND player_id = p_uid;
DELETE FROM clan_invites WHERE clan_id = p_clan AND player_id = p_uid;
PERFORM clan_event(p_clan, 'join', 'member_joined');
PERFORM clan_xp_add(p_clan, 20);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_kick(p_player uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_target text; v_clan uuid;
BEGIN
IF v_uid IS NULL OR p_player IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT role, clan_id INTO v_role, v_clan FROM clan_members WHERE player_id = v_uid;
IF v_clan IS NULL THEN RAISE EXCEPTION 'clan_not_member'; END IF;
SELECT role INTO v_target FROM clan_members WHERE clan_id = v_clan AND player_id = p_player;
IF v_target IS NULL THEN RAISE EXCEPTION 'clan_no_such_member'; END IF;
IF NOT ( (v_role = 'leader' AND v_target <> 'leader')
OR (v_role = 'deputy' AND v_target IN ('officer','veteran','member'))
OR (v_role = 'officer' AND v_target = 'member') ) THEN
RAISE EXCEPTION 'clan_no_permission';
END IF;
DELETE FROM clan_members WHERE clan_id = v_clan AND player_id = p_player;
DELETE FROM clan_chat_mutes WHERE clan_id = v_clan AND player_id = p_player;
PERFORM clan_event(v_clan, 'kick', 'member_kicked');
END $function$;

CREATE OR REPLACE FUNCTION public.clan_leave()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_clan uuid; v_left int; v_next uuid;
BEGIN
IF v_uid IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT role, clan_id INTO v_role, v_clan FROM clan_members WHERE player_id = v_uid;
IF v_clan IS NULL THEN RAISE EXCEPTION 'clan_not_member'; END IF;
IF v_role = 'leader' THEN
SELECT count(*) INTO v_left FROM clan_members WHERE clan_id = v_clan AND player_id <> v_uid;
IF v_left > 0 THEN RAISE EXCEPTION 'clan_leader_must_transfer'; END IF;
DELETE FROM clans WHERE id = v_clan;
RETURN;
END IF;
DELETE FROM clan_members WHERE player_id = v_uid;
DELETE FROM clan_chat_mutes WHERE clan_id = v_clan AND player_id = v_uid;
SELECT player_id INTO v_next FROM clan_members WHERE clan_id = v_clan
ORDER BY CASE role WHEN 'deputy' THEN 1 WHEN 'officer' THEN 2 WHEN 'veteran' THEN 3 ELSE 4 END, power DESC LIMIT 1;
IF v_next IS NOT NULL THEN
UPDATE clans SET leader_id = v_next, updated_at = now() WHERE id = v_clan;
UPDATE clan_members SET role = 'leader' WHERE clan_id = v_clan AND player_id = v_next;
END IF;
PERFORM clan_event(v_clan, 'leave', 'member_left');
END $function$;

CREATE OR REPLACE FUNCTION public.clan_level_recheck(p_clan uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_xp int; v_lvl int;
BEGIN
SELECT xp, level INTO v_xp, v_lvl FROM clans WHERE id = p_clan;
WHILE v_lvl < 50 AND v_xp >= clan_xp_needed(v_lvl) LOOP
v_xp := v_xp - clan_xp_needed(v_lvl);
v_lvl := v_lvl + 1;
END LOOP;
UPDATE clans SET xp = v_xp, level = v_lvl WHERE id = p_clan;
END $function$;

CREATE OR REPLACE FUNCTION public.clan_my_role(p_clan uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT role FROM clan_members WHERE clan_id = p_clan AND player_id = p_uid;
$function$;

CREATE OR REPLACE FUNCTION public.clan_profile(p_player uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT COALESCE(
(SELECT jsonb_build_object('clan', jsonb_build_object('id', c.id, 'name', c.name, 'tag', c.tag,
'emblem', c.emblem, 'color1', c.color1, 'color2', c.color2, 'season_medal', c.season_medal))
FROM clan_members m JOIN clans c ON c.id = m.clan_id WHERE m.player_id = p_player),
jsonb_build_object('clan', NULL)
);
$function$;

CREATE OR REPLACE FUNCTION public.clan_quest_claim(p_clan uuid, p_quest_id text, p_expected timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); p players%ROWTYPE;
v_period text; v_progress bigint; v_target bigint; v_member bigint; v_member_req bigint;
v_gold int;
BEGIN
IF v_uid IS NULL OR p_quest_id IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF NOT EXISTS (SELECT 1 FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid) THEN
RAISE EXCEPTION 'clan_not_member';
END IF;
CASE p_quest_id
WHEN 'cq_boss_dmg' THEN
v_period := current_date::text; v_target := 5000; v_member_req := 500; v_gold := 150;
SELECT COALESCE(sum(damage), 0) INTO v_progress FROM clan_boss_damage WHERE clan_id = p_clan AND day = current_date;
SELECT COALESCE(sum(damage), 0) INTO v_member FROM clan_boss_damage WHERE clan_id = p_clan AND player_id = v_uid AND day = current_date;
WHEN 'cq_war_strikes' THEN
v_period := current_date::text; v_target := 20; v_member_req := 3; v_gold := 150;
SELECT COALESCE(sum(score), 0) INTO v_progress FROM clan_war_strikes WHERE clan_id = p_clan AND day = current_date;
SELECT count(*) INTO v_member FROM clan_war_strikes WHERE clan_id = p_clan AND player_id = v_uid AND day = current_date;
WHEN 'cw_boss_kills' THEN
v_period := to_char(now(), 'IYYY-"W"IW'); v_target := 2; v_member_req := 1; v_gold := 500;
SELECT count(*) INTO v_progress FROM clan_bosses WHERE clan_id = p_clan AND killed_at >= date_trunc('week', now());
SELECT count(*) INTO v_member FROM clan_boss_damage WHERE clan_id = p_clan AND player_id = v_uid AND day >= date_trunc('week', now())::date;
WHEN 'cw_wars' THEN
v_period := to_char(now(), 'IYYY-"W"IW'); v_target := 1; v_member_req := 1; v_gold := 500;
SELECT count(*) INTO v_progress FROM clan_wars WHERE winner = p_clan AND resolved_at >= date_trunc('week', now());
SELECT count(*) INTO v_member FROM clan_war_strikes WHERE clan_id = p_clan AND player_id = v_uid;
ELSE RAISE EXCEPTION 'clan_bad_quest';
END CASE;
IF v_progress < v_target OR v_member < v_member_req THEN RAISE EXCEPTION 'clan_quest_locked'; END IF;
SELECT * INTO p FROM public.players WHERE id = v_uid AND NOT banned FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF p.updated_at <> p_expected THEN RAISE EXCEPTION 'clan_reload_save'; END IF;
IF (p.game_state->'player'->>'gold') !~ '^[0-9]{1,10}$' OR p.gold <> (p.game_state->'player'->>'gold')::integer THEN
RAISE EXCEPTION 'clan_invalid_wallet';
END IF;
IF p.gold::bigint + v_gold > 2147483647 THEN RAISE EXCEPTION 'clan_invalid_wallet'; END IF;
UPDATE players SET game_state = jsonb_set(p.game_state, '{player,gold}', to_jsonb(p.gold + v_gold)),
gold = p.gold + v_gold WHERE id = v_uid RETURNING * INTO p;
INSERT INTO clan_quest_claims(clan_id, quest_id, period, player_id, gold) VALUES (p_clan, p_quest_id, v_period, v_uid, v_gold);
PERFORM clan_xp_add(p_clan, 30);
RETURN jsonb_build_object('success', true, 'gold', v_gold, 'updated_at', p.updated_at,
'wallet_gold', p.gold, 'wallet_gems', p.gems, 'game_state', p.game_state);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_rankings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
PERFORM clan_season_ensure();
RETURN jsonb_build_object(
'season', (SELECT jsonb_build_object('started_at', started_at, 'ends_at', ends_at) FROM clan_seasons ORDER BY id DESC LIMIT 1),
'clans', (
SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'tag', c.tag, 'emblem', c.emblem,
'color1', c.color1, 'color2', c.color2, 'level', c.level, 'rating', c.rating,
'season_medal', c.season_medal,
'members', (SELECT count(*) FROM clan_members cm WHERE cm.clan_id = c.id),
'power', (SELECT COALESCE(sum(power), 0) FROM clan_members cm WHERE cm.clan_id = c.id)
) ORDER BY c.rating DESC, c.level DESC), '[]'::jsonb)
FROM (SELECT * FROM clans ORDER BY rating DESC, level DESC LIMIT 50) c
),
'history', (SELECT COALESCE(jsonb_agg(jsonb_build_object('season', season, 'rank', rank, 'medal', medal,
'name', name, 'tag', tag, 'rating', rating) ORDER BY season DESC, rank), '[]'::jsonb)
FROM (SELECT * FROM clan_season_archive ORDER BY season DESC, rank LIMIT 30) a)
);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_reject_app(p_player uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_clan uuid;
BEGIN
IF v_uid IS NULL OR p_player IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT role, clan_id INTO v_role, v_clan FROM clan_members WHERE player_id = v_uid;
IF v_clan IS NULL OR v_role NOT IN ('leader','deputy','officer') THEN RAISE EXCEPTION 'clan_no_permission'; END IF;
DELETE FROM clan_applications WHERE clan_id = v_clan AND player_id = p_player;
END $function$;

CREATE OR REPLACE FUNCTION public.clan_season_ensure()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_current record; v_top record;
BEGIN
SELECT * INTO v_current FROM clan_seasons ORDER BY id DESC LIMIT 1;
IF NOT FOUND THEN
INSERT INTO clan_seasons(started_at, ends_at) VALUES (now(), now() + interval '30 days');
RETURN;
END IF;
IF now() < v_current.ends_at THEN RETURN; END IF;
FOR v_top IN
SELECT id, name, tag, rating,
row_number() OVER (ORDER BY rating DESC, level DESC, id) AS rk
FROM clans ORDER BY rating DESC, level DESC, id LIMIT 50
LOOP
INSERT INTO clan_season_archive(season, clan_id, rank, medal, name, tag, rating)
VALUES (v_current.id, v_top.id, v_top.rk,
CASE WHEN v_top.rk <= 3 THEN 4 - v_top.rk ELSE 0 END,
v_top.name, v_top.tag, v_top.rating);
END LOOP;
UPDATE clans SET season_medal = CASE WHEN s.rk = 1 THEN 3 WHEN s.rk = 2 THEN 2 WHEN s.rk = 3 THEN 1 ELSE 0 END
FROM (
SELECT id AS clan_id, row_number() OVER (ORDER BY rating DESC, level DESC, id) AS rk
FROM clans ORDER BY rating DESC, level DESC, id LIMIT 50
) s WHERE s.clan_id = clans.id;
UPDATE clans SET rating = 1000;
INSERT INTO clan_seasons(started_at, ends_at) VALUES (now(), now() + interval '30 days');
UPDATE clan_seasons SET archived = true WHERE id = v_current.id;
END $function$;

CREATE OR REPLACE FUNCTION public.clan_set_role(p_player uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_target text; v_clan uuid;
BEGIN
IF v_uid IS NULL OR p_role IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF p_role NOT IN ('deputy','officer','veteran','member') THEN RAISE EXCEPTION 'clan_bad_role'; END IF;
SELECT role, clan_id INTO v_role, v_clan FROM clan_members WHERE player_id = v_uid;
IF v_clan IS NULL THEN RAISE EXCEPTION 'clan_not_member'; END IF;
SELECT role INTO v_target FROM clan_members WHERE clan_id = v_clan AND player_id = p_player;
IF v_target IS NULL OR v_target = 'leader' THEN RAISE EXCEPTION 'clan_no_such_member'; END IF;
IF p_role = 'deputy' AND v_role <> 'leader' THEN RAISE EXCEPTION 'clan_no_permission'; END IF;
IF NOT ( v_role = 'leader'
OR (v_role = 'deputy' AND p_role IN ('officer','veteran','member') AND v_target IN ('officer','veteran','member')) ) THEN
RAISE EXCEPTION 'clan_no_permission';
END IF;
UPDATE clan_members SET role = p_role WHERE clan_id = v_clan AND player_id = p_player;
PERFORM clan_event(v_clan, 'role', 'role_changed');
END $function$;

CREATE OR REPLACE FUNCTION public.clan_state(p_clan uuid, p_after bigint DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; c clans%ROWTYPE; b clan_bosses%ROWTYPE;
w clan_wars%ROWTYPE; v_season record; v_cap int; v_attacks int; v_today int;
BEGIN
IF v_uid IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT role INTO v_role FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid;
IF v_role IS NULL THEN RAISE EXCEPTION 'clan_not_member'; END IF;
PERFORM clan_season_ensure();
PERFORM clan_war_resolve_if_done();
PERFORM clan_building_collect(p_clan);
PERFORM clan_boss_sync(p_clan);
UPDATE clan_members SET last_active_at = now() WHERE clan_id = p_clan AND player_id = v_uid;
UPDATE players SET last_seen_at = now() WHERE id = v_uid;
SELECT * INTO c FROM clans WHERE id = p_clan;
SELECT * INTO b FROM clan_bosses WHERE clan_id = p_clan;
SELECT * INTO w FROM clan_wars WHERE (clan_a = p_clan OR clan_b = p_clan) AND status = 'active' ORDER BY id DESC LIMIT 1;
SELECT * INTO v_season FROM clan_seasons ORDER BY id DESC LIMIT 1;
v_cap := clan_capacity(COALESCE((c.buildings->'hall'->>'lvl')::int, 1));
v_attacks := 5 + CASE WHEN COALESCE((c.buildings->'heroes'->>'lvl')::int, 0) >= 5 THEN 1 ELSE 0 END;
v_today := (SELECT count(*) FROM clan_boss_damage WHERE clan_id = p_clan AND player_id = v_uid AND day = current_date);
RETURN jsonb_build_object(
'clan', jsonb_build_object('id', c.id, 'name', c.name, 'tag', c.tag, 'emblem', c.emblem,
'color1', c.color1, 'color2', c.color2, 'description', c.description, 'join_mode', c.join_mode,
'min_level', c.min_level, 'level', c.level, 'xp', c.xp, 'xp_needed', clan_xp_needed(c.level),
'xp_today', c.xp_today, 'rating', c.rating, 'treasury_gold', c.treasury_gold,
'treasury_points', c.treasury_points, 'buildings', c.buildings, 'boss_no', c.boss_no,
'season_medal', c.season_medal, 'capacity', v_cap,
'members', (SELECT count(*) FROM clan_members WHERE clan_id = p_clan),
'online', (SELECT count(*) FROM clan_members WHERE clan_id = p_clan AND last_active_at > now() - interval '5 minutes'),
'rank', (SELECT count(*) + 1 FROM clans c2 WHERE c2.rating > c.rating),
'total_power', (SELECT COALESCE(sum(power), 0) FROM clan_members WHERE clan_id = p_clan),
'season_ends_at', v_season.ends_at),
'my_role', v_role,
'members', (SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', m.player_id, 'role', m.role,
'name', m.display_name, 'level', m.level, 'power', m.power,
'contributed_gold', m.contributed_gold, 'contributed_points', m.contributed_points,
'online', m.last_active_at > now() - interval '5 minutes', 'joined_at', m.joined_at)
ORDER BY CASE m.role WHEN 'leader' THEN 1 WHEN 'deputy' THEN 2 WHEN 'officer' THEN 3 WHEN 'veteran' THEN 4 ELSE 5 END, m.power DESC), '[]'::jsonb)
FROM clan_members m WHERE m.clan_id = p_clan),
'applications', CASE WHEN v_role IN ('leader','deputy','officer') THEN
(SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', a.player_id, 'name', a2.display_name, 'level', a2.level) ORDER BY a.id), '[]'::jsonb)
FROM clan_applications a JOIN clan_members a2 ON a2.player_id = a.player_id AND a2.clan_id = p_clan
WHERE a.clan_id = p_clan)
ELSE NULL END,
'treasury_log', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', l.kind, 'gold', l.gold, 'points', l.points,
'note', l.note, 'at', l.created_at) ORDER BY l.id DESC), '[]'::jsonb)
FROM (SELECT * FROM clan_treasury_log WHERE clan_id = p_clan ORDER BY id DESC LIMIT 20) l),
'events', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', e.kind, 'body', e.body, 'at', e.created_at) ORDER BY e.id DESC), '[]'::jsonb)
FROM (SELECT * FROM clan_events WHERE clan_id = p_clan ORDER BY id DESC LIMIT 15) e),
'chat', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ch.id, 'kind', ch.kind, 'author', ch.author_name,
'role', ch.author_role, 'body', ch.body, 'at', ch.created_at) ORDER BY ch.id), '[]'::jsonb)
FROM (SELECT * FROM clan_chat WHERE clan_id = p_clan AND id > p_after ORDER BY id DESC LIMIT 80) ch),
'muted_until', (SELECT until FROM clan_chat_mutes WHERE clan_id = p_clan AND player_id = v_uid AND until > now()),
'boss', CASE WHEN b.clan_id IS NULL THEN NULL ELSE jsonb_build_object('no', b.boss_no, 'hp', b.hp,
'max_hp', b.max_hp, 'phase', b.phase, 'expires_at', b.expires_at, 'killed', b.killed_at IS NOT NULL,
'attacks_left', v_attacks - v_today,
'my_damage', (SELECT COALESCE(sum(damage), 0) FROM clan_boss_damage WHERE clan_id = p_clan AND player_id = v_uid AND boss_no = b.boss_no),
'total_damage', (SELECT COALESCE(sum(damage), 0) FROM clan_boss_damage WHERE clan_id = p_clan AND boss_no = b.boss_no),
'claimed', EXISTS (SELECT 1 FROM clan_boss_claims WHERE clan_id = p_clan AND boss_no = b.boss_no AND player_id = v_uid))
END,
'quests', jsonb_build_object(
'cq_boss_dmg', jsonb_build_object('progress',
(SELECT COALESCE(sum(damage), 0) FROM clan_boss_damage WHERE clan_id = p_clan AND day = current_date),
'target', 5000, 'member', (SELECT COALESCE(sum(damage), 0) FROM clan_boss_damage WHERE clan_id = p_clan AND player_id = v_uid AND day = current_date),
'member_req', 500, 'claimed', EXISTS (SELECT 1 FROM clan_quest_claims WHERE clan_id = p_clan AND quest_id = 'cq_boss_dmg' AND period = current_date::text AND player_id = v_uid)),
'cq_war_strikes', jsonb_build_object('progress',
(SELECT COALESCE(sum(score), 0) FROM clan_war_strikes WHERE clan_id = p_clan AND day = current_date),
'target', 20, 'member', (SELECT count(*) FROM clan_war_strikes WHERE clan_id = p_clan AND player_id = v_uid AND day = current_date),
'member_req', 3, 'claimed', EXISTS (SELECT 1 FROM clan_quest_claims WHERE clan_id = p_clan AND quest_id = 'cq_war_strikes' AND period = current_date::text AND player_id = v_uid)),
'cw_boss_kills', jsonb_build_object('progress',
(SELECT count(*) FROM clan_bosses WHERE clan_id = p_clan AND killed_at >= date_trunc('week', now())),
'target', 2, 'member', (SELECT count(*) FROM clan_boss_damage WHERE clan_id = p_clan AND player_id = v_uid AND day >= date_trunc('week', now())::date),
'member_req', 1, 'claimed', EXISTS (SELECT 1 FROM clan_quest_claims WHERE clan_id = p_clan AND quest_id = 'cw_boss_kills' AND period = to_char(now(),'IYYY-"W"IW') AND player_id = v_uid)),
'cw_wars', jsonb_build_object('progress',
(SELECT count(*) FROM clan_wars WHERE winner = p_clan AND resolved_at >= date_trunc('week', now())),
'target', 1, 'member', (SELECT count(*) FROM clan_war_strikes WHERE clan_id = p_clan AND player_id = v_uid),
'member_req', 1, 'claimed', EXISTS (SELECT 1 FROM clan_quest_claims WHERE clan_id = p_clan AND quest_id = 'cw_wars' AND period = to_char(now(),'IYYY-"W"IW') AND player_id = v_uid))),
'war', CASE WHEN w.id IS NULL THEN NULL ELSE jsonb_build_object('id', w.id,
'enemy', (SELECT jsonb_build_object('name', c2.name, 'tag', c2.tag, 'rating', c2.rating)
FROM clans c2 WHERE c2.id = CASE WHEN w.clan_a = p_clan THEN w.clan_b ELSE w.clan_a END),
'my_score', CASE WHEN w.clan_a = p_clan THEN w.score_a ELSE w.score_b END,
'enemy_score', CASE WHEN w.clan_a = p_clan THEN w.score_b ELSE w.score_a END,
'ends_at', w.ends_at,
'strikes_left', 5 - (SELECT count(*) FROM clan_war_strikes WHERE war_id = w.id AND player_id = v_uid AND day = current_date),
'my_total', (SELECT COALESCE(sum(score), 0) FROM clan_war_strikes WHERE war_id = w.id AND player_id = v_uid))
END,
'war_history', (SELECT COALESCE(jsonb_agg(jsonb_build_object('enemy', (SELECT name FROM clans c3 WHERE c3.id = CASE WHEN x.clan_a = p_clan THEN x.clan_b ELSE x.clan_a END),
'my_score', CASE WHEN x.clan_a = p_clan THEN x.score_a ELSE x.score_b END,
'enemy_score', CASE WHEN x.clan_a = p_clan THEN x.score_b ELSE x.score_a END,
'won', CASE WHEN x.winner IS NULL THEN NULL WHEN x.winner = p_clan THEN true ELSE false END,
'at', x.resolved_at) ORDER BY x.id DESC), '[]'::jsonb)
FROM (SELECT * FROM clan_wars WHERE (clan_a = p_clan OR clan_b = p_clan) AND status = 'resolved' ORDER BY id DESC LIMIT 10) x),
'signed_up', EXISTS (SELECT 1 FROM clan_war_signups WHERE clan_id = p_clan)
);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_transfer(p_player uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_clan uuid; v_target text;
BEGIN
IF v_uid IS NULL OR p_player IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT clan_id INTO v_clan FROM clan_members WHERE player_id = v_uid AND role = 'leader';
IF v_clan IS NULL THEN RAISE EXCEPTION 'clan_no_permission'; END IF;
IF p_player = v_uid THEN RAISE EXCEPTION 'clan_bad_target'; END IF;
SELECT role INTO v_target FROM clan_members WHERE clan_id = v_clan AND player_id = p_player;
IF v_target IS NULL THEN RAISE EXCEPTION 'clan_no_such_member'; END IF;
UPDATE clan_members SET role = 'leader' WHERE clan_id = v_clan AND player_id = p_player;
UPDATE clan_members SET role = 'officer' WHERE clan_id = v_clan AND player_id = v_uid;
UPDATE clans SET leader_id = p_player, updated_at = now() WHERE id = v_clan;
PERFORM clan_event(v_clan, 'transfer', 'leader_transferred');
END $function$;

CREATE OR REPLACE FUNCTION public.clan_update(p_clan uuid, p_description text, p_join_mode text, p_min_level integer, p_emblem integer, p_color1 text, p_color2 text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text;
BEGIN
IF v_uid IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT role INTO v_role FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid;
IF v_role IS NULL THEN RAISE EXCEPTION 'clan_not_member'; END IF;
IF v_role <> 'leader' THEN RAISE EXCEPTION 'clan_no_permission'; END IF;
IF p_join_mode IS NOT NULL AND p_join_mode NOT IN ('open','apply','closed') THEN RAISE EXCEPTION 'clan_bad_join_mode'; END IF;
IF p_min_level IS NOT NULL AND (p_min_level < 1 OR p_min_level > 50) THEN RAISE EXCEPTION 'clan_bad_min_level'; END IF;
IF p_emblem IS NOT NULL AND p_emblem NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'clan_bad_emblem'; END IF;
IF p_color1 IS NOT NULL AND p_color1 !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'clan_bad_color'; END IF;
IF p_color2 IS NOT NULL AND p_color2 !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'clan_bad_color'; END IF;
UPDATE clans SET
description = COALESCE(left(regexp_replace(trim(p_description), E'[[:cntrl:]]', '', 'g'), 500), description),
join_mode = COALESCE(p_join_mode, join_mode),
min_level = COALESCE(p_min_level, min_level),
emblem = COALESCE(p_emblem, emblem),
color1 = COALESCE(lower(p_color1), color1),
color2 = COALESCE(lower(p_color2), color2),
updated_at = now()
WHERE id = p_clan;
END $function$;

CREATE OR REPLACE FUNCTION public.clan_war_resolve_if_done()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE w record; v_winner uuid; v_loser uuid;
BEGIN
FOR w IN SELECT * FROM clan_wars WHERE status = 'active' AND ends_at <= now() FOR UPDATE LOOP
v_winner := CASE WHEN w.score_a > w.score_b THEN w.clan_a WHEN w.score_b > w.score_a THEN w.clan_b ELSE NULL END;
v_loser := CASE WHEN v_winner IS NULL THEN NULL WHEN v_winner = w.clan_a THEN w.clan_b ELSE w.clan_a END;
UPDATE clan_wars SET status = 'resolved', resolved_at = now(), winner = v_winner WHERE id = w.id;
IF v_winner IS NULL THEN
UPDATE clans SET rating = least(3000, rating + 5) WHERE id IN (w.clan_a, w.clan_b);
PERFORM clan_event(w.clan_a, 'war', 'war_draw');
PERFORM clan_event(w.clan_b, 'war', 'war_draw');
ELSE
UPDATE clans SET rating = least(3000, rating + 25) WHERE id = v_winner;
UPDATE clans SET rating = greatest(100, rating - 15) WHERE id = v_loser;
PERFORM clan_event(v_winner, 'war', 'war_won');
PERFORM clan_event(v_loser, 'war', 'war_lost');
PERFORM clan_xp_add(v_winner, 300);
END IF;
END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.clan_war_signup(p_clan uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; c clans%ROWTYPE; v_key text;
v_opp record;
BEGIN
IF v_uid IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
SELECT role INTO v_role FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid;
IF v_role NOT IN ('leader','deputy','officer') THEN RAISE EXCEPTION 'clan_no_permission'; END IF;
SELECT * INTO c FROM clans WHERE id = p_clan;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_not_found'; END IF;
IF EXISTS (SELECT 1 FROM clan_wars w WHERE (w.clan_a = p_clan OR w.clan_b = p_clan) AND w.status = 'active') THEN
RAISE EXCEPTION 'clan_war_active';
END IF;
v_key := to_char(now(), 'IYYY-"W"IW');
PERFORM clan_war_resolve_if_done();
SELECT s.clan_id, s.rating INTO v_opp
FROM clan_war_signups s
WHERE s.clan_id <> p_clan AND s.war_key = v_key
AND s.rating BETWEEN greatest(100, (c.rating / 2)::int) AND (c.rating * 2)
AND NOT EXISTS (SELECT 1 FROM clan_wars w2 WHERE (w2.clan_a = s.clan_id OR w2.clan_b = s.clan_id) AND w2.status = 'active')
ORDER BY abs(s.rating - c.rating), s.created_at LIMIT 1;
IF v_opp IS NOT NULL THEN
DELETE FROM clan_war_signups WHERE clan_id IN (p_clan, v_opp.clan_id);
INSERT INTO clan_wars(war_key, clan_a, clan_b, ends_at) VALUES (v_key, p_clan, v_opp.clan_id, now() + interval '24 hours');
PERFORM clan_event(p_clan, 'war', 'war_started');
PERFORM clan_event(v_opp.clan_id, 'war', 'war_started');
ELSE
INSERT INTO clan_war_signups(war_key, clan_id, rating) VALUES (v_key, p_clan, c.rating)
ON CONFLICT (clan_id) DO UPDATE SET rating = EXCLUDED.rating, created_at = now();
END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.clan_war_strike(p_clan uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); p players%ROWTYPE; w clan_wars%ROWTYPE;
v_score bigint; v_today int; v_tower int;
BEGIN
IF v_uid IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF NOT EXISTS (SELECT 1 FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid) THEN
RAISE EXCEPTION 'clan_not_member';
END IF;
SELECT * INTO w FROM clan_wars WHERE (clan_a = p_clan OR clan_b = p_clan) AND status = 'active' FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_war_none'; END IF;
IF w.ends_at <= now() THEN RAISE EXCEPTION 'clan_war_ended'; END IF;
SELECT * INTO p FROM players WHERE id = v_uid AND NOT banned FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_login_required'; END IF;
v_today := (SELECT count(*) FROM clan_war_strikes WHERE war_id = w.id AND player_id = v_uid AND day = current_date);
IF v_today >= 5 THEN RAISE EXCEPTION 'clan_war_limit'; END IF;
SELECT COALESCE((buildings->'tower'->>'lvl')::int, 0) INTO v_tower FROM clans WHERE id = p_clan;
v_score := greatest(10, round((p.attack + p.level * 10) * (0.9 + random() * 0.3) * (1 + v_tower * 0.03))::bigint);
INSERT INTO clan_war_strikes(war_id, clan_id, player_id, score) VALUES (w.id, p_clan, v_uid, v_score);
IF w.clan_a = p_clan THEN UPDATE clan_wars SET score_a = score_a + v_score WHERE id = w.id;
ELSE UPDATE clan_wars SET score_b = score_b + v_score WHERE id = w.id; END IF;
PERFORM clan_xp_add(p_clan, 5);
RETURN jsonb_build_object('score', v_score,
'score_a', (SELECT score_a FROM clan_wars WHERE id = w.id),
'score_b', (SELECT score_b FROM clan_wars WHERE id = w.id),
'strikes_left', 4 - v_today, 'ends_at', w.ends_at, 'war_id', w.id);
END $function$;

CREATE OR REPLACE FUNCTION public.clan_xp_add(p_clan uuid, p_base integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lib int; v_gain int;
BEGIN
IF p_base IS NULL OR p_base <= 0 THEN RETURN; END IF;
SELECT COALESCE((buildings->'library'->>'lvl')::int, 0) INTO v_lib FROM clans WHERE id = p_clan;
UPDATE clans SET
xp = xp + round(least(greatest(0, 5000 - CASE WHEN xp_day = current_date THEN xp_today ELSE 0 END), p_base)
* (1 + v_lib * 0.10))::int,
xp_today = CASE WHEN xp_day = current_date THEN xp_today ELSE 0 END
+ least(greatest(0, 5000 - CASE WHEN xp_day = current_date THEN xp_today ELSE 0 END), p_base),
xp_day = current_date
WHERE id = p_clan;
END $function$;

CREATE OR REPLACE FUNCTION public.clan_xp_needed(p_level integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
SELECT 1000 * p_level * p_level;
$function$;
