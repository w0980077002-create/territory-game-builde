\set ON_ERROR_STOP on
-- Extends the disposable PG17 fixture in check-vip-entitlements-pg17.sql.
-- Never run against production.
ALTER TABLE public.players ADD COLUMN game_state jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.players ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE public.players ADD COLUMN gold integer NOT NULL DEFAULT 0;
ALTER TABLE public.players ADD COLUMN gems integer NOT NULL DEFAULT 0;
CREATE TABLE public.arena_rooms(id uuid PRIMARY KEY,status text NOT NULL);
CREATE TABLE public.arena_participants(room_id uuid NOT NULL REFERENCES public.arena_rooms(id),
 user_id uuid NOT NULL,left_at timestamptz);
CREATE TABLE territory_private.combat_sessions_v1(player_id uuid NOT NULL,state jsonb NOT NULL);

UPDATE public.players SET
 updated_at='2026-11-05T06:00:00Z',
 gold=99,gems=7,
 game_state=jsonb_build_object(
  'player',jsonb_build_object('level',60,'equipped',jsonb_build_object(
   'helmet',jsonb_build_object('id','test-helmet-A','slot','helmet',
     'name','Test helmet','icon','helmet.webp','rarity','rare','level',20),
   'weapon',jsonb_build_object('id','test-sword-A','slot','weapon',
     'name','Test sword A','icon','sword.webp','rarity','rare','level',30))),
  'inventory',jsonb_build_array(jsonb_build_object('id','owned-sword-B',
    'type','equipment','name','Test sword B','rarity','rare',
    'qty',1,'description','owned','icon','sword.webp',
    'equipment',jsonb_build_object('id','test-sword-B','slot','weapon',
       'name','Test sword B','icon','sword.webp','rarity','rare','level',35))))
WHERE id='10000000-0000-0000-0000-000000000001';

