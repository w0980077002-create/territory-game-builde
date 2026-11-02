import type { Equipment, InventoryItem } from './types';

/** One-off owner-awarded Halloween 2026 trophy, never available in shop or random loot.
 * Server receipt is the only way to receive the item; client definitions are display-only.
 */
export const HALLOWEEN_HORNED_PUMPKIN_ID = 'halloween_horned_pumpkin_2026';
export const HALLOWEEN_HORNED_PUMPKIN_NAME = 'Рогатая тыква · Хэллоуин 2026';

export const HALLOWEEN_HORNED_PUMPKIN_GEAR: Readonly<Equipment> = {
  id: HALLOWEEN_HORNED_PUMPKIN_ID,
  slot: 'helmet',
  name: HALLOWEEN_HORNED_PUMPKIN_NAME,
  icon: '🎃',
  rarity: 'rare',
  level: 1,
  baseLevel: 1,
  defense: 6,
  hp: 40,
  critChance: 1,
  baseStats: { defense: 6, hp: 40, critChance: 1 },
  upgradeCount: 0,
};

export const HALLOWEEN_HORNED_PUMPKIN_DESCRIPTION =
  'Раритетный рогатый шлем. Награда за место в топ-20 рейда 2026. Защита +6, HP +40, крит +1%.';

export function isHalloweenHornedPumpkin(item: Pick<InventoryItem, 'equipment'>): boolean {
  return item.equipment?.id === HALLOWEEN_HORNED_PUMPKIN_ID;
}
