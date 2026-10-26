-- Staged-only clan hardening; historical migrations are immutable.
-- Applied after the source RPC snapshot, before the final grants.
ALTER TABLE public.clan_wars
  ADD COLUMN clan_a_name text NOT NULL DEFAULT ''::text,
  ADD COLUMN clan_b_name text NOT NULL DEFAULT ''::text;

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
-- The final leader disbands the clan. Serialize against concurrent joins
-- (clan_join_internal locks the same row) before checking membership.
PERFORM 1 FROM clans WHERE id = v_clan FOR UPDATE;
SELECT count(*) INTO v_left FROM clan_members WHERE clan_id = v_clan AND player_id <> v_uid;
IF v_left > 0 THEN RAISE EXCEPTION 'clan_leader_must_transfer'; END IF;
-- Never destroy an earned, unclaimed boss payout or an active war.
IF EXISTS (SELECT 1 FROM clan_boss_rewards r WHERE r.clan_id = v_clan AND r.player_id = v_uid
AND NOT EXISTS (SELECT 1 FROM clan_boss_claims x WHERE x.clan_id = r.clan_id
AND x.boss_no = r.boss_no AND x.player_id = v_uid)) THEN
RAISE EXCEPTION 'clan_rewards_pending'; END IF;
IF EXISTS (SELECT 1 FROM clan_wars WHERE status = 'active' AND (clan_a = v_clan OR clan_b = v_clan)) THEN
RAISE EXCEPTION 'clan_war_active'; END IF;
-- The original snapshot had no FKs/cascades: deleting only `clans`
-- stranded the leader in `clan_members`, blocking every future clan.
DELETE FROM clan_chat_mutes WHERE clan_id = v_clan;
DELETE FROM clan_invites WHERE clan_id = v_clan;
DELETE FROM clan_applications WHERE clan_id = v_clan;
DELETE FROM clan_chat WHERE clan_id = v_clan;
DELETE FROM clan_events WHERE clan_id = v_clan;
DELETE FROM clan_treasury_log WHERE clan_id = v_clan;
DELETE FROM clan_boss_damage WHERE clan_id = v_clan;
DELETE FROM clan_boss_claims WHERE clan_id = v_clan;
DELETE FROM clan_boss_rewards WHERE clan_id = v_clan;
DELETE FROM clan_bosses WHERE clan_id = v_clan;
DELETE FROM clan_quest_claims WHERE clan_id = v_clan;
DELETE FROM clan_war_signups WHERE clan_id = v_clan;
-- Completed war history and archived seasonal standings stay intact.
DELETE FROM clan_members WHERE clan_id = v_clan;
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

