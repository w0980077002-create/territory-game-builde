-- TERRITORY V1: server-authoritative, exactly-once claiming of owner grants.
-- STAGED ONLY. Requires reviewed deployment together with the updated client.
-- Do not deploy separately: cached clients deliberately cannot claim after cutover.

BEGIN;

CREATE OR REPLACE FUNCTION territory_private.territory_admin_claim_delta_v2(
  p_value jsonb, p_key text)
RETURNS integer LANGUAGE plpgsql SET search_path='pg_catalog'
AS $function$
DECLARE v_text text; v_num numeric;
BEGIN
  IF p_value IS NULL THEN RETURN 0; END IF;
  IF jsonb_typeof(p_value) <> 'number' THEN
    RAISE EXCEPTION 'admin_grant_invalid_quantity:%',p_key;
  END IF;
  v_text:=p_value #>> '{}';
  IF v_text !~ '^-?[0-9]{1,10}$' THEN
    RAISE EXCEPTION 'admin_grant_invalid_quantity:%',p_key;
  END IF;
  v_num:=v_text::numeric;
  IF v_num NOT BETWEEN -2147483647 AND 2147483647 THEN
    RAISE EXCEPTION 'admin_grant_invalid_quantity:%',p_key;
  END IF;
  RETURN v_num::integer;
END $function$;
REVOKE ALL ON FUNCTION territory_private.territory_admin_claim_delta_v2(jsonb,text)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION territory_private.territory_admin_claim_balance_v2(
  p_current integer,p_delta integer)
RETURNS integer LANGUAGE plpgsql SET search_path='pg_catalog'
AS $function$
DECLARE v_next bigint;
BEGIN
  v_next:=GREATEST(0::bigint,p_current::bigint+p_delta::bigint);
  IF v_next>2147483647 THEN RAISE EXCEPTION 'admin_grant_balance_overflow'; END IF;
  RETURN v_next::integer;
