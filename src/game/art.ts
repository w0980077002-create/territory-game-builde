import type { Equipment, InventoryItem, ShopItem } from './types';
import { assetUrl } from './assets';

export const SLOT_ART: Record<Equipment['slot'], string> = {
  helmet: assetUrl('/item-helmet.webp'),
  amulet: assetUrl('/item-amulet.webp'),
  armor: assetUrl('/item-armor.webp'),
  weapon: assetUrl('/item-weapon.webp'),
  shield: assetUrl('/item-shield.webp'),
  ring: assetUrl('/item-ring.webp'),
  boots: assetUrl('/item-boots.webp'),
};

export const CURRENCY_ART = {
  gold: assetUrl('/gold-coin.webp'),
  gems: assetUrl('/blue-gem.webp'),
  redGems: assetUrl('/red-gem.webp'),
  stones: assetUrl('/battle-stone.webp'),
  material: assetUrl('/forge-material.webp'),
} as const;

type ArtSource = Pick<InventoryItem, 'type' | 'effect' | 'arenaEffect' | 'equipment'> | Pick<ShopItem, 'type' | 'effect' | 'arenaEffect' | 'equipment'>;

export function itemArt(item: ArtSource): string {
  if (item.equipment) return SLOT_ART[item.equipment.slot];
  if (item.type === 'gem_pack') return assetUrl('/gem-pack.webp');
  if (item.type === 'stone') return CURRENCY_ART.stones;
  if (item.type === 'material') return CURRENCY_ART.material;
  if (item.arenaEffect === 'time') return assetUrl('/potion-time.webp');
  if (item.arenaEffect === 'adrenaline') return assetUrl('/potion-adrenaline.webp');
  const e = item.effect;
  if (e?.stat === 'hp') return e.value >= 150 ? assetUrl('/potion-hp-large.webp') : assetUrl('/potion-hp.webp');
  if (e?.stat === 'attack') return assetUrl('/elixir-attack.webp');
  if (e?.stat === 'defense') return assetUrl('/elixir-defense.webp');
  if (e?.stat === 'critChance') return assetUrl('/elixir-crit.webp');
  return assetUrl('/potion-hp.webp');
}
