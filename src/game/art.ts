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

/** Match the icon to the actual weapon; a sword must not appear as an axe.
 * Keep the old generic weapon icon for legacy/unrecognized weapons.
 * Cosmetic only — no item properties or combat statistics are altered.
 */
export function equipmentArt(equipment: Equipment): string {
  if (equipment.slot !== 'weapon') return SLOT_ART[equipment.slot];
  const name = equipment.name.toLowerCase();
  if (/топор|секир|axe|hatchet/.test(name)) return SLOT_ART.weapon;
  if (/лук|арбалет|bow|crossbow/.test(name) || equipment.icon === '🏹') return itemIcon('bow');
  if (/посох|жезл|staff|wand/.test(name) || equipment.icon === '🪄') return itemIcon('staff');
  if (/меч|клинок|сабл|рапир|sword|blade|saber|sabre|rapier/.test(name) || ['⚔️', '🗡️', '🔱'].includes(equipment.icon)) {
    return itemIcon('sword');
  }
  return SLOT_ART.weapon;
}

export function itemArt(item: ArtSource): string {
  if (item.equipment) return equipmentArt(item.equipment);
  if (item.type === 'gem_pack') return '/gem-pack.webp';
  if (item.type === 'stone') return CURRENCY_ART.stones;
  if (item.type === 'material') return CURRENCY_ART.material;
  if (item.arenaEffect === 'time') return itemIcon('potion-energy');
  if (item.arenaEffect === 'adrenaline') return itemIcon('potion-fire');
  const e = item.effect;
  // Large healing potions must have their own art in inventory and the shop,
  // matching the exact icon shown for the same item in the in-game mail.
  if (e?.stat === 'hp' && e.value >= 150) return import.meta.env.BASE_URL + 'potion-hp-large.webp';
  if (e?.stat === 'hp') return itemIcon('potion-hp');
  if (e?.stat === 'attack') return itemIcon('potion-fire');
  if (e?.stat === 'defense') return itemIcon('potion-mana');
  if (e?.stat === 'critChance') return itemIcon('potion-energy');
  return itemIcon('potion-green');
}
