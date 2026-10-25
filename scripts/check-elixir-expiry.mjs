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
const forge = await importSource('src/game/forge.ts');

const start = Date.parse('2026-10-25T12:00:00.000Z');
const elixir = (id, qty, expiresAt) => ({ id, qty, name: 'Эликсир силы', icon: '💪', type: 'elixir', rarity: 'common',
  description: '+10 атаки', effect: { stat: 'attack', value: 10, duration: 'battle' }, ...(expiresAt ? { expiresAt } : {}) });
const elixirAt = (days) => new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
const initial = actions.useGame.get();
const potion = { ...elixir('health', 33), name: 'Зелье', type: 'potion' };
const timePotion = { ...elixir('time', 4), name: 'Зелье времени', type: 'arena', arenaEffect: 'time' };

// Legacy stacks receive a full, one-time 7-day grace without losing quantity.
const oldState = { ...initial, inventory: [elixir('legacy', 933), potion, timePotion],
  belt: [elixir('belt-old', 5), ...Array(6).fill(null)] };
const dated = expiry.reconcileElixirExpiry(oldState, start);
assert.equal(dated.inventory[0].qty, 933);
assert.equal(dated.inventory[0].expiresAt, elixirAt(7));
assert.equal(dated.inventory[1].expiresAt, elixirAt(7), 'old health potions receive grace');
assert.equal(dated.inventory[2].expiresAt, elixirAt(7), 'old arena potions receive grace');
assert.equal(dated.belt[0].expiresAt, elixirAt(7));
assert.equal(dated.inventory[1].qty, potion.qty);
assert.equal(expiry.reconcileElixirExpiry(dated, start + 1000), dated, 'expiry must never be refreshed');
assert.equal(expiry.reconcileElixirExpiry(dated, start + 7 * 86400000 - 1).inventory.length, 3);
const expired = expiry.reconcileElixirExpiry(dated, start + 7 * 86400000);
assert.deepEqual(expired.inventory, [], 'elixirs, health and time potions expire together');
assert.equal(expired.belt[0], null);
assert.equal(expired.player.gold, initial.player.gold);
assert.equal(expired.player.gems, initial.player.gems);

// Old forge-material wallets receive a grace batch; new gains are independent,
// spend oldest first and expire after exactly seven days (including offline time).
const materialsOld = expiry.reconcileElixirExpiry({ ...initial, forgeMaterials: 100 }, start);
assert.deepEqual(materialsOld.forgeMaterialBatches, [{ qty: 100, expiresAt: elixirAt(7) }]);
const materialAdded = expiry.reconcileElixirExpiry({ ...materialsOld, forgeMaterials: 120 }, start + 86400000);
assert.equal(materialAdded.forgeMaterialBatches.length, 2);
assert.equal(materialAdded.forgeMaterialBatches[1].qty, 20);
assert.equal(materialAdded.forgeMaterialBatches[1].expiresAt, elixirAt(8));
const materialSpent = expiry.reconcileElixirExpiry({ ...materialAdded, forgeMaterials: 85 }, start + 2 * 86400000);
assert.equal(materialSpent.forgeMaterialBatches[0].qty, 65);
assert.equal(materialSpent.forgeMaterialBatches[1].qty, 20);
const materialExpired = expiry.reconcileElixirExpiry(materialSpent, start + 7 * 86400000);
assert.equal(materialExpired.forgeMaterials, 20);
assert.deepEqual(materialExpired.forgeMaterialBatches, [{qty:20,expiresAt:elixirAt(8)}]);
assert.equal(expiry.reconcileElixirExpiry(materialExpired, start + 8 * 86400000).forgeMaterials, 0);
assert.equal(expiry.reconcileElixirExpiry(materialExpired, start + 7 * 86400000), materialExpired, 'no extra expiry write');
const outOfDateMaterials = { ...initial, forgeMaterials: 10,
  forgeMaterialBatches: [{qty:10,expiresAt:new Date(Date.now() - 1000).toISOString()}],
  player: { ...initial.player, gold: 10000, level: 10, equipped: {
    weapon: { id: 'old-sword', name: 'Меч', icon: '⚔️', slot: 'weapon', rarity: 'common', level: 1 },
  } } };
const blockedForge = forge.forgeAttempt(outOfDateMaterials, 'equipped_old-sword', 1, 0);
assert.equal(blockedForge.status, 'invalid', 'expired materials must not fund an upgrade');
assert.equal(blockedForge.next.forgeMaterials, 0);

// Global game store must normalize all sources (shops, bosses, server rewards).
actions.useGame.set({ ...initial, forgeMaterials: 10, inventory: [potion] });
assert.equal(actions.useGame.get().forgeMaterialBatches[0].qty, 10);
assert.ok(actions.useGame.get().inventory[0].expiresAt);
actions.useGame.set((state) => ({ ...state, forgeMaterials: state.forgeMaterials + 4 }));
assert.equal(actions.useGame.get().forgeMaterialBatches.reduce((sum, lot) => sum + lot.qty, 0), 14);

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

// Health potions must also be equipped oldest-first, never extending the date.
const potionLate = { ...potion, id: 'p-late', expiresAt: elixirAt(6) };
const potionEarly = { ...potion, id: 'p-early', expiresAt: elixirAt(3) };
const potionEquipped = belt.putInBelt({ ...stock, inventory: [potionLate, potionEarly] }, potionLate.id, ctx);
assert.equal(potionEquipped.belt[0].expiresAt, potionEarly.expiresAt);

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
const potionShopItem = { ...shopItem, id: 'health', name: potion.name, type: 'potion' };
const boughtPotion = actions.buyItem({ ...buyState, inventory:[{...potion,expiresAt:elixirAt(2)}] }, potionShopItem, 3);
assert.equal(boughtPotion.inventory.length, 2);
assert.equal(boughtPotion.inventory[0].qty, 33);
assert.equal(boughtPotion.inventory[1].qty, 3);
assert.ok(boughtPotion.inventory[1].expiresAt);

const recipe = professions.PROFESSION_RECIPES.find((r) => r.output.type === 'elixir');
assert.ok(recipe, 'elixir crafting recipe should exist');
const resources = recipe.ingredients.map((i) => ({ id: i.id, qty: i.qty + 10, type: 'material' }));
const crafted = professions.craftItem([...resources, earlier], recipe);
assert.ok(crafted);
assert.equal(crafted.find((i) => i.id === earlier.id).qty, 8);
assert.ok(crafted.some((i) => i.type === 'elixir' && i.expiresAt !== earlier.expiresAt));

console.log('Seven-day elixir/potion/forge-material expiry, legacy grace, oldest-first belt and forge spending: OK');
