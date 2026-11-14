-- Mortarion owner-only chest QA. This never edits raid rows, rank, official
-- receipt, real honor, live rare-item IDs, or any other player.
BEGIN;
SET LOCAL lock_timeout = '4s';

CREATE OR REPLACE FUNCTION territory_private.mortarion_owner_test_chest_apply_v1(p_state jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
  v_inventory jsonb;
  v_item jsonb;
  v_kind text;
  v_part integer;
  v_original text;
  v_name text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_state) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_state->'inventory') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'mortarion_owner_test_invalid_save'; END IF;
  -- Defensive idempotency even if an administrator retries the same letter.
  IF p_state ? 'mortarionOwnerTestChest' THEN RETURN p_state; END IF;
  v_inventory:=p_state->'inventory';

  -- Same names/rarities/descriptions as the LIVE Mortarion claim; distinct
  -- identifiers make these NON-TRADEABLE QA examples, not actual rare trophies.
  FOR v_kind IN SELECT pg_catalog.unnest(ARRAY['guardian_blade','guardian_amulet'])
  LOOP
    FOR v_part IN 1..6 LOOP
      v_original:='trial_fragment_'||v_kind||'_'||v_part;
      v_name:='Фрагмент '||v_part||'/6 · '||
        CASE WHEN v_kind='guardian_blade' THEN 'Клинок Стража' ELSE 'Амулет Стража' END;
      v_item:=pg_catalog.jsonb_build_object(
        'id','mortarion_owner_test_'||v_original,
        'canonicalItemId',v_original,
        'ownerTest',true,'testOnly',true,
        'name',v_name,'icon','📜','type','material',
        'rarity',CASE WHEN v_part=6 THEN 'legendary'
                      WHEN v_part=5 THEN 'epic' ELSE 'rare' END,
        'qty',1,'description','Фрагмент чертежа для профессии мастера. Не портится.');
      v_inventory:=v_inventory||pg_catalog.jsonb_build_array(v_item);
    END LOOP;
  END LOOP;

  v_item:=pg_catalog.jsonb_build_object(
    'id','mortarion_owner_test_mortarion_soul_essence',
    'canonicalItemId','mortarion_soul_essence','ownerTest',true,'testOnly',true,
    'name','Эссенция душ Мортариона','icon','✦',
    'type','material','rarity','epic','qty',1,
    'description','Редкий бессрочный материал будущих рецептов мастеров.');
  v_inventory:=v_inventory||pg_catalog.jsonb_build_array(v_item);

  v_item:=pg_catalog.jsonb_build_object(
    'id','mortarion_owner_test_mortarion_heart',
    'canonicalItemId','mortarion_heart','ownerTest',true,'testOnly',true,
    'name','Сердце Мортариона','icon','💜',
    'type','material','rarity','legendary','qty',1,
    'description','Уникальный бессрочный материал. Будущий рецепт мастеров и аукцион; шанс 0,3%.');
  v_inventory:=v_inventory||pg_catalog.jsonb_build_array(v_item);

  v_item:=pg_catalog.jsonb_build_object(
    'id','mortarion_owner_test_cow_awakening_stone',
    'canonicalItemId','cow_awakening_stone','ownerTest',true,'testOnly',true,
    'name','Камень пробуждения','icon','💜',
    'type','material','rarity','legendary','qty',1,
    'description','Особо редкий бессрочный камень пробуждения спутника. Не продаётся.');
  v_inventory:=v_inventory||pg_catalog.jsonb_build_array(v_item);

  RETURN pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(p_state,'{inventory}',v_inventory,true),
    '{mortarionOwnerTestChest}',
    pg_catalog.jsonb_build_object(
      'testOnly',true,'eventId','mortarion_2026',
      'mailId','f4db6d91-863f-4592-a210-8164bc7b1fea',
      'receivedAt',pg_catalog.clock_timestamp(),
      'uniqueItems',15),true);
END;
$fn$;
REVOKE ALL ON FUNCTION territory_private.mortarion_owner_test_chest_apply_v1(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- Attach only this exact owner mail to the already atomic, exactly-once admin
-- mail claim. All other grant paths remain byte-for-byte unchanged.
DO $patch$
DECLARE
  src text;
  needle text := '  v_state:=jsonb_set(v_state,''{inventory}'',v_inventory,true);';
  extension text := $insert$
  -- Separate QA inventory and cosmetic preview. Never write mortarionHonor.
  IF v_grant.id='f4db6d91-863f-4592-a210-8164bc7b1fea'::uuid
    AND v_uid='1eb617c1-a7b9-4308-aa85-a8234f7818a1'::uuid
    AND v_player.telegram_id=770693083
    AND v_grant.kind='mail'
    AND v_grant.subject='ТЕСТ МОРТАРИОН · ПОЛНЫЙ СУНДУК'
    AND v_grant.payload='{}'::jsonb
  THEN
    v_state:=territory_private.mortarion_owner_test_chest_apply_v1(v_state);
  END IF;
$insert$;
BEGIN
  src:=pg_catalog.pg_get_functiondef(
    'public.territory_admin_claim_grant_v2(uuid)'::regprocedure);
  IF (pg_catalog.length(src)-pg_catalog.length(pg_catalog.replace(src,needle,'')))
       <> pg_catalog.length(needle)
  THEN RAISE EXCEPTION 'mortarion_owner_test_mail_anchor_mismatch'; END IF;
  EXECUTE pg_catalog.replace(src,needle,needle||E'\n'||extension);
END;
$patch$;
COMMIT;
