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
const sources = ['types.ts', 'equipmentCatalog.ts', 'equipmentBalance.ts', 'antiLevelPreview.ts', 'weeklyQuests.ts', 'pveBalance.ts', 'elixirExpiry.ts', 'followers.ts', 'engine.ts'];

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
const antiLevel = testRequire(path.join(out, 'antiLevelPreview.js'));
const catalog = testRequire(path.join(out, 'equipmentCatalog.js'));
const engine = testRequire(path.join(out, 'engine.js'));

// PvE combat must never mint new equipment: neither boss generation nor victory processing.
for (const chapterNum of [1, 10, 58, 3000]) {
  const chapter = engine.generateChapter(chapterNum);
  assert.equal(chapter.boss.rewardLoot, undefined, `chapter ${chapterNum} boss must not drop gear`);
  assert(chapter.enemies.every((enemy) => enemy.rewardLoot === undefined), 'normal enemies must not drop gear');
}
const actionsSource = fs.readFileSync(path.join(root, 'src/game/actions.ts'), 'utf8');
const pveSource = fs.readFileSync(path.join(root, 'src/components/pve/PveFight.tsx'), 'utf8');
assert.doesNotMatch(actionsSource, /rewards\.loot/, 'battle rewards must never add equipment to inventory');
assert.doesNotMatch(pveSource, /enemy\.rewardLoot|outcome\.loot/, 'PvE UI must not promise disabled equipment drops');

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
assert.equal(catalog.createBossLootEquipment(24, true, 'loot_test').attack, 50, 'chapter loot should use the canonical base-stat factory');
assert.equal(catalog.createBossLootEquipment(58, false, 'loot_armor').defense, 40, 'high-chapter armor should be generated from the shared formula');
assert.equal(catalog.rarityForChapter(1), 'common');
assert.equal(catalog.rarityForChapter(10), 'rare');
assert.equal(catalog.rarityForChapter(20), 'rare');
assert.equal(catalog.rarityForChapter(30), 'rare');


// Strict owner rule: old commons and old rares remain untouched, paid epic shop
// purchases retain their original epic stats. Only higher-grade loot is changed.
const oldCommonBoss={id:'loot_common_7',name:'Клинок победителя',icon:'⚔️',
  slot:'weapon',rarity:'common',level:7,attack:31,baseLevel:7,baseStats:{attack:31},upgradeCount:0};
assert.deepEqual(balance.rebalanceHistoricalRarity(oldCommonBoss),oldCommonBoss);
const oldRareBoss={id:'loot_rare_15',name:'Доспех воина',icon:'🛡️',
  slot:'armor',rarity:'rare',level:15,defense:35,hp:95,baseLevel:15,baseStats:{defense:35,hp:95},upgradeCount:0};
assert.deepEqual(balance.rebalanceHistoricalRarity(oldRareBoss),oldRareBoss);
const historicPurchased={id:'historic-paid',name:'Героический меч',icon:'🔱',
  slot:'weapon',rarity:'epic',level:58,attack:141,critChance:8,
  baseLevel:5,baseStats:{attack:35,critChance:8},upgradeCount:53};
assert.deepEqual(balance.rebalanceHistoricalRarity(historicPurchased),historicPurchased,
  'Purchased epic items are not part of the old boss-loot downgrade');
const oldLegendary={id:'loot_legend_59',name:'Доспех воина',icon:'🛡️',
  slot:'armor',rarity:'legendary',level:59,baseLevel:46,upgradeCount:13,
  baseStats:{defense:200,hp:530},defense:253,hp:641};
