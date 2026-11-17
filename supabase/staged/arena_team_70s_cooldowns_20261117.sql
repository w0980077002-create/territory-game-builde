-- TERRITORY: independent per-kind 70s potion timers for 3v3/20v20.
-- Owner-approved 2026-11-17. No wallet/inventory reset or data migration.
-- Source: live pg_get_functiondef of 3 existing production routines; minimal diff.
BEGIN;
CREATE OR REPLACE FUNCTION public.arena_use_item(p_room uuid, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_room arena_rooms%ROWTYPE;
v_me arena_participants%ROWTYPE;
v_heal int;
v_hp int;
BEGIN
IF p_kind NOT IN ('heal_small', 'heal_large', 'attack', 'defense', 'crit') THEN
RAISE EXCEPTION 'bad_item';
END IF;
SELECT * INTO v_room FROM arena_rooms WHERE id = p_room FOR UPDATE;
IF NOT FOUND OR v_room.status <> 'active' THEN RAISE EXCEPTION 'not_active'; END IF;
SELECT * INTO v_me FROM arena_participants
WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
IF v_me.hp <= 0 THEN RAISE EXCEPTION 'dead'; END IF;
-- Classic duels retain the 1-per-round limit. Team/chaos have independent
-- server-verified 70-second per-kind cooldowns instead.
IF NOT v_room.team_live_v1 AND v_me.item_round = v_room.round_no THEN RAISE EXCEPTION 'item_round'; END IF;

IF p_kind IN ('heal_small', 'heal_large') THEN
IF v_me.hp >= v_me.max_hp THEN RAISE EXCEPTION 'full_hp'; END IF;
-- Restores a relevant share of maximum HP, even for high-level fighters.
v_heal := CASE p_kind
  WHEN 'heal_small' THEN GREATEST(50, round(v_me.max_hp::numeric * 0.18)::int)
  ELSE GREATEST(150, round(v_me.max_hp::numeric * 0.35)::int)
END;
v_hp := LEAST(v_me.max_hp, v_me.hp + v_heal);
UPDATE arena_participants SET hp = v_hp, item_round = v_room.round_no WHERE id = v_me.id;
PERFORM arena_msg(p_room, 'item', v_me.name,
v_me.name || ' выпивает зелье здоровья: +' || (v_hp - v_me.hp) || ' HP [' || v_hp || '/' || v_me.max_hp || ']');
RETURN;
END IF;

IF p_kind = ANY(v_me.buffs) THEN RAISE EXCEPTION 'buff_active'; END IF;
UPDATE arena_participants SET
attack = CASE WHEN p_kind = 'attack' THEN
  LEAST(2000000000::numeric, attack::numeric + GREATEST(10::numeric, round(attack::numeric * 0.25)))::int
  ELSE attack END,
defense = CASE WHEN p_kind = 'defense' THEN
  LEAST(2000000000::numeric, defense::numeric + GREATEST(10::numeric, round(defense::numeric * 0.25)))::int
  ELSE defense END,
crit_chance = CASE WHEN p_kind = 'crit' THEN LEAST(75, crit_chance + 15) ELSE crit_chance END,
buffs = array_append(buffs, p_kind),
item_round = v_room.round_no
WHERE id = v_me.id;
PERFORM arena_msg(p_room, 'item', v_me.name, v_me.name || ' выпивает ' ||
CASE p_kind
WHEN 'attack' THEN 'эликсир силы (+' || GREATEST(10::numeric, round(v_me.attack::numeric * 0.25))::int || ' к атаке)'
WHEN 'defense' THEN 'эликсир защиты (+' || GREATEST(10::numeric, round(v_me.defense::numeric * 0.25))::int || ' к защите)'
ELSE 'эликсир крита (+15 п.п. к шансу крита, максимум 75%)' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.arena_secure_v1(p_action text, p_expected timestamp with time zone, p_mode text DEFAULT NULL::text, p_room uuid DEFAULT NULL::uuid, p_slot integer DEFAULT NULL::integer, p_kind text DEFAULT NULL::text, p_target uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.players%ROWTYPE;
  v_r public.arena_rooms%ROWTYPE;
  v_me public.arena_participants%ROWTYPE;
  v_state jsonb;
  v_belt jsonb;
  v_item jsonb;
  v_effect jsonb;
  v_after_item jsonb;
  v_qty integer;
  v_kind text;
  v_room uuid;
  v_already boolean := false;
  v_gold integer := 0;
  v_xp integer := 0;
  v_won boolean := false;
  v_draw boolean := false;
  v_mult numeric;
  v_level integer;
  v_xp_balance bigint;
  v_threshold bigint;
  v_cap integer := 100;
  v_stats jsonb;
  v_max_energy integer;
  v_quests jsonb;
  v_followers jsonb;
  v_follower jsonb;
  v_goal integer;
  v_out jsonb;
  i integer;
BEGIN
  IF v_uid IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'arena_login_required'; END IF;
  IF p_action NOT IN ('join','item','claim') THEN RAISE EXCEPTION 'arena_invalid_action'; END IF;
  IF p_action <> 'join' THEN
    SELECT * INTO v_r FROM public.arena_rooms WHERE id=p_room FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
  END IF;

  SELECT * INTO v_p FROM public.players
  WHERE id=v_uid AND NOT banned FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_player'; END IF;
  IF v_p.updated_at <> p_expected THEN RAISE EXCEPTION 'arena_reload_required'; END IF;
  v_state := v_p.game_state;
  IF jsonb_typeof(v_state) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_state->'player') IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_state->'belt') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_state->'belt') <> 7
    OR v_p.gold::text IS DISTINCT FROM (v_state#>>'{player,gold}')
    OR v_p.gems::text IS DISTINCT FROM (v_state#>>'{player,gems}')
  THEN RAISE EXCEPTION 'arena_invalid_save'; END IF;

  IF p_action = 'join' THEN
    IF p_mode NOT IN ('duel','team','chaos') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
    SELECT ap.room_id INTO v_room FROM public.arena_participants ap
    WHERE ap.user_id=v_uid AND ap.left_at IS NULL
    ORDER BY ap.joined_at DESC LIMIT 1;
    v_already := v_room IS NOT NULL;
    IF NOT v_already AND v_p.energy < 1 THEN RAISE EXCEPTION 'arena_no_energy'; END IF;
    v_room := public.arena_join(p_mode);
    IF NOT v_already THEN
      -- Consume exactly once, in the same transaction as room membership.
      v_state := jsonb_set(v_state,'{player,energy}',to_jsonb(v_p.energy - 1),false);
      UPDATE public.players SET energy=v_p.energy-1,game_state=v_state
      WHERE id=v_uid RETURNING * INTO v_p;
    END IF;
    v_out := jsonb_build_object('room_id',v_room,'joined_new',NOT v_already);

  ELSIF p_action = 'item' THEN
    IF v_r.status <> 'active' THEN RAISE EXCEPTION 'not_active'; END IF;
    SELECT * INTO v_me FROM public.arena_participants
    WHERE room_id=p_room AND user_id=v_uid AND left_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
    IF v_me.hp <= 0 THEN RAISE EXCEPTION 'dead'; END IF;
    IF p_slot NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'arena_invalid_slot'; END IF;
    v_goal := (ARRAY[0,100,500,1000,2000,3500,5000])[p_slot+1];
    IF v_p.arena_wins < v_goal THEN RAISE EXCEPTION 'arena_slot_locked'; END IF;
    v_belt := v_state->'belt';
    v_item := v_belt->p_slot;
    -- Consumables are permanent; still validate slots, quantity and effects.
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR
       (v_item->>'qty') !~ '^[1-5]$'
    THEN RAISE EXCEPTION 'arena_item_missing'; END IF;
    v_qty := (v_item->>'qty')::integer;
    v_effect := v_item->'effect';
    v_kind := CASE
      WHEN v_item->>'arenaEffect'='time' THEN 'time'
      WHEN v_item->>'arenaEffect'='adrenaline' THEN 'adrenaline'
      WHEN v_effect->>'stat'='hp' AND (v_effect->>'value') ~ '^[0-9]{1,4}$'
        AND (v_effect->>'value')::int >=150 THEN 'heal_large'
      WHEN v_effect->>'stat'='hp' THEN 'heal_small'
      WHEN v_effect->>'stat'='attack' THEN 'attack'
      WHEN v_effect->>'stat'='defense' THEN 'defense'
      WHEN v_effect->>'stat'='critChance' THEN 'crit'
      ELSE NULL END;
    IF v_kind IS NULL OR v_kind IS DISTINCT FROM p_kind
      OR v_item->>'type' NOT IN ('potion','elixir','arena')
    THEN RAISE EXCEPTION 'arena_invalid_item'; END IF;
    -- Defense in depth: never over five successful uses of a kind per fight.
    IF (SELECT count(*) FROM territory_private.arena_consumable_usage_v1 u
        WHERE u.room_id=p_room AND u.player_id=v_uid AND u.item_kind=p_kind) >= 5
    THEN RAISE EXCEPTION 'arena_item_fight_limit'; END IF;
    -- 3v3 / 20v20: an independent 70s timer per exact consumable kind.
    -- The room row is already locked FOR UPDATE, so concurrent requests serialize.
    IF v_r.team_live_v1 AND EXISTS (
      SELECT 1 FROM territory_private.arena_consumable_usage_v1 u
      WHERE u.room_id=p_room AND u.player_id=v_uid AND u.item_kind=p_kind
        AND u.used_at > clock_timestamp() - interval '70 seconds'
    ) THEN RAISE EXCEPTION 'arena_item_cooldown_70'; END IF;
    IF p_kind='adrenaline' THEN
      IF v_r.mode='duel' THEN RAISE EXCEPTION 'invalid_target'; END IF;
      PERFORM public.arena_revive(p_room,p_target);
    ELSIF p_kind='time' THEN
      PERFORM public.arena_time_potion(p_room);
    ELSE
      PERFORM public.arena_use_item(p_room,p_kind);
    END IF;

    -- A failed effect rolls back both the belt debit and action.
    v_after_item := CASE WHEN v_qty=1 THEN 'null'::jsonb
      ELSE jsonb_set(v_item,'{qty}',to_jsonb(v_qty-1)) END;
    v_belt := jsonb_set(v_belt,ARRAY[p_slot::text],v_after_item);
    v_state := jsonb_set(v_state,'{belt}',v_belt);
    -- Log the authorized debit BEFORE saving the changed belt in the same transaction.
    INSERT INTO territory_private.arena_consumable_usage_v1 (player_id,room_id,item_kind)
    VALUES (v_uid,p_room,p_kind);
    UPDATE public.players SET game_state=v_state WHERE id=v_uid RETURNING * INTO v_p;
    v_out := jsonb_build_object('item',p_kind,'slot',p_slot);

  ELSE
    IF v_r.status <> 'finished' THEN RAISE EXCEPTION 'not_finished'; END IF;
    SELECT * INTO v_me FROM public.arena_participants
    WHERE room_id=p_room AND user_id=v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
    IF v_me.rewarded THEN
      RETURN jsonb_build_object('success',true,'already_claimed',true,
        'updated_at',v_p.updated_at,'wallet_gold',v_p.gold,
        'wallet_gems',v_p.gems,'game_state',v_p.game_state,
        'reward',jsonb_build_object('gold',0,'xp',0,'won',false,'draw',false,
         'kills',0,'ratingChange',0,'rating',v_p.arena_rating,
         'wins',v_p.arena_wins,'losses',v_p.arena_losses));
    END IF;
    v_draw := v_r.winner_team IS NULL;
    v_won := coalesce(v_r.winner_team=v_me.team,false);
    v_mult := CASE v_r.mode WHEN 'duel' THEN 1.0
      WHEN 'team' THEN 1.2 ELSE 1.5 END;
    v_gold := round((CASE WHEN v_won THEN 30+v_me.level*10
      WHEN v_draw THEN 15+v_me.level*5 ELSE 5+v_me.level*2 END)*v_mult
      +v_me.kills*10)::integer;
    v_xp := round((CASE WHEN v_won THEN 40+v_me.level*15
      WHEN v_draw THEN 20+v_me.level*8 ELSE 10+v_me.level*3 END)*v_mult
      +v_me.kills*10)::integer;
    IF v_p.gold::bigint+v_gold>2147483647 THEN
      RAISE EXCEPTION 'arena_wallet_limit'; END IF;
    v_state := jsonb_set(v_state,'{player,gold}',to_jsonb(v_p.gold+v_gold));

    v_level := v_p.level;
    v_xp_balance := coalesce((v_state#>>'{player,xp}')::bigint,0)+v_xp;
    v_max_energy := v_p.max_energy;
    v_stats := v_state#>'{player,stats}';
    IF jsonb_typeof(v_stats) IS DISTINCT FROM 'object'
      THEN RAISE EXCEPTION 'arena_invalid_stats'; END IF;
    WHILE v_level < v_cap LOOP
      v_threshold := coalesce((v_state#>>'{player,xpToNext}')::bigint,0);
      -- Use the currently stored threshold for first step, and game formula thereafter.
      IF v_threshold <= 0 THEN
        v_threshold := floor(100*power(1.15::numeric,v_level-1)
          *(CASE WHEN v_level >=83 THEN 3+0.12*(v_level-83) ELSE 1 END))::bigint;
      END IF;
      EXIT WHEN v_xp_balance < v_threshold;
      v_xp_balance := v_xp_balance-v_threshold;
      v_level := v_level+1;
      v_state := jsonb_set(v_state,'{player,xpToNext}',
        to_jsonb(CASE WHEN v_level >=v_cap THEN 0 ELSE
          floor(100*power(1.15::numeric,v_level-1)
          *(CASE WHEN v_level >=83 THEN 3+0.12*(v_level-83) ELSE 1 END))::bigint END));
      v_stats := jsonb_set(v_stats,'{maxHp}',
        to_jsonb(coalesce((v_stats->>'maxHp')::integer,100)+20));
      v_stats := jsonb_set(v_stats,'{hp}',v_stats->'maxHp');
      v_stats := jsonb_set(v_stats,'{attack}',
        to_jsonb(coalesce((v_stats->>'attack')::integer,20)+5));
      v_stats := jsonb_set(v_stats,'{defense}',
        to_jsonb(coalesce((v_stats->>'defense')::integer,5)+2));
      v_max_energy := v_max_energy+1;
    END LOOP;
    IF v_level >=v_cap THEN v_xp_balance:=0; END IF;
    v_state := jsonb_set(v_state,'{player,level}',to_jsonb(v_level));
    v_state := jsonb_set(v_state,'{player,xp}',to_jsonb(v_xp_balance));
    v_state := jsonb_set(v_state,'{player,stats}',v_stats);
    v_state := jsonb_set(v_state,'{player,maxEnergy}',to_jsonb(v_max_energy));

    -- Daily arena-win quest and newly unlocked followers match client progression.
    IF v_won AND jsonb_typeof(v_state->'quests')='array' THEN
      SELECT coalesce(jsonb_agg(
        CASE WHEN q.value->>'id'='q_daily_3' AND q.value->>'claimed'='false'
          THEN jsonb_set(q.value,'{current}',to_jsonb(
            least(coalesce((q.value->>'target')::int,1),
              coalesce((q.value->>'current')::int,0)+1))) ELSE q.value END
        ORDER BY q.ordinality),'[]'::jsonb) INTO v_quests
      FROM jsonb_array_elements(v_state->'quests') WITH ORDINALITY AS q(value,ordinality);
      v_state := jsonb_set(v_state,'{quests}',v_quests);
    END IF;
    IF v_level>v_p.level AND jsonb_typeof(v_state->'followers')='array' THEN
      SELECT coalesce(jsonb_agg(
        CASE WHEN (f.value->>'id') IN ('follower_1','follower_2','follower_3','follower_4','follower_5')
         AND v_level >= (CASE f.value->>'id'
           WHEN 'follower_1' THEN 3 WHEN 'follower_2' THEN 8
           WHEN 'follower_3' THEN 15 WHEN 'follower_4' THEN 25 ELSE 40 END)
         THEN jsonb_set(f.value,'{unlocked}','true'::jsonb)
         ELSE f.value END ORDER BY f.ordinality),'[]'::jsonb) INTO v_followers
      FROM jsonb_array_elements(v_state->'followers') WITH ORDINALITY AS f(value,ordinality);
      v_state := jsonb_set(v_state,'{followers}',v_followers);
    END IF;

    UPDATE public.players SET
      game_state=v_state,gold=v_p.gold+v_gold,xp=v_xp_balance::integer,
      level=v_level,max_energy=v_max_energy
    WHERE id=v_uid RETURNING * INTO v_p;

    UPDATE public.arena_participants SET rewarded=true WHERE id=v_me.id;
    v_out := jsonb_build_object('reward',jsonb_build_object(
      'won',v_won,'draw',v_draw,'gold',v_gold,'xp',v_xp,'kills',v_me.kills,
      'ratingChange',coalesce(v_me.rating_change,0),
      'rating',v_p.arena_rating,'wins',v_p.arena_wins,'losses',v_p.arena_losses));
  END IF;

  RETURN jsonb_build_object('success',true,'updated_at',v_p.updated_at,
    'game_state',v_p.game_state,'wallet_gold',v_p.gold,'wallet_gems',v_p.gems)
    || coalesce(v_out,'{}'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.arena_state(p_room uuid, p_after bigint DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_me arena_participants%ROWTYPE;
v_room arena_rooms%ROWTYPE;
v_vip int;
BEGIN
SELECT * INTO v_me FROM arena_participants WHERE room_id = p_room AND user_id = auth.uid() AND left_at IS NULL;
IF NOT FOUND THEN RETURN json_build_object('error', 'not_member'); END IF;

PERFORM arena_tick(p_room);

SELECT * INTO v_me FROM arena_participants WHERE id = v_me.id;
SELECT * INTO v_room FROM arena_rooms WHERE id = p_room;
SELECT territory_private.fortune_vip_v1(auth.uid()) INTO v_vip;

RETURN json_build_object(
'now', floor(extract(epoch FROM now()) * 1000),
'room', json_build_object(
'id', v_room.id, 'mode', v_room.mode, 'status', v_room.status, 'round', v_room.round_no,
'timeout', v_room.timeout_seconds,
'deadline', CASE WHEN v_room.round_deadline IS NULL THEN NULL ELSE floor(extract(epoch FROM v_room.round_deadline) * 1000) END,
'startsAt', floor(extract(epoch FROM v_room.starts_at) * 1000),
'winnerTeam', v_room.winner_team,
'teamLive', v_room.team_live_v1,
'teamDeadline1', CASE WHEN v_room.team_live_v1 AND v_room.status='active'
  THEN floor(extract(epoch FROM (v_room.team1_last_attack_at+make_interval(secs=>60-v_room.team1_clock_penalty)))*1000)
  ELSE NULL END,
'teamDeadline2', CASE WHEN v_room.team_live_v1 AND v_room.status='active'
  THEN floor(extract(epoch FROM (v_room.team2_last_attack_at+make_interval(secs=>60-v_room.team2_clock_penalty)))*1000)
  ELSE NULL END),
'me', json_build_object(
'id', v_me.id, 'team', v_me.team, 'rewarded', v_me.rewarded, 'revivesUsed', v_me.revives_used,
'ratingChange', v_me.rating_change, 'auto', v_me.auto, 'vip', COALESCE(v_vip, 0),
'autoMinVip', arena_auto_min_vip(),
'activeBuffs', COALESCE(v_me.buffs, ARRAY[]::text[]),
'itemCooldowns', CASE WHEN v_room.team_live_v1 THEN
  (SELECT COALESCE(json_object_agg(t.item_kind,
      floor(extract(epoch FROM (t.last_used + interval '70 seconds')) * 1000)::bigint
    ), '{}'::json)
   FROM (SELECT u.item_kind, max(u.used_at) AS last_used
     FROM territory_private.arena_consumable_usage_v1 u
     WHERE u.room_id=p_room AND u.player_id=auth.uid()
       AND u.used_at > now() - interval '70 seconds'
     GROUP BY u.item_kind) t)
  ELSE '{}'::json END,
'nextStrikeAt', CASE WHEN v_room.team_live_v1 AND v_me.last_live_attack_at IS NOT NULL
  THEN floor(extract(epoch FROM (v_me.last_live_attack_at+interval '3 seconds'))*1000)
  ELSE NULL END,
'moved', CASE WHEN v_room.team_live_v1 THEN false ELSE
  EXISTS (SELECT 1 FROM arena_moves WHERE room_id = p_room AND round_no = v_room.round_no AND participant_id = v_me.id) END),
'participants', (
SELECT COALESCE(json_agg(json_build_object(
'id', p.id, 'name', p.name, 'level', p.level, 'rating', p.rating, 'hp', p.hp, 'maxHp', p.max_hp,
'team', p.team, 'kills', p.kills, 'damage', p.damage_dealt, 'left', p.left_at IS NOT NULL,
'moved', CASE WHEN v_room.team_live_v1 THEN (p.last_live_attack_at IS NOT NULL) ELSE
  EXISTS (SELECT 1 FROM arena_moves mv WHERE mv.room_id = p_room AND mv.round_no = v_room.round_no AND mv.participant_id = p.id) END
) ORDER BY p.joined_at, p.id), '[]'::json)
FROM arena_participants p WHERE p.room_id = p_room),
'messages', (
SELECT COALESCE(json_agg(json_build_object(
'id', x.id, 'kind', x.kind, 'author', x.author, 'body', x.body,
'at', floor(extract(epoch FROM x.created_at) * 1000)
) ORDER BY x.id), '[]'::json)
FROM (SELECT * FROM arena_messages WHERE room_id = p_room AND id > COALESCE(p_after, 0) ORDER BY id DESC LIMIT 300) x)
);
END;
$function$;
COMMIT;
