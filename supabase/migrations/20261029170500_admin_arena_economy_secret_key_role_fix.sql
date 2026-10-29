-- Repair: secret-key service-role calls have SQL privileges but can lack JWT role GUC.
-- Keep RPC inaccessible to browser roles; owner login stays enforced by admin-api.
CREATE OR REPLACE FUNCTION public.territory_admin_arena_economy_v1(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
 -- Only the privileged server key can EXECUTE this RPC. Standard roles
 -- lack EXECUTE via SQL GRANT; legacy request.jwt.claim.role is unreliable
 -- for Supabase sb_secret_* server keys and MUST NOT gate this RPC.
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
  'top50MailCreated',count(*) FILTER (WHERE g.created_at>=v_start AND g.created_at<v_end),
  'top50MailClaimed',count(*) FILTER (WHERE g.claimed_at>=v_start AND g.claimed_at<v_end),
  'redGemsGranted',coalesce(sum((t.reward->>'redGems')::integer)
       FILTER (WHERE g.created_at>=v_start AND g.created_at<v_end),0),
  'redGemsClaimed',coalesce(sum((t.reward->>'redGems')::integer)
       FILTER (WHERE g.claimed_at>=v_start AND g.claimed_at<v_end),0)
 ) INTO v_rewards
 FROM territory_private.arena_top50_reward_results_v1 t
 LEFT JOIN public.admin_grants g ON g.id=t.grant_id
 WHERE (g.created_at>=v_start AND g.created_at<v_end)
    OR (g.claimed_at>=v_start AND g.claimed_at<v_end);

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
     'rewards','Золото рассчитано по полученным наградам, ТОП-50 — по реальным письмам'));
END $function$;

REVOKE ALL ON FUNCTION public.territory_admin_arena_economy_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_arena_economy_v1(integer) TO service_role;
