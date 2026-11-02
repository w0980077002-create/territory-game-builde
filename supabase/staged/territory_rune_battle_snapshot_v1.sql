-- REVIEW-ONLY #175/#176. This is NOT a production migration.
-- Trusted server-only, immutable battle-start snapshot. Not yet connected to
-- live PvE or arena_start_room / arena_resolve_round; no combat effects here.
BEGIN;
CREATE TABLE IF NOT EXISTS territory_private.rune_battle_snapshots_v1 (
  player_id uuid NOT NULL REFERENCES public.players(id),
  battle_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('pve','arena')),
  snapshot jsonb NOT NULL,
  pinned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(player_id,battle_id)
);
ALTER TABLE territory_private.rune_battle_snapshots_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.rune_battle_snapshots_v1 FROM PUBLIC,anon,authenticated,service_role;

-- Must be called only by a trusted server at the ACTUAL battle start.
-- Replays return the original immutable snapshot, even after a new loadout.
-- Lock ordering matches save/admin (players row first) to prevent a race.
CREATE OR REPLACE FUNCTION public.territory_runes_pin_battle_v1(
  p_player uuid,p_battle uuid,p_kind text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $runes$
DECLARE existing territory_private.rune_battle_snapshots_v1%ROWTYPE;
  saved territory_private.rune_loadouts_v1%ROWTYPE;
  choices jsonb; selected jsonb; result_slots jsonb:='[]'::jsonb;
  result jsonb; rune text; expected_slot text; rune_level integer;
  idx integer;
BEGIN
  IF p_player IS NULL OR p_battle IS NULL OR p_kind IS NULL
     OR p_kind NOT IN ('pve','arena')
  THEN RAISE EXCEPTION 'rune_battle_invalid_request'; END IF;
  PERFORM 1 FROM public.players WHERE id=p_player AND NOT coalesce(banned,false) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rune_account_unavailable'; END IF;
  SELECT * INTO existing FROM territory_private.rune_battle_snapshots_v1
    WHERE player_id=p_player AND battle_id=p_battle;
  IF FOUND THEN
    IF existing.kind IS DISTINCT FROM p_kind THEN RAISE EXCEPTION 'rune_battle_reused'; END IF;
    RETURN existing.snapshot;
  END IF;
  SELECT * INTO saved FROM territory_private.rune_loadouts_v1 WHERE player_id=p_player;
  IF FOUND THEN
    choices:=saved.slots;
  ELSE
    SELECT jsonb_agg(jsonb_build_object('slotId',slot_id,'runeId',NULL) ORDER BY slot_id)
      INTO choices FROM (SELECT DISTINCT slot_id FROM territory_private.rune_catalog_v1) s;
    saved.revision:=0;
  END IF;
  IF jsonb_typeof(choices) IS DISTINCT FROM 'array' OR jsonb_array_length(choices)<>15
  THEN RAISE EXCEPTION 'rune_battle_invalid_loadout'; END IF;
  FOR idx IN 1..15 LOOP
    expected_slot:='rune_slot_'||lpad(idx::text,2,'0');
    selected:=choices->(idx-1);
    IF jsonb_typeof(selected) IS DISTINCT FROM 'object'
       OR NOT (selected ? 'slotId' AND selected ? 'runeId')
       OR (SELECT count(*) FROM jsonb_object_keys(selected))<>2
       OR selected->>'slotId' IS DISTINCT FROM expected_slot
       OR jsonb_typeof(selected->'runeId') NOT IN ('null','string')
    THEN RAISE EXCEPTION 'rune_battle_invalid_loadout'; END IF;
    rune:=selected->>'runeId';
    rune_level:=0;
    IF rune IS NOT NULL THEN
      SELECT o.level INTO rune_level FROM territory_private.rune_catalog_v1 c
      JOIN territory_private.rune_ownership_v1 o ON o.rune_id=c.rune_id
      WHERE c.slot_id=expected_slot AND c.rune_id=rune
        AND o.player_id=p_player AND o.level BETWEEN 1 AND c.max_level;
      IF NOT FOUND THEN RAISE EXCEPTION 'rune_battle_unverified_ownership'; END IF;
    END IF;
    result_slots:=result_slots||jsonb_build_array(
      jsonb_build_object('slotId',expected_slot,'runeId',rune,'level',rune_level));
  END LOOP;
  result:=jsonb_build_object('schema','territory-rune-battle-snapshot/1',
    'battleId',p_battle,'kind',p_kind,'revision',saved.revision,'slots',result_slots);
  INSERT INTO territory_private.rune_battle_snapshots_v1(player_id,battle_id,kind,snapshot)
    VALUES(p_player,p_battle,p_kind,result);
  RETURN result;
END $runes$;
REVOKE ALL ON FUNCTION public.territory_runes_pin_battle_v1(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.territory_runes_pin_battle_v1(uuid,uuid,text) TO service_role;
COMMIT;
