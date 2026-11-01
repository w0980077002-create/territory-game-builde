import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const src = read('src/game/belt.ts');
const js = ts.transpileModule(src, {
  fileName: 'belt.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const expiryJs = ts.transpileModule(read('src/game/elixirExpiry.ts'), {
  fileName: 'elixirExpiry.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const expiryMod = { exports: {} };
vm.runInNewContext(expiryJs, { module: expiryMod, exports: expiryMod.exports, Date, Math, JSON });
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, Math, JSON,
  require: (name) => { assert.equal(name, './elixirExpiry'); return expiryMod.exports; } });
const { BELT_WIN_GOALS, BELT_RULES, isSlotOpen, reconcileLockedBelt, putInBelt, takeFromBelt } = mod.exports;

const goals = [0, 100, 500, 1000, 2000, 3500, 5000];
assert.equal(BELT_WIN_GOALS.length, 7);
assert.equal(BELT_RULES.length, 7);
goals.forEach((goal, slot) => {
  assert.equal(BELT_WIN_GOALS[slot], goal, 'slot ' + (slot + 1) + ' goal');
  assert.equal(isSlotOpen(slot, { level: 9999, activeDays: 9999, arenaWins: Math.max(0, goal - 1) }),
    slot === 0, 'levels/days must NOT unlock slot ' + (slot + 1));
  assert.equal(isSlotOpen(slot, { level: 1, activeDays: 0, arenaWins: goal }), true,
    'server wins should unlock slot ' + (slot + 1));
  assert.equal(BELT_RULES[slot].check({ arenaWins: goal }).open, true);
  assert(BELT_RULES[slot].titleEn.length > 0);
});
assert.equal(isSlotOpen(6, { arenaWins: 4999 }), false);
assert.equal(isSlotOpen(6, { arenaWins: 5000 }), true);
assert.equal(src.includes('c.activeDays >= '), false, 'No active-day gate remains');
assert.equal(src.includes('c.level >= '), false, 'No level gate remains');

const elixir = (id, name, qty = 1, amount = 50) => ({
  id, name, qty, type: 'potion', rarity: 'common',
  effect: { stat: 'hp', value: amount }, icon: '🧪', description: 'Test potion',
});
const locked = [elixir('belt_0', 'Starter', 2), elixir('belt_1', 'Healing', 3),
  elixir('belt_2', 'Healing', 2), elixir('belt_3', 'Big Heal', 1, 150),
  elixir('belt_4', 'Mystic', 5), elixir('belt_5', 'Mystic', 2), elixir('belt_6', 'Last', 1)];
const state = { player: { level: 99 }, activeDays: 2000, inventory: [
  elixir('inv_0', 'Healing', 4),
  elixir('inv_diff_effect', 'Healing', 6, 150),
], belt: locked };

const sum = (s) => [...s.inventory, ...s.belt.filter(Boolean)]
  .reduce((n, item) => n + item.qty, 0);
const originalQty = sum(state);
const repaired = reconcileLockedBelt(state, 99);
assert.notEqual(repaired, state, 'old slots are migrated after wins drop below new goals');
assert.equal(repaired.belt[0]?.name, 'Starter');
for (let i = 1; i < 7; i++) assert.equal(repaired.belt[i], null, 'new locked slot stays empty');
assert.equal(sum(repaired), originalQty, 'migration must never lose or duplicate potions');
assert.equal(repaired.inventory.find(x => x.id === 'inv_0')?.qty, 9, 'identical effects stack safely');
assert.equal(repaired.inventory.find(x => x.id === 'inv_diff_effect')?.qty, 6, 'different effects must not merge');
assert.equal(reconcileLockedBelt(repaired, 99), repaired, 'migration is idempotent');
assert.equal(reconcileLockedBelt(state, 5000), state, 'fully unlocked players untouched');

const put = putInBelt({ ...state, belt: [null, null, null, null, null, null, null],
  inventory: [elixir('inv_added', 'Healing', 4)] }, 'inv_added',
  { level: 999, activeDays: 10000, arenaWins: 99 });
assert(put, 'potions can still be added to the unlocked first slot');
assert.equal(put.belt[0]?.qty, 4);
assert.equal(put.belt[1], null);

/** Regression #177: the tapped tile contains 5 but another older batch contains 1. */
const oldExpiry = new Date(Date.now() + 2 * 86400000).toISOString();
const selectedExpiry = new Date(Date.now() + 6 * 86400000).toISOString();
const oldLot = { ...elixir('lot-old', 'Strength', 1), expiresAt: oldExpiry };
const chosenLot = { ...elixir('lot-five', 'Strength', 5), expiresAt: selectedExpiry };
const ctx = { level: 1, activeDays: 0, arenaWins: 99 };
const emptyBelt = Array(7).fill(null);
const withLots = { player: { level: 1 }, activeDays: 0, belt: emptyBelt,
  inventory: [oldLot, chosenLot] };
