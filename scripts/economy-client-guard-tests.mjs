import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

// Compatible with the Node 20 used by GitHub Pages CI (no experimental TS flags).
const require = createRequire(import.meta.url);
const ts = require('typescript');
function loadPureTsModule(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: relativePath,
  });
  const module = { exports: {} };
  vm.runInNewContext(transpiled.outputText, { module, exports: module.exports, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected runtime import: ${name}`);
    return dependencies[name];
  } }, { filename: relativePath });
  return module.exports;
}
const { createSequentialWriter } = loadPureTsModule('../src/game/saveQueue.ts');
const calendar = loadPureTsModule('../src/game/weeklyQuests.ts');
const { canBuyShopItem, shopStonesBoughtToday, MAX_SHOP_PURCHASE_QTY } = loadPureTsModule('../src/game/purchaseGuard.ts', { './weeklyQuests': calendar });
const { spendStones } = loadPureTsModule('../src/game/progression.ts', { './actions': {}, './live': {}, './weeklyQuests': calendar });

// Pure tests: do not contact the real Supabase database or touch player data.
const now = new Date('2026-10-15T08:00:00+03:00');
const state = {
  player: { gold: 10000, gems: 1000 },
  battleStones: 20,
  forgeMaterials: 0,
  dailyStonesBought: 23,
  dailyStonesDate: now.toDateString(),
};
const stone = { id: 'shop_stone', type: 'stone', priceGold: 10, amount: 1 };
assert.equal(shopStonesBoughtToday(state, now), 23);
assert.equal(canBuyShopItem(state, stone, 2, now), true);
assert.equal(canBuyShopItem(state, stone, 3, now), false);
for (const invalid of [NaN, Infinity, -Infinity, 0, -1, 0.1, 1.5, 1001, Number.MAX_SAFE_INTEGER]) {
  assert.equal(canBuyShopItem(state, stone, invalid, now), false, `bad quantity ${invalid}`);
}
assert.equal(canBuyShopItem(state, { ...stone, amount: NaN }, 1, now), false);
assert.equal(canBuyShopItem(state, { ...stone, priceGold: -100 }, 1, now), false);
assert.equal(canBuyShopItem(state, { ...stone, priceGold: Infinity }, 1, now), false);
assert.equal(canBuyShopItem(state, { ...stone, amount: 0 }, 1, now), false);
assert.equal(canBuyShopItem(state, { ...stone, priceGold: 10001 }, 1, now), false);
assert.equal(canBuyShopItem({ ...state, dailyStonesBought: NaN }, stone, 1, now), false);
assert.equal(canBuyShopItem({ ...state, dailyStonesBought: 0, battleStones: 2147483647 }, stone, 1, now), false);
assert.equal(canBuyShopItem(state, { ...stone, type: 'gem_pack', amount: -100 }, 1, now), false);
assert.equal(canBuyShopItem(state, { ...stone, type: 'gem_pack', amount: 10 }, 1, now), true);
assert.equal(canBuyShopItem({ ...state, dailyStonesDate: 'old' }, stone, 25, now), true);
assert.equal(canBuyShopItem({ ...state, dailyStonesDate: 'old' }, stone, 26, now), false);
assert.equal(MAX_SHOP_PURCHASE_QTY, 1000);
assert.equal(spendStones(state, -100), null, 'negative spend must not mint stones');
assert.equal(spendStones(state, NaN), null);
assert.equal(spendStones(state, 0), null);
assert.equal(spendStones(state, 2).battleStones, 18);
assert.equal(spendStones(state, 21), null);

const trace = [];
let releaseFirst;
const gate = new Promise((resolve) => { releaseFirst = resolve; });
const write = createSequentialWriter(async (snapshot) => {
  trace.push(`begin${snapshot}`);
  if (snapshot === 1) await gate;
  trace.push(`end${snapshot}`);
  return true;
});
const w1 = write(1);
const w2 = write(2);
await Promise.resolve();
assert.deepEqual(trace, ['begin1']);
releaseFirst();
assert.equal(await w1, true);
assert.equal(await w2, true);
assert.deepEqual(trace, ['begin1', 'end1', 'begin2', 'end2']);
const errors = [];
const recover = createSequentialWriter(async (snapshot) => {
  errors.push(snapshot);
  if (snapshot === 1) throw new Error('offline');
  return true;
});
await assert.rejects(recover(1), /offline/);
assert.equal(await recover(2), true);
assert.deepEqual(errors, [1, 2]);
console.log('Territory client-side purchase and ordered-save regression tests: PASS');
console.log('WARNING: tests do not prove server-side anti-cheat or multi-device protection.');
