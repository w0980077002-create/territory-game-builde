-- TERRITORY: unopened Trials chests, server-owned draw and one-time claim.
-- Existing completed/paid floors are NOT retroactively queued. No data reset.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS territory_private.trial_chest_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  floor integer NOT NULL CHECK (floor BETWEEN 1 AND 10000),
  tier text NOT NULL CHECK (tier IN ('common','explorer','guardian','legendary')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  opened_at timestamptz,
  receipt jsonb,
  PRIMARY KEY (player_id, floor),
  CONSTRAINT trial_chest_v1_receipt_consistency CHECK ((opened_at IS NULL) = (receipt IS NULL))
);
REVOKE ALL ON territory_private.trial_chest_v1 FROM PUBLIC, anon, authenticated;

-- The row is reserved only when a newly confirmed Trial victory advances
-- one floor AND adds exactly that floor to the earned and unopened arrays.
-- Other account saves, legacy wins, and old already-paid claims do nothing.
CREATE OR REPLACE FUNCTION territory_private.reserve_trial_chest_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'pg_catalog'
AS $fn$
DECLARE floor_no integer; tier_name text;
BEGIN
 IF NEW.game_state IS NOT DISTINCT FROM OLD.game_state
    OR pg_catalog.jsonb_typeof(OLD.game_state->'trialLevel') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(NEW.game_state->'trialLevel') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(NEW.game_state->'trialChestClaims') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(NEW.game_state->'trialChestUnopenedFloors') IS DISTINCT FROM 'array'
 THEN RETURN NEW; END IF;
 floor_no := (OLD.game_state->>'trialLevel')::integer;
 IF floor_no NOT BETWEEN 1 AND 10000
   OR (NEW.game_state->>'trialLevel')::integer <> floor_no + 1
   OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
       coalesce(OLD.game_state->'trialChestClaims','[]'::jsonb)) v WHERE v.value = floor_no::text)
   OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
       NEW.game_state->'trialChestClaims') v WHERE v.value = floor_no::text)
   OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
       coalesce(OLD.game_state->'trialChestUnopenedFloors','[]'::jsonb)) v WHERE v.value = floor_no::text)
   OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
       NEW.game_state->'trialChestUnopenedFloors') v WHERE v.value = floor_no::text)
 THEN RETURN NEW; END IF;
 tier_name := CASE WHEN floor_no % 25 = 0 THEN 'legendary'
                   WHEN floor_no % 10 = 0 THEN 'guardian'
                   WHEN floor_no % 5 = 0 THEN 'explorer'
                   ELSE 'common' END;
 INSERT INTO territory_private.trial_chest_v1(player_id,floor,tier)
 VALUES (NEW.id,floor_no,tier_name) ON CONFLICT DO NOTHING;
 RETURN NEW;
END; $fn$;
REVOKE ALL ON FUNCTION territory_private.reserve_trial_chest_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS territory_reserve_trial_chest_v1 ON public.players;
CREATE TRIGGER territory_reserve_trial_chest_v1
AFTER UPDATE OF game_state ON public.players FOR EACH ROW
EXECUTE FUNCTION territory_private.reserve_trial_chest_v1();

