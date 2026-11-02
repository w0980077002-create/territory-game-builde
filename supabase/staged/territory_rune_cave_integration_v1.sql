-- REVIEW ONLY: not a production migration. Install after the rune ledger,
-- battle snapshots and effects. Default is OFF; never enable automatically.
-- The existing Cave commit inserts the session in the same transaction as
-- the dark-stone debit and operation receipt. This trigger pins the runes in
-- that transaction, after session_id is assigned and before it is returned.
BEGIN;
CREATE TABLE IF NOT EXISTS territory_private.rune_cave_config_v1 (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE territory_private.rune_cave_config_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.rune_cave_config_v1 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO territory_private.rune_cave_config_v1(id) VALUES(true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION territory_private.runes_cave_pin_session_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $runes$
DECLARE active boolean; resolved jsonb; totals jsonb; pinned jsonb;
BEGIN
 SELECT enabled INTO active FROM territory_private.rune_cave_config_v1 WHERE id=true;
 -- With the feature disabled, the trigger must never disrupt old sessions.
 IF NOT coalesce(active,false) THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.state) IS DISTINCT FROM 'object'
   OR jsonb_typeof(NEW.state->'input') IS DISTINCT FROM 'object'
   OR (NEW.state->'input') ? 'serverRuneEffects'
 THEN RAISE EXCEPTION 'rune_cave_invalid_start_state'; END IF;
 IF NEW.session_id IS NULL OR NEW.player_id IS NULL
   OR NEW.state#>>'{input,mode}' IS NULL
   OR NEW.state#>>'{input,mode}' NOT IN ('pve','boss')
 THEN RAISE EXCEPTION 'rune_cave_invalid_session'; END IF;
 PERFORM public.territory_runes_pin_battle_v1(NEW.player_id,NEW.session_id,'pve');
 resolved:=public.territory_runes_battle_effects_v1(NEW.player_id,NEW.session_id,'pve');
 totals:=resolved->'totals';
 pinned:=jsonb_build_object('battleId',NEW.session_id,
   'damage_bonus_bp',least(2500,coalesce((totals->>'damage_bonus_bp')::integer,0)+coalesce((totals->>'rune_combat_damage_bp')::integer,0)),
   'damage_vs_guard_bp',coalesce((totals->>'damage_vs_guard_bp')::integer,0),
   'guard_absorb_bp',least(2500,coalesce((totals->>'guard_absorb_bp')::integer,0)+coalesce((totals->>'rune_combat_guard_bp')::integer,0)),
   'crit_chance_bp',least(2500,coalesce((totals->>'crit_chance_bp')::integer,0)+coalesce((totals->>'rune_combat_crit_bp')::integer,0)),
   'dodge_chance_bp',least(2500,coalesce((totals->>'dodge_chance_bp')::integer,0)+coalesce((totals->>'rune_combat_dodge_bp')::integer,0)),
   'accuracy_bp',least(2500,coalesce((totals->>'accuracy_bp')::integer,0)+coalesce((totals->>'rune_combat_accuracy_bp')::integer,0)));
 NEW.state:=jsonb_set(NEW.state,'{input,serverRuneEffects}',pinned,true);
 RETURN NEW;
END $runes$;
REVOKE ALL ON FUNCTION territory_private.runes_cave_pin_session_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS territory_runes_cave_start_v1 ON territory_private.combat_sessions_v1;
CREATE TRIGGER territory_runes_cave_start_v1 BEFORE INSERT ON territory_private.combat_sessions_v1
 FOR EACH ROW EXECUTE FUNCTION territory_private.runes_cave_pin_session_v1();
COMMIT;
