-- Owner-managed tester settings persistence; real-player stats remain guarded.
-- Never reset tester profiles, arena history or any real player's saves.
ALTER TABLE territory_private.owner_test_bots_v1
  ADD COLUMN IF NOT EXISTS attack_override integer CHECK(attack_override BETWEEN 1 AND 2000000),
  ADD COLUMN IF NOT EXISTS defense_override integer CHECK(defense_override BETWEEN 0 AND 2000000),
  ADD COLUMN IF NOT EXISTS hp_override integer CHECK(hp_override BETWEEN 1 AND 2000000),
  ADD COLUMN IF NOT EXISTS crit_override integer CHECK(crit_override BETWEEN 0 AND 75);

CREATE OR REPLACE FUNCTION public.territory_gear_guard_v4()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_stats jsonb; v_managed record;
BEGIN
  IF NEW.game_state IS NULL THEN RETURN NEW; END IF;
  NEW.game_state:=territory_private.owner_cap_state_v1(
    public.territory_normalize_state_v4(
      territory_private.normalize_legacy_rare_state_20261108(NEW.game_state)),
    NEW.level,NEW.id);
  v_stats:=public.territory_gear_recompute_columns_v4(NEW.game_state);
  IF v_stats<>'{}'::jsonb THEN
    NEW.attack:=(v_stats->>'attack')::integer;
    NEW.defense:=(v_stats->>'defense')::integer;
    NEW.max_hp:=(v_stats->>'max_hp')::integer;
    NEW.crit_chance:=(v_stats->>'crit_chance')::integer;
  END IF;
  -- Real players retain the existing gear/level balance. Only ten
  -- owner-registered synthetic testers may have explicit combat overrides.
  SELECT attack_override,defense_override,hp_override,crit_override
    INTO v_managed FROM territory_private.owner_test_bots_v1 WHERE player_id=NEW.id;
  IF FOUND THEN
    NEW.attack:=COALESCE(v_managed.attack_override,NEW.attack);
    NEW.defense:=COALESCE(v_managed.defense_override,NEW.defense);
    NEW.max_hp:=COALESCE(v_managed.hp_override,NEW.max_hp);
    NEW.crit_chance:=COALESCE(v_managed.crit_override,NEW.crit_chance);
  END IF;
  RETURN NEW;
END
$function$
;
CREATE OR REPLACE FUNCTION public.territory_admin_test_bots_list_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'territory_private'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'slot', b.slot, 'playerId', p.id, 'name', p.display_name,
    'appearance', b.appearance, 'level', p.level,
    'attack', COALESCE(b.attack_override,p.attack),
    'defense', COALESCE(b.defense_override,p.defense),
    'hp', COALESCE(b.hp_override,p.max_hp),
    'crit', COALESCE(b.crit_override,p.crit_chance), 'vip', p.vip_level,
    'gold', p.gold, 'gems', p.gems,
    'energy', p.energy, 'forgeMaterials', p.forge_materials,
    'arenaRating', p.arena_rating, 'arenaWins', p.arena_wins,
    'arenaLosses', p.arena_losses, 'totalBattlesWon', p.total_battles_won,
    'chapter', p.current_chapter, 'chapterWins', p.chapter_wins,
    'bossesDefeated', p.total_bosses_defeated,
    'autoArena', b.auto_arena, 'autoCampaign', b.auto_campaign,
    'autoTrials', b.auto_trials, 'autoCave', b.auto_cave,
    'arenaMode', b.arena_mode, 'intervalMinutes', b.interval_minutes,
    'lastArenaAt', b.last_arena_at,
    'arenaStarts', (SELECT count(*) FROM territory_private.owner_test_bot_events_v1 e
       WHERE e.slot=b.slot AND e.activity='arena'),
    'lastEvent', (SELECT jsonb_build_object('activity',e.activity,'result',e.result,'at',e.created_at)
       FROM territory_private.owner_test_bot_events_v1 e WHERE e.slot=b.slot
       ORDER BY e.created_at DESC LIMIT 1)
  ) ORDER BY b.slot), '[]'::jsonb)
  FROM territory_private.owner_test_bots_v1 b
  JOIN public.players p ON p.id=b.player_id
