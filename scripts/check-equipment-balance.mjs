import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch {
  // Permit running focused checks where project dependencies are incomplete but
  // a global TypeScript compiler is available. Resolve its real install path.
  const tscPath = fs.realpathSync(execFileSync('which', ['tsc'], { encoding: 'utf8' }).trim());
  const globalTypeScript = path.resolve(path.dirname(tscPath), '..', 'lib', 'typescript.js');
  ts = require(globalTypeScript);
}

const root = process.cwd();
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'territory-balance-'));
const sources = ['types.ts', 'equipmentCatalog.ts', 'equipmentBalance.ts', 'engine.ts'];

for (const file of sources) {
  const sourcePath = path.join(root, 'src/game', file);
  const outputPath = path.join(out, file.replace(/\.ts$/, '.js'));
  const source = fs.readFileSync(sourcePath, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${file} should transpile without syntax errors`);
  fs.writeFileSync(outputPath, result.outputText);
}

const testRequire = createRequire(import.meta.url);
const balance = testRequire(path.join(out, 'equipmentBalance.js'));
const catalog = testRequire(path.join(out, 'equipmentCatalog.js'));
const engine = testRequire(path.join(out, 'engine.js'));

assert.equal(catalog.EQUIPMENT_TEMPLATES.length, 10, 'all current shop equipment templates should be in the canonical catalog');
assert.equal(catalog.SHOP_EQUIPMENT_ITEMS.length, 10, 'shop availability should remain separate from the base stats catalog');
assert.equal(new Set(catalog.EQUIPMENT_TEMPLATES.map((item) => item.id)).size, catalog.EQUIPMENT_TEMPLATES.length, 'equipment template IDs must be unique');
for (const shopItem of catalog.SHOP_EQUIPMENT_ITEMS) {
  assert.ok(shopItem.equipment, `${shopItem.name} must have canonical equipment stats`);
  const prepared = balance.prepareNewEquipment(shopItem.equipment);
  assert.equal(prepared.baseLevel, shopItem.equipment.level, `${shopItem.name} must retain its original level`);
  assert.equal(prepared.upgradeCount, 0, `${shopItem.name} must start with zero forge upgrades`);
  assert.deepEqual(prepared.baseStats, {
    ...(shopItem.equipment.attack !== undefined ? { attack: shopItem.equipment.attack } : {}),
    ...(shopItem.equipment.defense !== undefined ? { defense: shopItem.equipment.defense } : {}),
    ...(shopItem.equipment.hp !== undefined ? { hp: shopItem.equipment.hp } : {}),
    ...(shopItem.equipment.critChance !== undefined ? { critChance: shopItem.equipment.critChance } : {}),
  }, `${shopItem.name} baseline must match its catalog stats`);
}
assert.equal(catalog.createBossLootEquipment(24, true, 'loot_test').attack, 82, 'chapter loot should use the canonical base-stat factory');
assert.equal(catalog.createBossLootEquipment(58, false, 'loot_armor').defense, 121, 'high-chapter armor should be generated from the shared formula');
assert.equal(catalog.rarityForChapter(1), 'common');
assert.equal(catalog.rarityForChapter(10), 'rare');
assert.equal(catalog.rarityForChapter(20), 'epic');
assert.equal(catalog.rarityForChapter(30), 'legendary');

const heroicLegacy = {
  id: 'inventory-heroic', slot: 'weapon', name: 'Героический меч', icon: '🔱',
  rarity: 'epic', attack: 64767, critChance: 8, level: 58,
};
const heroic = balance.normalizeEquipmentForTests(heroicLegacy);
assert.equal(heroic.attack, 141, 'heroic sword compound growth should normalize onto the rarity-based linear curve');
assert.equal(heroic.baseLevel, 5);
assert.equal(heroic.upgradeCount, 53);
assert.equal(balance.normalizeEquipmentForTests(heroic).attack, 141, 'normalization must be idempotent');
const earlierFoundationHeroic = { ...heroic, attack: 128 };
assert.equal(balance.normalizeEquipmentForTests(earlierFoundationHeroic).attack, 141, 'items carrying metadata from the earlier development formula must move to the current curve');
assert.equal(balance.upgradeEquipment(heroic).attack, 143, 'the next upgrade should use rarity-based growth, not compound growth');
const twiceForged = balance.upgradeEquipment(balance.upgradeEquipment(heroic));
assert.equal(twiceForged.attack, 145, 'successive upgrades must derive from the immutable baseline');
assert.equal(twiceForged.upgradeCount, 55, 'upgrade count must track successful forge steps');
assert.equal(twiceForged.baseStats.attack, 35, 'forge must not mutate immutable baseline stats');

function oldForge(value, upgrades) {
  let result = value;
  for (let i = 0; i < upgrades; i++) result += Math.ceil(result * 0.15);
  return result;
}

const lootLegacy = {
  id: 'loot_test', slot: 'weapon', name: 'Клинок победителя', icon: '⚔️',
  rarity: 'epic', attack: 9923, defense: 0, hp: 0, level: 58,
};
const loot = balance.normalizeEquipmentForTests(lootLegacy);
assert.equal(loot.baseLevel, 24, 'legacy boss-drop origin chapter should be inferred');
assert.equal(loot.attack, 150, 'legacy boss loot should normalize to rarity-based linear growth');

const adminScaledLoot = {
  id: 'loot_admin_scaled', slot: 'weapon', name: 'Клинок победителя', icon: '⚔️',
  rarity: 'epic', attack: Math.round(82 * Math.pow(1.15, 34)), defense: 0, hp: 0, level: 58,
};
const adminNormalized = balance.normalizeEquipmentForTests(adminScaledLoot);
assert.equal(adminNormalized.baseLevel, 24, 'migration should also recognize legacy admin level grants');
assert.equal(adminNormalized.attack, 150, 'admin-scaled legacy equipment should normalize onto the same curve');

const armorLegacy = {
  id: 'loot_armor_test', slot: 'armor', name: 'Доспех воина', icon: '🛡️',
  rarity: 'epic', attack: 0, defense: oldForge(53, 34), hp: oldForge(140, 34), level: 58,
};
const armor = balance.normalizeEquipmentForTests(armorLegacy);
assert.equal(armor.baseLevel, 24);
assert.equal(armor.defense, 79);
assert.equal(armor.hp, 208);

const unknown = {
  id: 'custom-admin-item', slot: 'weapon', name: 'Неизвестный клинок', icon: '⚔️',
  rarity: 'legendary', attack: 777, level: 30,
};
const preserved = balance.normalizeEquipmentForTests(unknown);
assert.equal(preserved.attack, 777, 'unknown legacy equipment should be preserved rather than destructively guessed');
assert.equal(balance.upgradeEquipment(preserved).attack, 780, 'unknown legendary gear should use fixed legendary growth for future upgrades');

const customSameName = {
  id: 'custom-crafted-heroic', slot: 'weapon', name: 'Героический меч', icon: '🔱',
  rarity: 'epic', attack: 999, critChance: 12, level: 30,
};
const preservedSameName = balance.normalizeEquipmentForTests(customSameName);
assert.equal(preservedSameName.attack, 999, 'custom equipment sharing a shop name must not be reset to the shop template');
assert.equal(preservedSameName.baseLevel, 30, 'unrecognized custom equipment must retain its current level as the baseline');
assert.equal(balance.upgradeEquipment(preservedSameName).attack, 1001, 'custom same-name equipment must use controlled growth only for future upgrades');

const lowerLevel = balance.setEquipmentLevel(heroic, 2);
assert.equal(lowerLevel.level, 5, 'level grants should not drop an item below its original template level');
assert.equal(lowerLevel.attack, 35, 'lower target level should not change the base stats');

const initial = engine.createInitialGame();
assert.equal(initial.balanceVersion, balance.EQUIPMENT_BALANCE_VERSION, 'new saves should carry the current migration version');
const migrated = balance.migrateGameStateBalance({
  player: { equipped: { weapon: heroicLegacy } },
  inventory: [{ id: 'saved-loot', name: lootLegacy.name, icon: lootLegacy.icon, type: 'equipment', rarity: lootLegacy.rarity, qty: 1, description: '', equipment: lootLegacy }],
});
assert.equal(migrated.balanceVersion, balance.EQUIPMENT_BALANCE_VERSION);
assert.equal(migrated.player.equipped.weapon.attack, 141);
assert.equal(migrated.inventory[0].equipment.attack, 150);

// A save produced by the earlier v2 development formula must be recalculated
// from its immutable baseline when moving to v3, not skipped as already current.
const v2SavedState = {
  balanceVersion: 2,
  player: { equipped: { weapon: {
    ...heroic,
    attack: 128,
    baseLevel: 5,
    baseStats: { attack: 35, critChance: 8 },
    upgradeCount: 53,
    level: 58,
  } } },
};
const migratedV2 = balance.migrateGameStateBalance(v2SavedState);
assert.equal(migratedV2.balanceVersion, balance.EQUIPMENT_BALANCE_VERSION);
assert.equal(migratedV2.player.equipped.weapon.attack, 141, 'v2 development saves must be recalculated on the v3 curve');
assert.equal(migratedV2.player.equipped.weapon.critChance, 8, 'migration must preserve fixed critical chance');
const migratedBelt = balance.migrateGameStateBalance({
  belt: [null, { id: 'belt-loot', name: lootLegacy.name, icon: lootLegacy.icon, type: 'equipment', rarity: lootLegacy.rarity, qty: 1, description: '', equipment: lootLegacy }],
});
assert.equal(migratedBelt.belt[1].equipment.attack, 150, 'legacy equipment in belt slots must also migrate');
assert.equal(migratedBelt.belt.length, 2, 'migration must preserve belt shape instead of padding/truncating');
const alreadyCurrentCustom = {
  balanceVersion: balance.EQUIPMENT_BALANCE_VERSION,
  player: { equipped: { weapon: { ...preserved, attack: 888, baseLevel: 25, baseStats: { attack: 777 }, upgradeCount: 5, level: 30 } } },
};
assert.equal(balance.migrateGameStateBalance(alreadyCurrentCustom).player.equipped.weapon.attack, 888, 'current-version custom crafted stats should not be reinterpreted on each load');

// Level-58 worst-case single strike check: a full epic damage kit must not one-shot the weakest chapter enemy.
const baseState = engine.createInitialGame();
baseState.player.level = 58;
baseState.player.stats = { hp: 1240, maxHp: 1240, attack: 305, defense: 119, critChance: 5, critDamage: 50 };
const templateById = (id) => catalog.EQUIPMENT_TEMPLATES.find((item) => item.id === id);
const forgedHeroic = balance.setEquipmentLevel(balance.prepareNewEquipment(templateById('shop_weapon_hero_eq')), 58);
const forgedRing = balance.setEquipmentLevel(balance.prepareNewEquipment(templateById('shop_ring_power_eq')), 58);
const forgedAmulet = balance.setEquipmentLevel(balance.prepareNewEquipment(templateById('shop_amulet_raven_eq')), 58);
baseState.player.equipped = { weapon: forgedHeroic, ring: forgedRing, amulet: forgedAmulet };
const heroStats = engine.getComputedStats(baseState);
assert.equal(heroStats.attack, 535, 'slot-specific growth should keep a level-58 epic damage kit within the intended range');
const lateChapter = engine.generateChapter(58);
assert.equal(lateChapter.enemies[0].maxHp, 1220, 'chapter enemy HP should receive the 25% balancing increase');
assert.equal(lateChapter.boss.maxHp, 3355, 'boss HP should use the same adjusted chapter baseline');
const weakestEnemy = lateChapter.enemies[0];
const worstCriticalHeadHit = (heroStats.attack - weakestEnemy.defense / 2) * 1.25 * 1.1 * (1 + heroStats.critDamage / 100);
assert.ok(worstCriticalHeadHit < weakestEnemy.maxHp, 'the strongest theoretical head critical should not one-shot a normal chapter-58 enemy');

console.log('Balance checks passed: canonical item data, legacy normalization, old admin-level grants, idempotency, unknown-item safety, and a chapter-58 one-shot guard.');
fs.rmSync(out, { recursive: true, force: true });
