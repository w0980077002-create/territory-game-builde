-- Read-only preflight for TERRITORY #366. DO NOT MODIFY player rows.
-- Inspect only grouped counts, never print player IDs or item UUIDs.
-- Before enabling a Stage8 owner-verified save guard, all registered gear
-- must be matched with saved bag or equipped gear and any divergent levels
-- reviewed with trusted receipts rather than replaced automatically.
WITH registry AS (
  SELECT i.item_id, i.player_id,
    (i.item_output#>>'{equipment,level}')::integer AS registry_level
  FROM public.territory_profession_stage8_items i
  WHERE i.item_output->>'type' = 'equipment'
), bag AS (
  SELECT r.item_id, MAX((x.value#>>'{equipment,level}')::integer) AS saved_level
  FROM registry r
  JOIN public.players p ON p.id = r.player_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.game_state->'inventory')='array'
      THEN p.game_state->'inventory' ELSE '[]'::jsonb END) x(value)
  WHERE x.value->>'id' = 'stage8_' || r.item_id::text
    AND (x.value#>>'{equipment,level}') ~ '^[0-9]{1,3}$'
  GROUP BY r.item_id
), worn AS (
  SELECT r.item_id, MAX((y.value->>'level')::integer) AS saved_level
  FROM registry r
  JOIN public.players p ON p.id = r.player_id
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(p.game_state#>'{player,equipped}')='object'
      THEN p.game_state#>'{player,equipped}' ELSE '{}'::jsonb END) y(key,value)
  WHERE y.value->>'id' = 'stage8_' || r.item_id::text
    AND (y.value->>'level') ~ '^[0-9]{1,3}$'
  GROUP BY r.item_id
), combined AS (
  SELECT r.registry_level, b.saved_level AS bag_level,
         w.saved_level AS equipped_level,
         GREATEST(COALESCE(b.saved_level,0),COALESCE(w.saved_level,0)) AS displayed_level
  FROM registry r
  LEFT JOIN bag b ON b.item_id=r.item_id
  LEFT JOIN worn w ON w.item_id=r.item_id
)
SELECT COUNT(*)::integer AS registered_gear,
 COUNT(bag_level)::integer AS in_bag,
 COUNT(equipped_level)::integer AS worn,
 COUNT(*) FILTER (WHERE displayed_level=0)::integer AS not_in_saved_inventory,
 COUNT(*) FILTER (WHERE displayed_level>registry_level)::integer AS higher_than_registry,
 COUNT(*) FILTER (WHERE displayed_level<registry_level AND displayed_level>0)::integer AS lower_than_registry,
 MAX(displayed_level-registry_level) AS maximum_level_difference,
 CASE WHEN COUNT(*) FILTER (WHERE displayed_level<>registry_level)>0 THEN
  'BLOCKED_NEEDS_OWNER_PROVENANCE_RECONCILIATION'
  ELSE 'READY_FOR_FURTHER_TESTING_NOT_DEPLOYMENT' END AS preflight_result
FROM combined;
