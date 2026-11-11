import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const planner = readFileSync('src/game/workshopPlanner.ts', 'utf8');
const compiled = ts.transpileModule(planner, {
  fileName: 'workshopPlanner.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(() => {
  throw new Error('Workshop planner must remain self-contained and read-only');
}, module, module.exports);
const { recipeReadiness, visibleWorkshopRecipes, nextWorkshopGuidance, workshopGuidanceText } = module.exports;

const status = {
  enabled: true, profession: 'smith', masteryLevel: 25, masteryXp: 0, masterLicense: false,
  dailyXpCap: 300, dailyXpUsed: 80, resources: { ore: 12, wood: 2, crystal: 0 },
};
const recipe = (id, requiredLevel, masteryXp, ingredients, name = id) => ({
  id, name, profession: 'smith', kind: 'practice', requiredLevel, masteryXp, ingredients,
});
const recipes = [
  recipe('ready', 10, 20, [{ id: 'ore', qty: 10 }], 'Базовый клинок'),
  recipe('lacking', 15, 30, [{ id: 'wood', qty: 5 }, { id: 'crystal', qty: 1 }], 'Деревянный щит'),
  recipe('level', 55, 20, [{ id: 'ore', qty: 2 }]),
  recipe('cap', 20, 230, [{ id: 'ore', qty: 2 }]),
  recipe('master', 300, 10, [{ id: 'ore', qty: 2 }]),
];

assert.equal(recipeReadiness(recipes[0], status).ready, true);
assert.deepEqual(recipeReadiness(recipes[1], status).missing, [{ id: 'wood', need: 3 }, { id: 'crystal', need: 1 }]);
assert.equal(recipeReadiness(recipes[2], status).levelReady, false);
assert.equal(recipeReadiness(recipes[3], status).xpReady, false);
assert.equal(recipeReadiness(recipes[4], status).licenseReady, false);
assert.equal(recipeReadiness(recipes[4], { ...status, masteryLevel: 300, masterLicense: true }).ready, true);
assert.deepEqual(visibleWorkshopRecipes(recipes, status, 'ready', '' ).map(item => item.id), ['ready']);
assert.deepEqual(visibleWorkshopRecipes(recipes, status, 'nearby', '').map(item => item.id), ['ready', 'lacking', 'cap']);
assert.deepEqual(visibleWorkshopRecipes(recipes, status, 'all', 'деревян').map(item => item.id), ['lacking']);
assert.ok(visibleWorkshopRecipes(recipes, status, 'locked', '').every(item => item.id !== 'ready'));
assert.equal(status.resources.ore, 12, 'Planner must never spend resources');

// Player #180056600 case: engineer mastery 4, wood 0, other resources available.
// The first practical action must be visible without scrolling to the recipe list.
const catalog=JSON.parse(readFileSync('supabase/staged/territory_profession_stage8_catalog.json','utf8'));
const engineer=catalog.recipes.filter(item=>item.profession==='engineer');
const alexStatus={...status,profession:'engineer',masteryLevel:4,dailyXpUsed:90,
  resources:{'gather-wood':0,'gather-ore':6,'gather-herb':3,'gather-hide':5,'gather-crystal':6}};
const next=nextWorkshopGuidance(engineer,alexStatus);
assert.equal(next?.kind,'materials');
assert.equal(next.recipe.id,'s8_engineer_practice_1');
assert.deepEqual(next.missing,[{id:'gather-wood',need:1}]);
assert.equal(workshopGuidanceText(next,'ru'),'Собери 1 дерево для следующего обучения.');
assert.equal(workshopGuidanceText(next,'en'),'Gather 1 wood for your next training.');
assert.equal(nextWorkshopGuidance(engineer,{...alexStatus,resources:{...alexStatus.resources,'gather-wood':1}}),null,
  'No shortage tip when the player can already train');
for(const profession of ['smith','alchemist','artisan','jeweler','engineer']){
  const collection=catalog.recipes.filter(item=>item.profession===profession);
  const empty={...alexStatus,profession,masteryLevel:1,dailyXpUsed:0,
    resources:{'gather-wood':0,'gather-ore':0,'gather-herb':0,'gather-hide':0,'gather-crystal':0}};
  const tip=nextWorkshopGuidance(collection,empty);
  assert.equal(tip?.kind,'materials',profession+' should recommend real resources, not a locked section');
  assert.ok(workshopGuidanceText(tip,'ru').startsWith('Собери '));
}
assert.equal(nextWorkshopGuidance(engineer,{...alexStatus,dailyXpUsed:300})?.kind,'dailyCap');
assert.equal(workshopGuidanceText({kind:'level',level:25},'ru'),
  'Следующий рецепт откроется на уровне мастерства 25.');
assert.equal(workshopGuidanceText({kind:'masterLicense'},'ru'),
  'Для рецептов 300-го уровня нужна лицензия мастера.');
