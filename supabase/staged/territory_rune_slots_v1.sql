-- REVIEW-ONLY #175/#176. Do NOT place in migrations or run on production.
-- Independent server-owned 15-slot rune ledger. No player/save/economy writes.
-- Not live: PvE/Arena snapshots, admin UI, reward sources and cutover are separate gates.
BEGIN;
CREATE SCHEMA IF NOT EXISTS territory_private;
REVOKE ALL ON SCHEMA territory_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS territory_private.rune_catalog_v1 (
  slot_id text NOT NULL CHECK (slot_id ~ '^rune_slot_(0[1-9]|1[0-5])$'),
  rune_id text PRIMARY KEY,
  max_level integer NOT NULL DEFAULT 3 CHECK (max_level BETWEEN 1 AND 3)
);
INSERT INTO territory_private.rune_catalog_v1(slot_id,rune_id) VALUES
  ('rune_slot_01', 'shield_wall_r1'),
  ('rune_slot_01', 'shield_wall_r2'),
  ('rune_slot_01', 'shield_wall_r3'),
  ('rune_slot_02', 'axe_storm_r1'),
  ('rune_slot_02', 'axe_storm_r2'),
  ('rune_slot_02', 'axe_storm_r3'),
  ('rune_slot_03', 'hawk_shot_r1'),
  ('rune_slot_03', 'hawk_shot_r2'),
  ('rune_slot_03', 'hawk_shot_r3'),
  ('rune_slot_04', 'frost_oath_r1'),
  ('rune_slot_04', 'frost_oath_r2'),
  ('rune_slot_04', 'frost_oath_r3'),
  ('rune_slot_05', 'battle_chant_r1'),
  ('rune_slot_05', 'battle_chant_r2'),
  ('rune_slot_05', 'battle_chant_r3'),
  ('rune_slot_06', 'runic_bolt_r1'),
  ('rune_slot_06', 'runic_bolt_r2'),
  ('rune_slot_06', 'runic_bolt_r3'),
  ('rune_slot_07', 'rune_snare_r1'),
  ('rune_slot_07', 'rune_snare_r2'),
  ('rune_slot_07', 'rune_snare_r3'),
  ('rune_slot_08', 'quickstep_r1'),
  ('rune_slot_08', 'quickstep_r2'),
  ('rune_slot_08', 'quickstep_r3'),
  ('rune_slot_09', 'fire_net_r1'),
  ('rune_slot_09', 'fire_net_r2'),
  ('rune_slot_09', 'fire_net_r3'),
  ('rune_slot_10', 'ancestral_surge_r1'),
  ('rune_slot_10', 'ancestral_surge_r2'),
  ('rune_slot_10', 'ancestral_surge_r3'),
  ('rune_slot_11', 'blood_rush_r1'),
  ('rune_slot_11', 'blood_rush_r2'),
  ('rune_slot_11', 'blood_rush_r3'),
  ('rune_slot_12', 'forest_awakening_r1'),
  ('rune_slot_12', 'forest_awakening_r2'),
  ('rune_slot_12', 'forest_awakening_r3'),
  ('rune_slot_13', 'storm_judgement_r1'),
  ('rune_slot_13', 'storm_judgement_r2'),
  ('rune_slot_13', 'storm_judgement_r3'),
  ('rune_slot_14', 'winter_breaker_r1'),
  ('rune_slot_14', 'winter_breaker_r2'),
  ('rune_slot_14', 'winter_breaker_r3'),
  ('rune_slot_15', 'wolf_king_r1'),
  ('rune_slot_15', 'wolf_king_r2'),
  ('rune_slot_15', 'wolf_king_r3')
ON CONFLICT (rune_id) DO NOTHING;
DO $catalog$
BEGIN
 IF (SELECT count(*) FROM territory_private.rune_catalog_v1) <> 45
    OR (SELECT count(DISTINCT slot_id) FROM territory_private.rune_catalog_v1) <> 15
    OR EXISTS (SELECT 1 FROM territory_private.rune_catalog_v1 GROUP BY slot_id HAVING count(*)<>3)
 THEN RAISE EXCEPTION 'rune_catalog_drift'; END IF;
END $catalog$;

