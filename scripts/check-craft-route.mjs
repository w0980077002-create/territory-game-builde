import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync('src/game/craftJourney.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'craftJourney.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, mod, mod.exports);
const { nextCraftRoute } = mod.exports;
const recipes = [
  { id: 'ore', requiredLevel: 1, ingredients: [{ id: 'ore', qty: 5 }] },
  { id: 'wood', requiredLevel: 3, ingredients: [{ id: 'wood', qty: 2 }] },
  { id: 'master', requiredLevel: 300, ingredients: [] },
];
const get = counts => id => counts[id] ?? 0;
assert.equal(nextCraftRoute(recipes, 5, get({ ore: 2, wood: 2 })).recipe.id, 'wood', 'Ready recipe comes first');
assert.deepEqual(nextCraftRoute(recipes, 1, get({ ore: 3, wood: 0 })).missing, [{ id: 'ore', need: 2 }]);
assert.equal(nextCraftRoute(recipes, 1, get({ ore: 5 })).ready, true);
assert.equal(nextCraftRoute(recipes, 1, get({ ore: 0 })).levelReady, true);
assert.equal(nextCraftRoute(recipes, 0, get({ ore: 0 })).levelReady, false);
assert.equal(nextCraftRoute(recipes.slice(2), 300, get({})), null, 'Unverified master recipes never become suggested');
assert.equal(nextCraftRoute([], 300, get({})), null);
assert.equal(nextCraftRoute(recipes, 5, get({ ore: 2, wood: 2 })).missing.length, 0);
const app = readFileSync('src/App.tsx', 'utf8');
const professions = readFileSync('src/components/ProfessionsScreen.tsx', 'utf8');
const forge = readFileSync('src/components/ForgeScreen.tsx', 'utf8');
assert.match(app, /<ProfessionsScreen onMap=\{\(\) => setScreen\('map'\)\}/);
assert.match(app, /onInventory=\{\(\) => \{ setInventoryTab\('items'\); setScreen\('inventory'\); \}\}/);
assert.match(forge, /onProfessions/);
assert.match(professions, /nextCraftRoute\(availableRecipes, displayedLevel/);
assert.match(professions, /craftStatus\?\.enabled \? \(craftStatus\.resources\[id\] \?\? 0\) : countResource\(game\.inventory, id\)/);
assert.match(professions, /craftCheck === 'error'/);
assert.match(professions, /pendingCraft/);
assert.match(professions, /onClick=\{\(\) => setTab\('craft'\)\}/);
assert.doesNotMatch(source, /useGame\.set|supabase|fetch\(/, 'Read-only planner cannot mutate game state');
console.log('Craft route: real shortages, level gates, safe recipe suggestions, navigation and retry PASS');