const selectedFive = putInBelt(withLots, 'lot-five', ctx);
assert(selectedFive, 'a selected stack of five must fit in the first open belt slot');
assert.equal(selectedFive.belt[0].qty, 5, 'do not silently choose the older x1 lot');
assert.equal(selectedFive.belt[0].expiresAt, selectedExpiry, 'retain selected batch expiration');
assert.equal(selectedFive.inventory.find(i => i.id === 'lot-old')?.qty, 1, 'older stock is unchanged');
assert.equal(selectedFive.inventory.find(i => i.id === 'lot-five'), undefined, 'selected x5 moved in one click');
assert.equal(sum(selectedFive), sum(withLots), 'transfers cannot create or lose consumables');
assert.equal(putInBelt(selectedFive, 'lot-five', ctx), null, 'fast repeat cannot duplicate a depleted lot');

const partial = putInBelt({ ...withLots, inventory: [{ ...chosenLot, qty: 5 }],
  belt: [{ ...chosenLot, id: 'belt_0', qty: 2 }, ...Array(6).fill(null)] }, 'lot-five', ctx);
assert(partial, 'compatible stack must allow top-up');
assert.equal(partial.belt[0].qty, 5, 'top up 2 to 5');
assert.equal(partial.inventory[0].qty, 2, 'leave exactly two behind in the selected lot');
assert.equal(sum(partial), 7, 'top-up conserves inventory plus belt');

for (const [name, incompatible] of [
  ['expiry', { ...chosenLot, id: 'belt_0', expiresAt: oldExpiry, qty: 1 }],
  ['effect', { ...chosenLot, id: 'belt_0', effect: { stat: 'hp', value: 150 }, qty: 1 }],
  ['rarity', { ...chosenLot, id: 'belt_0', rarity: 'rare', qty: 1 }],
]) {
  const blocked = { ...withLots, inventory: [chosenLot],
    belt: [incompatible, ...Array(6).fill(null)] };
  assert.equal(putInBelt(blocked, 'lot-five', ctx), null, 'no incompatible merge for ' + name);
  assert.equal(blocked.inventory[0].qty, 5, 'failed move is immutable for ' + name);
}
const returned = takeFromBelt(selectedFive, 0);
assert.equal(sum(returned), sum(withLots), 'return to inventory conserves quantities');
assert.equal(returned.inventory.find(i => i.expiresAt === selectedExpiry)?.qty, 5,
  'returned lot keeps its own expiry');

const expired = { ...chosenLot, expiresAt: new Date(Date.now() - 86400000).toISOString() };
assert.equal(putInBelt({ ...withLots, inventory: [expired] }, 'lot-five', ctx), null,
  'expired lots must remain unusable');
for (const type of ['elixir', 'arena']) {
  const each = { ...chosenLot, type };
  const moved = putInBelt({ ...withLots, inventory: [oldLot, each] }, 'lot-five', ctx);
  assert.equal(moved?.belt[0]?.qty, 5, type + ' also must transfer selected x5');
}

const app = read('src/App.tsx');
assert.match(app, /reconcileLockedBelt\(timedState, profile\.arenaWins\)/,
  'use Supabase win total and not a forged local save counter');
assert.match(app, /\|\| beltReconciled\)/,
  'persist returned potions in the existing cloud save migration queue');

// Player request: tapping a lock must explain the actual server-win requirement.
const beltCells = read('src/components/ui/BeltCells.tsx');
assert.match(beltCells, /setLockedSlot\(i\)/, 'locked slot tap opens requirements');
assert.match(beltCells, /BELT_WIN_GOALS\[lockedSlot\]/, 'use the canonical Arena wins thresholds');
assert.match(beltCells, /data-testid="belt-slot-unlock-info"/, 'requirements are visible in a dialog');
assert.match(beltCells, /Math\.max\(0, requiredWins - wins\)/, 'remaining victories never go negative');
assert.match(beltCells, /language === 'en'/, 'lock details are localized RU and EN');
assert.match(beltCells, /<Modal[\s\S]*onClose=\{\(\) => setLockedSlot\(null\)\}/,
  'unlock dialog is dismissible');
assert.match(beltCells, /open \? onTap\(i, true\) : setLockedSlot\(i\)/,
  'open slots keep their original action and locked slots cannot mutate equipment');

console.log('Belt wins ONLY: thresholds, exact boundaries, no days/levels, migration without loss, cloud save, locked-slot hints: PASS');
