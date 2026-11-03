\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE SCHEMA territory_private;
CREATE TABLE public.players(
  id uuid PRIMARY KEY, game_state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  forge_materials integer,gold integer,gems integer);
CREATE FUNCTION public.touch_batch_253() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.game_state IS DISTINCT FROM OLD.game_state THEN
  NEW.updated_at:=GREATEST(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER touch_batch_253 BEFORE UPDATE ON public.players
FOR EACH ROW EXECUTE FUNCTION public.touch_batch_253();
CREATE TABLE territory_private.equipment_salvage_daily_v1(
  player_id uuid NOT NULL,salvage_day date NOT NULL,
  awarded integer NOT NULL DEFAULT 0, PRIMARY KEY(player_id,salvage_day));
CREATE TABLE territory_private.forge_upgrade_receipts_65_v1(
  player_id uuid NOT NULL, item_id text NOT NULL, upgrade_to int NOT NULL,
  material_cost int NOT NULL, refunded_at timestamptz,
  PRIMARY KEY(player_id,item_id,upgrade_to));
\i supabase/staged/territory_inventory_batch_salvage_253.sql

DO $batch$
DECLARE
  owner_id uuid:='10000000-0000-0000-0000-000000000091';
  other_id uuid:='10000000-0000-0000-0000-000000000092';
  gear jsonb;
  forged jsonb;
  state jsonb;
  quote jsonb;
  receipt jsonb;
  token timestamptz;
  snapshot jsonb;
BEGIN
 gear:=jsonb_build_object('id','loot_batch','name','Клинок победителя',
   'type','equipment','qty',1,'rarity','common','equipment',jsonb_build_object(
      'id','loot_batch','name','Клинок победителя','slot','weapon',
      'rarity','common','level',4,'baseLevel',4,'upgradeCount',0));
 forged:=jsonb_build_object('id','forged_batch','name','Клинок рыцаря',
  'type','equipment','qty',1,'rarity','rare','equipment',jsonb_build_object(
    'id','forged_batch','name','Клинок рыцаря','slot','weapon','rarity','rare',
    'level',6,'baseLevel',4,'upgradeCount',2));
 state:=jsonb_build_object('inventoryCleanupVersion',1,'player',
   jsonb_build_object('gold',500,'level',25,'gems',5,'equipped','{}'::jsonb),
   'forgeMaterials',30,'forgeMaterialBatches',jsonb_build_array(
     jsonb_build_object('qty',30,'expiresAt','2099-01-01T00:00:00.000Z')),
   'inventory',jsonb_build_array(gear,forged),'chapterWins',13,'battleStones',25);
 INSERT INTO public.players(id,game_state,forge_materials,gold,gems)
 VALUES(owner_id,state,30,500,5),(other_id,state,30,500,5);
 INSERT INTO territory_private.forge_upgrade_receipts_65_v1
   (player_id,item_id,upgrade_to,material_cost)
   VALUES(owner_id,'forged_batch',6,4);
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,false);
 quote:=public.territory_inventory_batch_quote_253();
 IF quote->>'ready'<>'true' OR jsonb_array_length(quote->'eligible')<>2
 THEN RAISE EXCEPTION 'PG17 wrong batch quote: %',quote; END IF;
 SELECT updated_at INTO token FROM public.players WHERE id=owner_id;
 BEGIN
  PERFORM public.territory_inventory_batch_salvage_253(
    ARRAY['loot_batch','missing_item'],token);
  RAISE EXCEPTION 'INVALID_BATCH_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='INVALID_BATCH_ACCEPTED' THEN RAISE; END IF;
  IF SQLERRM<>'batch_item_missing_or_duplicate' THEN RAISE; END IF;
 END;
 IF (SELECT forge_materials FROM public.players WHERE id=owner_id)<>30
 THEN RAISE EXCEPTION 'PG17 partial mutation on invalid batch'; END IF;
 receipt:=public.territory_inventory_batch_salvage_253(
   ARRAY['loot_batch','forged_batch'],token);
 IF receipt->>'awarded'<>'3' OR receipt->>'remaining_today'<>'2'
   OR receipt->'game_state'->>'forgeMaterials'<>'33'
   OR jsonb_array_length(receipt->'game_state'->'inventory')<>0
   OR receipt->'game_state'->>'chapterWins'<>'13'
 THEN RAISE EXCEPTION 'PG17 invalid receipt: %',receipt; END IF;
 IF (SELECT count(*) FROM territory_private.forge_upgrade_receipts_65_v1
     WHERE refunded_at IS NOT NULL)<>1
 THEN RAISE EXCEPTION 'PG17 missing spent ledger receipt'; END IF;
 BEGIN
  PERFORM public.territory_inventory_batch_salvage_253(
    ARRAY['loot_batch','forged_batch'],token);
  RAISE EXCEPTION 'REPLAY_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='REPLAY_ACCEPTED' THEN RAISE; END IF;
  IF SQLERRM<>'batch_conflict_reload' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub',other_id::text,false);
 quote:=public.territory_inventory_batch_quote_253();
 IF jsonb_array_length(quote->'eligible')<>1
 THEN RAISE EXCEPTION 'PG17 owner isolation failed: %',quote; END IF;
 IF (SELECT forge_materials FROM public.players WHERE id=other_id)<>30
 THEN RAISE EXCEPTION 'PG17 stranger modified'; END IF;
 IF has_function_privilege('anon',
  'public.territory_inventory_batch_salvage_253(text[],timestamptz)','EXECUTE')
  OR NOT has_function_privilege('authenticated',
  'public.territory_inventory_batch_salvage_253(text[],timestamptz)','EXECUTE')
 THEN RAISE EXCEPTION 'PG17 RPC permissions mismatch'; END IF;
 RAISE NOTICE 'PG17 PASS batch atomic, replay, 65%%, base quota, owner isolation';
END $batch$;

\i supabase/staged/territory_inventory_batch_salvage_253_rollback.sql
DO $rollback$
BEGIN
 IF to_regprocedure('public.territory_inventory_batch_salvage_253(text[],timestamptz)') IS NOT NULL
  OR to_regprocedure('public.territory_inventory_batch_quote_253()') IS NOT NULL
 THEN RAISE EXCEPTION 'batch rollback left public entrypoints'; END IF;
 IF (SELECT forge_materials FROM public.players WHERE id='10000000-0000-0000-0000-000000000091')<>33
  OR (SELECT count(*) FROM territory_private.forge_upgrade_receipts_65_v1)<>1
 THEN RAISE EXCEPTION 'batch rollback mutated player material balance or ledger'; END IF;
 RAISE NOTICE 'PG17 PASS: batch rollback retained resources and receipt';
END $rollback$;
