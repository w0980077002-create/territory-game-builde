-- STAGED ONLY. Do not apply to the live database before owner-approved migration.
-- Ordinary client PvE: combat, movement, damage and boss all stay on the phone.
-- This bridge stores only account progress, a Dark Stone debit and an idempotent run receipt.
-- Client victory is NOT proof of an honest fight. No gold, XP, VIP, red gems or account loot.
-- Prerequisites, already present on the working TERRITORY database:
-- territory_private.adventure_progress_v1, territory_private.dark_stones_v1,
-- territory_private.dark_stone_touch_v1(uuid), territory_private.dark_stone_take_v1(uuid),
-- territory_private.combat_sessions_v1, public.players, auth.uid().

CREATE TABLE IF NOT EXISTS territory_private.cave_client_runs_v1 (
  run_id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.players(id),
  floor integer NOT NULL CHECK (floor BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','won','lost')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  CHECK ((status='active' AND finished_at IS NULL) OR (status<>'active' AND finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cave_client_one_active_v1
  ON territory_private.cave_client_runs_v1(player_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS cave_client_player_runs_v1
  ON territory_private.cave_client_runs_v1(player_id,created_at DESC);
ALTER TABLE territory_private.cave_client_runs_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON territory_private.cave_client_runs_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON territory_private.cave_client_runs_v1 TO service_role;

-- The account is always taken from the authenticated JWT, never from a request parameter.
CREATE OR REPLACE FUNCTION public.territory_cave_pve_status_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); finished integer; opened integer; stones integer;
  r_id uuid; r_floor integer; legacy_id uuid;
BEGIN
  IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT coalesce(banned,false))
    THEN RAISE EXCEPTION 'cave_account_unavailable'; END IF;
  stones:=territory_private.dark_stone_touch_v1(u);
  SELECT completed_stage,unlocked_stage INTO finished,opened
    FROM territory_private.adventure_progress_v1 WHERE player_id=u;
  SELECT run_id,floor INTO r_id,r_floor FROM territory_private.cave_client_runs_v1
    WHERE player_id=u AND status='active';
  SELECT session_id INTO legacy_id FROM territory_private.combat_sessions_v1
    WHERE player_id=u AND encounter_id LIKE 'adventure_v1_stage_%'
      AND state->>'status'='fighting'
    ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('completed_stage',coalesce(finished,0),
    'unlocked_stage',coalesce(opened,1),'dark_stones',stones,
    'active_run_id',r_id,'active_floor',r_floor,'legacy_active_session_id',legacy_id);
END $$;

-- Transactional, idempotent entrance. Exactly one Dark Stone charge per run UUID.
CREATE OR REPLACE FUNCTION public.territory_cave_pve_start_v1(p_run_id uuid,p_floor integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); done integer; opened integer; stones integer;
  existing territory_private.cave_client_runs_v1%ROWTYPE;
BEGIN
  IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT coalesce(banned,false))
    THEN RAISE EXCEPTION 'cave_account_unavailable'; END IF;
  IF p_run_id IS NULL OR p_floor NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'cave_invalid_run'; END IF;
  -- Same lock order as other wallet operations: account -> progress -> stones.
  PERFORM 1 FROM public.players WHERE id=u FOR UPDATE;
  SELECT * INTO existing FROM territory_private.cave_client_runs_v1
    WHERE run_id=p_run_id FOR UPDATE;
  IF FOUND THEN
    IF existing.player_id<>u OR existing.floor<>p_floor THEN RAISE EXCEPTION 'cave_run_owner_or_floor_mismatch'; END IF;
    SELECT completed_stage,unlocked_stage INTO done,opened
      FROM territory_private.adventure_progress_v1 WHERE player_id=u;
    stones:=territory_private.dark_stone_touch_v1(u);
    RETURN jsonb_build_object('completed_stage',coalesce(done,0),'unlocked_stage',coalesce(opened,1),
      'dark_stones',stones,'active_run_id',CASE WHEN existing.status='active' THEN existing.run_id ELSE NULL END,
      'active_floor',CASE WHEN existing.status='active' THEN existing.floor ELSE NULL END,
      'run_status',existing.status,'legacy_active_session_id',NULL);
  END IF;
  INSERT INTO territory_private.adventure_progress_v1(player_id)
    VALUES(u) ON CONFLICT DO NOTHING;
  SELECT completed_stage,unlocked_stage INTO done,opened
    FROM territory_private.adventure_progress_v1 WHERE player_id=u FOR UPDATE;
  IF p_floor<>opened OR done>=100 THEN RAISE EXCEPTION 'cave_floor_locked'; END IF;
  IF EXISTS(SELECT 1 FROM territory_private.cave_client_runs_v1
    WHERE player_id=u AND status='active') THEN RAISE EXCEPTION 'cave_run_in_progress'; END IF;
  IF EXISTS(SELECT 1 FROM territory_private.combat_sessions_v1
    WHERE player_id=u AND encounter_id LIKE 'adventure_v1_stage_%'
      AND state->>'status'='fighting') THEN RAISE EXCEPTION 'cave_legacy_recovery_required'; END IF;
  stones:=territory_private.dark_stone_take_v1(u);
  INSERT INTO territory_private.cave_client_runs_v1(run_id,player_id,floor)
    VALUES(p_run_id,u,p_floor);
  RETURN jsonb_build_object('completed_stage',done,'unlocked_stage',opened,'dark_stones',stones,
    'active_run_id',p_run_id,'active_floor',p_floor,'run_status','active',
    'legacy_active_session_id',NULL);
