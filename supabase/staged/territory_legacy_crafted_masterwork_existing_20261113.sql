-- TERRITORY. ONE-TIME legacy-local craft compensation, 2026-11-13.
-- Scope: exactly 37 verified old crafted-* EQUIPMENT items across 8 existing
-- players. The 38th crafted-* item is a MATERIAL and MUST NOT be touched.
-- Never update 325+ independently server-owned stage8_* items, receipts,
-- payments, VIP, resources, shop goods, normal player gear or bot arena gear.
--
-- All writes occur atomically, with full pre-image game_state backups.
-- The authoritative ledger contains EXACT old item IDs and owners (not
-- client-supplied recipe names). Future saves are idempotently rebalanced.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS territory_private.legacy_crafted_masterwork_backup_20261113 (
 player_id uuid PRIMARY KEY,
 original_game_state jsonb NOT NULL,
 original_updated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS territory_private.legacy_crafted_masterwork_ledger_20261113 (
 item_id text PRIMARY KEY,
 player_id uuid NOT NULL REFERENCES public.players(id),
 recipe_id text NOT NULL,
 old_name text NOT NULL,
 slot text NOT NULL,
 rarity text NOT NULL,
 original_level integer NOT NULL,
 original_item jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON territory_private.legacy_crafted_masterwork_backup_20261113 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON territory_private.legacy_crafted_masterwork_ledger_20261113 FROM PUBLIC, anon, authenticated;

-- Lock all affected heroes, and verify the exact set before any changes.
SELECT id FROM public.players WHERE
 EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(
   CASE WHEN pg_catalog.jsonb_typeof(game_state->'inventory')='array'
     THEN game_state->'inventory' ELSE '[]'::jsonb END) i
   WHERE i->>'id' ~ '^crafted-(smith_apprentice_blade|smith_leather_armor|jeweler_raven_amulet|engineer_oak_shield)-[0-9]{13}-[a-z0-9]+$')
 OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(
   CASE WHEN pg_catalog.jsonb_typeof(game_state#>'{player,equipped}')='object'
     THEN game_state#>'{player,equipped}' ELSE '{}'::jsonb END) i
   WHERE i.value->>'id' ~ '^crafted-(smith_apprentice_blade|smith_leather_armor|jeweler_raven_amulet|engineer_oak_shield)-[0-9]{13}-[a-z0-9]+$')
 FOR UPDATE;

CREATE TEMP TABLE pg_temp.legacy_crafted_candidates_20261113 ON COMMIT DROP AS
WITH craft AS (
 SELECT p.id AS player_id,p.updated_at,v.value AS item,'inventory' AS context
 FROM public.players p CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
   CASE WHEN pg_catalog.jsonb_typeof(p.game_state->'inventory')='array' THEN p.game_state->'inventory' ELSE '[]'::jsonb END) v
 UNION ALL
 SELECT p.id,p.updated_at,v.value,'equipped' FROM public.players p
 CROSS JOIN LATERAL pg_catalog.jsonb_each(
   CASE WHEN pg_catalog.jsonb_typeof(p.game_state#>'{player,equipped}')='object' THEN p.game_state#>'{player,equipped}' ELSE '{}'::jsonb END) v
 UNION ALL
 SELECT p.id,p.updated_at,v.value,'belt' FROM public.players p
 CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
   CASE WHEN pg_catalog.jsonb_typeof(p.game_state->'belt')='array' THEN p.game_state->'belt' ELSE '[]'::jsonb END) v
)
SELECT c.player_id,c.updated_at,c.item,c.context,
       c.item->>'id' AS item_id,
       substring(c.item->>'id' FROM '^crafted-([a-z0-9_]+)-[0-9]{13}-[a-z0-9]+$') AS recipe_id,
       CASE WHEN c.context='equipped' THEN c.item ELSE c.item->'equipment' END AS eq
FROM craft c
WHERE c.item->>'id' ~ '^crafted-(smith_apprentice_blade|smith_leather_armor|jeweler_raven_amulet|engineer_oak_shield)-[0-9]{13}-[a-z0-9]+$';

DO $guard$
DECLARE n int; users int; bad int; duplicates int;
BEGIN
 SELECT count(*),count(DISTINCT player_id),count(*)-count(DISTINCT item_id)
 INTO n,users,duplicates FROM pg_temp.legacy_crafted_candidates_20261113;
 SELECT count(*) INTO bad FROM pg_temp.legacy_crafted_candidates_20261113
 WHERE pg_catalog.jsonb_typeof(eq)<>'object'
 OR eq->>'id'<>item_id OR (eq->>'level') !~ '^[1-9][0-9]{0,2}$'
 OR (eq->>'slot',eq->>'rarity',eq->>'name') IS DISTINCT FROM
  (CASE recipe_id WHEN 'smith_apprentice_blade' THEN 'weapon'
                  WHEN 'smith_leather_armor' THEN 'armor'
                  WHEN 'jeweler_raven_amulet' THEN 'amulet'
                  ELSE 'shield' END,
   CASE recipe_id WHEN 'jeweler_raven_amulet' THEN 'rare' ELSE 'common' END,
   CASE recipe_id WHEN 'smith_apprentice_blade' THEN 'Меч подмастерья'
                  WHEN 'smith_leather_armor' THEN 'Кожаная броня'
                  WHEN 'jeweler_raven_amulet' THEN 'Амулет ворона мастера'
                  ELSE 'Укреплённый щит' END);
 IF n<>37 OR users<>8 OR bad<>0 OR duplicates<>0
 THEN RAISE EXCEPTION 'legacy_masterwork_preflight_count=%_users=%_invalid=%_dupes=%',n,users,bad,duplicates; END IF;
 IF EXISTS (SELECT 1 FROM territory_private.legacy_crafted_masterwork_ledger_20261113)
 THEN RAISE EXCEPTION 'legacy_masterwork_already_migrated'; END IF;
END $guard$;

INSERT INTO territory_private.legacy_crafted_masterwork_backup_20261113
 (player_id,original_game_state,original_updated_at)
SELECT p.id,p.game_state,p.updated_at
FROM public.players p
WHERE p.id IN (SELECT DISTINCT player_id FROM pg_temp.legacy_crafted_candidates_20261113);

INSERT INTO territory_private.legacy_crafted_masterwork_ledger_20261113
 (item_id,player_id,recipe_id,old_name,slot,rarity,original_level,original_item)
SELECT item_id,player_id,recipe_id,eq->>'name',eq->>'slot',eq->>'rarity',(eq->>'level')::integer,item
FROM pg_temp.legacy_crafted_candidates_20261113;

-- Only server-reviewed ledger IDs are eligible. This helper is NOT an
-- authenticated RPC; no forge success, grants or resources can be created.
CREATE OR REPLACE FUNCTION territory_private.legacy_crafted_masterwork_item_20261113(
 p_item jsonb,p_player uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE
 v_id text := coalesce(p_item->>'id',p_item#>>'{equipment,id}');
 v_eq jsonb;
 v_recipe text;
 v_old_name text;
 v_slot text;
 v_rarity text;
 v_level int;
 v_base_level int;
 v_steps int;
 v_name text;
 v_base jsonb;
 v_stats jsonb := '{}'::jsonb;
 v_new_base numeric;
 v_target numeric;
 v_gain numeric;
 v_old numeric;
 v_shop numeric;
 v_stat text;
 v_growth numeric;
BEGIN
 IF pg_catalog.jsonb_typeof(p_item) <> 'object' THEN RETURN p_item; END IF;
 SELECT recipe_id,old_name,slot,rarity
 INTO v_recipe,v_old_name,v_slot,v_rarity
 FROM territory_private.legacy_crafted_masterwork_ledger_20261113
 WHERE player_id=p_player AND item_id=v_id;
 IF NOT FOUND THEN RETURN p_item; END IF;
 v_eq:=CASE WHEN pg_catalog.jsonb_typeof(p_item->'equipment')='object'
            THEN p_item->'equipment' ELSE p_item END;
 IF v_eq->>'id' IS DISTINCT FROM v_id
    OR v_eq->>'slot' IS DISTINCT FROM v_slot
    OR v_eq->>'rarity' IS DISTINCT FROM v_rarity
    OR v_eq->>'name' NOT IN (v_old_name,v_old_name||' · мастерская')
    OR v_eq->>'level' !~ '^[1-9][0-9]{0,2}$'
 THEN RETURN p_item; END IF;
 v_level:=(v_eq->>'level')::int;
 IF v_level>500 THEN RETURN p_item; END IF;
 v_base_level:=CASE WHEN (v_eq->>'baseLevel') ~ '^[1-9][0-9]{0,2}$'
                 THEN least(v_level,(v_eq->>'baseLevel')::integer)
                 ELSE v_level END;
 v_steps:=greatest(0,v_level-v_base_level);
 v_base:=CASE WHEN pg_catalog.jsonb_typeof(v_eq->'baseStats')='object'
              THEN v_eq->'baseStats' ELSE '{}'::jsonb END;
 v_name:=v_old_name||' · мастерская';
 FOR v_stat IN SELECT unnest(ARRAY['attack','defense','hp','critChance']) LOOP
   v_shop:=NULL; v_growth:=0;
   IF v_recipe='jeweler_raven_amulet' AND v_stat='attack' AND v_level>=3 THEN
     v_shop:=6+pg_catalog.round(0.5*(v_level-3));v_growth:=0.5;
   ELSIF v_recipe='jeweler_raven_amulet' AND v_stat='critChance' THEN
     v_shop:=3;
   ELSIF v_recipe='smith_apprentice_blade' AND v_stat='attack' THEN
     v_shop:=8+(v_level-1);v_growth:=1;
   ELSIF v_recipe='smith_leather_armor' AND v_stat='defense' THEN
     v_shop:=5+pg_catalog.round(0.25*(v_level-1));v_growth:=0.25;
   ELSIF v_recipe='smith_leather_armor' AND v_stat='hp' THEN
     v_shop:=30+(v_level-1);v_growth:=1;
   ELSIF v_recipe='engineer_oak_shield' AND v_stat='defense' AND v_level>=2 THEN
     v_shop:=5+pg_catalog.round(0.5*(v_level-2));v_growth:=0.5;
   ELSIF v_recipe='engineer_oak_shield' AND v_stat='hp' AND v_level>=2 THEN
     v_shop:=25+pg_catalog.round(0.5*(v_level-2));v_growth:=0.5;
   END IF;
   IF v_shop IS NULL THEN CONTINUE; END IF;
   v_old:=CASE WHEN pg_catalog.jsonb_typeof(v_eq->v_stat)='number'
              THEN (v_eq->>v_stat)::numeric ELSE 0 END;
   v_target:=greatest(v_old,ceil(v_shop*1.20));
   v_gain:=CASE WHEN v_stat='critChance' THEN 0 ELSE pg_catalog.round(v_growth*v_steps) END;
   v_new_base:=greatest(CASE WHEN pg_catalog.jsonb_typeof(v_base->v_stat)='number'
                          THEN (v_base->>v_stat)::numeric ELSE 0 END,
                        v_target-v_gain);
   v_base:=pg_catalog.jsonb_set(v_base,ARRAY[v_stat],to_jsonb(v_new_base::int),true);
   v_stats:=pg_catalog.jsonb_set(v_stats,ARRAY[v_stat],to_jsonb((v_new_base+v_gain)::int),true);
 END LOOP;
 v_eq:=v_eq||v_stats||pg_catalog.jsonb_build_object(
   'name',v_name,'baseLevel',v_base_level,
   'baseStats',v_base,'upgradeCount',v_steps);
 IF pg_catalog.jsonb_typeof(p_item->'equipment')='object' THEN
   RETURN p_item||pg_catalog.jsonb_build_object(
     'name',v_name,'equipment',v_eq);
 END IF;
 RETURN v_eq;
END $function$;

REVOKE ALL ON FUNCTION territory_private.legacy_crafted_masterwork_item_20261113(jsonb,uuid)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION territory_private.legacy_crafted_masterwork_save_20261113()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_inventory jsonb; v_equipped jsonb; v_belt jsonb; v_equipped_before jsonb; v_stats jsonb;
BEGIN
 IF NEW.game_state IS NULL OR pg_catalog.jsonb_typeof(NEW.game_state)<>'object'
 OR NOT EXISTS(SELECT 1 FROM territory_private.legacy_crafted_masterwork_ledger_20261113
               WHERE player_id=NEW.id) THEN RETURN NEW; END IF;
 IF pg_catalog.jsonb_typeof(NEW.game_state->'inventory')='array' THEN
   SELECT COALESCE(pg_catalog.jsonb_agg(
      territory_private.legacy_crafted_masterwork_item_20261113(e.value,NEW.id)
      ORDER BY e.ordinality),'[]'::jsonb) INTO v_inventory
   FROM pg_catalog.jsonb_array_elements(NEW.game_state->'inventory')
   WITH ORDINALITY e(value,ordinality);
   NEW.game_state:=pg_catalog.jsonb_set(NEW.game_state,'{inventory}',v_inventory);
 END IF;
 IF pg_catalog.jsonb_typeof(NEW.game_state#>'{player,equipped}')='object' THEN
   v_equipped_before:=NEW.game_state#>'{player,equipped}';
   SELECT COALESCE(pg_catalog.jsonb_object_agg(e.key,
     CASE WHEN pg_catalog.jsonb_typeof(e.value)='object' THEN
       territory_private.legacy_crafted_masterwork_item_20261113(e.value,NEW.id)
     ELSE e.value END),'{}'::jsonb) INTO v_equipped
   FROM pg_catalog.jsonb_each(NEW.game_state#>'{player,equipped}') e;
   NEW.game_state:=pg_catalog.jsonb_set(NEW.game_state,'{player,equipped}',v_equipped);
   -- This specific group has zero synthetic owner-bots; refresh combat
   -- columns only if an equipped legacy piece actually gained stats.
   IF v_equipped IS DISTINCT FROM v_equipped_before THEN
     v_stats:=public.territory_gear_recompute_columns_v4(NEW.game_state);
     IF v_stats<>'{}'::jsonb THEN
       NEW.attack:=(v_stats->>'attack')::integer;
       NEW.defense:=(v_stats->>'defense')::integer;
       NEW.max_hp:=(v_stats->>'max_hp')::integer;
       NEW.crit_chance:=(v_stats->>'crit_chance')::integer;
     END IF;
   END IF;
 END IF;
 IF pg_catalog.jsonb_typeof(NEW.game_state->'belt')='array' THEN
   SELECT COALESCE(pg_catalog.jsonb_agg(
      territory_private.legacy_crafted_masterwork_item_20261113(e.value,NEW.id)
      ORDER BY e.ordinality),'[]'::jsonb) INTO v_belt
   FROM pg_catalog.jsonb_array_elements(NEW.game_state->'belt')
   WITH ORDINALITY e(value,ordinality);
   NEW.game_state:=pg_catalog.jsonb_set(NEW.game_state,'{belt}',v_belt);
 END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION territory_private.legacy_crafted_masterwork_save_20261113()
 FROM PUBLIC,anon,authenticated;

-- Sort AFTER existing gear_guard (g) but BEFORE inventory_cleanup (i):
-- the owner-authorization legacy guard can otherwise restore a previously
-- approved, weaker level-60 shield from OLD.game_state after our correction.
-- Only these 8 real, non-test-bot accounts are migrated.
CREATE TRIGGER territory_hcrafted_masterwork_before_20261113
 BEFORE UPDATE OF game_state ON public.players FOR EACH ROW
 EXECUTE FUNCTION territory_private.legacy_crafted_masterwork_save_20261113();

-- Re-commit only the exact eight accounts protected by backups.
-- Existing trigger protections remain active; no bypass of server guards.
UPDATE public.players p SET game_state=p.game_state
WHERE p.id IN (SELECT DISTINCT player_id FROM pg_temp.legacy_crafted_candidates_20261113);

DO $verify$
DECLARE v_count int;v_players int;v_bad int;v_changed int;
BEGIN
 WITH patched AS (
 SELECT p.id AS player_id,p.game_state
 FROM public.players p JOIN territory_private.legacy_crafted_masterwork_backup_20261113 b
   ON b.player_id=p.id)
 SELECT count(*) INTO v_players FROM patched;
 IF v_players<>8 THEN RAISE EXCEPTION 'legacy_masterwork_player_count_changed_%',v_players; END IF;
 SELECT count(*) INTO v_count FROM territory_private.legacy_crafted_masterwork_ledger_20261113;
 IF v_count<>37 THEN RAISE EXCEPTION 'legacy_masterwork_item_count_changed_%',v_count; END IF;
 WITH live_items AS (
 SELECT p.id AS player_id,e.value AS eq FROM public.players p
 CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
   CASE WHEN pg_catalog.jsonb_typeof(p.game_state->'inventory')='array'
     THEN p.game_state->'inventory' ELSE '[]'::jsonb END) i
 CROSS JOIN LATERAL (SELECT i.value->'equipment' AS value) e
 WHERE i.value->>'id' LIKE 'crafted-%'
 UNION ALL
 SELECT p.id,e.value FROM public.players p
 CROSS JOIN LATERAL pg_catalog.jsonb_each(
   CASE WHEN pg_catalog.jsonb_typeof(p.game_state#>'{player,equipped}')='object'
     THEN p.game_state#>'{player,equipped}' ELSE '{}'::jsonb END) e
 WHERE e.value->>'id' LIKE 'crafted-%'
 UNION ALL
 SELECT p.id,i.value->'equipment' FROM public.players p
 CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
   CASE WHEN pg_catalog.jsonb_typeof(p.game_state->'belt')='array'
     THEN p.game_state->'belt' ELSE '[]'::jsonb END) i
 WHERE i.value->>'id' LIKE 'crafted-%'
 )
 SELECT count(*) FILTER (WHERE i.eq IS NULL OR eq->>'name' NOT LIKE '% · мастерская'
   OR (eq->>'level')::int < l.original_level)
 INTO v_bad
 FROM territory_private.legacy_crafted_masterwork_ledger_20261113 l
 LEFT JOIN live_items i ON i.player_id=l.player_id AND i.eq->>'id'=l.item_id;
 IF v_bad<>0 THEN RAISE EXCEPTION 'legacy_masterwork_postcheck_failed_%',v_bad; END IF;
 -- Shop/premium assets, profile level, wallets and other non-gear state untouched.
 IF EXISTS(SELECT 1 FROM public.players p JOIN
   territory_private.legacy_crafted_masterwork_backup_20261113 b ON b.player_id=p.id
   WHERE p.level <> (b.original_game_state#>>'{player,level}')::int
       OR p.game_state - 'inventory' - 'player' - 'belt'
          IS DISTINCT FROM b.original_game_state - 'inventory' - 'player' - 'belt'
       OR ((p.game_state#>'{player}') - 'equipped' - 'stats')
          IS DISTINCT FROM ((b.original_game_state#>'{player}') - 'equipped' - 'stats'))
 THEN RAISE EXCEPTION 'legacy_masterwork_unrelated_state_changed'; END IF;
END $verify$;
COMMIT;

-- Future stale saves of one of these exact previously owned crafted items are
-- corrected again by the BEFORE trigger; no items ever created or deleted.
