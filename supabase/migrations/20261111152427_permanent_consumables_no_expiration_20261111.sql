-- TERRITORY owner decision 2026-11-11: PERMANENT potions, elixirs,
-- and Arena consumables. No inventory, currency, XP or VIP deletion.
-- Surgical replacement of six live functions preserves all other security checks.
-- Each anchor is asserted; any mismatch aborts this whole migration atomically.
DO $migration$
DECLARE
  src text;
  start_pos int;
  end_pos int;
  old_fragment text;
  reward_needle text := E',\n     ''expiresAt'',pg_catalog.to_jsonb(pg_catalog.clock_timestamp()+interval ''7 days'')';
BEGIN
  -- Preserve Arena CAS, win-locked slots, per-battle 5-dose limit and all effects.
  src := pg_catalog.pg_get_functiondef(
    'public.arena_secure_v1(text,timestamptz,text,uuid,integer,text,uuid)'::regprocedure);
  start_pos := strpos(src, '    -- Expiry is server-owned enforcement');
  end_pos := strpos(src, '    IF jsonb_typeof(v_item) IS DISTINCT FROM ''object''');
  IF start_pos=0 OR end_pos<=start_pos THEN
    RAISE EXCEPTION 'permanent_consumables_arena_anchor_mismatch';
  END IF;
  EXECUTE substr(src,1,start_pos-1)
    || E'    -- Consumables are permanent; still validate slots, quantity and effects.\n'
    || substr(src,end_pos);

  src := pg_catalog.pg_get_functiondef(
    'public.territory_trial_chest_open_v1(integer,timestamptz)'::regprocedure);
  IF (length(src)-length(replace(src,reward_needle,''))) / length(reward_needle) <> 2
  THEN RAISE EXCEPTION 'permanent_consumables_trial_anchor_mismatch'; END IF;
  EXECUTE replace(src,reward_needle,'');

  src := pg_catalog.pg_get_functiondef(
    'public.territory_mortarion_reward_claim_v1(timestamptz)'::regprocedure);
  IF (length(src)-length(replace(src,reward_needle,''))) / length(reward_needle) <> 1
  THEN RAISE EXCEPTION 'permanent_consumables_mortarion_anchor_mismatch'; END IF;
  EXECUTE replace(src,reward_needle,'');

  src := pg_catalog.pg_get_functiondef(
    'public.territory_admin_claim_grant_v2(uuid)'::regprocedure);
  old_fragment := '''qty'',v_qty,''expiresAt'',v_expiry';
  IF strpos(src,old_fragment)=0
  THEN RAISE EXCEPTION 'permanent_consumables_admin_anchor_mismatch'; END IF;
  EXECUTE replace(src,old_fragment,'''qty'',v_qty');

  src := pg_catalog.pg_get_functiondef(
    'public.territory_profession_stage8_execute(text,uuid)'::regprocedure);
  start_pos := strpos(src,
    '    IF v_recipe.item_output->>''type'' IN (''elixir'',''potion'')');
  end_pos := strpos(src, '    INSERT INTO public.territory_profession_stage8_items');
  IF start_pos=0 OR end_pos<=start_pos
  THEN RAISE EXCEPTION 'permanent_consumables_stage8_execute_anchor_mismatch'; END IF;
  EXECUTE substr(src,1,start_pos-1)
    || E'    -- Permanent crafted consumables: v_expires_at remains NULL.\n'
    || substr(src,end_pos);

  src := pg_catalog.pg_get_functiondef(
    'public.territory_profession_stage8_inventory()'::regprocedure);
  old_fragment := 'WHERE i.player_id=v_uid AND (i.expires_at IS NULL OR i.expires_at>pg_catalog.clock_timestamp());';
  IF strpos(src,old_fragment)=0
  THEN RAISE EXCEPTION 'permanent_consumables_stage8_inventory_anchor_mismatch'; END IF;
  EXECUTE replace(src,old_fragment,'WHERE i.player_id=v_uid;');
END;
$migration$;

UPDATE public.territory_profession_stage8_items
  SET expires_at=NULL WHERE expires_at IS NOT NULL;
COMMENT ON COLUMN public.territory_profession_stage8_items.expires_at IS
  'Deprecated 2026-11-11. Consumables are permanent; all existing items remain owned.';