CREATE TABLE IF NOT EXISTS territory_private.rune_ownership_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id),
  rune_id text NOT NULL REFERENCES territory_private.rune_catalog_v1(rune_id),
  level integer NOT NULL CHECK(level BETWEEN 1 AND 3),
  source text NOT NULL CHECK(length(btrim(source))>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(player_id,rune_id)
);
CREATE TABLE IF NOT EXISTS territory_private.rune_loadouts_v1 (
  player_id uuid PRIMARY KEY REFERENCES public.players(id),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  slots jsonb NOT NULL CHECK(jsonb_typeof(slots)='array' AND jsonb_array_length(slots)=15),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS territory_private.rune_operations_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id),
  operation_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('save','admin')),
  request jsonb NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(player_id,operation_id)
);
ALTER TABLE territory_private.rune_catalog_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.rune_ownership_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.rune_loadouts_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_private.rune_operations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.rune_catalog_v1,territory_private.rune_ownership_v1,
  territory_private.rune_loadouts_v1,territory_private.rune_operations_v1
  FROM PUBLIC,anon,authenticated,service_role;

-- Authenticated read: no direct table grants, no client-supplied owner id.
CREATE OR REPLACE FUNCTION public.territory_runes_status_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $runes$
DECLARE u uuid:=auth.uid(); state territory_private.rune_loadouts_v1%ROWTYPE;
  empty_slots jsonb; owned jsonb;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT coalesce(banned,false))
 THEN RAISE EXCEPTION 'rune_account_unavailable'; END IF;
 SELECT jsonb_agg(jsonb_build_object('slotId',slot_id,'runeId',NULL) ORDER BY slot_id)
 INTO empty_slots FROM (SELECT DISTINCT slot_id FROM territory_private.rune_catalog_v1) s;
 SELECT * INTO state FROM territory_private.rune_loadouts_v1 WHERE player_id=u;
 SELECT coalesce(jsonb_agg(jsonb_build_object('runeId',rune_id,'level',level) ORDER BY rune_id),'[]'::jsonb)
 INTO owned FROM territory_private.rune_ownership_v1 WHERE player_id=u;
 RETURN jsonb_build_object('schema','territory-rune-slots/1','revision',coalesce(state.revision,0),
   'slots',coalesce(state.slots,empty_slots),'owned',owned);
END $runes$;

-- Player and admin writes lock the SAME player row before loadout/ownership.
-- This prevents a revoke racing a save. Duplicate operation IDs replay exactly.
CREATE OR REPLACE FUNCTION public.territory_runes_save_v1(
 p_operation uuid,p_revision bigint,p_slots jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $runes$
DECLARE u uuid:=auth.uid(); old territory_private.rune_operations_v1%ROWTYPE;
  current_state territory_private.rune_loadouts_v1%ROWTYPE;
  request_body jsonb; result jsonb; choice jsonb; idx integer:=0; selected text;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT coalesce(banned,false) FOR UPDATE)
 THEN RAISE EXCEPTION 'rune_account_unavailable'; END IF;
 IF p_operation IS NULL OR p_revision IS NULL OR p_revision<0
    OR jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_slots)<>15 THEN RAISE EXCEPTION 'rune_invalid_request'; END IF;
 request_body:=jsonb_build_object('revision',p_revision,'slots',p_slots);
 SELECT * INTO old FROM territory_private.rune_operations_v1 WHERE player_id=u AND operation_id=p_operation;
 IF FOUND THEN
   IF old.kind<>'save' OR old.request<>request_body THEN RAISE EXCEPTION 'rune_operation_reused'; END IF;
   RETURN old.receipt;
 END IF;
 INSERT INTO territory_private.rune_loadouts_v1(player_id,slots)
 SELECT u,jsonb_agg(jsonb_build_object('slotId',slot_id,'runeId',NULL) ORDER BY slot_id)
 FROM (SELECT DISTINCT slot_id FROM territory_private.rune_catalog_v1) s
 WHERE true
 ON CONFLICT(player_id) DO NOTHING;
 SELECT * INTO current_state FROM territory_private.rune_loadouts_v1 WHERE player_id=u FOR UPDATE;
 IF current_state.revision<>p_revision THEN RAISE EXCEPTION 'rune_revision_conflict'; END IF;
 FOR choice IN SELECT value FROM jsonb_array_elements(p_slots) LOOP
   idx:=idx+1;
   IF jsonb_typeof(choice) IS DISTINCT FROM 'object'
      OR NOT (choice ? 'slotId' AND choice ? 'runeId')
      OR (SELECT count(*) FROM jsonb_object_keys(choice))<>2
      OR choice->>'slotId'<>'rune_slot_'||lpad(idx::text,2,'0')
      OR jsonb_typeof(choice->'runeId') NOT IN ('string','null')
   THEN RAISE EXCEPTION 'rune_invalid_slot'; END IF;
   selected:=choice->>'runeId';
   IF selected IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM territory_private.rune_catalog_v1 c
     JOIN territory_private.rune_ownership_v1 o ON o.rune_id=c.rune_id
     WHERE c.slot_id=choice->>'slotId' AND c.rune_id=selected
       AND o.player_id=u AND o.level BETWEEN 1 AND c.max_level
   ) THEN RAISE EXCEPTION 'rune_not_owned_or_wrong_slot'; END IF;
 END LOOP;
 UPDATE territory_private.rune_loadouts_v1
 SET slots=p_slots,revision=revision+1,updated_at=clock_timestamp() WHERE player_id=u;
 result:=jsonb_build_object('schema','territory-rune-slots/1','revision',p_revision+1,
    'slots',p_slots,'operationId',p_operation);
 INSERT INTO territory_private.rune_operations_v1(player_id,operation_id,kind,request,receipt)
 VALUES(u,p_operation,'save',request_body,result);
 RETURN result;