assert.equal(workshopGuidanceText({kind:'materials',recipe:engineer[0],missing:[{id:'gather-wood',need:5}]},'ru'),
  'Собери 5 деревьев для следующего обучения.');
assert.equal(status.resources.ore, 12, 'Read-only guidance must not mutate resources');

const app = readFileSync('src/App.tsx', 'utf8');
const inventory = readFileSync('src/components/InventoryScreen.tsx', 'utf8');
const gear = readFileSync('src/components/GearShowcase.tsx', 'utf8');
const forge = readFileSync('src/components/ForgeScreen.tsx', 'utf8');
const professions = readFileSync('src/components/ProfessionsStage8Screen.tsx', 'utf8');
assert.match(app, /onForge=\{openForge\}/, 'Inventory opens the connected forge');
assert.match(app, /focusEquipmentId=\{forgeFocusId\}/, 'Selected gear must be focused in forge');
assert.match(app, /<Stage8ProfessionsScreen onNavigate=/, 'Profession links must be wired to real screens');
assert.match(inventory, /<GearShowcase userId=\{userId\} onForge=\{onForge\}\/>/, 'Equipment has direct forge link');
assert.match(gear, /onForge\(candidate\.id\)/, 'Spare equipment can open the forge');
assert.match(gear, /onForge\(worn\.id\)/, 'Equipped gear can open the forge');
assert.match(forge, /const readyCount = allEquipment\.filter\(forgeReady\)\.length/, 'Forge shows preparation status');
assert.match(forge, /const listed = allEquipment\.filter/, 'Forge filters actual inventory, not dummy rewards');

// The forged set must display this hero's real equipped items, not seven generic slot emojis.
assert.match(forge, /data-testid="forge-equipped-set"/, 'Live equipped set is visible in Forge');
assert.match(forge, /const eq = state\.player\.equipped\[id\]/, 'Forge reads the current hero equipment for each slot');
assert.match(forge, /src=\{equipmentArt\(eq\)\}/, 'Forge renders the same item-specific art used by the hero');
assert.match(forge, /data-testid="forge-equipped-item-art"/, 'Equipped artwork can be verified in the browser');
assert.match(forge, /id: `equipped_\$\{eq\.id\}`/, 'Clicking equipped gear opens its real Forge item');
assert.doesNotMatch(forge, /EQUIPMENT_SLOTS\.map\(\(\{ id, icon, name \}\)/,
  'Never regress to generic decorative slot emojis in the set');

assert.match(forge, /forgeAttempt\(latest, item\.id, eq\.level, Math\.random\(\)\)/, 'Existing forge actions preserved');
assert.match(app, /<ForgeScreen focusEquipmentId=\{forgeFocusId\} userId=\{user\.id\}/,
  'Forge verifies saves for the authenticated hero');
assert.match(forge, /const saved = await saveCloudSave\(userId, result\.next\)/,
  'Forge must await the cloud writer after each attempt');
assert.match(forge, /savedItem\?\.level !== expectedLevel/,
  'Forge must verify the final item level after server normalization');
assert.match(forge, /data\.gold !== result\.next\.player\.gold/,
  'Forge must verify server-reported gold debit');
assert.match(forge, /saveUnverified \|\| isStage8Gear\(selectedCurrent\.id\) \|\| selectedCurrent\.equipment\.level/,
  'No further roll is allowed when the server has not confirmed the previous one');
assert.match(forge, /if \(result\.status === 'success'\) \{\s*setSuccess\(true\)/,
  'Only a confirmed server save may display forge success');

assert.match(professions, /readyRecipes/, 'Server-provided craft readiness summary visible');
assert.match(professions, /data-testid="workshop-next-step"/, 'Show actionable advice next to zero-ready summary');
assert.match(professions, /onClick=\{\(\)=>onNavigate\('map'\)\}/, 'Gather CTA routes to the existing map');
assert.match(professions, /readiness\.missing\.map/, 'Missing resource counts visible');
assert.match(professions, /const canRun=readiness\.ready && !pending && !busy/, 'Unready recipes cannot execute');
assert.match(professions, /executeStage8\(recipeId,operationId\)/, 'Server-authoritative crafting preserved');
assert.match(professions, /readStage8Pending\(\)/, 'Idempotent pending operations preserved');
assert.match(professions, /setStage8Pending\(\{recipeId,operationId\}\)/, 'Operation stored before execution');
assert.match(professions, /onNavigate\('inventory',craftedItemTab\)/, 'Crafted gear or potion opens the correct inventory tab');
assert.doesNotMatch(professions, /setStage8Pending\(null\);\s*await executeStage8/, 'Never clear operation before execution');
console.log('Workshop: recipe readiness, shortages, filters, inventory → forge focus, navigation and server receipts PASS');
