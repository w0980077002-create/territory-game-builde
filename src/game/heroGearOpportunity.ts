import type { Equipment, InventoryItem } from './types';

/** Read-only suggestion from the existing saved inventory. Never grants or equips items. */
export type HeroGearOpportunity = {
  item: InventoryItem & { equipment: Equipment };
  kind: 'empty' | 'upgrade' | 'compare';
};
const stats = ['attack', 'defense', 'hp', 'critChance'] as const;
// A malformed legacy inventory entry must not masquerade as equipable loot.
const validSlots = new Set<Equipment['slot']>(['helmet', 'amulet', 'armor', 'weapon', 'shield', 'ring', 'boots']);
const value = (gear: Equipment, key: (typeof stats)[number]) =>
  Number.isFinite(gear[key]) ? (gear[key] ?? 0) : 0;

/** Only call an item stronger when it cannot lower ANY listed combat stat. */
export function strictlyStrongerGear(candidate: Equipment, equipped: Equipment): boolean {
  if (candidate.slot !== equipped.slot || candidate.id === equipped.id) return false;
  const differences = stats.map(key => value(candidate, key) - value(equipped, key));
  return differences.every(delta => delta >= 0) && differences.some(delta => delta > 0);
}

/** A real trade-off is worth inspecting, but must never be called an upgrade. */
export function tradeoffGear(candidate: Equipment, equipped: Equipment): boolean {
  if (candidate.slot !== equipped.slot || candidate.id === equipped.id) return false;
  const differences = stats.map(key => value(candidate, key) - value(equipped, key));
  return differences.some(delta => delta > 0) && differences.some(delta => delta < 0);
}

export function findHeroGearOpportunity(
  inventory: readonly InventoryItem[],
  equipped: Partial<Record<Equipment['slot'], Equipment>>,
): HeroGearOpportunity | null {
  const owned = inventory.filter((item): item is InventoryItem & { equipment: Equipment } =>
    item.type === 'equipment' && Number.isFinite(item.qty) && item.qty > 0 && !!item.equipment && validSlots.has(item.equipment.slot));
  // Inventory order is not a measure of combat strength. If several owned
  // items compete for the same slot, prefer one that is at least as strong
  // in EVERY combat stat and strictly stronger in one. Incomparable builds
  // remain genuine tactical choices: never invent a universal stat weight.
  const pickDominant = (candidates: typeof owned) => candidates.reduce<(typeof owned)[number] | null>((best, item) => {
    if (!best) return item;
    if (best.equipment.slot !== item.equipment.slot) return best;
    const deltas = stats.map(key => value(item.equipment, key) - value(best.equipment, key));
    return deltas.every(delta => delta >= 0) && deltas.some(delta => delta > 0) ? item : best;
  }, null);
  const empty = pickDominant(owned.filter(item => !equipped[item.equipment.slot]));
  if (empty) return { item: empty, kind: 'empty' };
  const upgrade = pickDominant(owned.filter(item => {
    const current = equipped[item.equipment.slot];
    return !!current && strictlyStrongerGear(item.equipment, current);
  }));
  if (upgrade) return { item: upgrade, kind: 'upgrade' };
  // Show the player a meaningful tactical choice only after empty slots and
  // unequivocal upgrades. No item is equipped or changed by this suggestion.
  const tradeoff = pickDominant(owned.filter(item => {
    const current = equipped[item.equipment.slot];
    return !!current && tradeoffGear(item.equipment, current);
  }));
  return tradeoff ? { item: tradeoff, kind: 'compare' } : null;
}