END $runes$;

-- Restricted staging admin primitive; NOT a public/client mint endpoint.
-- This is not a complete admin UI or reward pipeline.
CREATE OR REPLACE FUNCTION public.territory_runes_admin_set_level_v1(
 p_player uuid,p_rune text,p_level integer,p_operation uuid,p_source text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $runes$
DECLARE old territory_private.rune_operations_v1%ROWTYPE;
  request_body jsonb; result jsonb; previous integer; equipped boolean;
BEGIN
 IF p_player IS NULL OR p_rune IS NULL OR p_level IS NULL OR p_level NOT BETWEEN 0 AND 3
    OR p_operation IS NULL OR p_source IS NULL OR length(btrim(p_source))<4
 THEN RAISE EXCEPTION 'rune_admin_invalid_request'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.players WHERE id=p_player AND NOT coalesce(banned,false) FOR UPDATE)
 THEN RAISE EXCEPTION 'rune_account_unavailable'; END IF;
 request_body:=jsonb_build_object('runeId',p_rune,'level',p_level,'source',p_source);
 SELECT * INTO old FROM territory_private.rune_operations_v1
 WHERE player_id=p_player AND operation_id=p_operation;
 IF FOUND THEN
   IF old.kind<>'admin' OR old.request<>request_body THEN RAISE EXCEPTION 'rune_operation_reused'; END IF;
   RETURN old.receipt;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM territory_private.rune_catalog_v1
   WHERE rune_id=p_rune AND max_level>=p_level)
 THEN RAISE EXCEPTION 'rune_unknown_id'; END IF;
 SELECT level INTO previous FROM territory_private.rune_ownership_v1
 WHERE player_id=p_player AND rune_id=p_rune;
 IF p_level=0 THEN
   SELECT EXISTS(SELECT 1 FROM territory_private.rune_loadouts_v1 l,
     jsonb_array_elements(l.slots) slot WHERE l.player_id=p_player AND slot->>'runeId'=p_rune)
   INTO equipped;
   IF equipped THEN RAISE EXCEPTION 'rune_still_equipped'; END IF;
   DELETE FROM territory_private.rune_ownership_v1 WHERE player_id=p_player AND rune_id=p_rune;
 ELSE
   INSERT INTO territory_private.rune_ownership_v1(player_id,rune_id,level,source)
   VALUES(p_player,p_rune,p_level,p_source)
   ON CONFLICT(player_id,rune_id) DO UPDATE SET
     level=excluded.level,source=excluded.source,updated_at=clock_timestamp();
 END IF;
 result:=jsonb_build_object('playerId',p_player,'runeId',p_rune,
   'previousLevel',coalesce(previous,0),'level',p_level,'operationId',p_operation);
 INSERT INTO territory_private.rune_operations_v1(player_id,operation_id,kind,request,receipt)
 VALUES(p_player,p_operation,'admin',request_body,result);
 RETURN result;
END $runes$;

REVOKE ALL ON FUNCTION public.territory_runes_status_v1(),
 public.territory_runes_save_v1(uuid,bigint,jsonb),
 public.territory_runes_admin_set_level_v1(uuid,text,integer,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.territory_runes_status_v1(),
 public.territory_runes_save_v1(uuid,bigint,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.territory_runes_admin_set_level_v1(uuid,text,integer,uuid,text)
 TO service_role;
COMMIT;
