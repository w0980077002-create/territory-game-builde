-- TERRITORY owner toolkit v2. Service-role-only actions, replay-safe ticket grants,
-- and rotating admin credential storage. No player wallets modified on install.
ALTER TABLE territory_private.hall_accounts_v1
  DROP CONSTRAINT IF EXISTS hall_accounts_v1_tickets_check;
ALTER TABLE territory_private.hall_accounts_v1
  ADD CONSTRAINT hall_accounts_v1_tickets_check CHECK (tickets BETWEEN 0 AND 1000);

CREATE TABLE territory_private.hall_admin_receipts_v2 (
 request_id uuid PRIMARY KEY,
 scope text NOT NULL CHECK(scope IN('one','active','all')),
 player_id uuid,
 delta integer NOT NULL CHECK(delta BETWEEN -250 AND 250 AND delta<>0),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 140),
 affected integer NOT NULL CHECK(affected>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON territory_private.hall_admin_receipts_v2 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_hall_admin_adjust_v2(
 p_request uuid,p_scope text,p_player uuid,p_delta int,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_done territory_private.hall_admin_receipts_v2%ROWTYPE;
 v_count int; v_target int; v_balance int; v_note text:=trim(p_reason);
BEGIN
 IF p_request IS NULL OR p_scope NOT IN('one','active','all') OR
  p_delta IS NULL OR p_delta=0 OR abs(p_delta)>250 OR
  v_note IS NULL OR length(v_note) NOT BETWEEN 3 AND 140 OR
  (p_scope='one' AND p_player IS NULL) OR
  (p_scope<>'one' AND p_player IS NOT NULL)
 THEN RAISE EXCEPTION 'admin_bad_ticket_grant'; END IF;
 SELECT * INTO v_done FROM territory_private.hall_admin_receipts_v2
 WHERE request_id=p_request;
 IF FOUND THEN
  IF v_done.scope<>p_scope OR v_done.player_id IS DISTINCT FROM p_player OR
   v_done.delta<>p_delta OR v_done.reason<>v_note
  THEN RAISE EXCEPTION 'admin_request_conflict'; END IF;
  RETURN jsonb_build_object('affected',v_done.affected,'replayed',true);
 END IF;
 -- Serialize the administrative receipts, preventing concurrent requests with
 -- the same key from spending the same authorized grant twice.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,347));
 SELECT * INTO v_done FROM territory_private.hall_admin_receipts_v2
 WHERE request_id=p_request;
 IF FOUND THEN
  IF v_done.scope<>p_scope OR v_done.player_id IS DISTINCT FROM p_player OR
   v_done.delta<>p_delta OR v_done.reason<>v_note
  THEN RAISE EXCEPTION 'admin_request_conflict'; END IF;
  RETURN jsonb_build_object('affected',v_done.affected,'replayed',true);
 END IF;
 IF p_scope='one' AND NOT EXISTS(SELECT 1 FROM public.players WHERE id=p_player)
 THEN RAISE EXCEPTION 'admin_player_missing'; END IF;
 IF p_scope='one' THEN
  INSERT INTO territory_private.hall_accounts_v1(player_id,tickets)
  SELECT id,greatest(0,least(1000,4+p_delta)) FROM public.players WHERE id=p_player
  ON CONFLICT(player_id) DO UPDATE
    SET tickets=greatest(0,least(1000,territory_private.hall_accounts_v1.tickets+p_delta));
  GET DIAGNOSTICS v_count=ROW_COUNT;
  SELECT tickets INTO v_balance FROM territory_private.hall_accounts_v1 WHERE player_id=p_player;
 ELSE
  INSERT INTO territory_private.hall_accounts_v1(player_id,tickets)
  SELECT id,greatest(0,least(1000,4+p_delta)) FROM public.players
  WHERE NOT banned AND (p_scope='all' OR last_seen_at>=clock_timestamp()-interval '7 days')
  ON CONFLICT(player_id) DO UPDATE
    SET tickets=greatest(0,least(1000,territory_private.hall_accounts_v1.tickets+p_delta));
  GET DIAGNOSTICS v_count=ROW_COUNT;
 END IF;
 INSERT INTO territory_private.hall_admin_receipts_v2(request_id,scope,player_id,delta,reason,affected)
 VALUES(p_request,p_scope,p_player,p_delta,v_note,v_count);
 RETURN jsonb_build_object('affected',v_count,'balance',v_balance,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.territory_hall_admin_adjust_v2(uuid,text,uuid,int,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_hall_admin_adjust_v2(uuid,text,uuid,int,text) TO service_role;

-- The hash is deliberately NOT stored in the repository or client bundle.
-- A one-time production initialization seeds a verifier for the current password.
-- Owner can rotate it from the admin panel; rotation invalidates old tokens.
CREATE TABLE territory_private.admin_auth_v2 (
 id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
 salt text NOT NULL CHECK(salt ~ '^[0-9a-f]{32}$'),
 verifier text NOT NULL CHECK(verifier ~ '^[0-9a-f]{64}$'),
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483647),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON territory_private.admin_auth_v2 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.territory_admin_credential_v2()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
 SELECT jsonb_build_object('salt',salt,'verifier',verifier,'version',version)
 FROM territory_private.admin_auth_v2 WHERE id=1
$$;
REVOKE ALL ON FUNCTION public.territory_admin_credential_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_credential_v2() TO service_role;

CREATE OR REPLACE FUNCTION public.territory_admin_rotate_v2(
 p_salt text,p_verifier text,p_expected_version integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE v_version integer;
BEGIN
 IF p_salt !~ '^[0-9a-f]{32}$' OR p_verifier !~ '^[0-9a-f]{64}$'
  OR p_expected_version IS NULL THEN RAISE EXCEPTION 'admin_invalid_password_hash'; END IF;
 UPDATE territory_private.admin_auth_v2
 SET salt=p_salt,verifier=p_verifier,version=version+1,updated_at=clock_timestamp()
 WHERE id=1 AND version=p_expected_version RETURNING version INTO v_version;
 IF v_version IS NULL THEN RAISE EXCEPTION 'admin_auth_conflict'; END IF;
 RETURN v_version;
END $$;
REVOKE ALL ON FUNCTION public.territory_admin_rotate_v2(text,text,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_admin_rotate_v2(text,text,integer) TO service_role;


-- Private reporting published ONLY to service role.
CREATE OR REPLACE FUNCTION public.territory_hall_admin_overview_v2()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
 SELECT jsonb_build_object(
  'wallets',(SELECT count(*) FROM territory_private.hall_accounts_v1),
  'tickets',(SELECT coalesce(sum(tickets),0) FROM territory_private.hall_accounts_v1),
  'games',(SELECT coalesce(sum(played),0) FROM territory_private.hall_accounts_v1),
  'wins',(SELECT coalesce(sum(wins),0) FROM territory_private.hall_accounts_v1),
  'pendingGold',(SELECT coalesce(sum(pending_gold),0) FROM territory_private.hall_accounts_v1),
  'activeSessions',(SELECT count(*) FROM territory_private.hall_sessions_v1),
  'recent',(SELECT coalesce(jsonb_agg(jsonb_build_object(
     'name',coalesce(p.display_name,'Герой'),
     'game',h.game,'won',h.won,'gold',h.earned_gold,'at',h.played_at
   ) ORDER BY h.played_at DESC),'[]'::jsonb)
   FROM (SELECT player_id,game,won,earned_gold,played_at
     FROM territory_private.hall_history_v1 ORDER BY played_at DESC LIMIT 20) h
   LEFT JOIN public.players p ON p.id=h.player_id)
 )
$$;
REVOKE ALL ON FUNCTION public.territory_hall_admin_overview_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_hall_admin_overview_v2() TO service_role;

CREATE OR REPLACE FUNCTION public.territory_hall_admin_player_v2(p_player uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $$
DECLARE a territory_private.hall_accounts_v1%ROWTYPE;
 v_game text; v_since timestamptz;
BEGIN
 IF p_player IS NULL OR NOT EXISTS(SELECT 1 FROM public.players WHERE id=p_player)
 THEN RAISE EXCEPTION 'admin_player_missing'; END IF;
 SELECT * INTO a FROM territory_private.hall_accounts_v1 WHERE player_id=p_player;
 SELECT game,created_at INTO v_game,v_since FROM territory_private.hall_sessions_v1 WHERE player_id=p_player;
 RETURN jsonb_build_object('tickets',coalesce(a.tickets,4),
   'played',coalesce(a.played,0),'wins',coalesce(a.wins,0),
   'points',coalesce(a.points,0),'pendingGold',coalesce(a.pending_gold,0),
   'claimedGold',coalesce(a.claimed_gold,0),
   'activeGame',v_game,'activeSince',v_since);
END $$;
REVOKE ALL ON FUNCTION public.territory_hall_admin_player_v2(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.territory_hall_admin_player_v2(uuid) TO service_role;
