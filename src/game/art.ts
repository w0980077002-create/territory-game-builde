import type { Equipment, InventoryItem, ShopItem } from './types';

export const SLOT_ART: Record<Equipment['slot'], string> = {
  helmet: '/item-helmet.webp',
  amulet: '/item-amulet.webp',
  armor: '/item-armor.webp',
  weapon: '/item-weapon.webp',
  shield: '/item-shield.webp',
  ring: '/item-ring.webp',
  boots: '/item-boots.webp',
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
  if (item.arenaEffect === 'time') return '/potion-time.webp';
  if (item.arenaEffect === 'adrenaline') return '/potion-adrenaline.webp';
  const e = item.effect;
  if (e?.stat === 'hp') return e.value >= 150 ? '/potion-hp-large.webp' : '/potion-hp.webp';
  if (e?.stat === 'attack') return '/elixir-attack.webp';
  if (e?.stat === 'defense') return '/elixir-defense.webp';
  if (e?.stat === 'critChance') return '/elixir-crit.webp';
  return '/potion-hp.webp';
}
