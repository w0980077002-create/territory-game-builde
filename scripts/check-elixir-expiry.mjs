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
assert.equal(expiry.elixirTimeLeftLabel(elixir('timer', 1, elixirAt(7)), 'ru', start), '',
  'Old expiry labels are never displayed');
assert.equal(expiry.isElixirExpired(elixir('very-old', 1, elixirAt(-100)), start + 5 * 86400000), false,
  'No consumable ever expires, including historically dated items');
const initial = actions.useGame.get();
const potion = { ...elixir('health', 33), name: 'Зелье', type: 'potion' };
const timePotion = { ...elixir('time', 4), name: 'Зелье времени', type: 'arena', arenaEffect: 'time' };
const legacyState = { ...initial,
  inventory: [elixir('legacy', 933, elixirAt(-100)), { ...potion, expiresAt: elixirAt(-50) },
    { ...timePotion, expiresAt: elixirAt(1) }],
  belt: [elixir('belt-old', 5, elixirAt(-90)), ...Array(6).fill(null)] };
const permanent = expiry.reconcileElixirExpiry(legacyState, start);
assert.equal(permanent.inventory[0].qty, 933);
assert.equal(permanent.inventory[1].qty, potion.qty);
assert.equal(permanent.inventory[2].qty, timePotion.qty);
assert.equal(permanent.belt[0].qty, 5);
assert(permanent.inventory.every(i => !Object.hasOwn(i, 'expiresAt')));
assert(!Object.hasOwn(permanent.belt[0], 'expiresAt'));
assert.strictEqual(expiry.reconcileElixirExpiry(permanent, start + 10 * 365 * 86400000), permanent,
  'Permanent inventory must stay unchanged years later');
assert.equal(permanent.player.gold, initial.player.gold);
assert.equal(permanent.player.gems, initial.player.gems);
assert.equal(expiry.newElixirBatch(elixir('legacy-batch', 3, elixirAt(-3))).expiresAt, undefined);
assert.equal(expiry.isElixirExpired(potion), false);
assert.equal(expiry.isElixirExpired(timePotion), false);

// Legacy material lots (even already expired) must NOT deplete materials.
const pastMaterialDate = new Date(start - 86400000).toISOString();
const materialsOld = expiry.reconcileElixirExpiry({ ...initial, forgeMaterials: 100,
  forgeMaterialBatches: [{ qty: 100, expiresAt: pastMaterialDate }] }, start);
assert.equal(materialsOld.forgeMaterials, 100);
assert.deepEqual(materialsOld.forgeMaterialBatches,
  [{ qty: 100, expiresAt: expiry.PERMANENT_FORGE_BATCH_EXPIRY }]);
const materialAdded = expiry.reconcileElixirExpiry({ ...materialsOld, forgeMaterials: 120 }, start + 86400000);
assert.deepEqual(materialAdded.forgeMaterialBatches,
  [{ qty: 120, expiresAt: expiry.PERMANENT_FORGE_BATCH_EXPIRY }]);
const materialSpent = expiry.reconcileElixirExpiry({ ...materialAdded, forgeMaterials: 85 }, start + 2 * 86400000);
assert.equal(materialSpent.forgeMaterialBatches[0].qty, 85);
const materialLater = expiry.reconcileElixirExpiry(materialSpent, start + 3650 * 86400000);
assert.equal(materialLater.forgeMaterials, 85, 'materials must remain permanent');
assert.deepEqual(materialLater.forgeMaterialBatches, materialSpent.forgeMaterialBatches);
const outOfDateMaterials = { ...initial, forgeMaterials: 10,
  forgeMaterialBatches: [{qty:10,expiresAt:new Date(Date.now() - 1000).toISOString()}],
  player: { ...initial.player, gold: 10000, level: 10, equipped: {
    weapon: { id: 'old-sword', name: 'Меч', icon: '⚔️', slot: 'weapon', rarity: 'common', level: 1 },
  } } };
const allowedForge = forge.forgeAttempt(outOfDateMaterials, 'equipped_old-sword', 1, 0);
assert.notEqual(allowedForge.status, 'invalid', 'old material dates must not prevent forging');
assert.equal(allowedForge.next.forgeMaterialBatches[0].expiresAt,
  expiry.PERMANENT_FORGE_BATCH_EXPIRY);

// Global game store must normalize all sources (shops, bosses, server rewards).
actions.useGame.set({ ...initial, forgeMaterials: 10, inventory: [potion] });
assert.equal(actions.useGame.get().forgeMaterialBatches[0].qty, 10);
assert.equal(actions.useGame.get().inventory[0].expiresAt, undefined, 'Store never introduces expiry dates');
actions.useGame.set((state) => ({ ...state, forgeMaterials: state.forgeMaterials + 4 }));
assert.equal(actions.useGame.get().forgeMaterialBatches.reduce((sum, lot) => sum + lot.qty, 0), 14);

