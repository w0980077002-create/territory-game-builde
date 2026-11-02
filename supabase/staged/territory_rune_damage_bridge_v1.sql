-- REVIEW ONLY #175/#176. Deterministic damage bridge for server-owned pinned runes.
-- This is NOT a production migration, nor a live Arena/PvE hook.
-- Call only AFTER existing tactical block/crit/target logic has decided a hit.
-- The existing battle engine remains authoritative for HP, rewards and receipts.
BEGIN;
CREATE OR REPLACE FUNCTION public.territory_runes_resolve_damage_v1(
  p_attacker uuid, p_defender uuid, p_battle uuid, p_kind text,
  p_base_damage integer, p_guarded boolean
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $runes$
DECLARE attack_effects jsonb; defense_effects jsonb;
  attack_bp integer; guard_bp integer; versus_guard_bp integer;
  adjusted numeric;
BEGIN
  IF p_attacker IS NULL OR p_battle IS NULL OR p_kind NOT IN ('pve','arena')
     OR p_base_damage IS NULL OR p_base_damage < 0 OR p_base_damage > 100000000
     OR p_guarded IS NULL THEN RAISE EXCEPTION 'rune_damage_invalid_request'; END IF;
  -- Attacker MUST have a trusted immutable snapshot. Never accept a client build.
  attack_effects:=public.territory_runes_battle_effects_v1(p_attacker,p_battle,p_kind);
  attack_bp:=coalesce((attack_effects#>>'{totals,damage_bonus_bp}')::integer,0);
  versus_guard_bp:=CASE WHEN p_guarded THEN
    coalesce((attack_effects#>>'{totals,damage_vs_guard_bp}')::integer,0) ELSE 0 END;
  guard_bp:=0;
  IF p_defender IS NOT NULL THEN
    defense_effects:=public.territory_runes_battle_effects_v1(p_defender,p_battle,p_kind);
    IF p_guarded THEN
      guard_bp:=coalesce((defense_effects#>>'{totals,guard_absorb_bp}')::integer,0);
    END IF;
  END IF;
  -- A 25% cap on each category is enforced by the pinned-effects resolver.
  -- Use numeric to avoid integer overflow and a stable rounding rule.
  adjusted:=round(p_base_damage::numeric
    * (10000+attack_bp+versus_guard_bp)::numeric / 10000
    * (10000-guard_bp)::numeric / 10000);
  RETURN least(100000000,greatest(0,adjusted))::integer;
END $runes$;
REVOKE ALL ON FUNCTION public.territory_runes_resolve_damage_v1(uuid,uuid,uuid,text,integer,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.territory_runes_resolve_damage_v1(uuid,uuid,uuid,text,integer,boolean)
  TO service_role;
COMMIT;
