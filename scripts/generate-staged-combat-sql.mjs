/**
 * Emit a REVIEW-ONLY SQL seed for the isolated TERRITORY V1 staging database.
 * Does NOT connect to Supabase. Never changes production or enables combat.
 *
 * Usage: node scripts/generate-staged-combat-sql.mjs > territory-v1-catalog.REVIEW.sql
 * First apply supabase/staged/territory_v1_combat_completion.sql in an isolated DB,
 * inspect the proposal, and approve the actual combat numbers and safe migration.
 */
import {readFileSync} from 'node:fs';
const read=file=>JSON.parse(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
const catalog=read('src/game/config/territory-v1-combat-catalog.staged.json');
const rules=read('src/game/config/territory-v1-combat-rules.staged.json');
if(catalog.skills.length!==15||catalog.runes.length!==45||catalog.passives.length!==6)
  throw new Error('Not the approved five-row skill structure');
const json=(data)=>JSON.stringify(data);
if([catalog,rules].some(o=>json(o).includes('$v1combat$')))throw new Error('invalid dollar-delimiter collision');
const result=`-- REVIEW-ONLY, NO DEPLOYMENT. Staging catalog proposal, NEVER production.
-- Mechanic strength is provisional until owner approves balance values.
-- The following block does not create verified heroes, encounters, rewards or payments.
BEGIN;
DO $v1seed$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
      WHERE table_schema='territory_private' AND table_name='combat_config_v1') THEN
    RAISE EXCEPTION 'Apply reviewed combat staging schema first';
  END IF;
  IF EXISTS (SELECT 1 FROM territory_private.combat_config_v1 WHERE id=true AND enabled=true) THEN
    RAISE EXCEPTION 'Refuse to modify an ENABLED combat configuration';
  END IF;
  UPDATE territory_private.combat_config_v1
     SET catalog = $v1combat$${json(catalog)}$v1combat$::jsonb,
         rules = $v1combat$${json(rules)}$v1combat$::jsonb,
         version = version + 1
   WHERE id = true AND enabled = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'No disabled combat config available'; END IF;
END
$v1seed$;
-- Explicitly preserve enabled=false, existing profiles, wallets and all saves.
COMMIT;
`;
process.stdout.write(result);