$function$
;
CREATE OR REPLACE FUNCTION public.territory_admin_test_bot_update_v1(p_slot smallint, p_patch jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'territory_private'
AS $function$
DECLARE v_id uuid; v_key text;
BEGIN
 SELECT player_id INTO v_id FROM territory_private.owner_test_bots_v1 WHERE slot=p_slot FOR UPDATE;
 IF v_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' THEN
   RAISE EXCEPTION 'invalid_bot_update';
 END IF;
 FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
   IF v_key NOT IN ('name','appearance','level','attack','defense','hp','crit','vip',
                   'gold','gems','energy','forgeMaterials','arenaRating',
                   'autoArena','autoCampaign','autoTrials','autoCave','arenaMode','intervalMinutes') THEN
     RAISE EXCEPTION 'invalid_bot_field';
   END IF;
 END LOOP;
 IF p_patch ? 'name' AND (length(btrim(p_patch->>'name')) NOT BETWEEN 2 AND 28) THEN
   RAISE EXCEPTION 'invalid_bot_name';
 END IF;
 IF p_patch ? 'level' AND (p_patch->>'level')::int NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_bot_level'; END IF;
 IF p_patch ? 'attack' AND (p_patch->>'attack')::int NOT BETWEEN 1 AND 2000000 THEN RAISE EXCEPTION 'invalid_bot_attack'; END IF;
 IF p_patch ? 'defense' AND (p_patch->>'defense')::int NOT BETWEEN 0 AND 2000000 THEN RAISE EXCEPTION 'invalid_bot_defense'; END IF;
 IF p_patch ? 'hp' AND (p_patch->>'hp')::int NOT BETWEEN 1 AND 2000000 THEN RAISE EXCEPTION 'invalid_bot_hp'; END IF;
 IF p_patch ? 'crit' AND (p_patch->>'crit')::int NOT BETWEEN 0 AND 75 THEN RAISE EXCEPTION 'invalid_bot_crit'; END IF;
 IF p_patch ? 'vip' AND (p_patch->>'vip')::int NOT BETWEEN 0 AND 10 THEN RAISE EXCEPTION 'invalid_bot_vip'; END IF;
 IF p_patch ? 'gold' AND (p_patch->>'gold')::bigint NOT BETWEEN 0 AND 2147483647 THEN RAISE EXCEPTION 'invalid_bot_gold'; END IF;
 IF p_patch ? 'gems' AND (p_patch->>'gems')::bigint NOT BETWEEN 0 AND 2147483647 THEN RAISE EXCEPTION 'invalid_bot_gems'; END IF;
 IF p_patch ? 'energy' AND (p_patch->>'energy')::int NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'invalid_bot_energy'; END IF;
 IF p_patch ? 'forgeMaterials' AND (p_patch->>'forgeMaterials')::bigint NOT BETWEEN 0 AND 2147483647 THEN RAISE EXCEPTION 'invalid_bot_materials'; END IF;
 IF p_patch ? 'arenaRating' AND (p_patch->>'arenaRating')::int NOT BETWEEN 100 AND 100000 THEN RAISE EXCEPTION 'invalid_bot_rating'; END IF;
 IF p_patch ? 'intervalMinutes' AND (p_patch->>'intervalMinutes')::int NOT BETWEEN 2 AND 1440 THEN RAISE EXCEPTION 'invalid_bot_interval'; END IF;
 IF p_patch ? 'appearance' AND (p_patch->>'appearance') NOT IN ('m1','m2','f1','f2') THEN RAISE EXCEPTION 'invalid_bot_appearance'; END IF;
 IF p_patch ? 'arenaMode' AND (p_patch->>'arenaMode') NOT IN ('duel','team','chaos') THEN RAISE EXCEPTION 'invalid_bot_mode'; END IF;
 FOR v_key IN SELECT unnest(ARRAY['autoArena','autoCampaign','autoTrials','autoCave']) LOOP
   IF p_patch ? v_key AND jsonb_typeof(p_patch->v_key)<>'boolean' THEN RAISE EXCEPTION 'invalid_bot_toggle'; END IF;
 END LOOP;
 -- Persist bot-specific combat settings separately from level-derived
 -- player stats. The existing gear guard will reapply overrides for these
 -- ten synthetic profiles on every subsequent game_state save.
 UPDATE territory_private.owner_test_bots_v1 SET
   appearance=CASE WHEN p_patch?'appearance' THEN p_patch->>'appearance' ELSE appearance END,
   attack_override=CASE WHEN p_patch?'attack' THEN (p_patch->>'attack')::int ELSE attack_override END,
   defense_override=CASE WHEN p_patch?'defense' THEN (p_patch->>'defense')::int ELSE defense_override END,
   hp_override=CASE WHEN p_patch?'hp' THEN (p_patch->>'hp')::int ELSE hp_override END,
   crit_override=CASE WHEN p_patch?'crit' THEN (p_patch->>'crit')::int ELSE crit_override END,
   auto_arena=CASE WHEN p_patch?'autoArena' THEN (p_patch->>'autoArena')::boolean ELSE auto_arena END,
   auto_campaign=CASE WHEN p_patch?'autoCampaign' THEN (p_patch->>'autoCampaign')::boolean ELSE auto_campaign END,
   auto_trials=CASE WHEN p_patch?'autoTrials' THEN (p_patch->>'autoTrials')::boolean ELSE auto_trials END,
   auto_cave=CASE WHEN p_patch?'autoCave' THEN (p_patch->>'autoCave')::boolean ELSE auto_cave END,
   arena_mode=CASE WHEN p_patch?'arenaMode' THEN p_patch->>'arenaMode' ELSE arena_mode END,
   interval_minutes=CASE WHEN p_patch?'intervalMinutes' THEN (p_patch->>'intervalMinutes')::int ELSE interval_minutes END,
   updated_at=clock_timestamp()
 WHERE slot=p_slot;

 -- Bot behavior-only updates must NOT touch player saves, arena rating,
 -- currencies, inventory or derived equipment stats.
 IF p_patch ?| ARRAY['name','level','gold','gems','energy','forgeMaterials','vip','arenaRating'] THEN
   UPDATE public.players SET
     display_name=CASE WHEN p_patch?'name' THEN btrim(p_patch->>'name') ELSE display_name END,
     level=CASE WHEN p_patch?'level' THEN (p_patch->>'level')::int ELSE level END,
     vip_level=CASE WHEN p_patch?'vip' THEN (p_patch->>'vip')::int ELSE vip_level END,
     gold=CASE WHEN p_patch?'gold' THEN (p_patch->>'gold')::int ELSE gold END,
     gems=CASE WHEN p_patch?'gems' THEN (p_patch->>'gems')::int ELSE gems END,
     energy=CASE WHEN p_patch?'energy' THEN (p_patch->>'energy')::int ELSE energy END,
     forge_materials=CASE WHEN p_patch?'forgeMaterials' THEN (p_patch->>'forgeMaterials')::int ELSE forge_materials END,
     arena_rating=CASE WHEN p_patch?'arenaRating' THEN (p_patch->>'arenaRating')::int ELSE arena_rating END,
     updated_at=clock_timestamp()
   WHERE id=v_id;
 END IF;

 IF p_patch ?| ARRAY['name','level','gold','gems','vip','attack','defense','hp','crit','appearance'] THEN
   -- Only character edits refresh the game_state snapshot. The original
   -- economy/gear guards still validate this single managed player.
   UPDATE public.players p SET game_state=jsonb_set(
     COALESCE(p.game_state,'{}'::jsonb),'{player}',
     COALESCE(p.game_state->'player','{}'::jsonb) ||
     jsonb_build_object(
       'name',p.display_name,'level',p.level,'gold',p.gold,'gems',p.gems,
       'attack',COALESCE((SELECT attack_override FROM territory_private.owner_test_bots_v1 WHERE slot=p_slot),p.attack),
       'defense',COALESCE((SELECT defense_override FROM territory_private.owner_test_bots_v1 WHERE slot=p_slot),p.defense),
       'maxHp',COALESCE((SELECT hp_override FROM territory_private.owner_test_bots_v1 WHERE slot=p_slot),p.max_hp),
       'critChance',COALESCE((SELECT crit_override FROM territory_private.owner_test_bots_v1 WHERE slot=p_slot),p.crit_chance),
       'vipLevel',p.vip_level,
       'appearance',(SELECT appearance FROM territory_private.owner_test_bots_v1 WHERE slot=p_slot)
     ),true)
   WHERE p.id=v_id;
 END IF;
 RETURN true;
END
$function$
;
REVOKE ALL ON FUNCTION public.territory_admin_test_bot_update_v1(smallint,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_test_bot_update_v1(smallint,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.territory_admin_test_bots_list_v1()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_test_bots_list_v1() TO service_role;
