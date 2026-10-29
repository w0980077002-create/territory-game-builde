
-- TERRITORY 1.0 owner-only Arena Economy: no player state, wallets or progress rewritten.
CREATE TABLE IF NOT EXISTS territory_private.arena_consumable_usage_v1 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id uuid NOT NULL,
  room_id uuid NOT NULL,
  item_kind text NOT NULL CHECK (item_kind IN
    ('attack','defense','crit','heal_small','heal_large','time','adrenaline')),
  used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arena_consumable_usage_used_at_idx
  ON territory_private.arena_consumable_usage_v1(used_at DESC);
CREATE INDEX IF NOT EXISTS arena_consumable_usage_player_at_idx
  ON territory_private.arena_consumable_usage_v1(player_id,used_at DESC);
ALTER TABLE territory_private.arena_consumable_usage_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.arena_consumable_usage_v1 FROM PUBLIC, anon, authenticated;

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
    UPDATE public.players SET game_state=v_state WHERE id=v_uid RETURNING * INTO v_p;
    -- Exactly once in the existing authoritative, rollback-safe item transaction.
    INSERT INTO territory_private.arena_consumable_usage_v1 (player_id,room_id,item_kind)
    VALUES (v_uid,p_room,p_kind);
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

-- Runs only with the service-role JWT of the pre-existing owner-protected admin-api.
-- No client-facing execute grant. Query values are real server battle/economy records.
CREATE OR REPLACE FUNCTION public.territory_admin_arena_economy_v1(p_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $func$
DECLARE
 v_start timestamptz;
 v_end timestamptz := now();
 v_battles jsonb := '{}'::jsonb;
 v_balance jsonb := '{}'::jsonb;
 v_usage jsonb := '{}'::jsonb;
 v_rewards jsonb := '{}'::jsonb;
 v_top jsonb := '[]'::jsonb;
 v_daily jsonb := '[]'::jsonb;
BEGIN
 IF coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' THEN
   RAISE EXCEPTION 'arena_economy_forbidden' USING ERRCODE='42501';
 END IF;
 IF p_days NOT IN (1,7,30) THEN RAISE EXCEPTION 'arena_economy_period_invalid'; END IF;
 v_start := CASE WHEN p_days=1
   THEN date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
   ELSE v_end-make_interval(days=>p_days) END;

 WITH duels AS (
   SELECT r.id,r.winner_team,
     count(*) FILTER (WHERE NOT a.is_bot AND a.user_id IS NOT NULL) AS humans,
     count(*) FILTER (WHERE a.is_bot) AS bots,
     max(a.team) FILTER (WHERE NOT a.is_bot AND a.user_id IS NOT NULL) AS human_team,
     max(a.team) FILTER (WHERE a.is_bot) AS bot_team
   FROM public.arena_rooms r JOIN public.arena_participants a ON a.room_id=r.id
   WHERE r.mode='duel' AND r.status='finished' AND r.created_at>=v_start AND r.created_at<v_end
   GROUP BY r.id
 ), matched AS (SELECT * FROM duels WHERE humans=1 AND bots=1)
 SELECT pg_catalog.jsonb_build_object(
   'finished', (SELECT count(*) FROM public.arena_rooms
      WHERE status='finished' AND created_at>=v_start AND created_at<v_end),
   'allParticipants', (SELECT count(*) FROM public.arena_participants a
      JOIN public.arena_rooms r ON r.id=a.room_id
      WHERE NOT a.is_bot AND a.user_id IS NOT NULL AND r.status='finished'
        AND r.created_at>=v_start AND r.created_at<v_end),
   'uniquePlayers', (SELECT count(DISTINCT a.user_id) FROM public.arena_participants a
      JOIN public.arena_rooms r ON r.id=a.room_id
      WHERE NOT a.is_bot AND a.user_id IS NOT NULL AND r.created_at>=v_start AND r.created_at<v_end),
   'botDuels', count(*),
   'humanWins', count(*) FILTER (WHERE winner_team=human_team),
   'botWins', count(*) FILTER (WHERE winner_team=bot_team),
   'draws', count(*) FILTER (WHERE winner_team IS NULL)
 ) INTO v_battles FROM matched;

 -- The legacy audit records wallet deltas, not the reason for a purchase.
 -- These figures must NEVER be described as confirmed Arena shopping expenses.
 SELECT pg_catalog.jsonb_build_object(
   'goldOut',coalesce(sum(greatest(0,gold_old-gold_new)),0),
   'gemsOut',coalesce(sum(greatest(0,gems_old-gems_new)),0),
   'stonesOut',coalesce(sum(greatest(0,stones_old-stones_new)),0),
   'goldIn',coalesce(sum(greatest(0,gold_new-gold_old)),0),
   'gemsIn',coalesce(sum(greatest(0,gems_new-gems_old)),0),
   'stoneIn',coalesce(sum(greatest(0,stones_new-stones_old)),0),
   'events',count(*)
 ) INTO v_balance FROM public.territory_economy_audit_v1
 WHERE changed_at>=v_start AND changed_at<v_end;

 SELECT pg_catalog.jsonb_build_object(
   'total',count(*),
   'users',count(DISTINCT player_id),
   'byKind',coalesce((
     SELECT pg_catalog.jsonb_object_agg(item_kind,n)
     FROM (SELECT item_kind,count(*)::integer n
       FROM territory_private.arena_consumable_usage_v1
       WHERE used_at>=v_start AND used_at<v_end GROUP BY item_kind) kinds
   ),'{}'::jsonb)
 ) INTO v_usage FROM territory_private.arena_consumable_usage_v1
 WHERE used_at>=v_start AND used_at<v_end;

 -- Claimed Arena gold can be reconstructed from the fixed authoritative formula,
 -- but older grants lack their own claimed-at events. Label as computed.
 SELECT pg_catalog.jsonb_build_object(
   'claimed',count(*),
   'goldComputed',coalesce(sum(round((CASE
      WHEN r.winner_team=a.team THEN 30+a.level*10
      WHEN r.winner_team IS NULL THEN 15+a.level*5
      ELSE 5+a.level*2 END)
      * CASE r.mode WHEN 'duel' THEN 1.0 WHEN 'team' THEN 1.2 ELSE 1.5 END
      + a.kills*10)::bigint),0)
 ) INTO v_rewards
 FROM public.arena_participants a JOIN public.arena_rooms r ON r.id=a.room_id
 WHERE NOT a.is_bot AND a.user_id IS NOT NULL AND a.rewarded AND r.status='finished'
   AND r.created_at>=v_start AND r.created_at<v_end;

 SELECT v_rewards || pg_catalog.jsonb_build_object(
  'top50MailCreated',count(*) FILTER (WHERE t.grant_id IS NOT NULL),
  'top50MailClaimed',count(*) FILTER (WHERE g.claimed_at IS NOT NULL),
  'redGemsGranted',coalesce(sum((t.reward->>'redGems')::integer)
       FILTER (WHERE t.grant_id IS NOT NULL),0),
  'redGemsClaimed',coalesce(sum((t.reward->>'redGems')::integer)
       FILTER (WHERE g.claimed_at IS NOT NULL),0)
 ) INTO v_rewards
 FROM territory_private.arena_top50_reward_results_v1 t
 LEFT JOIN public.admin_grants g ON g.id=t.grant_id
 WHERE (t.week::timestamp AT TIME ZONE 'UTC') >= v_start
   AND (t.week::timestamp AT TIME ZONE 'UTC') < v_end;

 WITH ranked AS (
  SELECT a.user_id,p.display_name,
    count(*)::integer AS fights,
    count(*) FILTER (WHERE r.winner_team=a.team)::integer AS wins,
    count(*) FILTER (WHERE r.winner_team IS NOT NULL AND r.winner_team<>a.team)::integer AS losses
  FROM public.arena_participants a
  JOIN public.arena_rooms r ON r.id=a.room_id
  JOIN public.players p ON p.id=a.user_id
  WHERE NOT a.is_bot AND a.user_id IS NOT NULL
    AND r.status='finished' AND r.created_at>=v_start AND r.created_at<v_end
  GROUP BY a.user_id,p.display_name ORDER BY fights DESC,wins DESC LIMIT 10
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'name',display_name,'fights',fights,'wins',wins,'losses',losses)), '[]'::jsonb)
 INTO v_top FROM ranked;

 WITH duel_data AS (
  SELECT r.id,(r.created_at AT TIME ZONE 'UTC')::date AS day,r.winner_team,
    count(*) FILTER (WHERE NOT a.is_bot AND a.user_id IS NOT NULL) humans,
    count(*) FILTER (WHERE a.is_bot) bots,
    max(a.team) FILTER (WHERE NOT a.is_bot AND a.user_id IS NOT NULL) human_team,
    max(a.team) FILTER (WHERE a.is_bot) bot_team
  FROM public.arena_rooms r JOIN public.arena_participants a ON a.room_id=r.id
  WHERE r.mode='duel' AND r.status='finished'
    AND r.created_at>=v_start AND r.created_at<v_end GROUP BY r.id
 ), day_totals AS (
  SELECT day,count(*) n,count(*) FILTER (WHERE winner_team=human_team) human,
    count(*) FILTER (WHERE winner_team=bot_team) bot
  FROM duel_data WHERE humans=1 AND bots=1 GROUP BY day
 ), days AS (
  SELECT (d::timestamp AT TIME ZONE 'UTC')::date AS day
  FROM generate_series((v_start AT TIME ZONE 'UTC')::date,
    (v_end AT TIME ZONE 'UTC')::date, interval '1 day') d
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'date',to_char(days.day,'DD.MM'),'duels',coalesce(t.n,0),
  'humanWins',coalesce(t.human,0),'botWins',coalesce(t.bot,0)
 ) ORDER BY days.day),'[]'::jsonb)
 INTO v_daily FROM days LEFT JOIN day_totals t ON t.day=days.day;

 RETURN pg_catalog.jsonb_build_object(
   'period',p_days,'from',v_start,'to',v_end,'battles',v_battles,
   'wallet',v_balance,'consumables',v_usage,'rewards',v_rewards,
   'topPlayers',v_top,'daily',v_daily,
   'notes',pg_catalog.jsonb_build_object(
     'wallet','Все списания/пополнения по игре; точных исторических покупок лавки нет',
     'consumables','Точный серверный учёт начат с установки этой версии',
     'rewards','Золото рассчитано по полученным наградам, ТОП-50 — по реальным письмам'))
END $func$;
REVOKE ALL ON FUNCTION public.territory_admin_arena_economy_v1(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_arena_economy_v1(integer) TO service_role;