const rareLegendary=balance.rebalanceHistoricalRarity(oldLegendary);
assert.equal(rareLegendary.rarity,'rare');
assert.equal(rareLegendary.level,59);
assert.equal(rareLegendary.baseLevel,46);
assert.equal(rareLegendary.upgradeCount,13);
assert.equal(rareLegendary.defense,12+Math.round(0.5*(46-3))+Math.round(0.5*13));
assert.equal(rareLegendary.hp,80+Math.round(1.5*(46-3))+Math.round(1.5*13));
assert.equal(balance.upgradeEquipment(rareLegendary).level,60);
assert.equal(balance.upgradeEquipment(rareLegendary).upgradeCount,14);
assert.deepEqual(balance.rebalanceHistoricalRarity(rareLegendary),rareLegendary);
assert.equal(catalog.SHOP_EQUIPMENT_ITEMS.filter(x=>x.rarity==='epic').length,0);
assert.equal(catalog.SHOP_EQUIPMENT_ITEMS.find(x=>x.id==='shop_weapon_hero').equipment.attack,22);
assert.equal(catalog.SHOP_EQUIPMENT_ITEMS.find(x=>x.id==='shop_ring_power').equipment.critChance,3);

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
assert.equal(loot.baseLevel, 58, 'overpowered unknown boss loot is capped at its saved level');
assert.equal(loot.attack, 101, 'huge boss loot is capped to a generous level-relative maximum');

const adminScaledLoot = {
  id: 'loot_admin_scaled', slot: 'weapon', name: 'Клинок победителя', icon: '⚔️',
  rarity: 'epic', attack: Math.round(82 * Math.pow(1.15, 34)), defense: 0, hp: 0, level: 58,
};
const adminNormalized = balance.normalizeEquipmentForTests(adminScaledLoot);
assert.equal(adminNormalized.baseLevel, 58, 'admin-inflated loot cannot keep exponential baselines');
assert.equal(adminNormalized.attack, 101, 'admin-scaled legacy equipment is capped on the server and client');

const armorLegacy = {
  id: 'loot_armor_test', slot: 'armor', name: 'Доспех воина', icon: '🛡️',
  rarity: 'epic', attack: 0, defense: oldForge(53, 34), hp: oldForge(140, 34), level: 58,
};
const armor = balance.normalizeEquipmentForTests(armorLegacy);
assert.equal(armor.baseLevel, 58);
assert.equal(armor.defense, 40);
assert.equal(armor.hp, 163);

const unknown = {
  id: 'custom-admin-item', slot: 'weapon', name: 'Неизвестный клинок', icon: '⚔️',
  rarity: 'legendary', attack: 777, level: 30,
};
const preserved = balance.normalizeEquipmentForTests(unknown);
assert.equal(preserved.attack, 220, 'suspiciously large custom equipment must be capped without deleting the item');
assert.equal(balance.upgradeEquipment(preserved).attack, 223, 'custom equipment retains linear forge growth after normalization');

const customSameName = {
  id: 'custom-crafted-heroic', slot: 'weapon', name: 'Героический меч', icon: '🔱',
  rarity: 'epic', attack: 999, critChance: 12, level: 30,
};
const preservedSameName = balance.normalizeEquipmentForTests(customSameName);
assert.equal(preservedSameName.attack, 85, 'fake huge stats on recognizable shop gear must not survive');
assert.equal(preservedSameName.baseLevel, 5, 'recognized shop gear is rebuilt from catalog baseline');
assert.equal(balance.upgradeEquipment(preservedSameName).attack, 87, 'known-name equipment uses controlled canonical growth');

// The owner must be able to lower historic boss gear whose base level was
// originally the chapter number. This action must DECREASE stats, not merely
// relabel an old powerful item.
const highBossSword = balance.prepareNewEquipment(catalog.createBossLootEquipment(165, true, 'historic-sword'));
const fixedBossSword = balance.setAdminEquipmentLevel(highBossSword, 82);
assert.equal(fixedBossSword.id, highBossSword.id, 'admin correction keeps item identity');
assert.equal(fixedBossSword.level, 82, 'admin correction must lower a historic boss sword');
assert.equal(fixedBossSword.baseLevel, 82, 'corrected boss sword baseline must match target');
assert.equal(fixedBossSword.upgradeCount, 0, 'correction resets high-chapter upgrade baseline');
assert.equal(fixedBossSword.attack, 18 + Math.round(1.5 * (82 - 3)), 'sword attack must drop to level-82 boss formula');
assert.equal(balance.normalizeEquipmentForTests(fixedBossSword).attack, fixedBossSword.attack,
  'server-compatible normalization must not restore old strength');
