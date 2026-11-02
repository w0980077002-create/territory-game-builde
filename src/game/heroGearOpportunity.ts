import type { Equipment, InventoryItem } from './types';

/** Read-only suggestion from the existing saved inventory. Never grants or equips items. */
export type HeroGearOpportunity = {
  item: InventoryItem & { equipment: Equipment };
  kind: 'empty' | 'upgrade';
};
const stats = ['attack', 'defense', 'hp', 'critChance'] as const;
const value = (gear: Equipment, key: (typeof stats)[number]) =>
  Number.isFinite(gear[key]) ? (gear[key] ?? 0) : 0;

/** Only call an item stronger when it cannot lower ANY listed combat stat. */
export function strictlyStrongerGear(candidate: Equipment, equipped: Equipment): boolean {
  if (candidate.slot !== equipped.slot || candidate.id === equipped.id) return false;
  const differences = stats.map(key => value(candidate, key) - value(equipped, key));
  return differences.every(delta => delta >= 0) && differences.some(delta => delta > 0);
}

export function findHeroGearOpportunity(
  inventory: readonly InventoryItem[],
  equipped: Partial<Record<Equipment['slot'], Equipment>>,
): HeroGearOpportunity | null {
  const owned = inventory.filter((item): item is InventoryItem & { equipment: Equipment } =>
    item.type === 'equipment' && Number.isFinite(item.qty) && item.qty > 0 && !!item.equipment);
  const empty = owned.find(item => !equipped[item.equipment.slot]);
  if (empty) return { item: empty, kind: 'empty' };
  const upgrade = owned.find(item => {
    const current = equipped[item.equipment.slot];
    return !!current && strictlyStrongerGear(item.equipment, current);
  });
  return upgrade ? { item: upgrade, kind: 'upgrade' } : null;
}