\i supabase/staged/20261105_vip_equipment_presets_v1.sql
DO $permissions$
BEGIN
 IF has_table_privilege('authenticated','territory_private.vip_equipment_presets_v1','INSERT')
 OR has_table_privilege('authenticated','territory_private.vip_equipment_preset_receipts_v1','SELECT')
 OR has_function_privilege('anon','public.territory_vip_equipment_preset_apply_v1(integer,timestamptz,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Presets exposed to untrusted client'; END IF;
 IF NOT has_function_privilege('authenticated','public.territory_vip_equipment_preset_apply_v1(integer,timestamptz,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Authenticated user cannot apply a protected preset'; END IF;
END $permissions$;

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
DO $save$
DECLARE j jsonb;
BEGIN
 j:=public.territory_vip_equipment_preset_save_v1(1,'2026-11-05T06:00:00Z');
 IF j->'equipment_ids'->>'weapon'<>'test-sword-A'
 OR j->'equipment_ids'->>'helmet'<>'test-helmet-A'
 OR j->'equipment_ids'->'ring'<>'null'::jsonb
 THEN RAISE EXCEPTION 'Save did not capture all seven slots: %',j; END IF;
 BEGIN
   PERFORM public.territory_vip_equipment_preset_save_v1(2,'2026-11-05T06:00:00Z');
   RAISE EXCEPTION 'VIP5 improperly unlocked VIP6 second preset';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'vip_preset_locked' THEN RAISE; END IF;
 END;
END $save$;
RESET ROLE;

-- Simulate a perfectly normal authenticated equipment change on the same
-- player row BEFORE the previously saved VIP preset is applied.
UPDATE public.players SET
 updated_at='2026-11-05T06:01:00Z',
 game_state=jsonb_set(
  jsonb_set(game_state,'{player,equipped,weapon}',
    jsonb_build_object('id','test-sword-B','slot','weapon',
      'name','Test sword B','icon','sword.webp','rarity','rare','level',35)),
   '{inventory}',jsonb_build_array(jsonb_build_object(
     'id','owned-sword-A','type','equipment','name','Test sword A',
     'rarity','rare','qty',1,'description','owned','icon','sword.webp',
     'equipment',jsonb_build_object('id','test-sword-A','slot','weapon',
       'name','Test sword A','icon','sword.webp','rarity','rare','level',30))))
WHERE id='10000000-0000-0000-0000-000000000001';

SET ROLE authenticated;
DO $apply$
DECLARE j jsonb;
BEGIN
 j:=public.territory_vip_equipment_preset_apply_v1(1,'2026-11-05T06:01:00Z',
    '30000000-0000-4000-8000-000000000001');
 IF j->>'success'<>'true' OR j->>'already_applied'<>'false'
 OR j#>>'{game_state,player,equipped,weapon,id}'<>'test-sword-A'
 OR j#>>'{game_state,player,equipped,helmet,id}'<>'test-helmet-A'
 OR (j->>'wallet_gold')::int<>99 OR (j->>'wallet_gems')::int<>7
 OR jsonb_array_length(j#>'{game_state,inventory}')<>1
 OR j#>>'{game_state,inventory,0,equipment,id}'<>'test-sword-B'
 THEN RAISE EXCEPTION 'Preset applied wrong items or minted a reward: %',j; END IF;
 j:=public.territory_vip_equipment_preset_apply_v1(1,'2026-11-05T06:01:00Z',
    '30000000-0000-4000-8000-000000000001');
 IF j->>'already_applied'<>'true'
 OR jsonb_array_length(j#>'{game_state,inventory}')<>1
 THEN RAISE EXCEPTION 'Replay created an extra equipment copy: %',j; END IF;
END $apply$;
RESET ROLE;

DO $stable$
DECLARE p public.players%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.players WHERE id='10000000-0000-0000-0000-000000000001';
 IF p.gold<>99 OR p.gems<>7
 OR p.game_state#>>'{player,equipped,weapon,id}'<>'test-sword-A'
 OR p.game_state#>>'{inventory,0,equipment,id}'<>'test-sword-B'
 OR (SELECT count(*) FROM territory_private.vip_equipment_preset_receipts_v1
    WHERE player_id=p.id)<>1
 THEN RAISE EXCEPTION 'Receipt or equipped inventory not durable'; END IF;
END $stable$;

-- A stale CAS token cannot apply a different operation.
SET ROLE authenticated;
DO $stale$
BEGIN
 BEGIN
 PERFORM public.territory_vip_equipment_preset_apply_v1(1,'2026-11-05T06:01:00Z',
   '30000000-0000-4000-8000-000000000002');
 RAISE EXCEPTION 'Stale CAS token accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_preset_stale_save' THEN RAISE; END IF;
 END;
END $stale$;
RESET ROLE;

-- Explicitly block both real combat pathways.
INSERT INTO public.arena_rooms VALUES('40000000-0000-4000-8000-000000000001','active');
INSERT INTO public.arena_participants(room_id,user_id)
 VALUES ('40000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
DO $arena$
DECLARE v_time timestamptz;
BEGIN
 SELECT updated_at INTO v_time FROM public.players WHERE id=auth.uid();
 BEGIN
 PERFORM public.territory_vip_equipment_preset_apply_v1(1,v_time,
   '30000000-0000-4000-8000-000000000003');
 RAISE EXCEPTION 'Preset changed gear during Arena';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_preset_combat_active' THEN RAISE; END IF;
 END;
END $arena$;
RESET ROLE;
DELETE FROM public.arena_participants;
INSERT INTO territory_private.combat_sessions_v1 VALUES
 ('10000000-0000-0000-0000-000000000001','{"status":"fighting"}');
SET ROLE authenticated;
DO $cave$
DECLARE v_time timestamptz;
BEGIN
 SELECT updated_at INTO v_time FROM public.players WHERE id=auth.uid();
 BEGIN
 PERFORM public.territory_vip_equipment_preset_apply_v1(1,v_time,
  '30000000-0000-4000-8000-000000000004');
 RAISE EXCEPTION 'Preset changed gear during Cave';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'vip_preset_combat_active' THEN RAISE; END IF;
 END;
END $cave$;
RESET ROLE;
DELETE FROM territory_private.combat_sessions_v1;

-- Even at VIP5, a lost inventory item must not be recreated from a preset.
UPDATE public.players SET updated_at='2026-11-05T06:03:00Z',
 game_state=jsonb_set(jsonb_set(game_state,'{player,equipped,weapon}',
  jsonb_build_object('id','test-sword-B','slot','weapon','name','Sword B',
    'icon','sword.webp','rarity','rare','level',35)),'{inventory}','[]'::jsonb)
WHERE id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $missing$
BEGIN
 BEGIN
 PERFORM public.territory_vip_equipment_preset_apply_v1(1,'2026-11-05T06:03:00Z',
  '30000000-0000-4000-8000-000000000005');
 RAISE EXCEPTION 'Deleted item was recreated by a VIP preset';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'vip_preset_gear_missing_or_invalid' THEN RAISE; END IF;
 END;
END $missing$;
RESET ROLE;

-- Different hero or no authenticated user cannot recover another owner's
-- equipment preset. This also covers the zero-spend and revoked gift user.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SET ROLE authenticated;
DO $foreign$
BEGIN
 BEGIN
 PERFORM public.territory_vip_equipment_preset_apply_v1(1,'2026-11-05T06:00:00Z',
  '30000000-0000-4000-8000-000000000001');
 RAISE EXCEPTION 'Different hero could replay the equipment operation';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'vip_preset_operation_conflict' THEN RAISE; END IF;
 END;
END $foreign$;
RESET ROLE;

-- Upgrade from VIP5 to VIP6 grants a second saved slot; it does not affect
-- the first slot, duplicate its contents, or require any additional spend.
INSERT INTO territory_private.vip_entitlement_grants_v1
(grant_id,player_id,campaign_key,kind,vip_level,reason)
VALUES('50000000-0000-4000-8000-000000000001',
 '10000000-0000-0000-0000-000000000001','unit-test-vip6','gift',6,'PG17 fixture');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
DO $second$
DECLARE v_time timestamptz; j jsonb;
BEGIN
 SELECT updated_at INTO v_time FROM public.players WHERE id=auth.uid();
 j:=public.territory_vip_equipment_preset_save_v1(2,v_time);
 IF j->>'preset_no'<>'2' THEN RAISE EXCEPTION 'VIP6 did not unlock second preset'; END IF;
END $second$;
RESET ROLE;
SELECT 'VIP equipment PG17: owned gear, 7 slots, VIP4/6, Arena/Cave gates, CAS, replay, no-mint PASS' AS verified;
