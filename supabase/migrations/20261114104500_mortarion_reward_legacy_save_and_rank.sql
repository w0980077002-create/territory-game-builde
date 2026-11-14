-- Mortarion 2026: legacy save compatibility and accurate final chest preview.
-- No player rows, wallets, raid HP, participation, or receipts are changed here.
-- Changes only existing SQL function definitions; one-time rewards remain atomic.
BEGIN;
SET LOCAL lock_timeout = '4s';

DO $patch_claim$
DECLARE
  src text;
  needle text := ' OR (v_state->>''forgeMaterials'')::integer IS DISTINCT FROM v_player.forge_materials';
  replacement text := E' OR ((v_state ? ''forgeMaterials'')\n     AND (v_state->>''forgeMaterials'')::integer IS DISTINCT FROM v_player.forge_materials)';
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.territory_mortarion_reward_claim_v1(timestamptz)'::regprocedure
  ) INTO src;
  IF (length(src) - length(replace(src, needle, ''))) <> length(needle)
  THEN RAISE EXCEPTION 'mortarion_claim_legacy_anchor_mismatch'; END IF;
  -- Only allow an ABSENT legacy field. If it exists, it must equal the canonical
  -- server wallet. Credit uses players.forge_materials and writes it into
  -- game_state atomically with the reward; never mint from a client snapshot.
  EXECUTE replace(src, needle, replacement);
END;
$patch_claim$;

DO $patch_status$
DECLARE
  src text;
  declaration_needle text := ' v_tier text:=''participant'';';
  declaration_replacement text := E' v_tier text:=''participant'';\n v_rank integer:=NULL;';
  tier_needle text := E' IF v_days>=v_needed AND v_hits>=15 THEN v_tier:=''legendary'';\n ELSIF v_days>=LEAST(3,v_needed) THEN v_tier:=''hunter''; END IF;';
  tier_replacement text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.territory_mortarion_reward_status_v1()'::regprocedure
  ) INTO src;
  IF (length(src) - length(replace(src, declaration_needle, ''))) <> length(declaration_needle)
    OR (length(src) - length(replace(src, tier_needle, ''))) <> length(tier_needle)
  THEN RAISE EXCEPTION 'mortarion_status_rank_anchor_mismatch'; END IF;
  tier_replacement := tier_needle || E'\n' || $rank$
 -- After the raid, the TOP-1 / TOP-2-3 chest preview must match the actual claim.
 -- During an active raid, keep the purely participation-based preview.
 IF v_closed AND v_hits>0 THEN
   SELECT z.rank INTO v_rank FROM (
     SELECT s.player_id,pg_catalog.row_number() OVER (
       ORDER BY s.total_damage DESC,s.last_hit_at ASC NULLS LAST,s.player_id
     )::integer AS rank
     FROM public.territory_mortarion_2026_players s
     JOIN public.players p ON p.id=s.player_id
     WHERE s.event_id=v_event.id AND s.total_damage>0
       AND NOT COALESCE(p.banned,false)
   ) z WHERE z.player_id=v_uid;
   IF v_rank=1 THEN v_tier:='legendary';
   ELSIF v_rank BETWEEN 2 AND 3 AND v_tier='participant'
   THEN v_tier:='hunter'; END IF;
 END IF;
$rank$;
  src := replace(src, declaration_needle, declaration_replacement);
  EXECUTE replace(src, tier_needle, tier_replacement);
END;
$patch_status$;
COMMIT;
