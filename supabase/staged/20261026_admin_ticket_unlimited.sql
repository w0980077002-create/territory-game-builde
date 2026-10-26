-- TERRITORY 1.0: owner-authorized ticket grants have no gameplay cap.
-- STAGED ONLY. Apply to production after infrastructure review; no balances
-- or receipts are deleted or modified by this installation.
-- Player-earned tickets retain their existing independent reward restrictions.

BEGIN;

ALTER TABLE territory_private.hall_accounts_v1
  DROP CONSTRAINT hall_accounts_v1_tickets_check;
ALTER TABLE territory_private.hall_accounts_v1
  ADD CONSTRAINT hall_accounts_v1_tickets_check CHECK (tickets >= 0);

ALTER TABLE territory_private.hall_admin_receipts_v2
  DROP CONSTRAINT hall_admin_receipts_v2_delta_check;
ALTER TABLE territory_private.hall_admin_receipts_v2
  ADD CONSTRAINT hall_admin_receipts_v2_delta_check
    CHECK (delta BETWEEN -2147483647 AND 2147483647 AND delta <> 0);

-- The wallet is PostgreSQL integer: overflow must abort the WHOLE grant,
-- never silently give fewer tickets than the administrator requested.
CREATE OR REPLACE FUNCTION territory_private.hall_admin_checked_tickets_v3(
  p_current integer, p_delta integer)
RETURNS integer LANGUAGE plpgsql SET search_path='pg_catalog'
AS $function$
DECLARE v_next bigint;
BEGIN
  v_next := GREATEST(0::bigint, p_current::bigint + p_delta::bigint);
  IF v_next > 2147483647 THEN RAISE EXCEPTION 'admin_ticket_wallet_overflow'; END IF;
  RETURN v_next::integer;
END $function$;
REVOKE ALL ON FUNCTION territory_private.hall_admin_checked_tickets_v3(integer,integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.territory_hall_admin_adjust_v2(
  p_request uuid,p_scope text,p_player uuid,p_delta int,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $function$
DECLARE
  v_done territory_private.hall_admin_receipts_v2%ROWTYPE;
  v_count int;
  v_balance int;
  v_note text:=trim(p_reason);
BEGIN
  IF p_request IS NULL OR p_scope NOT IN('one','active','all') OR
    p_delta IS NULL OR p_delta=0 OR p_delta < -2147483647 OR
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
    IF p_scope='one' THEN
      SELECT tickets INTO v_balance FROM territory_private.hall_accounts_v1
        WHERE player_id=p_player;
    END IF;
    RETURN jsonb_build_object('affected',v_done.affected,'balance',v_balance,'replayed',true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,347));
  SELECT * INTO v_done FROM territory_private.hall_admin_receipts_v2
    WHERE request_id=p_request;
  IF FOUND THEN
    IF v_done.scope<>p_scope OR v_done.player_id IS DISTINCT FROM p_player OR
      v_done.delta<>p_delta OR v_done.reason<>v_note
    THEN RAISE EXCEPTION 'admin_request_conflict'; END IF;
    IF p_scope='one' THEN
      SELECT tickets INTO v_balance FROM territory_private.hall_accounts_v1
        WHERE player_id=p_player;
    END IF;
    RETURN jsonb_build_object('affected',v_done.affected,'balance',v_balance,'replayed',true);
  END IF;

  IF p_scope='one' AND NOT EXISTS(SELECT 1 FROM public.players WHERE id=p_player)
  THEN RAISE EXCEPTION 'admin_player_missing'; END IF;

  IF p_scope='one' THEN
    INSERT INTO territory_private.hall_accounts_v1(player_id,tickets)
    SELECT id,territory_private.hall_admin_checked_tickets_v3(4,p_delta)
      FROM public.players WHERE id=p_player
    ON CONFLICT(player_id) DO UPDATE
      SET tickets=territory_private.hall_admin_checked_tickets_v3(
        territory_private.hall_accounts_v1.tickets,p_delta);
    GET DIAGNOSTICS v_count=ROW_COUNT;
    SELECT tickets INTO v_balance FROM territory_private.hall_accounts_v1
      WHERE player_id=p_player;
  ELSE
    INSERT INTO territory_private.hall_accounts_v1(player_id,tickets)
    SELECT id,territory_private.hall_admin_checked_tickets_v3(4,p_delta)
      FROM public.players
    WHERE NOT banned AND
      (p_scope='all' OR last_seen_at>=clock_timestamp()-interval '7 days')
    ON CONFLICT(player_id) DO UPDATE
      SET tickets=territory_private.hall_admin_checked_tickets_v3(
        territory_private.hall_accounts_v1.tickets,p_delta);
    GET DIAGNOSTICS v_count=ROW_COUNT;
  END IF;

  INSERT INTO territory_private.hall_admin_receipts_v2(
    request_id,scope,player_id,delta,reason,affected)
  VALUES(p_request,p_scope,p_player,p_delta,v_note,v_count);
  RETURN jsonb_build_object('affected',v_count,'balance',v_balance,'replayed',false);
END $function$;

REVOKE ALL ON FUNCTION public.territory_hall_admin_adjust_v2(uuid,text,uuid,int,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_hall_admin_adjust_v2(uuid,text,uuid,int,text)
  TO service_role;

-- Monopoly quests/offers/milestones used to assume that every hall wallet
-- must stay <=1000. Once the owner grants more tickets, that old check would
-- prevent the player from claiming ordinary Monopoly prizes. Change only
-- the storage-overflow guard; do NOT increase normal earn rates or bypass
-- the existing per-quest eligibility/frequency restrictions.
DO $owner_ticket_monopoly$
DECLARE
  v_source text;
  v_old constant text := $old$IF a.tickets+v_reward>1000 THEN RAISE EXCEPTION 'hall_ticket_wallet_full'; END IF;$old$;
  v_new constant text := $new$IF a.tickets::bigint+v_reward::bigint>2147483647 THEN RAISE EXCEPTION 'hall_ticket_wallet_full'; END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.territory_monopoly_v2(text,integer,uuid)'::regprocedure)
    INTO v_source;
  IF position(v_new IN v_source)>0 THEN RETURN; END IF;
  IF position(v_old IN v_source)=0 THEN
    RAISE EXCEPTION 'monopoly_ticket_guard_unexpected_definition';
  END IF;
  EXECUTE replace(v_source,v_old,v_new);
END $owner_ticket_monopoly$;

COMMIT;
