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
const { recipeReadiness, visibleWorkshopRecipes } = module.exports;

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
assert.match(forge, /forgeAttempt\(latest, item\.id, eq\.level, Math\.random\(\)\)/, 'Existing forge actions preserved');
assert.match(professions, /readyRecipes/, 'Server-provided craft readiness summary visible');
assert.match(professions, /readiness\.missing\.map/, 'Missing resource counts visible');
assert.match(professions, /const canRun=readiness\.ready && !pending && !busy/, 'Unready recipes cannot execute');
assert.match(professions, /executeStage8\(recipeId,operationId\)/, 'Server-authoritative crafting preserved');
assert.match(professions, /readStage8Pending\(\)/, 'Idempotent pending operations preserved');
assert.match(professions, /setStage8Pending\(\{recipeId,operationId\}\)/, 'Operation stored before execution');
assert.match(professions, /onNavigate\('inventory',craftedItemTab\)/, 'Crafted gear or potion opens the correct inventory tab');
assert.doesNotMatch(professions, /setStage8Pending\(null\);\s*await executeStage8/, 'Never clear operation before execution');
console.log('Workshop: recipe readiness, shortages, filters, inventory → forge focus, navigation and server receipts PASS');
