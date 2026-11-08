\set ON_ERROR_STOP on
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA territory_private;
CREATE TABLE public.players(id uuid PRIMARY KEY, game_state jsonb, updated_at timestamptz DEFAULT now());
CREATE TABLE public.territory_profession_stage8_items(item_id uuid PRIMARY KEY, player_id uuid NOT NULL, item_output jsonb NOT NULL);
ALTER TABLE public.territory_profession_stage8_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.territory_profession_stage8_items FROM PUBLIC,anon,authenticated;
CREATE TABLE territory_private.owner_test_gear_v1(player_id uuid, slot text, equipment_id text, target_level integer, approved_equipment jsonb, updated_at timestamptz);
CREATE FUNCTION territory_private.cap_overlevel_item_20261018(jsonb,integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_set($1,'{level}',to_jsonb(least(($1->>'level')::integer,$2))) $$;
CREATE FUNCTION public.territory_normalize_gear_v4(jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT $1 $$;
\ir ../supabase/staged/territory_stage8_owner_save_guard.sql

INSERT INTO public.players(id,game_state) VALUES
 ('10000000-0000-4000-8000-000000000001','{"player":{"equipped":{}},"inventory":[]}');
INSERT INTO public.territory_profession_stage8_items VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 '{"type":"equipment","equipment":{"id":"untrusted-display-id","slot":"weapon","level":37,"attack":90,"rarity":"rare","baseLevel":2,"upgradeCount":35,"baseStats":{"attack":20}}}');
DO $$
DECLARE p uuid:='10000000-0000-4000-8000-000000000001';
 id text:='stage8_20000000-0000-4000-8000-000000000001';
 gear jsonb:=jsonb_build_object('id',id,'slot','weapon','level',37,'attack',9999);
 state jsonb; result jsonb;
BEGIN
 state:=jsonb_build_object('player',jsonb_build_object('equipped','{}'::jsonb),'inventory',jsonb_build_array(jsonb_build_object('id',id,'equipment',gear)));
 result:=territory_private.owner_cap_state_v1(state,1,p);
 IF result#>>'{inventory,0,equipment,level}'<>'37' OR result#>>'{inventory,0,equipment,attack}'<>'90' THEN RAISE EXCEPTION 'canonical level or stats lost'; END IF;
 IF (territory_private.owner_cap_item_v1('{"id":"ordinary","level":37}',1,p)->>'level')<>'1' THEN RAISE EXCEPTION 'legacy protection changed'; END IF;
 BEGIN
   PERFORM territory_private.owner_cap_state_v1(jsonb_set(state,'{player,equipped}',jsonb_build_object('weapon',gear)),1,p);
   RAISE EXCEPTION 'duplicate accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   PERFORM territory_private.owner_cap_state_v1(jsonb_set(jsonb_set(state,'{inventory}','[]'::jsonb),'{player,equipped}',jsonb_build_object('weapon',gear)),1,p);
   RAISE EXCEPTION 'overlevel equipment accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   PERFORM territory_private.owner_cap_item_v1(gear,1,'10000000-0000-4000-8000-000000000002');
   RAISE EXCEPTION 'foreign item accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   PERFORM territory_private.owner_cap_item_v1(jsonb_set(gear,'{id}','"stage8_30000000-0000-4000-8000-000000000001"'),1,p);
   RAISE EXCEPTION 'unknown UUID accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   PERFORM territory_private.owner_cap_item_v1(gear||'{"level":null}'::jsonb,1,p);
   RAISE EXCEPTION 'invalid level accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.players SET game_state=jsonb_set(state,'{inventory,0,equipment,level}','59');
 BEGIN
   PERFORM territory_private.owner_cap_state_v1('{"player":{"equipped":{}},"inventory":[]}',1,p);
   RAISE EXCEPTION 'historical disagreement silently removed';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   PERFORM territory_private.owner_cap_state_v1('{}',1,p);
   RAISE EXCEPTION 'malformed snapshot bypassed reconciliation';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT game_state#>>'{inventory,0,equipment,level}' FROM public.players WHERE players.id=p)<>'59' THEN RAISE EXCEPTION 'saved evidence lost'; END IF;
END $$;
CREATE FUNCTION public.test_save_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 NEW.game_state:=territory_private.owner_cap_state_v1(NEW.game_state,1,NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER test_save_guard BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.test_save_guard();
DO $$ BEGIN
 BEGIN
   UPDATE public.players SET game_state='{"player":{"equipped":{}},"inventory":[]}';
   RAISE EXCEPTION 'trigger erased unresolved item';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
GRANT SELECT ON public.territory_profession_stage8_items TO authenticated;
SET ROLE authenticated;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.territory_profession_stage8_items) THEN
   RAISE EXCEPTION 'RLS exposed server registry';
 END IF;
END $$;
RESET ROLE;
REVOKE SELECT ON public.territory_profession_stage8_items FROM authenticated;
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.territory_profession_stage8_items','SELECT') OR
    has_function_privilege('authenticated','territory_private.owner_cap_state_v1(jsonb,integer,uuid)','EXECUTE') OR
    has_function_privilege('anon','territory_private.stage8_verified_gear_v2(jsonb,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'private registry or guard exposed';
 END IF;
END $$;
BEGIN;
 UPDATE public.territory_profession_stage8_items SET item_output='{}';
ROLLBACK;
DO $$ BEGIN
 IF (SELECT game_state#>>'{inventory,0,equipment,level}' FROM public.players LIMIT 1)<>'59' THEN
   RAISE EXCEPTION 'rollback failed';
 END IF;
 IF (SELECT item_output#>>'{equipment,level}' FROM public.territory_profession_stage8_items LIMIT 1)<>'37' THEN
   RAISE EXCEPTION 'registry rollback failed';
 END IF;
END $$;
SELECT 'stage8 save guard PG17 PASS' AS result;
