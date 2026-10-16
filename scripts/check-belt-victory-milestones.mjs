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
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, Math, JSON });
const { BELT_WIN_GOALS, BELT_RULES, isSlotOpen, reconcileLockedBelt, putInBelt } = mod.exports;

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

const app = read('src/App.tsx');
assert.match(app, /reconcileLockedBelt\(timedState, profile\.arenaWins\)/,
  'use Supabase win total and not a forged local save counter');
assert.match(app, /\|\| beltReconciled\)/,
  'persist returned potions in the existing cloud save migration queue');

console.log('Belt wins ONLY: thresholds, exact boundaries, no days/levels, migration without loss, cloud save: PASS');