const highBossArmor = balance.prepareNewEquipment(catalog.createBossLootEquipment(164, false, 'historic-armor'));
const fixedBossArmor = balance.setAdminEquipmentLevel(highBossArmor, 82);
assert.equal(fixedBossArmor.id, highBossArmor.id);
assert.equal(fixedBossArmor.level, 82, 'admin correction must lower historic boss armor');
assert.equal(fixedBossArmor.defense, 12 + Math.round(0.5 * (82 - 3)), 'level-82 boss armor defense');
assert.equal(fixedBossArmor.hp, 80 + Math.round(1.5 * (82 - 3)), 'level-82 boss armor HP');
const customHigh = {
  id: 'custom-overlevel', name: 'Custom blade', slot: 'weapon', rarity: 'legendary',
  level: 164, attack: 900, baseLevel: 164, baseStats: { attack: 900 }, upgradeCount: 0,
};
const customDown = balance.setAdminEquipmentLevel(customHigh, 82);
assert.equal(customDown.level, 82);
assert(customDown.attack < customHigh.attack, 'custom gear must lose high-level attack');
assert(customDown.attack <= 40 + 6 * 82, 'custom correction respects server attack cap');
assert.equal(balance.setAdminEquipmentLevel(heroic, 2).level, 5,
  'shop gear may not be reduced below its original template level');
assert.equal(balance.setAdminEquipmentLevel(highBossSword, 501).level, 165,
  'out-of-range admin correction must be ignored');
const liveSource = fs.readFileSync(path.join(root, 'src/game/live.ts'), 'utf8');
const adminUiSource = fs.readFileSync(path.join(root, 'src/admin/tabs/PlayersTab.tsx'), 'utf8');
assert.match(liveSource, /setAdminEquipmentLevel\(eq, level\)/,
  'owner correction must use the dedicated decrease-safe helper');
assert.match(adminUiSource, /set_test_gear_level/,
  'admin panel must route owner testing through the secured server action');
assert.match(adminUiSource, /Уровень .*и характеристики сохранены на сервере/,
  'admin panel must confirm actual server-calculated equipment stats, not only a changed level');
assert.match(adminUiSource, /result\.gear\?\.level !== level/,
  'admin UI must reject an unconfirmed or mismatched equipment update');
assert.match(adminUiSource, /p\.equipped\[slot\]\.attack/,
  'admin UI must show the saved equipment damage alongside the item level');

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
assert.equal(migrated.inventory[0].equipment.attack, 101);

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
assert.equal(migratedBelt.belt[1].equipment.attack, 101, 'inflated equipment in belt slots must also migrate');
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
assert.equal(heroStats.attack, 478, 'slot-specific growth should keep a level-58 epic damage kit within the intended range');
const lateChapter = engine.generateChapter(58);
assert.equal(lateChapter.enemies[0].maxHp, Math.floor((75 + 58 * 25) * 0.8 * require(path.join(out, 'pveBalance.js')).chapterEnemyMultipliers(58).hp), 'chapter enemy HP should track gradual difficulty');
const bossAt58 = require(path.join(out, 'pveBalance.js')).bossEnemyMultipliers(58);
assert.equal(lateChapter.boss.maxHp, Math.floor((75 + 58 * 25) * 2.55 * require(path.join(out, 'pveBalance.js')).chapterEnemyMultipliers(58).hp * bossAt58.hp), 'boss HP should include campaign curve and its milestone scaling');
const weakestEnemy = lateChapter.enemies[0];
const worstCriticalHeadHit = (heroStats.attack - weakestEnemy.defense / 2) * 1.25 * 1.1 * (1 + heroStats.critDamage / 100);
assert.ok(worstCriticalHeadHit < weakestEnemy.maxHp, 'the strongest theoretical head critical should not one-shot a normal chapter-58 enemy');


// Permanent hero-level gear rule: old loot, shop, custom gear, player gear slots and grants.
const heroLevel47Sword = balance.capEquipmentToHeroLevel(
  catalog.createBossLootEquipment(85, true, 'old-loot-85'), 47);