CREATE OR REPLACE FUNCTION public.clan_state(p_clan uuid, p_after bigint DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; c clans%ROWTYPE; b clan_bosses%ROWTYPE;
w clan_wars%ROWTYPE; v_season record; v_cap int; v_attacks int; v_today int;
BEGIN
IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND NOT banned) THEN RAISE EXCEPTION 'clan_login_required'; END IF;
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
FROM clan_applications a JOIN players a2 ON a2.id = a.player_id
WHERE a.clan_id = p_clan)
ELSE NULL END,
'treasury_log', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', l.kind, 'gold', l.gold, 'points', l.points,
'note', l.note, 'at', l.created_at) ORDER BY l.id DESC), '[]'::jsonb)
FROM (SELECT * FROM clan_treasury_log WHERE clan_id = p_clan ORDER BY id DESC LIMIT 20) l),
'events', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', e.kind, 'body', e.body, 'at', e.created_at) ORDER BY e.id DESC), '[]'::jsonb)
FROM (SELECT * FROM clan_events WHERE clan_id = p_clan ORDER BY id DESC LIMIT 15) e),
'chat', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ch.id, 'kind', ch.kind, 'author_id', ch.author_id, 'author', ch.author_name,
'role', ch.author_role, 'body', ch.body, 'at', ch.created_at) ORDER BY ch.id), '[]'::jsonb)
FROM (SELECT * FROM clan_chat WHERE clan_id = p_clan AND id > p_after ORDER BY id DESC LIMIT 80) ch),
'muted_until', (SELECT until FROM clan_chat_mutes WHERE clan_id = p_clan AND player_id = v_uid AND until > now()),
 'pending_boss_rewards', (SELECT coalesce(jsonb_agg(jsonb_build_object('boss_no', e.boss_no, 'gold', e.gold, 'earned_at', e.earned_at) ORDER BY e.boss_no), '[]'::jsonb)
FROM clan_boss_rewards e WHERE e.clan_id = p_clan AND e.player_id = v_uid
AND NOT EXISTS (SELECT 1 FROM clan_boss_claims r WHERE r.clan_id = e.clan_id AND r.boss_no = e.boss_no AND r.player_id = v_uid)),
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
(SELECT count(DISTINCT boss_no) FROM clan_boss_rewards WHERE clan_id = p_clan AND earned_at >= date_trunc('week', now())),
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
'war_history', (SELECT COALESCE(jsonb_agg(jsonb_build_object('enemy', coalesce(
 (SELECT name FROM clans c3 WHERE c3.id = CASE WHEN x.clan_a = p_clan THEN x.clan_b ELSE x.clan_a END),
 CASE WHEN x.clan_a = p_clan THEN x.clan_b_name ELSE x.clan_a_name END),
'my_score', CASE WHEN x.clan_a = p_clan THEN x.score_a ELSE x.score_b END,
'enemy_score', CASE WHEN x.clan_a = p_clan THEN x.score_b ELSE x.score_a END,
'won', CASE WHEN x.winner IS NULL THEN NULL WHEN x.winner = p_clan THEN true ELSE false END,
'at', x.resolved_at) ORDER BY x.id DESC), '[]'::jsonb)
FROM (SELECT * FROM clan_wars WHERE (clan_a = p_clan OR clan_b = p_clan) AND status = 'resolved' ORDER BY id DESC LIMIT 10) x),
'signed_up', EXISTS (SELECT 1 FROM clan_war_signups WHERE clan_id = p_clan)
);
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
IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND NOT banned) THEN RAISE EXCEPTION 'clan_login_required'; END IF;
IF v_uid IS NULL THEN RAISE EXCEPTION 'clan_login_required'; END IF;
-- Pairing must be atomic: two leaders must not consume the same waiting
-- opponent and create overlapping wars in concurrent Telegram requests.
PERFORM pg_advisory_xact_lock(174901, 2);
SELECT role INTO v_role FROM clan_members WHERE clan_id = p_clan AND player_id = v_uid;
IF v_role IS NULL OR v_role NOT IN ('leader','deputy','officer') THEN RAISE EXCEPTION 'clan_no_permission'; END IF;
SELECT * INTO c FROM clans WHERE id = p_clan;
IF NOT FOUND THEN RAISE EXCEPTION 'clan_not_found'; END IF;
IF EXISTS (SELECT 1 FROM clan_wars w WHERE (w.clan_a = p_clan OR w.clan_b = p_clan) AND w.status = 'active') THEN
RAISE EXCEPTION 'clan_war_active';
END IF;
v_key := to_char(now(), 'IYYY-"W"IW');
PERFORM clan_war_resolve_if_done();
SELECT s.clan_id, s.rating, opponent.name INTO v_opp
FROM clan_war_signups s JOIN clans opponent ON opponent.id = s.clan_id
WHERE s.clan_id <> p_clan AND s.war_key = v_key
AND s.rating BETWEEN greatest(100, (c.rating / 2)::int) AND (c.rating * 2)
AND NOT EXISTS (SELECT 1 FROM clan_wars w2 WHERE (w2.clan_a = s.clan_id OR w2.clan_b = s.clan_id) AND w2.status = 'active')
ORDER BY abs(s.rating - c.rating), s.created_at LIMIT 1;
IF v_opp IS NOT NULL THEN
DELETE FROM clan_war_signups WHERE clan_id IN (p_clan, v_opp.clan_id);
INSERT INTO clan_wars(war_key, clan_a, clan_b, clan_a_name, clan_b_name, ends_at)
VALUES (v_key, p_clan, v_opp.clan_id, c.name, v_opp.name, now() + interval '24 hours');
PERFORM clan_event(p_clan, 'war', 'war_started');
PERFORM clan_event(v_opp.clan_id, 'war', 'war_started');
ELSE
INSERT INTO clan_war_signups(war_key, clan_id, rating) VALUES (v_key, p_clan, c.rating)
ON CONFLICT (clan_id) DO UPDATE SET rating = EXCLUDED.rating, created_at = now();
END IF;
END $function$;