-- The chest is not rolled at the client and no reward exists to forge in
-- the saved player snapshot. Draw once while holding the owner's player lock.
CREATE OR REPLACE FUNCTION territory_private.roll_trial_chest_v1(p_floor integer, p_tier text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = 'pg_catalog'
AS $fn$
DECLARE g integer:=0; gems integer:=0; mats integer:=0; elix integer:=0; pots integer:=0;
 rep integer:=0; frag jsonb:=NULL; component jsonb:=NULL; pick double precision;
 frag_probability double precision:=0; comp_probability double precision:=0;
 rep_probability double precision:=0; part_no integer; blueprint text;
 component_id text; component_qty integer;
BEGIN
 IF p_floor NOT BETWEEN 1 AND 10000 OR p_tier IS DISTINCT FROM
    CASE WHEN p_floor % 25 = 0 THEN 'legendary'
         WHEN p_floor % 10 = 0 THEN 'guardian'
         WHEN p_floor % 5 = 0 THEN 'explorer' ELSE 'common' END
 THEN RAISE EXCEPTION 'trial_chest_invalid_tier'; END IF;
 IF p_tier='common' THEN
   g:=20 + pg_catalog.floor(pg_catalog.random()*21)::integer;
   pick:=pg_catalog.random();
   IF pick < .45 THEN pots:=1;
   ELSIF pick < .80 THEN mats:=1;
   ELSIF pick < .95 THEN elix:=1;
   ELSE gems:=1; END IF;
 ELSE
   IF p_tier='explorer' THEN
     g:=90; gems:=2; mats:=1; elix:=1; rep_probability:=.03; frag_probability:=.04; comp_probability:=.20;
   ELSIF p_tier='guardian' THEN
     g:=160; gems:=3; mats:=2; elix:=2; rep_probability:=.05; frag_probability:=.07; comp_probability:=.35;
   ELSE
     g:=280; gems:=5; mats:=3; elix:=3; rep_probability:=.10; frag_probability:=.12; comp_probability:=.60;
   END IF;
   IF pg_catalog.random() < rep_probability THEN rep:=1; END IF;
   IF pg_catalog.random() < frag_probability THEN
     blueprint:=CASE WHEN pg_catalog.random()<.5 THEN 'guardian_blade' ELSE 'guardian_amulet' END;
     pick:=pg_catalog.random();
     part_no:=CASE WHEN pick<.22 THEN 1 WHEN pick<.44 THEN 2 WHEN pick<.64 THEN 3
                   WHEN pick<.84 THEN 4 WHEN pick<.95 THEN 5 ELSE 6 END;
     frag:=pg_catalog.jsonb_build_object('blueprint',blueprint,'part',part_no);
   END IF;
   IF pg_catalog.random() < comp_probability THEN
     pick:=pg_catalog.random();
     component_id:=CASE WHEN pick<1.0/3 THEN 'guardian_shard'
                        WHEN pick<2.0/3 THEN 'trial_essence' ELSE 'ancient_mechanism' END;
     component_qty:=CASE WHEN p_tier='legendary' AND pg_catalog.random() < .5 THEN 2 ELSE 1 END;
     component:=pg_catalog.jsonb_build_object('id',component_id,'qty',component_qty);
   END IF;
 END IF;
 RETURN pg_catalog.jsonb_build_object('floor',p_floor,'tier',p_tier,'gold',g,'gems',gems,
   'materials',mats,'elixirs',elix,'potions',pots,'reputation',rep)
   || CASE WHEN frag IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('fragment',frag) END
   || CASE WHEN component IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('component',component) END;
END; $fn$;
REVOKE ALL ON FUNCTION territory_private.roll_trial_chest_v1(integer,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_trial_chest_open_v1(p_floor integer, p_expected timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'pg_catalog'
AS $fn$
DECLARE u uuid:=auth.uid(); p public.players%ROWTYPE;
 chest territory_private.trial_chest_v1%ROWTYPE; st jsonb; hero jsonb; inv jsonb; loot jsonb;
 new_item jsonb; frag jsonb; comp jsonb; idx integer; part_no integer; qty integer;
 g integer; gems integer; mats integer; elix integer; pots integer; rep integer;
 item_id text; item_name text; rarity text; part_text text; comp_id text;
BEGIN
 IF u IS NULL OR p_floor NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'trial_chest_login_required'; END IF;
 SELECT * INTO p FROM public.players WHERE id=u AND NOT banned FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'trial_chest_login_required'; END IF;
 SELECT * INTO chest FROM territory_private.trial_chest_v1
 WHERE player_id=u AND floor=p_floor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'trial_chest_not_reserved'; END IF;
 IF chest.opened_at IS NOT NULL THEN
   RETURN pg_catalog.jsonb_build_object('success',true,'already_opened',true,'receipt',chest.receipt,
     'updated_at',p.updated_at,'wallet_gold',p.gold,'wallet_gems',p.gems,'game_state',p.game_state);
 END IF;
 IF p_expected IS NULL OR p.updated_at IS DISTINCT FROM p_expected THEN
   RAISE EXCEPTION 'trial_chest_reload_required';
 END IF;
 st:=p.game_state; hero:=st->'player'; inv:=st->'inventory';
 IF pg_catalog.jsonb_typeof(hero) IS DISTINCT FROM 'object'
   OR pg_catalog.jsonb_typeof(inv) IS DISTINCT FROM 'array'
   OR pg_catalog.jsonb_typeof(st->'trialChestUnopenedFloors') IS DISTINCT FROM 'array'
   OR (hero->>'gold')::integer IS DISTINCT FROM p.gold
   OR (hero->>'gems')::integer IS DISTINCT FROM p.gems
   OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
       st->'trialChestUnopenedFloors') v WHERE v.value=p_floor::text)
 THEN RAISE EXCEPTION 'trial_chest_invalid_save'; END IF;
 loot:=territory_private.roll_trial_chest_v1(p_floor,chest.tier);
 g:=(loot->>'gold')::integer; gems:=(loot->>'gems')::integer; mats:=(loot->>'materials')::integer;
 elix:=(loot->>'elixirs')::integer; pots:=(loot->>'potions')::integer; rep:=(loot->>'reputation')::integer;
 IF p.gold > 2147483647-g OR p.gems > 2147483647-gems OR
    (st->>'forgeMaterials')::integer > 2147483647-mats
 THEN RAISE EXCEPTION 'trial_chest_wallet_overflow'; END IF;
 hero:=pg_catalog.jsonb_set(hero,'{gold}',pg_catalog.to_jsonb(p.gold+g));
 hero:=pg_catalog.jsonb_set(hero,'{gems}',pg_catalog.to_jsonb(p.gems+gems));
 st:=pg_catalog.jsonb_set(st,'{player}',hero);
 st:=pg_catalog.jsonb_set(st,'{forgeMaterials}',pg_catalog.to_jsonb((st->>'forgeMaterials')::integer+mats));
 st:=pg_catalog.jsonb_set(st,'{territoryCityReputation}',pg_catalog.to_jsonb(
   coalesce((st->>'territoryCityReputation')::integer,0)+rep),true);
 -- Only opening a chest starts the consumable's seven-day lifespan.
 IF pots>0 THEN
   inv:=inv||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'id','trial_health_potion_'||p_floor,'name','Большое зелье здоровья','icon','⚗️',
     'type','potion','rarity','rare','qty',pots,
     'description','Восстанавливает 150 HP мгновенно',
     'effect',pg_catalog.jsonb_build_object('stat','hp','value',150,'duration','instant'),
     'expiresAt',pg_catalog.to_jsonb(pg_catalog.clock_timestamp()+interval '7 days')));
 END IF;
 IF elix>0 THEN
   inv:=inv||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'id','trial_elixir_'||p_floor,'name','Эликсир силы','icon','💪',
     'type','elixir','rarity','rare','qty',elix,
     'description','+10 к атаке на один бой',
     'effect',pg_catalog.jsonb_build_object('stat','attack','value',10,'duration','battle'),
     'expiresAt',pg_catalog.to_jsonb(pg_catalog.clock_timestamp()+interval '7 days')));
 END IF;
 frag:=loot->'fragment';
 IF frag IS NOT NULL THEN
   part_no:=(frag->>'part')::integer;
   item_id:='trial_fragment_'||(frag->>'blueprint')||'_'||part_no;
   item_name:='Фрагмент '||part_no||'/6 · '||
     CASE frag->>'blueprint' WHEN 'guardian_blade' THEN 'Клинок Стража' ELSE 'Амулет Стража' END;
   rarity:=CASE WHEN part_no=6 THEN 'legendary' WHEN part_no=5 THEN 'epic' ELSE 'rare' END;
   new_item:=pg_catalog.jsonb_build_object('id',item_id,'name',item_name,'icon','📜',
      'type','material','rarity',rarity,'qty',1,
      'description','Часть редкого чертежа. Не портится. Для будущего создания предмета мастером.');
   SELECT (ordinality-1)::integer INTO idx
   FROM pg_catalog.jsonb_array_elements(inv) WITH ORDINALITY WHERE value->>'id'=item_id LIMIT 1;
   IF idx IS NULL THEN inv:=inv||pg_catalog.jsonb_build_array(new_item);
   ELSE inv:=pg_catalog.jsonb_set(inv,ARRAY[idx::text,'qty'],
      pg_catalog.to_jsonb((inv->idx->>'qty')::integer+1)); END IF;
 END IF;
 comp:=loot->'component';
 IF comp IS NOT NULL THEN
   comp_id:=comp->>'id'; qty:=(comp->>'qty')::integer;
   item_id:='trial_component_'||comp_id;
   item_name:=CASE comp_id WHEN 'guardian_shard' THEN 'Осколок силы Стража'
     WHEN 'trial_essence' THEN 'Эссенция Испытаний' ELSE 'Древний механизм' END;
   new_item:=pg_catalog.jsonb_build_object('id',item_id,'name',item_name,'icon','✦',
      'type','material','rarity','epic','qty',qty,
      'description','Редкий ингредиент из Испытаний для будущих рецептов профессий. Не портится.');
   idx:=NULL;
   SELECT (ordinality-1)::integer INTO idx
   FROM pg_catalog.jsonb_array_elements(inv) WITH ORDINALITY WHERE value->>'id'=item_id LIMIT 1;
   IF idx IS NULL THEN inv:=inv||pg_catalog.jsonb_build_array(new_item);
   ELSE inv:=pg_catalog.jsonb_set(inv,ARRAY[idx::text,'qty'],
      pg_catalog.to_jsonb((inv->idx->>'qty')::integer+qty)); END IF;
 END IF;
 st:=pg_catalog.jsonb_set(st,'{inventory}',inv);
 st:=pg_catalog.jsonb_set(st,'{trialChestUnopenedFloors}',(
   SELECT coalesce(pg_catalog.jsonb_agg(value ORDER BY ordinality),'[]'::jsonb)
   FROM pg_catalog.jsonb_array_elements(st->'trialChestUnopenedFloors') WITH ORDINALITY
   WHERE value::text<>p_floor::text
 ),true);
 st:=pg_catalog.jsonb_set(st,'{trialChestOpenedFloors}',
   coalesce(st->'trialChestOpenedFloors','[]'::jsonb)||pg_catalog.jsonb_build_array(p_floor),true);
 st:=pg_catalog.jsonb_set(st,'{lastTrialChest}',loot,true);
 UPDATE public.players SET game_state=st,gold=p.gold+g,gems=p.gems+gems,
   forge_materials=(st->>'forgeMaterials')::integer
 WHERE id=u RETURNING * INTO p;
 UPDATE territory_private.trial_chest_v1 SET receipt=loot,opened_at=pg_catalog.clock_timestamp()
 WHERE player_id=u AND floor=p_floor;
 RETURN pg_catalog.jsonb_build_object('success',true,'already_opened',false,'receipt',loot,
   'updated_at',p.updated_at,'wallet_gold',p.gold,'wallet_gems',p.gems,'game_state',p.game_state);
END; $fn$;
REVOKE ALL ON FUNCTION public.territory_trial_chest_open_v1(integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.territory_trial_chest_open_v1(integer,timestamptz) TO authenticated;
COMMIT;
