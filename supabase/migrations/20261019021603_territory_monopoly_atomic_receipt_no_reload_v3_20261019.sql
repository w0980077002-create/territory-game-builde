-- Grant an atomic versioned claim receipt without changing rewards.
-- Preserve every existing launch gate, RLS rule and authenticated permission.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE original text; changed text; before_update text; before_receipt text;
BEGIN
 IF to_regprocedure('public.territory_monopoly_claim_v2(timestamptz,jsonb)') IS NULL
 THEN RAISE EXCEPTION 'monopoly_claim_not_installed'; END IF;
 IF NOT (SELECT p.prosecdef AND 'search_path=pg_catalog'=ANY(coalesce(p.proconfig, ARRAY[]::text[]))
   FROM pg_proc p WHERE p.oid='public.territory_monopoly_claim_v2(timestamptz,jsonb)'::regprocedure)
 THEN RAISE EXCEPTION 'monopoly_claim_security_changed'; END IF;
 original:=pg_get_functiondef('public.territory_monopoly_claim_v2(timestamptz,jsonb)'::regprocedure);
 before_update:='updated_at=greatest(clock_timestamp(),p.updated_at+interval ''1 microsecond'') WHERE id=u;';
 before_receipt:='RETURN jsonb_build_object(''success'',true,''awards'',prize);';
 IF strpos(original,before_update)=0 OR strpos(original,before_receipt)=0
 THEN RAISE EXCEPTION 'monopoly_claim_unreviewed_body'; END IF;
 changed:=replace(original,before_update,
  'updated_at=greatest(clock_timestamp(),p.updated_at+interval ''1 microsecond'') WHERE id=u RETURNING * INTO p;');
 changed:=replace(changed,before_receipt,
  'RETURN jsonb_build_object(''success'',true,''awards'',prize,''updated_at'',p.updated_at,''game_state'',p.game_state,''wallet_gold'',p.gold,''wallet_gems'',p.gems);');
 IF changed=original THEN RAISE EXCEPTION 'monopoly_claim_receipt_patch_failed'; END IF;
 EXECUTE changed;
END $patch$;
COMMIT;
