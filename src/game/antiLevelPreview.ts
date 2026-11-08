import type { Equipment } from './types';
import { capEquipmentToHeroLevel } from './equipmentBalance';

/** Non-mutating visual estimate for the owner's proposed rare Anti-Level item.
 * The buyer's level NEVER affects ownership, bag storage, resale, or item stats.
 * This is NOT a forge action: no consumable is issued/charged and no save happens.
 * The authoritative server conversion must be separately reviewed.
 */
export interface AntiLevelPreview {
  fromLevel: number;
  toLevel: number;
  removedLevels: number;
  estimated: Equipment;
}

export function previewAntiLevel(item: Equipment, heroLevel: number): AntiLevelPreview | null {
  if (!Number.isSafeInteger(item.level) || !Number.isSafeInteger(heroLevel)
    || item.level < 2 || heroLevel < 1 || heroLevel >= item.level || heroLevel > 500) return null;

  // Admin-only overlevel hints must not bypass this preview. Always work on a
  // copied object and preserve the original UUID/rarity without persisting it.
  const estimated = capEquipmentToHeroLevel(
    { ...item, adminTestLevel: false },
    heroLevel,
  );
  if (estimated.level !== heroLevel) return null;
  return {
    fromLevel: item.level,
    toLevel: heroLevel,
    removedLevels: item.level - heroLevel,
    estimated: { ...estimated, id: item.id, rarity: item.rarity },
  };
}
