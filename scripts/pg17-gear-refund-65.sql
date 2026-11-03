-- PostgreSQL 17 real-engine fixture for staged TERRITORY #253 (synthetic data).
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
  forge_materials integer, gold integer, gems integer);
CREATE FUNCTION public.test_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.game_state IS DISTINCT FROM OLD.game_state THEN
    NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER touch BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.test_touch();
CREATE TABLE territory_private.equipment_salvage_daily_v1 (
  player_id uuid NOT NULL,salvage_day date NOT NULL,awarded integer NOT NULL DEFAULT 0,
  PRIMARY KEY(player_id,salvage_day));
\i supabase/staged/territory_gear_refund_65_v1.sql

DO $test$
DECLARE
  uid uuid:='10000000-0000-0000-0000-000000000071';
  outsider uuid:='10000000-0000-0000-0000-000000000072';
  before_state jsonb;
  new_state jsonb;
  original_gear jsonb;
  modified_gear jsonb;
  quote jsonb;
  receipt jsonb;
  token timestamptz;
BEGIN
  before_state:=jsonb_build_object(
    'inventoryCleanupVersion',1,
    'player',jsonb_build_object('gold',1000,'level',15,'equipped','{}'::jsonb),
    'forgeMaterials',100,
    'forgeMaterialBatches',jsonb_build_array(jsonb_build_object('qty',100,'expiresAt','2099-01-01T00:00:00.000Z')),
    'inventory',jsonb_build_array(jsonb_build_object(
      'id','loot_refund17','type','equipment','qty',1,
      'name','Клинок победителя','rarity','rare',
      'equipment',jsonb_build_object(
        'id','loot_refund17','slot','weapon','name','Клинок победителя',
        'rarity','rare','level',4,'baseLevel',4,'upgradeCount',0,
        'baseStats',jsonb_build_object('attack',18),'attack',18))),
    'chapterWins',9, 'battleStones',25
  );
  INSERT INTO public.players(id,game_state,forge_materials,gold,gems)
  VALUES(uid,before_state,100,1000,5),(outsider,before_state,100,1000,5);
  PERFORM set_config('request.jwt.claim.sub',uid::text,false);
  quote:=public.territory_forge_refund_quote_65_v1('loot_refund17');
  IF quote->>'eligible' <> 'false' THEN RAISE EXCEPTION 'unverified historical refund'; END IF;

  original_gear:=before_state->'inventory'->0->'equipment';
  modified_gear:=original_gear || jsonb_build_object('level',5,'upgradeCount',1,'attack',20);
  new_state:=jsonb_set(before_state,'{inventory,0,equipment}',modified_gear);
  new_state:=jsonb_set(new_state,'{player,gold}','830'::jsonb);
  new_state:=jsonb_set(new_state,'{forgeMaterials}','98'::jsonb);
  new_state:=jsonb_set(new_state,'{forgeMaterialBatches,0,qty}','98'::jsonb);
  UPDATE public.players SET game_state=new_state, gold=830,forge_materials=98 WHERE id=uid;
  quote:=public.territory_forge_refund_quote_65_v1('loot_refund17');
  IF quote->>'eligible' <> 'true' OR quote->>'spent_verified'<>'2' OR quote->>'refund'<>'1'
  THEN RAISE EXCEPTION 'PG17 incorrect verified quote: %',quote; END IF;

  SELECT updated_at INTO token FROM public.players WHERE id=uid;
  receipt:=public.territory_inventory_recycle_refund_65_v1('loot_refund17',token);
  IF receipt->>'awarded'<>'1' OR receipt->'game_state'->>'forgeMaterials'<>'99'
    OR jsonb_array_length(receipt->'game_state'->'inventory')<>0
    OR receipt->'game_state'->>'chapterWins'<>'9'
  THEN RAISE EXCEPTION 'PG17 atomic refund failed: %',receipt; END IF;
  BEGIN
    PERFORM public.territory_inventory_recycle_refund_65_v1('loot_refund17',token);
    RAISE EXCEPTION 'REPLAY_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='REPLAY_ACCEPTED' THEN RAISE; END IF;
    IF SQLERRM<>'refund_conflict_reload' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub',outsider::text,false);
  quote:=public.territory_forge_refund_quote_65_v1('loot_refund17');
  IF quote->>'eligible' <> 'false' THEN RAISE EXCEPTION 'other player can see the ledger'; END IF;
  IF NOT has_function_privilege('authenticated','public.territory_inventory_recycle_refund_65_v1(text,timestamptz)','EXECUTE')
    OR has_function_privilege('anon','public.territory_inventory_recycle_refund_65_v1(text,timestamptz)','EXECUTE')
  THEN RAISE EXCEPTION 'PG17 unexpected function grants'; END IF;
  IF EXISTS (SELECT 1 FROM territory_private.forge_upgrade_receipts_65_v1 WHERE refunded_at IS NULL)
  THEN RAISE EXCEPTION 'unconsumed ledger after refund'; END IF;
  RAISE NOTICE 'PG17 PASS: protected owner, 2 spent -> 1 refund, atomic consume, CAS replay, grants, and isolated user';
END $test$;

-- Simulate emergency rollback after a confirmed award: never erase audit ledger,
-- never alter the already credited materials or a remaining player's gear.
\i supabase/staged/territory_gear_refund_65_v1_rollback.sql
DO $rollback$
BEGIN
  IF to_regprocedure('public.territory_forge_refund_quote_65_v1(text)') IS NOT NULL
    OR to_regprocedure('public.territory_inventory_recycle_refund_65_v1(text,timestamp with time zone)') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.players'::regclass
      AND tgname='territory_capture_forge_spend_65_v1') THEN
    RAISE EXCEPTION 'rollback left refund entry points active';
  END IF;
  IF (SELECT count(*) FROM territory_private.forge_upgrade_receipts_65_v1)<>1
    OR (SELECT forge_materials FROM public.players WHERE id='10000000-0000-0000-0000-000000000071')<>99
  THEN RAISE EXCEPTION 'rollback changed award ledger or player assets'; END IF;
  RAISE NOTICE 'PG17 rollback PASS: entrypoints disabled, player materials and audit retained';
END $rollback$;
