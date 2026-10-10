import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'territory-professions-'));
const require = createRequire(import.meta.url);
const ts = require('typescript');

try {
  const files = ['types.ts', 'equipmentCatalog.ts', 'equipmentBalance.ts', 'professions.ts'];
  const outDir = path.join(temp, 'src', 'game');
  await mkdir(outDir, { recursive: true });

  for (const file of files) {
    const sourcePath = path.join(root, 'src', 'game', file);
    const source = await readFile(sourcePath, 'utf8');
    const result = ts.transpileModule(source, {
      fileName: sourcePath,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        strict: true,
        esModuleInterop: true,
      },
    });
    const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `${file} contains TypeScript transpilation errors`);
    await writeFile(path.join(outDir, file.replace(/\.ts$/, '.js')), result.outputText);
  }

  const game = require(path.join(outDir, 'professions.js'));
  assert.equal(game.PROFESSION_DEFINITIONS.length, 5, 'Expected five professions');
  assert.equal(new Set(game.PROFESSION_DEFINITIONS.map((item) => item.id)).size, 5, 'Profession IDs must be unique');
  assert.ok(game.PROFESSION_RECIPES.length >= 15, 'Expected a usable starter recipe catalogue');
  assert.equal(new Set(game.PROFESSION_RECIPES.map((item) => item.id)).size, game.PROFESSION_RECIPES.length, 'Recipe IDs must be unique');

  for (const recipe of game.PROFESSION_RECIPES) {
    assert.ok(game.PROFESSION_DEFINITIONS.some((profession) => profession.id === recipe.profession), `Unknown profession in ${recipe.id}`);
    assert.ok(recipe.requiredLevel >= 1 && recipe.requiredLevel <= 300, `Invalid level in ${recipe.id}`);
    assert.ok(recipe.masteryXp > 0, `Invalid mastery XP in ${recipe.id}`);
    for (const ingredient of recipe.ingredients) {
      assert.ok(game.RESOURCE_DEFINITIONS.some((resource) => resource.id === ingredient.id), `Unknown resource ${ingredient.id} in ${recipe.id}`);
      assert.ok(ingredient.qty > 0, `Invalid ingredient quantity in ${recipe.id}`);
    }
  }

  let progress = { active: 'smith', masteryLevel: 1, masteryXp: 0, lastGatherAt: 0 };
  progress = game.addMasteryXp(progress, 250);
  assert.equal(progress.masteryLevel, 3, 'Mastery should advance across multiple levels');
  assert.equal(progress.masteryXp, 25, 'Mastery should preserve overflow XP');
  progress = game.addMasteryXp(progress, 1_000_000_000);
  assert.equal(progress.masteryLevel, 300, 'Mastery must cap at 300');
  assert.equal(progress.masteryXp, 0, 'Mastery XP must stop accumulating at max level');

  const inventory = [
    { id: 'gather-ore', name: 'Iron ore', icon: '⛏️', type: 'material', rarity: 'common', qty: 5, description: '' },
    { id: 'gather-wood', name: 'Wood', icon: '🪵', type: 'material', rarity: 'common', qty: 2, description: '' },
  ];
  const blade = game.PROFESSION_RECIPES.find((item) => item.id === 'smith_apprentice_blade');
  assert.ok(blade, 'Starter smith blade recipe must exist');
  assert.ok(game.canCraft(inventory, blade), 'Enough materials should permit crafting');
  const crafted = game.craftItem(inventory, blade);
  assert.ok(crafted, 'Crafting should return an inventory');
  assert.equal(crafted.some((item) => item.id === 'gather-ore' || item.id === 'gather-wood'), false, 'Spent resource stacks should be removed');
  const equipment = crafted.find((item) => item.type === 'equipment' && item.name === blade.output.name);
  assert.ok(equipment?.equipment?.id, 'Crafted equipment must have an equipment ID');
  assert.equal(game.craftItem([{ ...inventory[0], qty: 1 }], blade), null, 'Insufficient materials must reject crafting');

  console.log(`Profession checks passed: ${game.PROFESSION_DEFINITIONS.length} professions, ${game.PROFESSION_RECIPES.length} recipes, XP progression to level 300, resource spending, crafting output, and insufficient-material rejection.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
