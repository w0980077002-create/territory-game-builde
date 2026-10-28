/** Ephemeral loot demonstration. NEVER use as real rewards or saved player inventory. */
export type PreviewRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type PreviewLootItem = {
  id: string;
  slotId: string;
  icon: string;
  name: string;
  rarity: PreviewRarity;
  level: number;
  power: number;
  stage: number;
};

export const PREVIEW_EQUIPMENT_SLOTS = [
  { id: 'weapon', name: 'Оружие', icon: 'weapon' },
  { id: 'helmet', name: 'Шлем', icon: 'helmet' },
  { id: 'armor', name: 'Доспехи', icon: 'armor' },
  { id: 'shield', name: 'Щит', icon: 'shield' },
  { id: 'boots', name: 'Сапоги', icon: 'boots' },
  { id: 'ring', name: 'Кольцо', icon: 'ring' },
  { id: 'amulet', name: 'Амулет', icon: 'amulet' },
  { id: 'offhand', name: 'Второе оружие', icon: 'weapon' },
] as const;

const PREFIX: Record<PreviewRarity, string> = {
  common: 'Дорожный', rare: 'Закалённый', epic: 'Героический', legendary: 'Легендарный',
};

function rarityFor(stage: number, index: number): PreviewRarity {
  if (stage % 20 === 0 && index === 0) return 'legendary';
  if (stage % 5 === 0 && index === 0) return 'epic';
  const roll = (stage * 37 + index * 17) % 100;
  return roll >= 92 ? 'legendary' : roll >= 77 ? 'epic' : roll >= 43 ? 'rare' : 'common';
}

export function rollPreviewLoot(stage: number): PreviewLootItem[] {
  const count = stage % 5 === 0 ? 3 : 2;
  return Array.from({ length: count }, (_, index) => {
    const slot = PREVIEW_EQUIPMENT_SLOTS[(stage - 1 + index * 3) % PREVIEW_EQUIPMENT_SLOTS.length];
    const rarity = rarityFor(stage, index);
    const tier = { common: 1, rare: 1.35, epic: 1.8, legendary: 2.5 }[rarity];
    const level = Math.max(1, stage + Math.floor(index / 2));
    return { id: `demo:${stage}:${index}`, slotId: slot.id, icon: slot.icon,
      name: `${PREFIX[rarity]} ${slot.name.toLowerCase()}`, rarity, level,
      power: Math.round((15 + level * 3) * tier), stage };
  });
}

export function autoEquipPreviewLoot(equipped: ReadonlyArray<PreviewLootItem | null>,
  inventory: ReadonlyArray<PreviewLootItem>, drops: ReadonlyArray<PreviewLootItem>) {
  const next = [...equipped];
  const bag = [...inventory];
  // Replaying an unlocked stage may display the same loot animation, but must
  // never duplicate its deterministic item IDs in this temporary inventory.
  const seen = new Set([...next.filter((item): item is PreviewLootItem => item !== null), ...bag]
    .map(item => item.id));
  for (const item of drops) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const index = PREVIEW_EQUIPMENT_SLOTS.findIndex(slot => slot.id === item.slotId);
    if (index >= 0 && next[index] === null) next[index] = item;
    else bag.push(item);
  }
  return { equipped: next, inventory: bag };
}
