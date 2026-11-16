-- #366: READ ONLY, NO IDENTIFIERS IN OUTPUT. Staged provenance diagnostic, not activation.
WITH registry AS (
 SELECT i.item_id,i.player_id,(i.item_output#>>'{equipment,level}')::int AS base,i.item_output#>>'{equipment,slot}' AS slot
 FROM public.territory_profession_stage8_items i WHERE i.item_output->>'type'='equipment'
), mirrors AS (
 SELECT r.*, 'bag'::text AS location,x.value->'equipment' AS eq
 FROM registry r JOIN public.players p ON p.id=r.player_id
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.game_state->'inventory')='array' THEN p.game_state->'inventory' ELSE '[]'::jsonb END) x(value)
 WHERE x.value->>'id'='stage8_'||r.item_id::text
 UNION ALL
 SELECT r.*,'equipped',e.value FROM registry r JOIN public.players p ON p.id=r.player_id
 CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(p.game_state#>'{player,equipped}')='object' THEN p.game_state#>'{player,equipped}' ELSE '{}'::jsonb END) e(slot,value)
 WHERE e.value->>'id'='stage8_'||r.item_id::text
), disputed AS (
 SELECT m.*,(m.eq->>'level')::int AS saved FROM mirrors m
 WHERE m.eq->>'level' ~ '^[0-9]{1,3}$' AND (m.eq->>'level')::int>m.base
), evidence AS (
 SELECT d.*,EXISTS (
 SELECT 1 FROM public.admin_grants g JOIN territory_private.owner_test_gear_v1 t
 ON t.player_id=d.player_id AND t.equipment_id='stage8_'||d.item_id::text AND t.slot=d.slot AND t.target_level=d.saved
 WHERE g.player_id=d.player_id AND g.kind='adjust' AND g.claimed_at IS NOT NULL
 AND g.payload->>'adminTestGearId'='stage8_'||d.item_id::text
 AND g.payload->'adminTestLevel'='true'::jsonb
 AND g.payload#>>ARRAY['equipLevels',d.slot]=d.saved::text
 AND g.payload->'adminTestEquipment'=d.eq
 ) AS exact_admin FROM disputed d
)
SELECT base AS registry_level,saved AS saved_level,slot,location,eq->>'upgradeCount' AS upgrades,
 exact_admin,CASE WHEN exact_admin THEN 'EXACT_ADMIN_APPROVED' ELSE 'HOLD_NO_AUTOMATIC_REWRITE' END AS evidence,
 COUNT(*)::int AS copies FROM evidence
GROUP BY base,saved,slot,location,eq->>'upgradeCount',exact_admin ORDER BY base,slot,location;