-- One shared midnight boundary for existing server-side daily quotas.
-- No player rows are reset; only the date calculations in verified RPCs change.
DO $unified$
DECLARE
 sig text; oid_value oid; old_code text; next_code text;
 old_term text := 'AT TIME ZONE ' || quote_literal('UTC');
 new_term text := 'AT TIME ZONE ' || quote_literal('Europe/Kyiv');
BEGIN
 FOREACH sig IN ARRAY ARRAY[
  'public.territory_hall_daily_v1()',
  'public.territory_hall_status_v1()',
  'public.territory_hall_finish_v1(uuid,integer)',
  'public.territory_monopoly_v2(text,integer,uuid)',
  'public.territory_inventory_recycle_v1(text,text,timestamp with time zone)',
  'public.territory_referral_claim_v1(timestamp with time zone)'
 ] LOOP
  oid_value := to_regprocedure(sig);
  IF oid_value IS NULL THEN RAISE EXCEPTION 'Required daily quota function missing: %', sig; END IF;
  old_code := pg_get_functiondef(oid_value);
  IF position(old_term IN old_code) = 0 THEN
   RAISE EXCEPTION 'Unexpected daily quota function body: %', sig;
  END IF;
  next_code := replace(old_code, old_term, new_term);
  EXECUTE next_code;
 END LOOP;
 oid_value := to_regprocedure('public.territory_daily_share_v1(text,text,timestamp with time zone)');
 IF oid_value IS NULL THEN RAISE EXCEPTION 'Required daily share function missing'; END IF;
 old_code := pg_get_functiondef(oid_value);
 IF (length(old_code) - length(replace(old_code,'24 hours',''))) / 8 <> 4 THEN
  RAISE EXCEPTION 'Unexpected share cooldown body; migration stopped';
 END IF;
 next_code := old_code;
 next_code := replace(next_code,
  'cl.claimed_at+interval ' || quote_literal('24 hours'),
  '((date_trunc(' || quote_literal('day') || ',cl.claimed_at AT TIME ZONE ' || quote_literal('Europe/Kyiv') || ')+interval ' || quote_literal('1 day') || ') AT TIME ZONE ' || quote_literal('Europe/Kyiv') || ')');
 next_code := replace(next_code,
  'v_previous+interval ' || quote_literal('24 hours'),
  '((date_trunc(' || quote_literal('day') || ',v_previous AT TIME ZONE ' || quote_literal('Europe/Kyiv') || ')+interval ' || quote_literal('1 day') || ') AT TIME ZONE ' || quote_literal('Europe/Kyiv') || ')');
 next_code := replace(next_code,
  'v_claimed+interval ' || quote_literal('24 hours'),
  '((date_trunc(' || quote_literal('day') || ',v_claimed AT TIME ZONE ' || quote_literal('Europe/Kyiv') || ')+interval ' || quote_literal('1 day') || ') AT TIME ZONE ' || quote_literal('Europe/Kyiv') || ')');
 IF position('24 hours' IN next_code)>0 THEN RAISE EXCEPTION 'Could not convert all share boundaries'; END IF;
 EXECUTE next_code;
END
$unified$;