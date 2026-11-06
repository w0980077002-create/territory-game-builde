/**
 * Cave loot milestones for the owner-visible prototype.
 *
 * Only gold and XP are currently verified settlement rewards. The other tiers
 * are previews, NOT an active reward table, drop odds, an entitlement, or
 * permission to issue new client-side currency/items.
 *
 * Unlock floors 6 (socketable gems) and 41 (set pieces) are based on publicly
 * described Realm of Darkness progression. All artwork, names and rates for
 * TERRITORY must be original and balance-reviewed before server activation.
 */
export type CaveLootType = 'dark_equipment' | 'socket_gem' | 'set_equipment';
export type CaveLootMilestone = Readonly<{
  type: CaveLootType;
  unlockFloor: number;
  ru: string;
  en: string;
  detailRu: string;
  detailEn: string;
}>;

export const CAVE_LOOT_MILESTONES: readonly CaveLootMilestone[] = [
  {
    type: 'dark_equipment', unlockFloor: 1,
    ru: 'Тёмная экипировка', en: 'Dark equipment',
    detailRu: 'Особое снаряжение для боёв и сборок.',
    detailEn: 'Distinct gear for battles and builds.',
  },
  {
    type: 'socket_gem', unlockFloor: 6,
    ru: 'Самоцветы', en: 'Gems',
    detailRu: 'Камни усиления экипировки.',
    detailEn: 'Socketable equipment enhancements.',
  },
  {
    type: 'set_equipment', unlockFloor: 41,
    ru: 'Комплектная экипировка', en: 'Set equipment',
    detailRu: 'Предметы с бонусом за комплект.',
    detailEn: 'Matching gear with set bonuses.',
  },
];

export function caveLootPreview(floor: number) {
  // Pure presentation only. Never use this to grant an item or decide combat.
  const depth = Number.isFinite(floor) ? Math.min(100, Math.max(0, Math.floor(floor))) : 0;
  return CAVE_LOOT_MILESTONES.map(reward => ({
    ...reward,
    unlockedAtDepth: depth >= reward.unlockFloor,
  }));
}
