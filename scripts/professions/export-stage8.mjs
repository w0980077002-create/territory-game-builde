/** Mechanical export for server engineers; NEVER applies a migration. */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  STAGE8_VERSION, DAILY_SERVER_XP_CAP, MAX_MASTERY_LEVEL,
  GATHER_HOURS_PER_UNIT, MASTERY_BANDS, PROFESSION_TRACKS, STAGE8_RECIPES,
} from './stage8-model.mjs';

const destination = new URL('../../supabase/staged/territory_profession_stage8_catalog.json',import.meta.url);
const blueprint = {
  version: STAGE8_VERSION,
  enabled: false,
  requiresServerAuthority: true,
  supportsClientLocalCraftFallback: false,
  dailyXpCapKyiv: DAILY_SERVER_XP_CAP,
  levelCap: MAX_MASTERY_LEVEL,
  gatherHoursPerUnit: GATHER_HOURS_PER_UNIT,
  gatheredResourcesExpire: false,
  masteryBands: MASTERY_BANDS,
  professions: PROFESSION_TRACKS.map(({id,name})=>({id,name})),
  recipes: STAGE8_RECIPES,
};
await writeFile(destination,`${JSON.stringify(blueprint,null,2)}\n`,'utf8');
console.log(`Exported ${blueprint.recipes.length} staging recipes -> ${fileURLToPath(destination)}; no SQL or live database action.`);