END $function$;
REVOKE ALL ON FUNCTION territory_private.territory_admin_claim_balance_v2(integer,integer)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_admin_claim_grant_v2(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_grant public.admin_grants%ROWTYPE;
  v_player public.players%ROWTYPE;
  v_state jsonb;
  v_payload jsonb;
  v_hero jsonb;
  v_inventory jsonb;
  v_equipped jsonb;
  v_items jsonb;
  v_entry jsonb;
  v_def jsonb;
  v_batches jsonb;
  v_batch jsonb;
  v_new_batches jsonb;
  v_gold integer;
  v_gems integer;
  v_red integer;
  v_stones integer;
  v_forge integer;
  v_delta integer;
  v_qty integer;
  v_remaining bigint;
  v_used bigint;
  v_current bigint;
  v_position integer;
  v_key text;
  v_slot text;
  v_gear_id text;
  v_gear jsonb;
  v_expiry text:=to_jsonb(clock_timestamp()+interval '7 days') #>> '{}';
  v_replayed boolean:=false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'admin_grant_not_authenticated'; END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION 'admin_grant_missing'; END IF;

  -- Discover the owner first, then lock owner and grant in a stable order.
  SELECT * INTO v_grant FROM public.admin_grants
    WHERE id=p_id AND player_id=v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_grant_missing'; END IF;
  SELECT * INTO v_player FROM public.players WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_grant_player_missing'; END IF;
  SELECT * INTO v_grant FROM public.admin_grants
    WHERE id=p_id AND player_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_grant_missing'; END IF;

  IF v_grant.claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'replayed',true,
      'updated_at',v_player.updated_at,'game_state',v_player.game_state,
      'wallet_gold',v_player.gold,'wallet_gems',v_player.gems);
  END IF;

  v_payload:=v_grant.payload;
  IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object'
    OR (v_payload-ARRAY['gold','gems','redGems','stones','forgeMaterials',
      'items','equipLevels','adminTestLevel','adminTestGearId','adminTestEquipment']) <> '{}'::jsonb
  THEN RAISE EXCEPTION 'admin_grant_invalid_payload'; END IF;

  v_state:=v_player.game_state;
  v_hero:=v_state->'player';
  IF jsonb_typeof(v_state) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_hero) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_state->'inventory') IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_hero->'equipped') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'admin_grant_invalid_save'; END IF;

  v_gold:=territory_private.territory_admin_claim_balance_v2(
    v_player.gold,territory_private.territory_admin_claim_delta_v2(v_payload->'gold','gold'));
  v_gems:=territory_private.territory_admin_claim_balance_v2(
    v_player.gems,territory_private.territory_admin_claim_delta_v2(v_payload->'gems','gems'));
  v_red:=territory_private.territory_admin_claim_balance_v2(
    territory_private.territory_admin_claim_delta_v2(v_hero->'redGems','redGems'),
    territory_private.territory_admin_claim_delta_v2(v_payload->'redGems','redGems'));
  v_stones:=territory_private.territory_admin_claim_balance_v2(
    territory_private.territory_admin_claim_delta_v2(v_state->'battleStones','battleStones'),
    territory_private.territory_admin_claim_delta_v2(v_payload->'stones','stones'));
  v_forge:=territory_private.territory_admin_claim_balance_v2(
    v_player.forge_materials,
    territory_private.territory_admin_claim_delta_v2(v_payload->'forgeMaterials','forgeMaterials'));

  v_inventory:=v_state->'inventory';
  v_equipped:=v_hero->'equipped';
  v_items:=COALESCE(v_payload->'items','{}'::jsonb);
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'admin_grant_invalid_items';
  END IF;

  FOR v_key,v_entry IN SELECT key,value FROM jsonb_each(v_items) LOOP
    v_qty:=territory_private.territory_admin_claim_delta_v2(v_entry,v_key);
    IF v_key='shop_stone_5' THEN
      IF abs(v_qty::bigint)*5>2147483647 THEN
        RAISE EXCEPTION 'admin_grant_invalid_stone_bundle';
      END IF;
      v_stones:=territory_private.territory_admin_claim_balance_v2(v_stones,v_qty*5);
      CONTINUE;
    END IF;

    v_def:=CASE v_key
      WHEN 'shop_potion_hp' THEN jsonb_build_object('name','Зелье здоровья','icon','🧪','type','potion','rarity','common','description','Восстанавливает 50 HP мгновенно','effect',jsonb_build_object('stat','hp','value',50,'duration','instant'))
      WHEN 'shop_potion_hp_large' THEN jsonb_build_object('name','Большое зелье здоровья','icon','⚗️','type','potion','rarity','rare','description','Восстанавливает 150 HP мгновенно','effect',jsonb_build_object('stat','hp','value',150,'duration','instant'))
      WHEN 'shop_elixir_atk' THEN jsonb_build_object('name','Эликсир силы','icon','💪','type','elixir','rarity','rare','description','+10 к атаке на один бой','effect',jsonb_build_object('stat','attack','value',10,'duration','battle'))
      WHEN 'shop_elixir_def' THEN jsonb_build_object('name','Эликсир защиты','icon','🛡️','type','elixir','rarity','rare','description','+10 к защите на один бой','effect',jsonb_build_object('stat','defense','value',10,'duration','battle'))
      WHEN 'shop_elixir_crit' THEN jsonb_build_object('name','Эликсир крита','icon','🎯','type','elixir','rarity','epic','description','+15% к шансу крита на один бой','effect',jsonb_build_object('stat','critChance','value',15,'duration','battle'))
      WHEN 'shop_arena_time' THEN jsonb_build_object('name','Зелье времени','icon','⏳','type','arena','rarity','rare','description','Арена: сокращает тайм боя на 10 сек. (не меньше 30 сек.)','arenaEffect','time')
      WHEN 'shop_arena_adrenaline' THEN jsonb_build_object('name','Адреналин','icon','💉','type','arena','rarity','epic','description','Арена: возвращает павшего союзника в бой с 50% здоровья','arenaEffect','adrenaline')
      ELSE NULL END;
    IF v_def IS NULL THEN RAISE EXCEPTION 'admin_grant_unknown_item:%',v_key; END IF;

    IF v_qty>0 THEN
      v_inventory:=v_inventory || jsonb_build_array(
        v_def || jsonb_build_object('id','inv_'||replace(gen_random_uuid()::text,'-',''),
          'qty',v_qty,'expiresAt',v_expiry));
    ELSIF v_qty<0 THEN
      -- Consume the oldest-expiring matching lots first, never other items.
      v_remaining:=-v_qty::bigint;
      WHILE v_remaining>0 LOOP
        SELECT e.ordinality::integer-1,(e.value->>'qty')::bigint
        INTO v_position,v_current
        FROM jsonb_array_elements(v_inventory) WITH ORDINALITY AS e(value,ordinality)
        WHERE e.value->>'name'=v_def->>'name'
          AND e.value->>'type'=v_def->>'type'
          AND (e.value->>'qty') ~ '^[0-9]{1,10}$'
          AND (e.value->>'qty')::bigint>0
        ORDER BY COALESCE(e.value->>'expiresAt','9999'),e.ordinality
        LIMIT 1;
        EXIT WHEN NOT FOUND;
        v_used:=LEAST(v_current,v_remaining);
        v_remaining:=v_remaining-v_used;
        v_inventory:=jsonb_set(v_inventory,
          ARRAY[v_position::text,'qty'],to_jsonb(v_current-v_used),false);
      END LOOP;
      SELECT COALESCE(jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb)
      INTO v_inventory FROM jsonb_array_elements(v_inventory)
        WITH ORDINALITY AS e(value,ordinality)
      WHERE e.value->>'qty' IS NULL OR (e.value->>'qty')::numeric>0;
    END IF;
  END LOOP;

  IF v_payload ? 'equipLevels' THEN
    IF jsonb_typeof(v_payload->'equipLevels') IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_payload->'equipLevels'))<>1
      OR v_payload->'adminTestLevel' IS DISTINCT FROM 'true'::jsonb
      OR jsonb_typeof(v_payload->'adminTestEquipment') IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'admin_grant_invalid_gear'; END IF;
    SELECT key INTO v_slot FROM jsonb_each(v_payload->'equipLevels') LIMIT 1;
    IF v_slot NOT IN('helmet','amulet','armor','weapon','shield','ring','boots')
    THEN RAISE EXCEPTION 'admin_grant_invalid_gear'; END IF;
    v_gear:=v_payload->'adminTestEquipment';
    v_gear_id:=v_payload->>'adminTestGearId';
    v_qty:=territory_private.territory_admin_claim_delta_v2(v_payload->'equipLevels'->v_slot,'gearLevel');
    IF v_qty NOT BETWEEN 1 AND 500 OR v_gear->>'id' IS DISTINCT FROM v_gear_id
      OR v_gear->>'slot' IS DISTINCT FROM v_slot
      OR v_gear->>'level' IS DISTINCT FROM v_qty::text
      OR v_gear->'adminTestLevel' IS DISTINCT FROM 'true'::jsonb
      OR v_equipped->v_slot->>'id' IS DISTINCT FROM v_gear_id
    THEN RAISE EXCEPTION 'admin_grant_gear_conflict'; END IF;
    v_equipped:=jsonb_set(v_equipped,ARRAY[v_slot],v_gear,true);
  ELSIF (v_payload ? 'adminTestLevel') OR (v_payload ? 'adminTestGearId')
    OR (v_payload ? 'adminTestEquipment')
  THEN RAISE EXCEPTION 'admin_grant_invalid_gear'; END IF;

  -- Preserve exact seven-day batches of forge material rewards. Legacy saves
  -- without batches receive a normal seven-day starting batch on first claim.
  v_batches:=COALESCE(v_state->'forgeMaterialBatches','[]'::jsonb);
  IF jsonb_typeof(v_batches) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'admin_grant_invalid_material_batches'; END IF;
  IF jsonb_array_length(v_batches)=0 AND v_player.forge_materials>0 THEN
    v_batches:=jsonb_build_array(jsonb_build_object(
      'qty',v_player.forge_materials,'expiresAt',v_expiry));
  END IF;
  v_delta:=territory_private.territory_admin_claim_delta_v2(
    v_payload->'forgeMaterials','forgeMaterials');
  IF v_delta>0 THEN
    v_batches:=v_batches || jsonb_build_array(jsonb_build_object(
      'qty',v_delta,'expiresAt',v_expiry));
  ELSIF v_delta<0 THEN
    v_remaining:=-v_delta::bigint;
    v_new_batches:='[]'::jsonb;
    FOR v_batch IN SELECT e.value FROM jsonb_array_elements(v_batches)
      WITH ORDINALITY AS e(value,ordinality)
      ORDER BY COALESCE(e.value->>'expiresAt','9999'),e.ordinality
    LOOP
      v_current:=(v_batch->>'qty')::bigint;
      v_used:=LEAST(v_current,v_remaining);
      v_remaining:=v_remaining-v_used;
      IF v_current>v_used THEN
        v_new_batches:=v_new_batches || jsonb_build_array(
          jsonb_set(v_batch,'{qty}',to_jsonb(v_current-v_used)));
      END IF;
    END LOOP;
    v_batches:=v_new_batches;
  END IF;

  v_hero:=jsonb_set(v_hero,'{gold}',to_jsonb(v_gold),true);
  v_hero:=jsonb_set(v_hero,'{gems}',to_jsonb(v_gems),true);
  v_hero:=jsonb_set(v_hero,'{redGems}',to_jsonb(v_red),true);
  v_hero:=jsonb_set(v_hero,'{equipped}',v_equipped,true);
  v_state:=jsonb_set(v_state,'{player}',v_hero,true);
  v_state:=jsonb_set(v_state,'{battleStones}',to_jsonb(v_stones),true);
  v_state:=jsonb_set(v_state,'{forgeMaterials}',to_jsonb(v_forge),true);
  v_state:=jsonb_set(v_state,'{forgeMaterialBatches}',v_batches,true);
  v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);

  UPDATE public.players SET gold=v_gold,gems=v_gems,
    forge_materials=v_forge,game_state=v_state,
    updated_at=GREATEST(clock_timestamp(),v_player.updated_at+interval '1 microsecond')
    WHERE id=v_uid RETURNING * INTO v_player;

  -- Existing master-license trigger credits protected red wallet exactly once.
  -- Any trigger failure (or overflow) rolls back player state and claimed_at.
  UPDATE public.admin_grants SET claimed_at=clock_timestamp()
    WHERE id=p_id AND player_id=v_uid AND claimed_at IS NULL;

  RETURN jsonb_build_object('success',true,'replayed',v_replayed,
    'updated_at',v_player.updated_at,'game_state',v_player.game_state,
    'wallet_gold',v_player.gold,'wallet_gems',v_player.gems);
END $function$;

REVOKE ALL ON FUNCTION public.territory_admin_claim_grant_v2(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_claim_grant_v2(uuid)
  TO authenticated,service_role;

-- Cached legacy clients must not mark rewards as claimed without a committed
-- server wallet update. Returning NULL is safe and lets the new client retry.
CREATE OR REPLACE FUNCTION public.claim_admin_grant(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.claim_admin_grant(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin_grant(uuid) TO authenticated,service_role;

COMMIT;