assert.equal(heroLevel47Sword.level, 47);
assert.equal(heroLevel47Sword.attack, 84);
assert.equal(heroLevel47Sword.id, 'old-loot-85');
const heroLevel47Armor = balance.capEquipmentToHeroLevel(
  catalog.createBossLootEquipment(87, false, 'old-loot-87'), 47);
assert.equal(heroLevel47Armor.level, 47);
assert.equal(heroLevel47Armor.defense, 34);
assert.equal(heroLevel47Armor.hp, 146);
const levelOneEpic = balance.capEquipmentToHeroLevel(
  catalog.EQUIPMENT_TEMPLATES.find((t) => t.name === 'Героический меч'), 1);
assert.equal(levelOneEpic.level, 1);
assert.equal(levelOneEpic.attack, 4);
assert.equal(levelOneEpic.critChance, 1);
assert.deepEqual(balance.capEquipmentToHeroLevel(levelOneEpic, 1), levelOneEpic,
  'Repeated saves cannot resurrect catalog stats');
const upgradedEpic = balance.upgradeEquipment(levelOneEpic);
assert.equal(upgradedEpic.level, 2);
assert.equal(upgradedEpic.attack, 9,
  'Forging an item below its catalog minimum must never jump back to level 5');
const levelThreePlate = balance.capEquipmentToHeroLevel(
  catalog.EQUIPMENT_TEMPLATES.find((t) => t.name === 'Латные доспехи'), 2);
assert.equal(levelThreePlate.level, 2);
assert.equal(levelThreePlate.defense, 8);
assert.equal(levelThreePlate.hp, 53);
const customReduced = balance.capEquipmentToHeroLevel(
  { id:'custom-high', name:'Custom', slot:'shield', rarity:'legendary',
    level:100, defense:250, hp:500 }, 8);
assert.equal(customReduced.level, 8);
assert.equal(customReduced.defense, 20);
assert.equal(customReduced.hp, 40);
// A level-50 item must remain exactly the same object at handoff. Its buyer
// continues with level 51 rather than recreating a level-1 item.
const sellerItem=balance.setEquipmentLevel(balance.prepareNewEquipment({
  id:'seller-legendary-123',name:'Клинок древних',slot:'weapon',icon:'🔱',rarity:'legendary',
  attack:46,critChance:9,level:5,
}),50);
const buyerInventoryCopy={...sellerItem,baseStats:{...sellerItem.baseStats}};
assert.equal(buyerInventoryCopy.level,50);
assert.equal(buyerInventoryCopy.upgradeCount,45);
assert.deepEqual(buyerInventoryCopy.baseStats,sellerItem.baseStats);
const buyerNext=balance.upgradeEquipment(buyerInventoryCopy);
assert.equal(buyerNext.id,sellerItem.id,'Transferred item must retain its original identity');
assert.equal(buyerNext.level,51,'New owner upgrades from 50 to 51, not from its crafting baseline');
assert.equal(buyerNext.upgradeCount,46);
assert.equal(buyerNext.attack,sellerItem.attack+3);
assert.equal(sellerItem.level,50,'A transfer must not mutate the former owner snapshot');

const actionsAfter = fs.readFileSync(path.join(root, 'src/game/actions.ts'), 'utf8');
const cloudAfter = fs.readFileSync(path.join(root, 'src/game/cloud.ts'), 'utf8');
const liveAfter = fs.readFileSync(path.join(root, 'src/game/live.ts'), 'utf8');
const guardSql = fs.readFileSync(path.join(root, 'supabase/migrations/20261018_permanent_gear_level_rule.sql'), 'utf8');
assert.match(actionsAfter, /capEquipmentToHeroLevel\(prepareNewEquipment/, 'shop caps every new purchased item');
assert.match(actionsAfter, /capEquipmentToHeroLevel\(item\.equipment, state\.player\.level\)/, 'equipping never bypasses hero-level cap');
assert.match(actionsAfter, /if \(item\.equipment\.level > state\.player\.level\) return state;/,
  'Under-levelled users must not destroy traded equipment stats by equipping');
const showcase=fs.readFileSync(path.join(root, 'src/components/GearShowcase.tsx'), 'utf8');
assert.match(showcase, /candidate\?\.level \?\? 0\) > state\.player\.level/,
  'Over-levelled item must be visibly blocked from equipping');