END $$;

-- One final report per run. Nothing about combat is simulated in PostgreSQL.
-- Losing refunds the entrance stone, consistent with the existing Cave test rule.
CREATE OR REPLACE FUNCTION public.territory_cave_pve_finish_v1(p_run_id uuid,p_won boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); r territory_private.cave_client_runs_v1%ROWTYPE;
  done integer; opened integer; stones integer;
BEGIN
  IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=u AND NOT coalesce(banned,false))
    THEN RAISE EXCEPTION 'cave_account_unavailable'; END IF;
  IF p_run_id IS NULL OR p_won IS NULL THEN RAISE EXCEPTION 'cave_invalid_finish'; END IF;
  PERFORM 1 FROM public.players WHERE id=u FOR UPDATE;
  SELECT * INTO r FROM territory_private.cave_client_runs_v1
    WHERE run_id=p_run_id AND player_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cave_run_not_found'; END IF;
  INSERT INTO territory_private.adventure_progress_v1(player_id)
    VALUES(u) ON CONFLICT DO NOTHING;
  SELECT completed_stage,unlocked_stage INTO done,opened
    FROM territory_private.adventure_progress_v1 WHERE player_id=u FOR UPDATE;
  IF r.status='active' THEN
    IF p_won THEN
      IF r.floor<>opened OR done>=r.floor THEN RAISE EXCEPTION 'cave_run_stage_conflict'; END IF;
      UPDATE territory_private.adventure_progress_v1
        SET completed_stage=r.floor,unlocked_stage=least(100,r.floor+1) WHERE player_id=u;
      done:=r.floor; opened:=least(100,r.floor+1);
    ELSE
      UPDATE territory_private.dark_stones_v1 SET balance=balance+1
        WHERE player_id=u AND balance<2147483647;
      IF NOT FOUND THEN RAISE EXCEPTION 'cave_stone_refund_failed'; END IF;
    END IF;
    UPDATE territory_private.cave_client_runs_v1
      SET status=CASE WHEN p_won THEN 'won' ELSE 'lost' END,
        finished_at=clock_timestamp()
      WHERE run_id=p_run_id;
    r.status:=CASE WHEN p_won THEN 'won' ELSE 'lost' END;
  END IF;
  stones:=territory_private.dark_stone_touch_v1(u);
  RETURN jsonb_build_object('completed_stage',done,'unlocked_stage',opened,'dark_stones',stones,
    'active_run_id',NULL,'active_floor',NULL,'run_status',r.status,
    'legacy_active_session_id',NULL);
END $$;
REVOKE ALL ON FUNCTION public.territory_cave_pve_status_v1(),
  public.territory_cave_pve_start_v1(uuid,integer),
  public.territory_cave_pve_finish_v1(uuid,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_cave_pve_status_v1(),
  public.territory_cave_pve_start_v1(uuid,integer),
  public.territory_cave_pve_finish_v1(uuid,boolean)
  TO authenticated;
