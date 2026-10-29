import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(path, 'utf8');
function load(source, dependencies = {}) {
  const compiled = ts.transpileModule(read(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports, Math, Number,
    require: name => {
      if (!(name in dependencies)) throw new Error('Unexpected dependency: ' + name);
      return dependencies[name];
    },
  }, { timeout: 3000 });
  return module.exports;
}

const forge = load('src/game/forge.ts', { './equipmentBalance': {}, './elixirExpiry': {} });
const { forecastForgeUpgrade } = load('src/game/forgeForecast.ts', { './forge': forge });
const component = read('src/components/ForgeForecastHint.tsx');
const screen = read('src/components/ForgeScreen.tsx');
const catalog = load('src/game/equipmentCatalog.ts');

const approx = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-8,
  label + ': expected ' + expected + ', got ' + actual);
assert.equal(forecastForgeUpgrade(10, 10), null, 'No upgrades at hero cap');
assert.equal(forecastForgeUpgrade(100, 100), null);
assert.equal(forecastForgeUpgrade(0, 100), null);
assert.equal(forecastForgeUpgrade(NaN, 100), null);
assert.equal(forecastForgeUpgrade(5, 100, 4), null);
assert.equal(forecastForgeUpgrade(5, 100, 0), null);
assert.equal(forecastForgeUpgrade(5, 5.5), null);

const first = forecastForgeUpgrade(1, 100);
assert.equal(first.levels, 1);
approx(first.firstSuccessChance, .85, 'Level 1 success chance');
assert.equal(first.nextCost.gold, 80, 'Existing level-one price');
assert.equal(first.nextCost.materials, 1);
approx(first.expectedAttempts, 1 / .85, 'Expected attempts at level 1');
approx(first.expectedGold, 80 / .85, 'Expected gold at level 1');
approx(first.expectedMaterials, 1 / .85, 'Expected materials at level 1');

const ten = forecastForgeUpgrade(10, 100);
approx(ten.firstSuccessChance, .5, 'Existing minimum success rate');
assert.equal(ten.nextCost.gold, 350);
assert.equal(ten.nextCost.materials, 4);
approx(ten.expectedAttempts, 2);
approx(ten.expectedGold, 700);
approx(ten.expectedMaterials, 8);

for (let itemLevel = 1; itemLevel < 100; itemLevel++) {
  const forecast = forecastForgeUpgrade(itemLevel, 100, 3);
  const expectedSteps = Math.min(3, 100 - itemLevel);
  assert.equal(forecast.levels, expectedSteps);
  assert.equal(forecast.toLevel, itemLevel + expectedSteps);
  assert(forecast.expectedAttempts >= expectedSteps);
  assert(forecast.expectedGold >= forge.forgeCost(itemLevel).gold);
  assert(forecast.expectedMaterials >= forge.forgeCost(itemLevel).materials);
  assert(Number.isFinite(forecast.expectedGold));
  assert(Number.isFinite(forecast.expectedMaterials));
  let expectedGold = 0, expectedMaterials = 0, expectedAttempts = 0;
  for (let i = itemLevel; i < itemLevel + expectedSteps; i++) {
    const chance = forge.forgeSuccessRate(i);
    assert(chance >= .5 && chance <= .9);
    expectedAttempts += 1 / chance;
    expectedGold += forge.forgeCost(i).gold / chance;
    expectedMaterials += forge.forgeCost(i).materials / chance;
  }
  approx(forecast.expectedAttempts, expectedAttempts, 'Attempts at level ' + itemLevel);
  approx(forecast.expectedGold, expectedGold, 'Gold at level ' + itemLevel);
  approx(forecast.expectedMaterials, expectedMaterials, 'Materials at level ' + itemLevel);
}
assert.equal(new Set(catalog.SHOP_EQUIPMENT_ITEMS.filter(x => x.type === 'equipment')
  .map(x => x.equipment.slot)).size, 7, 'All seven equipment slots have shop options');
for (const item of catalog.SHOP_EQUIPMENT_ITEMS) {
  assert(Number.isSafeInteger(item.priceGold ?? 0) && (item.priceGold ?? 0) >= 0, item.id + ' gold');
  assert(Number.isSafeInteger(item.priceGems ?? 0) && (item.priceGems ?? 0) >= 0, item.id + ' gems');
}

assert.match(screen, /<ForgeForecastHint itemLevel=\{selectedCurrent\.equipment\.level\} heroLevel=\{state\.player\.level\} language=\{language\}\/>/);
assert.match(component, /forecastForgeUpgrade\(itemLevel, heroLevel/);
assert.match(component, /aria-expanded=\{expanded\}/);
assert.match(component, /not a guarantee|не гарантия/, 'Expected price cannot promise a sure result');
assert.doesNotMatch(component, /useGame\.set|supabase\.rpc|forgeAttempt\(/, 'Preview must never spend or grant resources');
console.log('T17 forge forecast PASS: 99 levels, actual prices/chances, no purchases or state changes; 7 equipment slots.');
