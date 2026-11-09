-- Owner-only authentic equipment for 10 managed testers (7 equipped slots each).
-- Catalog values follow src/game/equipmentCatalog.ts and the v4 forge growth.
-- Ordinary Arena opponent generation, real players and their inventory are untouched.
CREATE OR REPLACE FUNCTION territory_private.owner_tester_gear_template_v1(p_template text,p_level integer,p_tester_slot smallint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path='pg_catalog','public','territory_private' AS $gear$
DECLARE t record; v_stats jsonb; v_base jsonb;
BEGIN
 SELECT * INTO t FROM (VALUES
('shop_weapon_warrior_eq','weapon','Меч воина','⚔️','common',1,8,NULL,NULL,NULL,1,0,0),
('shop_weapon_knight_eq','weapon','Клинок рыцаря','🗡️','rare',3,18,NULL,NULL,3,1.5,0,0),
('shop_armor_leather_eq','armor','Кожаная броня','🦺','common',1,NULL,5,30,NULL,0,0.25,1),
('shop_armor_plate_eq','armor','Латные доспехи','🛡️','rare',3,NULL,12,80,NULL,0,0.5,1.5),
('shop_helmet_iron_eq','helmet','Железный шлем','⛑️','common',1,NULL,3,20,NULL,0,0.25,0.5),
('shop_boots_swift_eq','boots','Сапоги скорости','🥾','rare',2,NULL,4,40,2,0,0.25,1),
('shop_ring_power_eq','ring','Кольцо силы','💍','rare',5,10,NULL,NULL,3,0.5,0.25,0.75),
('shop_shield_oak_eq','shield','Дубовый щит','🛡️','common',2,NULL,5,25,NULL,0,0.5,0.5),
('shop_amulet_raven_eq','amulet','Амулет ворона','📿','rare',3,6,NULL,NULL,3,0.5,0.25,0.75)
 ) AS c(template,slot,name,icon,rarity,base_level,base_attack,base_defense,base_hp,base_crit,
        gain_attack,gain_defense,gain_hp)
 WHERE template=p_template;
 IF NOT FOUND OR p_level NOT BETWEEN t.base_level AND 100 OR p_tester_slot NOT BETWEEN 1 AND 10
 THEN RAISE EXCEPTION 'tester_invalid_gear_template_or_level'; END IF;
 v_base:=jsonb_strip_nulls(jsonb_build_object(
    'attack',t.base_attack,'defense',t.base_defense,
    'hp',t.base_hp,'critChance',t.base_crit));
 v_stats:=jsonb_strip_nulls(jsonb_build_object(
    'attack',CASE WHEN t.base_attack IS NULL THEN NULL ELSE t.base_attack+round(t.gain_attack*(p_level-t.base_level)) END,
    'defense',CASE WHEN t.base_defense IS NULL THEN NULL ELSE t.base_defense+round(t.gain_defense*(p_level-t.base_level)) END,
    'hp',CASE WHEN t.base_hp IS NULL THEN NULL ELSE t.base_hp+round(t.gain_hp*(p_level-t.base_level)) END,
    'critChance',t.base_crit));
 RETURN public.territory_normalize_gear_v4(
    jsonb_build_object(
       'id','owner_tester_'||p_tester_slot::text||'_'||t.template,
       'slot',t.slot,'name',t.name,'icon',t.icon,'rarity',t.rarity,
       'level',p_level,'baseLevel',t.base_level,'baseStats',v_base,
       'upgradeCount',p_level-t.base_level
    ) || v_stats);
END;
$gear$;
REVOKE ALL ON FUNCTION territory_private.owner_tester_gear_template_v1(text,integer,smallint)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_admin_test_bot_gear_v1(
 p_slot smallint,p_operation text,p_gear_slot text DEFAULT NULL,
 p_template text DEFAULT NULL,p_level integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','public','territory_private' AS $gear$
DECLARE v_id uuid; v_hero_level int; v_state jsonb; v_equipped jsonb;
v_bag jsonb; v_item jsonb; v_current jsonb; v_slot text;
v_template text; v_idx int; v_changes int:=0; v_new_bag jsonb;
BEGIN
 IF p_slot NOT BETWEEN 1 AND 10 OR p_operation NOT IN ('seed','equip','unequip','relevel')
 THEN RAISE EXCEPTION 'tester_invalid_gear_action'; END IF;
 SELECT p.id,p.level,p.game_state INTO v_id,v_hero_level,v_state
   FROM territory_private.owner_test_bots_v1 b
   JOIN public.players p ON p.id=b.player_id
   WHERE b.slot=p_slot FOR UPDATE OF p;
 IF v_id IS NULL OR jsonb_typeof(v_state->'player') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'tester_profile_missing'; END IF;
 v_equipped:=CASE WHEN jsonb_typeof(v_state#>'{player,equipped}')='object'
   THEN v_state#>'{player,equipped}' ELSE '{}'::jsonb END;
 v_bag:=CASE WHEN jsonb_typeof(v_state->'inventory')='array'
   THEN v_state->'inventory' ELSE '[]'::jsonb END;
 IF p_operation='seed' THEN
   FOR v_slot,v_template IN SELECT x.slot,x.template FROM (VALUES
     ('weapon','shop_weapon_knight_eq'),('armor','shop_armor_plate_eq'),
     ('helmet','shop_helmet_iron_eq'),('boots','shop_boots_swift_eq'),
     ('shield','shop_shield_oak_eq'),('ring','shop_ring_power_eq'),
     ('amulet','shop_amulet_raven_eq')
   ) AS x(slot,template) LOOP
     IF v_equipped ? v_slot THEN CONTINUE; END IF;
     v_item:=territory_private.owner_tester_gear_template_v1(v_template,v_hero_level,p_slot);
     v_equipped:=jsonb_set(v_equipped,ARRAY[v_slot],v_item,true);
     v_changes:=v_changes+1;
   END LOOP;
 ELSIF p_operation='unequip' THEN
   IF p_gear_slot NOT IN ('weapon','armor','helmet','boots','shield','ring','amulet')
   THEN RAISE EXCEPTION 'tester_invalid_gear_slot'; END IF;
   v_current:=v_equipped->p_gear_slot;
   IF jsonb_typeof(v_current)='object' THEN
     v_bag:=v_bag||jsonb_build_array(jsonb_build_object(
       'id',(v_current->>'id')||'_inv','name',v_current->>'name',
       'icon',v_current->>'icon','type','equipment','rarity',v_current->>'rarity',
       'qty',1,'description','Снаряжение тестера','equipment',v_current));
     v_equipped:=v_equipped-p_gear_slot;
     v_changes:=1;
   END IF;
 ELSIF p_operation='equip' THEN
   v_item:=territory_private.owner_tester_gear_template_v1(
     p_template,COALESCE(p_level,v_hero_level),p_slot);
   IF (v_item->>'slot') IS DISTINCT FROM p_gear_slot OR (v_item->>'level')::int>v_hero_level
   THEN RAISE EXCEPTION 'tester_gear_level_or_slot_mismatch'; END IF;
   v_current:=v_equipped->p_gear_slot;
   IF v_current IS DISTINCT FROM v_item THEN
     -- If the requested item was previously unequipped, take it from the bag.
     SELECT COALESCE(jsonb_agg(x.value ORDER BY x.n),'[]'::jsonb)
       INTO v_new_bag FROM jsonb_array_elements(v_bag) WITH ORDINALITY x(value,n)
       WHERE x.value#>>'{equipment,id}' IS DISTINCT FROM v_item->>'id';
     v_bag:=v_new_bag;
     IF jsonb_typeof(v_current)='object' AND v_current->>'id' IS DISTINCT FROM v_item->>'id' THEN
       v_bag:=v_bag||jsonb_build_array(jsonb_build_object(
         'id',(v_current->>'id')||'_inv','name',v_current->>'name',
         'icon',v_current->>'icon','type','equipment','rarity',v_current->>'rarity',
         'qty',1,'description','Снаряжение тестера','equipment',v_current));
     END IF;
     v_equipped:=jsonb_set(v_equipped,ARRAY[p_gear_slot],v_item,true);
     v_changes:=1;
   END IF;
 ELSIF p_operation='relevel' THEN
   IF p_gear_slot NOT IN ('weapon','armor','helmet','boots','shield','ring','amulet')
      OR p_level NOT BETWEEN 1 AND v_hero_level THEN
       RAISE EXCEPTION 'tester_invalid_gear_level'; END IF;
   v_current:=v_equipped->p_gear_slot;
   IF jsonb_typeof(v_current)<>'object' OR
     (v_current->>'id') NOT LIKE 'owner_tester_'||p_slot::text||'_%' THEN
     RAISE EXCEPTION 'tester_gear_not_owned'; END IF;
   v_template:=substring(v_current->>'id' FROM char_length('owner_tester_'||p_slot::text||'_')+1);
   v_item:=territory_private.owner_tester_gear_template_v1(v_template,p_level,p_slot);
   IF v_item->>'slot' IS DISTINCT FROM p_gear_slot THEN RAISE EXCEPTION 'tester_gear_invalid_slot'; END IF;
   IF v_current IS DISTINCT FROM v_item THEN
     v_equipped:=jsonb_set(v_equipped,ARRAY[p_gear_slot],v_item,true);
     v_changes:=1;
   END IF;
 END IF;
 IF v_changes>0 THEN
    UPDATE public.players SET game_state=jsonb_set(
       jsonb_set(v_state,'{player,equipped}',v_equipped,true),
       '{inventory}',v_bag,true),updated_at=clock_timestamp()
    WHERE id=v_id;
 END IF;
 RETURN jsonb_build_object('changed',v_changes,'slot',p_slot,'operation',p_operation,
  'gear',COALESCE((SELECT game_state#>'{player,equipped}' FROM public.players WHERE id=v_id),'{}'::jsonb));
END $gear$;
REVOKE ALL ON FUNCTION public.territory_admin_test_bot_gear_v1(smallint,text,text,text,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_test_bot_gear_v1(smallint,text,text,text,integer)
 TO service_role;

CREATE OR REPLACE FUNCTION public.territory_gear_guard_v4()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_stats jsonb; v_managed record;
  v_att int; v_def int; v_hp int; v_crit int;
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
    -- Only these ten owner test profiles can carry manually chosen base stats.
    -- Equipped gear always adds actual canonical bonuses on top of that base.
    SELECT coalesce(sum(coalesce((gear.value->>'attack')::int,0)),0),
           coalesce(sum(coalesce((gear.value->>'defense')::int,0)),0),
           coalesce(sum(coalesce((gear.value->>'hp')::int,0)),0),
           coalesce(sum(coalesce((gear.value->>'critChance')::int,0)),0)
      INTO v_att,v_def,v_hp,v_crit
    FROM jsonb_each(CASE WHEN jsonb_typeof(NEW.game_state#>'{player,equipped}')='object'
      THEN NEW.game_state#>'{player,equipped}' ELSE '{}'::jsonb END) gear
    WHERE jsonb_typeof(gear.value)='object';
    NEW.attack:=least(2147483647,greatest(1,coalesce(v_managed.attack_override,NEW.attack-v_att))+v_att);
    NEW.defense:=least(2147483647,greatest(0,coalesce(v_managed.defense_override,NEW.defense-v_def))+v_def);
    NEW.max_hp:=least(2147483647,greatest(1,coalesce(v_managed.hp_override,NEW.max_hp-v_hp))+v_hp);
    NEW.crit_chance:=least(75,greatest(0,coalesce(v_managed.crit_override,NEW.crit_chance-v_crit))+v_crit);
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
    'attack', COALESCE(b.attack_override, (p.game_state#>>'{player,stats,attack}')::int, p.attack),
    'defense', COALESCE(b.defense_override,(p.game_state#>>'{player,stats,defense}')::int,p.defense),
    'hp', COALESCE(b.hp_override,(p.game_state#>>'{player,stats,maxHp}')::int,p.max_hp),
    'crit', COALESCE(b.crit_override,(p.game_state#>>'{player,stats,critChance}')::int,p.crit_chance),
    'totalAttack',p.attack,'totalDefense',p.defense,'totalHp',p.max_hp,'totalCrit',p.crit_chance,
    'equipped', COALESCE(p.game_state#>'{player,equipped}','{}'::jsonb),
    'vip', p.vip_level,
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
REVOKE ALL ON FUNCTION public.territory_admin_test_bots_list_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_test_bots_list_v1() TO service_role;
