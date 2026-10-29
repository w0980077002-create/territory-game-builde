-- TERRITORY V1 one-time owner-authorized beta baseline. Never changes
-- public.players, wallets, gear, inventory, VIP, premium gems or arena.
-- This records the current live DB state as the owner's migration baseline;
-- it is NOT an independent proof of historical item acquisition.
-- It requires the preinstalled legacy text equipment reconciliation migration.
BEGIN;
DO $preflight$
BEGIN
 IF EXISTS (SELECT 1 FROM territory_private.combat_profile_attestations_v1)
    OR EXISTS (SELECT 1 FROM territory_private.combat_profiles_v1)
    OR EXISTS (SELECT 1 FROM territory_private.combat_sessions_v1 WHERE state->>'status'='fighting')
 THEN RAISE EXCEPTION 'legacy_baseline_requires_empty_profiles'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.players p
  WHERE coalesce(p.banned,false)
     OR p.level NOT BETWEEN 1 AND 100
     OR p.game_state#>>'{player,level}' IS DISTINCT FROM p.level::text
     OR jsonb_typeof(p.game_state#>'{player,stats}')<>'object'
     OR jsonb_typeof(p.game_state#>'{player,equipped}')<>'object'
     OR jsonb_typeof(p.game_state->'inventory')<>'array'
     OR p.game_state#>>'{player,gold}' IS DISTINCT FROM p.gold::text
     OR p.game_state#>>'{player,xp}' IS DISTINCT FROM p.xp::text
     OR p.game_state#>>'{player,maxEnergy}' IS DISTINCT FROM p.max_energy::text
 ) THEN RAISE EXCEPTION 'legacy_baseline_requires_clean_saves'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.players p
  CROSS JOIN LATERAL jsonb_each(p.game_state#>'{player,equipped}') e(slot,v)
  WHERE e.v<>'null'::jsonb AND (e.v->>'id' IS NULL
        OR btrim(e.v->>'id')='' OR length(e.v->>'id')>256)
 ) THEN RAISE EXCEPTION 'legacy_baseline_requires_identifiable_equipment'; END IF;
END $preflight$;

WITH baseline AS (
 SELECT p.id, p.game_state, p.level,
   coalesce((p.game_state#>>'{player,stats,hp}')::numeric,0) AS hero_hp,
   coalesce((p.game_state#>>'{player,stats,maxHp}')::numeric,0) AS hero_max_hp,
   coalesce((p.game_state#>>'{player,stats,attack}')::numeric,0) AS hero_attack,
   coalesce((p.game_state#>>'{player,stats,defense}')::numeric,0) AS hero_defense,
   coalesce((p.game_state#>>'{player,stats,critChance}')::numeric,0) AS hero_crit,
   coalesce((p.game_state#>>'{player,stats,critDamage}')::numeric,0) AS hero_crit_damage,
   gear.hp AS gear_hp,gear.attack AS gear_attack,
   gear.defense AS gear_defense,gear.crit AS gear_crit,
   territory_private.combat_legacy_equipped_ids_v1(p.game_state) AS legacy_ids
 FROM public.players p
 CROSS JOIN LATERAL (
  SELECT coalesce(sum((v->>'hp')::numeric),0) AS hp,
         coalesce(sum((v->>'attack')::numeric),0) AS attack,
         coalesce(sum((v->>'defense')::numeric),0) AS defense,
         coalesce(sum((v->>'critChance')::numeric),0) AS crit
  FROM jsonb_each(p.game_state#>'{player,equipped}') e(slot,v)
  WHERE v<>'null'::jsonb
 ) gear
),
candidates AS (
 SELECT b.*, jsonb_build_object(
   'stats',jsonb_build_object(
     'hp',b.hero_hp+b.gear_hp,
     'maxHp',b.hero_max_hp+b.gear_hp,
     'attack',b.hero_attack+b.gear_attack,
     'defense',b.hero_defense+b.gear_defense,
     'critChance',(b.hero_crit+b.gear_crit)/100.0,
     'critMultiplier',1+b.hero_crit_damage/100.0,
     'dodgeChance',0,'blockChance',0),
   'ownership',jsonb_build_object('heroLevel',b.level,
      'skills','{}'::jsonb,'runes','{}'::jsonb,'passives','{}'::jsonb),
   'loadout',jsonb_build_object('skills','[]'::jsonb,'passives','[]'::jsonb)
 ) AS fighter
 FROM baseline b
 WHERE b.hero_hp>=0 AND b.hero_max_hp>0 AND b.hero_hp<=b.hero_max_hp
  AND b.hero_attack>=0 AND b.hero_defense>=0
  AND b.hero_crit>=0 AND b.hero_crit+b.gear_crit<=100
  AND b.hero_crit_damage BETWEEN 0 AND 999
  AND b.gear_hp>=0 AND b.gear_attack>=0 AND b.gear_defense>=0
  AND b.hero_hp+b.gear_hp<=1000000000
  AND b.hero_attack+b.gear_attack<=1000000000
  AND array_position(b.legacy_ids,NULL) IS NULL
  AND cardinality(b.legacy_ids)=(SELECT count(DISTINCT id) FROM unnest(b.legacy_ids) id)
)
INSERT INTO territory_private.combat_profile_attestations_v1(
  player_id,source_game_state,source_player_level,fighter,equipped_item_ids,
  legacy_equipped_ids,evidence_reference,reviewed_by
)
SELECT c.id,c.game_state,c.level,c.fighter,ARRAY[]::uuid[],c.legacy_ids,
 'owner_authorized_live_beta_baseline_20261029',
 'owner_requested_migration_snapshot'
FROM candidates c;

-- If the data are not uniformly valid, abort the entire migration instead of
-- creating a mixed/partially blocked player population.
DO $verify$
DECLARE actual integer; expected integer; bad integer;
BEGIN
 SELECT count(*) INTO expected FROM public.players;
 SELECT count(*) INTO actual FROM territory_private.combat_profile_attestations_v1
  WHERE evidence_reference='owner_authorized_live_beta_baseline_20261029';
 IF actual<>expected THEN RAISE EXCEPTION 'legacy_baseline_incomplete: % of %',actual,expected; END IF;
 SELECT count(*) INTO bad FROM (
  SELECT p.id, (territory_private.prepare_combat_profile_v1(p.id))->>'status' status
  FROM public.players p ORDER BY p.id
 ) checked WHERE status<>'ready';
 IF bad>0 THEN RAISE EXCEPTION 'legacy_baseline_reconciliation_failed: %',bad; END IF;
END $verify$;
COMMIT;
