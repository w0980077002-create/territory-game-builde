#!/usr/bin/env bash
set -euo pipefail
# DISPOSABLE PostgreSQL 17 only: event is after deadline and 20 bonus receipts exist.
db=halloween-after
docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_bonus <<'SQL'
ALTER TABLE public.players ADD COLUMN gems integer NOT NULL DEFAULT 0;
ALTER TABLE public.players ADD COLUMN forge_materials integer NOT NULL DEFAULT 0;
ALTER TABLE public.players ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
-- Keep original cow unchanged; create valid saved states for one winner / one nonwinner.
UPDATE public.players SET game_state=jsonb_build_object(
  'player',jsonb_build_object('gold',200,'gems',0,'redGems',0,'equipped','{}'::jsonb),
  'inventory','[]'::jsonb,'battleStones',3,'forgeMaterials',0,
  'forgeMaterialBatches','[]'::jsonb,'followers',game_state->'followers')
WHERE id IN ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000021');
SQL
docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_bonus < supabase/staged/20261026_admin_claim_atomic_v2.sql
docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_bonus < supabase/staged/halloween_top20_helmet_claim_2026.sql
# Patch must be repeatable and must not restore an old function.
docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_bonus < supabase/staged/halloween_top20_helmet_claim_2026.sql
docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d halloween_bonus <<'SQL'
DO $$ BEGIN
 IF EXISTS (
   SELECT 1 FROM territory_private.halloween_top20_bonus_2026
   WHERE payload#>>'{items,halloween_horned_pumpkin_2026}' IS DISTINCT FROM '1'
 ) THEN RAISE EXCEPTION 'helmet missing from one or more award mails'; END IF;
 IF (SELECT payload->>'gold' FROM territory_private.halloween_top20_bonus_2026 WHERE place=4)
    IS DISTINCT FROM (SELECT payload->>'gold' FROM territory_private.halloween_top20_bonus_2026 WHERE place=20)
 OR (SELECT payload->>'gems' FROM territory_private.halloween_top20_bonus_2026 WHERE place=4)
    IS DISTINCT FROM (SELECT payload->>'gems' FROM territory_private.halloween_top20_bonus_2026 WHERE place=20)
 OR (SELECT payload->>'stones' FROM territory_private.halloween_top20_bonus_2026 WHERE place=4)
    IS DISTINCT FROM (SELECT payload->>'stones' FROM territory_private.halloween_top20_bonus_2026 WHERE place=20)
 THEN RAISE EXCEPTION 'tier 4-20 differs'; END IF;
END $$;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000004',false);
DO $$ DECLARE
  mail uuid; receipt jsonb; s jsonb; gear jsonb;
BEGIN
 SELECT mail_id INTO mail FROM territory_private.halloween_top20_bonus_2026 WHERE place=4;
 receipt:=public.territory_admin_claim_grant_v2(mail);
 IF receipt->>'success' <> 'true' OR receipt->>'replayed' <> 'false'
 THEN RAISE EXCEPTION 'authorized helmet claim failed: %',receipt; END IF;
 SELECT game_state INTO s FROM public.players WHERE id=auth.uid();
 IF jsonb_array_length(s->'inventory')<>1
 OR s#>>'{inventory,0,equipment,id}' IS DISTINCT FROM 'halloween_horned_pumpkin_2026'
 OR s#>>'{inventory,0,equipment,slot}' IS DISTINCT FROM 'helmet'
 OR s#>>'{inventory,0,equipment,rarity}' IS DISTINCT FROM 'rare'
 OR s#>>'{inventory,0,equipment,defense}' IS DISTINCT FROM '6'
 OR s#>>'{inventory,0,equipment,hp}' IS DISTINCT FROM '40'
 OR s#>>'{inventory,0,equipment,critChance}' IS DISTINCT FROM '1'
 OR s#>>'{followers,0,id}' IS DISTINCT FROM 'follower_6'
 THEN RAISE EXCEPTION 'helmet stats or existing companion invalid: %',s; END IF;
 receipt:=public.territory_admin_claim_grant_v2(mail);
 IF receipt->>'replayed' <> 'true' THEN RAISE EXCEPTION 'mail replay not guarded'; END IF;
 SELECT game_state INTO s FROM public.players WHERE id=auth.uid();
 IF jsonb_array_length(s->'inventory')<>1
 THEN RAISE EXCEPTION 'duplicate helmet from mail replay'; END IF;
END $$;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000021',false);
INSERT INTO public.admin_grants(player_id,kind,subject,body,payload)
VALUES ('00000000-0000-0000-0000-000000000021','mail','spoof','spoof',
  '{"items":{"halloween_horned_pumpkin_2026":1}}'::jsonb);
DO $$ DECLARE mail uuid; s jsonb; BEGIN
 SELECT id INTO mail FROM public.admin_grants
 WHERE player_id=auth.uid() AND subject='spoof';
 BEGIN
   PERFORM public.territory_admin_claim_grant_v2(mail);
   RAISE EXCEPTION 'nonwinner claimed Halloween helmet';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'halloween_pumpkin_mail_not_entitled' THEN RAISE; END IF;
 END;
 SELECT game_state INTO s FROM public.players WHERE id=auth.uid();
 IF jsonb_array_length(s->'inventory')<>0
 OR EXISTS (SELECT 1 FROM public.admin_grants WHERE id=mail AND claimed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'spoof claim changed a player'; END IF;
END $$;
RESET test.uid;
SQL
echo "Halloween top20 horned helmet atomic authenticated claim and replay: PASS"
