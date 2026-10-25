import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const importSource = async (path) => {
  const bundled = await build({ entryPoints: [resolve(path)], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
};

const expiry = await importSource('src/game/elixirExpiry.ts');
const belt = await importSource('src/game/belt.ts');
const actions = await importSource('src/game/actions.ts');
const professions = await importSource('src/game/professions.ts');

const start = Date.parse('2026-10-25T12:00:00.000Z');
const elixir = (id, qty, expiresAt) => ({ id, qty, name: 'Эликсир силы', icon: '💪', type: 'elixir', rarity: 'common',
  description: '+10 атаки', effect: { stat: 'attack', value: 10, duration: 'battle' }, ...(expiresAt ? { expiresAt } : {}) });
const elixirAt = (days) => new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
const initial = actions.useGame.get();
const potion = { ...elixir('health', 33), name: 'Зелье', type: 'potion' };

// Legacy stacks receive a full, one-time 7-day grace without losing quantity.
const oldState = { ...initial, inventory: [elixir('legacy', 933), potion],
  belt: [elixir('belt-old', 5), ...Array(6).fill(null)] };
const dated = expiry.reconcileElixirExpiry(oldState, start);
assert.equal(dated.inventory[0].qty, 933);
assert.equal(dated.inventory[0].expiresAt, elixirAt(7));
assert.equal(dated.belt[0].expiresAt, elixirAt(7));
assert.equal(dated.inventory[1], potion);
assert.equal(expiry.reconcileElixirExpiry(dated, start + 1000), dated, 'expiry must never be refreshed');
assert.equal(expiry.reconcileElixirExpiry(dated, start + 7 * 86400000 - 1).inventory.length, 2);
const expired = expiry.reconcileElixirExpiry(dated, start + 7 * 86400000);
assert.deepEqual(expired.inventory, [potion], 'only elixirs expire');
assert.equal(expired.belt[0], null);
assert.equal(expired.player.gold, initial.player.gold);
assert.equal(expired.player.gems, initial.player.gems);

// When a different date was selected, equip the batch that expires first.
const later = elixir('newer', 8, elixirAt(6));
const earlier = elixir('older', 8, elixirAt(2));
const stock = { ...initial, inventory: [later, earlier], belt: Array(7).fill(null) };
const ctx = { level: 99, activeDays: 99, arenaWins: 10000 };
const first = belt.putInBelt(stock, later.id, ctx);
assert.equal(first.belt[0].expiresAt, earlier.expiresAt);
assert.equal(first.belt[0].qty, 5);
assert.equal(first.inventory.find((i) => i.id === earlier.id).qty, 3);
const second = belt.putInBelt(first, later.id, ctx);
assert.equal(second.belt[0].qty, 5, 'other expiry must not be mixed into a slot');
assert.equal(second.belt[1].expiresAt, earlier.expiresAt);
assert.equal(second.belt[1].qty, 3);
const third = belt.putInBelt(second, later.id, ctx);
assert.equal(third.belt[2].expiresAt, later.expiresAt);
assert.equal(third.belt[2].qty, 5);
const returned = belt.takeFromBelt(third, 1);
assert.equal(returned.inventory.find((i) => i.expiresAt === earlier.expiresAt).qty, 3);
assert.equal(belt.beltAction(elixir('bad', 2, elixirAt(-1))), null);
assert.equal(belt.canBelt(elixir('bad', 2, new Date(Date.now() - 1000).toISOString())), false);

// Shop and crafting create new, separately dated supplies, never prolong old batches.
const shopItem = { id: 'test-elixir', name: 'Эликсир силы', icon: '💪', type: 'elixir', rarity: 'common',
  priceGold: 1, description: '+10 атаки', effect: { stat: 'attack', value: 10, duration: 'battle' } };
const buyState = { ...initial, inventory: [earlier], player: { ...initial.player, gold: 1000 } };
const bought = actions.buyItem(buyState, shopItem, 2);
assert.ok(bought);
assert.equal(bought.inventory.length, 2);
assert.equal(bought.inventory[0].expiresAt, earlier.expiresAt);
assert.equal(bought.inventory[0].qty, 8);
assert.equal(bought.inventory[1].qty, 2);
assert.ok(Date.parse(bought.inventory[1].expiresAt) > Date.now() + 6 * 86400000);

const recipe = professions.PROFESSION_RECIPES.find((r) => r.output.type === 'elixir');
assert.ok(recipe, 'elixir crafting recipe should exist');
const resources = recipe.ingredients.map((i) => ({ id: i.id, qty: i.qty + 10, type: 'material' }));
const crafted = professions.craftItem([...resources, earlier], recipe);
assert.ok(crafted);
assert.equal(crafted.find((i) => i.id === earlier.id).qty, 8);
assert.ok(crafted.some((i) => i.type === 'elixir' && i.expiresAt !== earlier.expiresAt));

console.log('Elixir expiry, legacy grace, oldest-first belt, safe stacking, purchases and crafting: OK');