assert.match(cloudAfter, /capEquipmentToHeroLevel\(eq, heroLevel\)/, 'cloud loaded equipment is capped');
assert.match(liveAfter, /ownerApproved \? \{ \.\.\.item, adminTestLevel: true \} : capEquipmentToHeroLevel\(item, heroLevel\)/,
  'only the explicit owner test grant may bypass the local hero-level cap');
assert.match(liveAfter, /p\.adminTestLevel === true && p\.adminTestGearId === eq\.id/,
  'owner test grants must bind to the exact equipped item ID');
const ownerTestSql = fs.readFileSync(path.join(root, 'supabase/migrations/20261022_owner_test_equipment_levels.sql'), 'utf8');
assert.match(ownerTestSql, /REVOKE ALL ON FUNCTION public\.territory_owner_authorize_test_gear_v1/,
  'ordinary accounts cannot authorize over-level gear on the server');
assert.match(guardSql, /BEFORE INSERT OR UPDATE OF game_state, attack, defense, max_hp, crit_chance/);
assert.match(guardSql, /cap_overlevel_state_20261018\(/);

// Owner decision 08.11: trade/ownership is level-agnostic; Anti-Level is optional
// and currently a non-mutating visual preview, NOT a client-side forge action.
const traderGear = {
  id: 'stage8_50000000-0000-4000-8000-000000000050',
  slot: 'weapon', name: 'Меч мастера', icon: '⚔️', rarity: 'rare',
  level: 50, baseLevel: 1, upgradeCount: 49, attack: 118,
  baseStats: { attack: 20 },
};
const unchangedTradeSnapshot = structuredClone(traderGear);
const previewForLevel10 = antiLevel.previewAntiLevel(traderGear, 10);
assert.equal(previewForLevel10?.fromLevel, 50);
assert.equal(previewForLevel10?.toLevel, 10);
assert.equal(previewForLevel10?.removedLevels, 40);
assert.equal(previewForLevel10?.estimated.id, traderGear.id,
  'Preview must retain item identity; actual trade is NOT a re-craft');
assert.equal(previewForLevel10?.estimated.rarity, 'rare');
assert.equal(previewForLevel10?.estimated.level, 10);
assert.ok((previewForLevel10?.estimated.attack ?? 0) < traderGear.attack,
  'Low-level anti-level conversion must not keep original level-50 attack');
assert.deepEqual(traderGear, unchangedTradeSnapshot,
  'An ordinary level-10 merchant must retain the level-50 original unchanged');
assert.equal(antiLevel.previewAntiLevel(traderGear, 50), null,
  'No anti-level reduction exists when hero already meets item level');
assert.equal(antiLevel.previewAntiLevel(traderGear, 1.5), null);
assert.equal(antiLevel.previewAntiLevel(traderGear, 0), null);
const adminSnapshot = { ...traderGear, adminTestLevel: true };
assert.equal(antiLevel.previewAntiLevel(adminSnapshot, 10)?.estimated.level, 10,
  'The preview must ignore owner-only admin test bypass flags');
assert.deepEqual(adminSnapshot, { ...traderGear, adminTestLevel: true },
  'Preview never alters the live object even when administrative flags exist');
const antiLevelSource = fs.readFileSync(path.join(root, 'src/game/antiLevelPreview.ts'), 'utf8');
assert.doesNotMatch(antiLevelSource, /saveCloudSave|supabase|forgeAttempt|inventory\.splice|localStorage/,
  'Anti-Level preview cannot spend, change ownership, or write to the server');
const forgeUiSource = fs.readFileSync(path.join(root, 'src/components/ForgeScreen.tsx'), 'utf8');
assert.match(forgeUiSource, /data-testid="anti-level-preview"/,
  'Forge must show the result preview to a hero holding over-levelled equipment');

console.log('Balance checks passed: canonical item data, legacy normalization, old admin-level grants, idempotency, unknown-item safety, and a chapter-58 one-shot guard.');
fs.rmSync(out, { recursive: true, force: true });
