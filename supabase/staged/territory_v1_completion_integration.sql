-- STAGED ONLY. Install after combat + progression completion. No configuration
-- values or player rewards are seeded; existing production routes are untouched.
BEGIN;
CREATE TABLE territory_private.v1_combat_activity_sources (
  mode text NOT NULL CHECK(mode IN('pve','boss','pvp')),
  activity text NOT NULL REFERENCES territory_private.v1_activity_rules(activity),
  approval_reference text NOT NULL CHECK(length(approval_reference)>0),
  PRIMARY KEY(mode,activity)
);
CREATE TABLE territory_private.v1_combat_fund_sources (
  encounter_id text NOT NULL REFERENCES territory_private.combat_encounters_v1(encounter_id),
  fund text NOT NULL CHECK(fund IN('level','arena','blessing','adventure','artifact','dark_energy')),
  progress bigint NOT NULL CHECK(progress BETWEEN 0 AND 999999999),
  approval_reference text NOT NULL CHECK(length(approval_reference)>0),
  PRIMARY KEY(encounter_id,fund)
);
ALTER TABLE territory_private.v1_combat_activity_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.v1_combat_fund_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.v1_combat_activity_sources,territory_private.v1_combat_fund_sources FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION territory_private.v1_combat_progression_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source record;
BEGIN
  IF NEW.outcome<>'hero_won' OR NOT coalesce((SELECT enabled FROM territory_private.v1_progression_config WHERE id=1),false) THEN RETURN NEW; END IF;
  -- Each semantic event has its own stable id. Replays cannot double count and
  -- a failure rolls back the combat outcome and progress together.
  FOR source IN SELECT activity FROM territory_private.v1_combat_activity_sources WHERE mode=NEW.mode LOOP
    PERFORM territory_private.v1_progression_event(NEW.player_id,
      md5(NEW.session_id::text||':activity:'||source.activity)::uuid,'activity',
      jsonb_build_object('activity',source.activity,'quantity',1));
  END LOOP;
  FOR source IN SELECT fund,progress FROM territory_private.v1_combat_fund_sources WHERE encounter_id=NEW.encounter_id LOOP
    PERFORM territory_private.v1_progression_event(NEW.player_id,
      md5(NEW.session_id::text||':fund:'||source.fund)::uuid,'fund_progress',
      jsonb_build_object('fund',source.fund,'value',source.progress));
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION territory_private.v1_combat_progression_hook() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER v1_combat_progression_hook AFTER INSERT ON territory_private.combat_outcomes_v1
  FOR EACH ROW EXECUTE FUNCTION territory_private.v1_combat_progression_hook();
COMMIT;
