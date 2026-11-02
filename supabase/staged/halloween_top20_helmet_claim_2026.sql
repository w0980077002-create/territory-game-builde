-- STAGED ONLY. Must deploy together with verified top-20 bonus SQL.
-- Adds one authenticated, server-entitled, permanent Halloween 2026 helmet
-- through the EXISTING atomic mail-claim receipt. No client-created item and no
-- direct save overwrite during bulk: player row stays locked during each claim.
-- Refuse to modify an unknown claim version; NEVER apply to live without PG17/JWT gates.
DO $patch$
DECLARE
  fn text;
  marker text := '    v_def:=CASE v_key';
  branch text := $fragment$
    IF v_key='halloween_horned_pumpkin_2026' THEN
      -- Only this event's sealed top-20 mail can ever mint the commemorative helmet.
      IF v_qty<>1 OR NOT EXISTS (
        SELECT 1 FROM territory_private.halloween_top20_bonus_2026 b
        WHERE b.event_id='halloween_2026'
          AND b.player_id=v_uid
          AND b.mail_id=v_grant.id
          AND b.payload->'items'->>'halloween_horned_pumpkin_2026'='1'
      ) THEN
        RAISE EXCEPTION 'halloween_pumpkin_mail_not_entitled';
      END IF;
      -- A retried or restored save must not create another copy of the trophy.
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_inventory) AS inv(entry)
        WHERE inv.entry#>>'{equipment,id}'='halloween_horned_pumpkin_2026'
      ) AND NOT EXISTS (
        SELECT 1 FROM jsonb_each(v_equipped) AS eq(slot,item)
        WHERE eq.item->>'id'='halloween_horned_pumpkin_2026'
      ) THEN
        v_inventory:=v_inventory || jsonb_build_array(jsonb_build_object(
          'id','inv_'||replace(gen_random_uuid()::text,'-',''),
          'name','Рогатая тыква · Хэллоуин 2026',
          'icon','🎃',
          'type','equipment',
          'rarity','rare',
          'qty',1,
          'description','Раритетный рогатый шлем. Защита +6, HP +40, крит +1%. Память о рейде 2026.',
          'equipment',jsonb_build_object(
            'id','halloween_horned_pumpkin_2026',
            'slot','helmet',
            'name','Рогатая тыква · Хэллоуин 2026',
            'icon','🎃',
            'rarity','rare',
            'level',1,'baseLevel',1,'upgradeCount',0,
            'defense',6,'hp',40,'critChance',1,
            'baseStats',jsonb_build_object('defense',6,'hp',40,'critChance',1)
          )
        ));
      END IF;
      CONTINUE;
    END IF;

    v_def:=CASE v_key$fragment$;
BEGIN
  IF to_regclass('territory_private.halloween_top20_bonus_2026') IS NULL
    OR to_regprocedure('public.territory_admin_claim_grant_v2(uuid)') IS NULL
  THEN RAISE EXCEPTION 'halloween_pumpkin_requires_top20_and_atomic_claim'; END IF;
  SELECT pg_get_functiondef('public.territory_admin_claim_grant_v2(uuid)'::regprocedure) INTO fn;
  IF position('halloween_pumpkin_mail_not_entitled' in fn)>0 THEN
    RETURN; -- already applied; preserve any later edits
  END IF;
  IF position(marker IN fn)=0
    OR position('admin_grant_unknown_item' IN fn)=0
    OR position('v_grant.claimed_at IS NOT NULL' IN fn)=0
    OR position('v_inventory:=v_state->''inventory''' IN fn)=0
    OR position('UPDATE public.players SET gold=v_gold' IN fn)=0
  THEN RAISE EXCEPTION 'halloween_pumpkin_claim_unknown_version'; END IF;
  EXECUTE replace(fn,marker,branch);
END $patch$;
REVOKE ALL ON FUNCTION public.territory_admin_claim_grant_v2(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.territory_admin_claim_grant_v2(uuid) TO authenticated,service_role;
