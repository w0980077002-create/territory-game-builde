import type { Equipment, ShopItem } from './types';

export type EquipmentRarity = Equipment['rarity'];

export const EQUIPMENT_RARITIES: readonly EquipmentRarity[] = [
  'common',
  'rare',
  'epic',
  'legendary',
];

/**
 * All equipment sources use the same data definitions and balance rules.
 * Keep prices/availability in SHOP_EQUIPMENT_ITEMS and combat stats here.
 */
export const EQUIPMENT_TEMPLATES: Equipment[] = [
  { id: 'shop_weapon_warrior_eq', slot: 'weapon', name: 'Меч воина', icon: '⚔️', rarity: 'common', attack: 8, level: 1 },
  { id: 'shop_weapon_knight_eq', slot: 'weapon', name: 'Клинок рыцаря', icon: '🗡️', rarity: 'rare', attack: 18, critChance: 3, level: 3 },
  { id: 'shop_weapon_hero_eq', slot: 'weapon', name: 'Героический меч', icon: '🔱', rarity: 'epic', attack: 35, critChance: 8, level: 5 },
  { id: 'shop_armor_leather_eq', slot: 'armor', name: 'Кожаная броня', icon: '🦺', rarity: 'common', defense: 5, hp: 30, level: 1 },
  { id: 'shop_armor_plate_eq', slot: 'armor', name: 'Латные доспехи', icon: '🛡️', rarity: 'rare', defense: 12, hp: 80, level: 3 },
  { id: 'shop_helmet_iron_eq', slot: 'helmet', name: 'Железный шлем', icon: '⛑️', rarity: 'common', defense: 3, hp: 20, level: 1 },
  { id: 'shop_boots_swift_eq', slot: 'boots', name: 'Сапоги скорости', icon: '🥾', rarity: 'rare', defense: 4, hp: 40, critChance: 2, level: 2 },
  { id: 'shop_ring_power_eq', slot: 'ring', name: 'Кольцо силы', icon: '💍', rarity: 'epic', attack: 15, critChance: 5, level: 5 },
  { id: 'shop_shield_oak_eq', slot: 'shield', name: 'Дубовый щит', icon: '🛡️', rarity: 'common', defense: 5, hp: 25, level: 2 },
  { id: 'shop_amulet_raven_eq', slot: 'amulet', name: 'Амулет ворона', icon: '📿', rarity: 'rare', attack: 6, critChance: 3, level: 3 },
];

function template(id: string): Equipment {
  const found = EQUIPMENT_TEMPLATES.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown equipment template: ${id}`);
  return { ...found };
}

/** Shop prices/availability deliberately do not affect an item's base stats. */
export const SHOP_EQUIPMENT_ITEMS: ShopItem[] = [
  { id: 'shop_weapon_warrior', name: 'Меч воина', icon: '⚔️', type: 'equipment', rarity: 'common', priceGold: 100, description: 'Надёжный стальной меч. +8 к атаке.', equipment: template('shop_weapon_warrior_eq') },
  { id: 'shop_weapon_knight', name: 'Клинок рыцаря', icon: '🗡️', type: 'equipment', rarity: 'rare', priceGold: 300, description: 'Острый клинок. +18 к атаке, +3% крит.', equipment: template('shop_weapon_knight_eq') },
  { id: 'shop_weapon_hero', name: 'Героический меч', icon: '🔱', type: 'equipment', rarity: 'epic', priceGems: 30, priceGold: 0, description: 'Легендарное оружие. +35 к атаке, +8% крит.', equipment: template('shop_weapon_hero_eq') },
  { id: 'shop_armor_leather', name: 'Кожаная броня', icon: '🦺', type: 'equipment', rarity: 'common', priceGold: 100, description: 'Базовая защита. +5 к защите, +30 HP.', equipment: template('shop_armor_leather_eq') },
  { id: 'shop_armor_plate', name: 'Латные доспехи', icon: '🛡️', type: 'equipment', rarity: 'rare', priceGold: 350, description: 'Тяжёлая броня. +12 к защите, +80 HP.', equipment: template('shop_armor_plate_eq') },
  { id: 'shop_helmet_iron', name: 'Железный шлем', icon: '⛑️', type: 'equipment', rarity: 'common', priceGold: 80, description: 'Защита головы. +3 к защите, +20 HP.', equipment: template('shop_helmet_iron_eq') },
  { id: 'shop_boots_swift', name: 'Сапоги скорости', icon: '🥾', type: 'equipment', rarity: 'rare', priceGold: 200, description: 'Лёгкие сапоги. +4 к защите, +40 HP, +2% крит.', equipment: template('shop_boots_swift_eq') },
  { id: 'shop_ring_power', name: 'Кольцо силы', icon: '💍', type: 'equipment', rarity: 'epic', priceGems: 50, priceGold: 0, description: 'Магическое кольцо. +15 к атаке, +5% крит.', equipment: template('shop_ring_power_eq') },
  { id: 'shop_shield_oak', name: 'Дубовый щит', icon: '🛡️', type: 'equipment', rarity: 'common', priceGold: 120, description: 'Окованный железом щит. +5 к защите, +25 HP.', equipment: template('shop_shield_oak_eq') },
  { id: 'shop_amulet_raven', name: 'Амулет ворона', icon: '📿', type: 'equipment', rarity: 'rare', priceGold: 260, description: 'Оберег из кости ворона. +6 к атаке, +3% крит.', equipment: template('shop_amulet_raven_eq') },
];

export function rarityForChapter(chapter: number): EquipmentRarity {
  const index = Math.min(Math.floor(Math.max(1, Math.floor(chapter)) / 10), EQUIPMENT_RARITIES.length - 1);
  return EQUIPMENT_RARITIES[index];
}

/** Base definition for existing boss drops; forge metadata is attached centrally. */
export function createBossLootEquipment(chapter: number, isWeapon: boolean, id: string): Equipment {
  const level = Math.max(1, Math.floor(chapter));
  return {
    id,
    slot: isWeapon ? 'weapon' : 'armor',
    name: isWeapon ? 'Клинок победителя' : 'Доспех воина',
    icon: isWeapon ? '⚔️' : '🛡️',
    rarity: rarityForChapter(level),
    attack: isWeapon ? 10 + level * 3 : 0,
    defense: isWeapon ? 0 : 5 + level * 2,
    hp: isWeapon ? 0 : 20 + level * 5,
    level,
  };
}
