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
  require: (name) => { if (name === './elixirExpiry') return expiryMod.exports;
    if (name === './vipProgram') return { VIP_AUTO_BELT_LEVEL: 3 };
    throw new Error('Unexpected belt dependency: ' + name); } });
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
assert.match(src, /const candidates = state\.inventory\.filter/, 'Cross-lot grouping comes from current inventory');

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
const duplicateRepaired = reconcileLockedBelt(state, 5000);
assert.equal(duplicateRepaired.belt[1]?.name, 'Healing', 'first kind keeps its slot');
assert.equal(duplicateRepaired.belt[2], null, 'duplicate healing moves back to inventory');
assert.equal(duplicateRepaired.belt[4]?.name, 'Mystic', 'distinct kind keeps its slot');
assert.equal(duplicateRepaired.belt[5], null, 'duplicate mystic moves back to inventory');
assert.equal(sum(duplicateRepaired), originalQty, 'legacy duplicate cleanup never loses stock');
assert.equal(reconcileLockedBelt(duplicateRepaired, 5000), duplicateRepaired, 'duplicate cleanup is idempotent');

const put = putInBelt({ ...state, belt: [null, null, null, null, null, null, null],
  inventory: [elixir('inv_added', 'Healing', 4)] }, 'inv_added',
  { level: 999, activeDays: 10000, arenaWins: 99 });
assert(put, 'potions can still be added to the unlocked first slot');
assert.equal(put.belt[0]?.qty, 4);
assert.equal(put.belt[1], null);

/** Identical old inventory lots, regardless of legacy expiry timestamps,
 * must fill one slot automatically up to 5. Never duplicate or discard stock.
 */
const oldExpiry = new Date(Date.now() - 30 * 86400000).toISOString();
const selectedExpiry = new Date(Date.now() + 6 * 86400000).toISOString();
const oldLot = { ...elixir('lot-old', 'Strength', 1), expiresAt: oldExpiry };
const chosenLot = { ...elixir('lot-five', 'Strength', 5), expiresAt: selectedExpiry };
const ctx = { level: 1, activeDays: 0, arenaWins: 99 };
const emptyBelt = Array(7).fill(null);
const withLots = { player: { level: 1 }, activeDays: 0, belt: emptyBelt,
  inventory: [oldLot, chosenLot] };
const grouped = mod.exports.groupConsumablesForDisplay(withLots.inventory);
assert.equal(grouped.length, 1);
assert.equal(grouped[0].qty, 6);
assert.equal(grouped[0].expiresAt, undefined, 'No expiry on displayed potions');
const selectedFive = putInBelt(withLots, 'lot-five', ctx);
assert(selectedFive, 'a matching kind equips multiple batches at once');
assert.equal(selectedFive.belt[0].qty, 5, 'fill all five doses in one click');
assert.equal(selectedFive.belt[0].expiresAt, undefined, 'no expiry on equipped stock');
assert.equal(selectedFive.inventory.find(i => i.id === 'lot-old'), undefined);
assert.equal(selectedFive.inventory.find(i => i.id === 'lot-five')?.qty, 1);
assert.equal(sum(selectedFive), sum(withLots), 'all potions conserved');
assert.equal(putInBelt(selectedFive, 'lot-five', ctx), null, 'same kind does not use second slot');
const returned = takeFromBelt(selectedFive, 0);
assert.equal(sum(returned), sum(withLots), 'return conserves stock, no potion lost');
assert.equal(returned.inventory.reduce((n,i)=>n+i.qty,0),6);
assert.equal(returned.inventory.find(i=>i.id==='lot-five')?.qty,6);

const partial = putInBelt({ ...withLots, inventory: [{ ...chosenLot, qty: 5 }],
  belt: [{ ...oldLot, id: 'belt_0', qty: 2 }, ...Array(6).fill(null)] }, 'lot-five', ctx);
assert(partial, 'partial older belt stack must accept a different-date matching lot');
assert.equal(partial.belt[0].qty, 5);
assert.equal(partial.inventory[0].qty, 2);
assert.equal(sum(partial), 7, 'replenish from different lots conserves stock');

// Every unlocked slot can carry a DIFFERENT kind, but never a second stack
// of the same exact potion/elixir, even across expiry batches.
const allOpen = { level: 99, activeDays: 99, arenaWins: 5000 };
const otherKind = { ...chosenLot, id: 'lot-defense', name: 'Defense elixir',
  type: 'elixir', effect: { stat: 'defense', value: 10 }, qty: 5 };
const withKinds = { ...withLots, belt: Array(7).fill(null),
  inventory: [chosenLot, otherKind] };
const equippedHeal = putInBelt(withKinds, 'lot-five', allOpen);
assert(equippedHeal, 'first kind can occupy first open slot');
assert.equal(putInBelt(equippedHeal, 'lot-five', allOpen), null,
  'same item is no longer in inventory');
const equippedDefense = putInBelt(equippedHeal, 'lot-defense', allOpen);
assert(equippedDefense, 'a different kind may use another unlocked slot');
assert.equal(equippedDefense.belt[0]?.qty, 5);
assert.equal(equippedDefense.belt[1]?.name, 'Defense elixir');
assert.equal(sum(equippedDefense), sum(withKinds), 'different kinds conserve all stock');

const fullWithSpare = { ...withLots, inventory: [{ ...chosenLot, id: 'lot-spare', qty: 5 }],
  belt: [{ ...chosenLot, id: 'belt_0', qty: 5 }, ...Array(6).fill(null)] };
assert.equal(putInBelt(fullWithSpare, 'lot-spare', allOpen), null,
  'a full stack must not occupy a second unlocked slot');
assert.equal(fullWithSpare.inventory[0].qty, 5, 'rejected transfer preserves inventory');
const mixedExpiry = { ...fullWithSpare, belt: [{ ...chosenLot, id: 'belt_0', qty: 2, expiresAt: oldExpiry }, ...Array(6).fill(null)] };
const filledDifferentExpiry = putInBelt(mixedExpiry, 'lot-spare', allOpen);
assert.equal(filledDifferentExpiry.belt[0].qty, 5, 'Different old timestamps now top up in same slot');
assert.equal(filledDifferentExpiry.inventory[0].qty, 2, 'Precisely three doses moved');
assert.equal(filledDifferentExpiry.belt[1], null, 'Never mint a second stack');

for (const [name, incompatible] of [
  ['effect', { ...chosenLot, id: 'belt_0', effect: { stat: 'hp', value: 150 }, qty: 1 }],
  ['rarity', { ...chosenLot, id: 'belt_0', rarity: 'rare', qty: 1 }],
]) {
  const blocked = { ...withLots, inventory: [chosenLot],
    belt: [incompatible, ...Array(6).fill(null)] };
  assert.equal(putInBelt(blocked, 'lot-five', ctx), null, 'no incompatible merge for ' + name);
  assert.equal(blocked.inventory[0].qty, 5, 'failed move is immutable for ' + name);
}

const expired = { ...chosenLot, expiresAt: new Date(Date.now() - 86400000).toISOString() };
const legacyExpired = putInBelt({ ...withLots, inventory: [expired] }, 'lot-five', ctx);
assert.equal(legacyExpired?.belt[0]?.qty, 5, 'Old expired lots are permanent and fully usable');
for (const type of ['elixir', 'arena']) {
  const each = { ...chosenLot, type };
  const moved = putInBelt({ ...withLots, inventory: [oldLot, each] }, 'lot-five', ctx);
  assert.equal(moved?.belt[0]?.qty, 5, type + ' also moves the only compatible type');
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