// Same type, rarity and effect: multiple old lots merge into one belt slot in
// one click, including historical expired stock. No source is lost.
const older = elixir('older', 1, elixirAt(-300));
const newer = elixir('newer', 5, elixirAt(6));
const stock = { ...initial, inventory: [older, newer], belt: Array(7).fill(null) };
const ctx = { level: 99, activeDays: 99, arenaWins: 10000 };
const grouped = belt.groupConsumablesForDisplay(stock.inventory);
assert.equal(grouped.length, 1);
assert.equal(grouped[0].qty, 6);
assert.equal(grouped[0].expiresAt, undefined);
assert.equal(stock.inventory.length, 2, 'Display must not mutate original stock');
const first = belt.putInBelt(stock, newer.id, ctx);
assert(first);
assert.equal(first.belt[0].qty, 5, 'All five doses equipped at once');
assert.equal(first.belt[0].expiresAt, undefined);
assert.equal(first.inventory.find(i => i.id === older.id), undefined);
assert.equal(first.inventory.find(i => i.id === newer.id)?.qty, 1);
assert.equal(belt.putInBelt(first, newer.id, ctx), null, 'One kind cannot duplicate into second slot');
const returned = belt.takeFromBelt(first, 0);
assert.equal(returned.inventory.reduce((n, i) => n + i.qty, 0), 6);
assert.equal(returned.inventory.every(i => i.expiresAt === undefined), false,
  'Legacy source dates may remain until the next non-destructive normalization');
const cleaned = expiry.reconcileElixirExpiry(returned);
assert(cleaned.inventory.every(i => i.expiresAt === undefined));
const topUpStart = { ...stock,
  belt: [elixir('belt_0', 2, elixirAt(-50)), ...Array(6).fill(null)],
  inventory: [elixir('new-1', 1, elixirAt(-10)), elixir('new-2', 5, elixirAt(10))] };
const topUp = belt.putInBelt(topUpStart, 'new-2', ctx);
assert.equal(topUp.belt[0].qty, 5, 'Old ×2 topped to ×5 from separate lots');
assert.equal(topUp.inventory.find(i => i.id === 'new-2').qty, 3);
assert.equal(topUp.inventory.reduce((n, i) => n + i.qty, 0) +
  topUp.belt.filter(Boolean).reduce((n, i) => n + i.qty, 0), 8);
const other = { ...newer, id: 'defense', name: 'Эликсир защиты', effect: { stat: 'defense', value: 10 } };
const withDifferent = { ...first, inventory: [...first.inventory, other] };
const equippedDifferent = belt.putInBelt(withDifferent, 'defense', ctx);
assert.equal(equippedDifferent.belt[1].name, 'Эликсир защиты', 'Different kinds need separate unlocked slots');
assert.equal(belt.canBelt(elixir('old-but-valid', 1, elixirAt(-100))), true);

// Purchases never assign a seven-day deadline; previously stored batches remain usable.
const shopItem = { id: 'test-elixir', name: 'Эликсир силы', icon: '💪', type: 'elixir', rarity: 'common',
  priceGold: 1, description: '+10 атаки', effect: { stat: 'attack', value: 10, duration: 'battle' } };
const buyState = { ...initial, inventory: [newer], player: { ...initial.player, gold: 1000 } };
const bought = actions.buyItem(buyState, shopItem, 2);
assert.ok(bought);
assert.equal(bought.inventory.length, 2);
assert.equal(bought.inventory[0].qty, 5);
assert.equal(bought.inventory[1].qty, 2);
assert.equal(bought.inventory[1].expiresAt, undefined, 'Purchased potion is permanent');
const potionShopItem = { ...shopItem, id: 'health', name: potion.name, type: 'potion' };
const boughtPotion = actions.buyItem({ ...buyState, inventory: [potion] }, potionShopItem, 3);
assert.equal(boughtPotion.inventory[1].qty, 3);
assert.equal(boughtPotion.inventory[1].expiresAt, undefined, 'Purchased health potion is permanent');

const recipe = professions.PROFESSION_RECIPES.find((r) => r.output.type === 'elixir');
assert.ok(recipe, 'elixir crafting recipe should exist');
const resources = recipe.ingredients.map((i) => ({ id: i.id, qty: i.qty + 10, type: 'material' }));
const crafted = professions.craftItem([...resources, newer], recipe);
assert.ok(crafted);
assert.equal(crafted.find((i) => i.id === newer.id).qty, 5);
assert.ok(crafted.some((i) => i.type === 'elixir' && i.expiresAt === undefined));

console.log('Permanent consumables: no expiry, old stock preserved, cross-lot belt stacking, permanent forge materials: OK');
