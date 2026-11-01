-- REVIEW ONLY (#175/#176). Not a production migration or combat cutover.
-- Server-owned deterministic effects for BOTH PvE and tactical Arena snapshots.
-- This function resolves effects; live combat adapters must still consume them.
-- Percent-style modifiers are basis points (100 = 1%). Each effect is capped
-- at 2500bp (25%) across all slots. No client-provided stats or rune levels.
BEGIN;
CREATE TABLE IF NOT EXISTS territory_private.rune_effects_v1 (
  rune_id text PRIMARY KEY REFERENCES territory_private.rune_catalog_v1(rune_id),
  effect_key text NOT NULL CHECK (effect_key IN ('guard_absorb_bp','counter_damage_bp','guard_duration_bp','damage_bonus_bp','bleed_chance_bp','haste_bp','accuracy_bp','armor_pen_bp','crit_chance_bp','slow_duration_bp','damage_vs_slow_bp','root_chance_bp','buff_duration_bp','next_attack_bp','energy_gain_bp','chain_chance_bp','spell_damage_bp','root_duration_bp','area_radius_bp','dispel_chance_bp','dodge_chance_bp','next_enemy_damage_reduction_bp','burn_chance_bp','enemy_accuracy_reduction_bp','attack_chain_damage_bp','rage_damage_reduction_bp','slow_chance_bp','regen_bp','single_target_damage_bp','dot_damage_bp','cooldown_reduction_bp','damage_vs_guard_bp','finisher_damage_bp','control_resist_bp')),
  basis_points_per_level integer NOT NULL CHECK (basis_points_per_level BETWEEN 1 AND 500)
);
INSERT INTO territory_private.rune_effects_v1(rune_id,effect_key,basis_points_per_level) VALUES
  ('shield_wall_r1','guard_absorb_bp',120),
  ('shield_wall_r2','counter_damage_bp',120),
  ('shield_wall_r3','guard_duration_bp',150),
  ('axe_storm_r1','damage_bonus_bp',100),
  ('axe_storm_r2','bleed_chance_bp',120),
  ('axe_storm_r3','haste_bp',100),
  ('hawk_shot_r1','accuracy_bp',120),
  ('hawk_shot_r2','armor_pen_bp',110),
  ('hawk_shot_r3','crit_chance_bp',80),
  ('frost_oath_r1','slow_duration_bp',130),
  ('frost_oath_r2','damage_vs_slow_bp',120),
  ('frost_oath_r3','root_chance_bp',70),
  ('battle_chant_r1','buff_duration_bp',140),
  ('battle_chant_r2','next_attack_bp',150),
  ('battle_chant_r3','guard_absorb_bp',110),
  ('runic_bolt_r1','energy_gain_bp',90),
  ('runic_bolt_r2','chain_chance_bp',70),
  ('runic_bolt_r3','spell_damage_bp',120),
  ('rune_snare_r1','root_duration_bp',150),
  ('rune_snare_r2','area_radius_bp',100),
  ('rune_snare_r3','dispel_chance_bp',80),
  ('quickstep_r1','dodge_chance_bp',80),
  ('quickstep_r2','next_enemy_damage_reduction_bp',140),
  ('quickstep_r3','counter_damage_bp',110),
  ('fire_net_r1','root_duration_bp',120),
  ('fire_net_r2','burn_chance_bp',100),
  ('fire_net_r3','enemy_accuracy_reduction_bp',100),
  ('ancestral_surge_r1','buff_duration_bp',120),
  ('ancestral_surge_r2','guard_absorb_bp',130),
  ('ancestral_surge_r3','energy_gain_bp',100),
  ('blood_rush_r1','attack_chain_damage_bp',110),
  ('blood_rush_r2','rage_damage_reduction_bp',110),
  ('blood_rush_r3','crit_chance_bp',90),
  ('forest_awakening_r1','slow_chance_bp',90),
  ('forest_awakening_r2','regen_bp',120),
  ('forest_awakening_r3','dodge_chance_bp',90),
  ('storm_judgement_r1','single_target_damage_bp',120),
  ('storm_judgement_r2','dot_damage_bp',110),
  ('storm_judgement_r3','cooldown_reduction_bp',100),
  ('winter_breaker_r1','damage_vs_guard_bp',130),
  ('winter_breaker_r2','area_radius_bp',100),
  ('winter_breaker_r3','slow_duration_bp',120),
  ('wolf_king_r1','buff_duration_bp',120),
  ('wolf_king_r2','finisher_damage_bp',140),
  ('wolf_king_r3','control_resist_bp',110)
ON CONFLICT(rune_id) DO UPDATE SET
 effect_key=excluded.effect_key,
 basis_points_per_level=excluded.basis_points_per_level;
DO $coverage$
BEGIN
 IF (SELECT count(*) FROM territory_private.rune_effects_v1)<>45
 OR EXISTS(
   SELECT rune_id FROM territory_private.rune_catalog_v1
   EXCEPT SELECT rune_id FROM territory_private.rune_effects_v1
 ) OR EXISTS(
   SELECT rune_id FROM territory_private.rune_effects_v1
   EXCEPT SELECT rune_id FROM territory_private.rune_catalog_v1
 ) THEN RAISE EXCEPTION 'rune_effect_catalog_drift'; END IF;
END $coverage$;
ALTER TABLE territory_private.rune_effects_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.rune_effects_v1 FROM PUBLIC,anon,authenticated,service_role;

-- IMPORTANT: no client-supplied snapshot; read only the previously pinned
-- immutable battle-start snapshot. Same result after changing the loadout,
-- downgrading ownership or losing connectivity. No RNG, no currency writes.
CREATE OR REPLACE FUNCTION public.territory_runes_battle_effects_v1(
 p_player uuid,p_battle uuid,p_kind text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $runes$
DECLARE snap jsonb; selected jsonb; effects jsonb:='[]'::jsonb;
 totals jsonb:='{}'::jsonb; rune text; effect text;
 unit_bp integer; level_num integer; amount integer; i integer;
BEGIN
 IF p_player IS NULL OR p_battle IS NULL OR p_kind NOT IN ('pve','arena')
 THEN RAISE EXCEPTION 'rune_effect_invalid_request'; END IF;
 SELECT snapshot INTO snap FROM territory_private.rune_battle_snapshots_v1
 WHERE player_id=p_player AND battle_id=p_battle AND kind=p_kind;
 IF NOT FOUND THEN RAISE EXCEPTION 'rune_effect_snapshot_missing'; END IF;
 IF snap->>'schema' IS DISTINCT FROM 'territory-rune-battle-snapshot/1'
 OR snap->>'kind' IS DISTINCT FROM p_kind
 OR snap->>'battleId' IS DISTINCT FROM p_battle::text
 OR jsonb_typeof(snap->'slots') IS DISTINCT FROM 'array'
 OR jsonb_array_length(snap->'slots')<>15
 THEN RAISE EXCEPTION 'rune_effect_snapshot_invalid'; END IF;
 FOR i IN 0..14 LOOP
   selected:=snap->'slots'->i;
   IF jsonb_typeof(selected) IS DISTINCT FROM 'object'
      OR selected->>'slotId' IS DISTINCT FROM 'rune_slot_'||lpad((i+1)::text,2,'0')
      OR NOT (selected ? 'runeId' AND selected ? 'level')
   THEN RAISE EXCEPTION 'rune_effect_snapshot_invalid'; END IF;
   rune:=selected->>'runeId';
   IF jsonb_typeof(selected->'level') IS DISTINCT FROM 'number'
      OR (selected->>'level') !~ '^[0-3]$'
   THEN RAISE EXCEPTION 'rune_effect_snapshot_invalid'; END IF;
   level_num:=(selected->>'level')::integer;
   IF rune IS NULL THEN
     IF jsonb_typeof(selected->'runeId') IS DISTINCT FROM 'null' OR level_num<>0
     THEN RAISE EXCEPTION 'rune_effect_snapshot_invalid'; END IF;
     CONTINUE;
   END IF;
   IF jsonb_typeof(selected->'runeId') IS DISTINCT FROM 'string' OR level_num<1
   THEN RAISE EXCEPTION 'rune_effect_snapshot_invalid'; END IF;
   SELECT e.effect_key,e.basis_points_per_level INTO effect,unit_bp
   FROM territory_private.rune_effects_v1 e
   JOIN territory_private.rune_catalog_v1 c ON c.rune_id=e.rune_id
   WHERE c.slot_id=selected->>'slotId' AND e.rune_id=rune
     AND level_num<=c.max_level;
   IF NOT FOUND THEN RAISE EXCEPTION 'rune_effect_snapshot_invalid'; END IF;
   amount:=unit_bp*level_num;
   effects:=effects||jsonb_build_array(jsonb_build_object(
     'slotId',selected->>'slotId','runeId',rune,'level',level_num,
     'effectKey',effect,'amountBp',amount));
   totals:=jsonb_set(totals,ARRAY[effect],
     to_jsonb(least(2500,coalesce((totals->>effect)::integer,0)+amount)),true);
 END LOOP;
 RETURN jsonb_build_object(
   'schema','territory-rune-effects/1','battleId',p_battle,'kind',p_kind,
   'revision',snap->'revision','effects',effects,'totals',totals);
END $runes$;
REVOKE ALL ON FUNCTION public.territory_runes_battle_effects_v1(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.territory_runes_battle_effects_v1(uuid,uuid,text)
 TO service_role;
COMMIT;
