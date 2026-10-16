import type { Equipment, InventoryItem, ShopItem } from './types';

const ui = import.meta.env.BASE_URL + 'assets/territory/ui/';
const eq = (slot: string) => ui + 'equipment/' + slot + '.webp';
const itemIcon = (name: string) => ui + 'items/' + name + '.webp';

// Static cosmetic art only: item identities, equip slots and stats are unchanged.
export const SLOT_ART: Record<Equipment['slot'], string> = {
  helmet: eq('helmet'),
  amulet: eq('amulet'),
  armor: eq('armor'),
  weapon: eq('weapon'),
  shield: eq('shield'),
  ring: eq('ring'),
  boots: eq('boots'),
};

export const CURRENCY_ART = {
  gold: '/gold-coin.webp',
  gems: '/blue-gem.webp',
  redGems: '/red-gem.webp',
  stones: '/battle-stone.webp',
  material: '/forge-material.webp',
} as const;

type ArtSource = Pick<InventoryItem, 'type' | 'effect' | 'arenaEffect' | 'equipment'> | Pick<ShopItem, 'type' | 'effect' | 'arenaEffect' | 'equipment'>;

export function itemArt(item: ArtSource): string {
  if (item.equipment) return SLOT_ART[item.equipment.slot];
  if (item.type === 'gem_pack') return '/gem-pack.webp';
  if (item.type === 'stone') return CURRENCY_ART.stones;
  if (item.type === 'material') return CURRENCY_ART.material;
  if (item.arenaEffect === 'time') return itemIcon('potion-energy');
  if (item.arenaEffect === 'adrenaline') return itemIcon('potion-fire');
  const e = item.effect;
  if (e?.stat === 'hp') return itemIcon('potion-hp');
  if (e?.stat === 'attack') return itemIcon('potion-fire');
  if (e?.stat === 'defense') return itemIcon('potion-mana');
  if (e?.stat === 'critChance') return itemIcon('potion-energy');
  return itemIcon('potion-green');
}
