import type { Equipment, InventoryItem } from './types';

/** A quick comparison, not an assertion that one build is always better. */
export const GEAR_STATS = [
  { key: 'attack', ru: 'Атака', en: 'Attack', weight: 4, icon: '⚔️' },
  { key: 'defense', ru: 'Защита', en: 'Defense', weight: 3, icon: '🛡️' },
  { key: 'hp', ru: 'Здоровье', en: 'Health', weight: 0.1, icon: '❤️' },
  { key: 'critChance', ru: 'Крит. шанс', en: 'Crit chance', weight: 12, icon: '✴️' },
] as const;

export function gearScore(eq: Equipment | undefined): number {
  if (!eq) return 0;
  return GEAR_STATS.reduce((sum, stat) => sum + Math.max(0, Number(eq[stat.key]) || 0) * stat.weight, 0);
}

/** Backend accepts only ordinary never-forged boss drops; shop gear has no free returns. */
export function canSalvageEquipment(item: InventoryItem): boolean {
  const e = item.equipment;
  return item.type === 'equipment' && item.qty === 1 && !!e
    && e.id.startsWith('loot_')
    && ((e.name === 'Клинок победителя' && e.slot === 'weapon')
      || (e.name === 'Доспех воина' && e.slot === 'armor'))
    && ['common','rare','epic','legendary'].includes(e.rarity)
    && Number.isSafeInteger(e.level) && e.level >= 1 && e.level <= 999999
    && e.baseLevel === e.level && e.upgradeCount === 0;
}
