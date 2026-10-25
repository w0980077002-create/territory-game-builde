import type { Equipment, InventoryItem, ShopItem } from './types';
import { MAIL_ITEM_VISUALS } from './mailRewardVisuals';

const ui = import.meta.env.BASE_URL + 'assets/territory/ui/';
const eq = (slot: string) => ui + 'equipment-cartoon/' + slot + '.webp';
const itemIcon = (name: string) => ui + 'items/' + name + '.webp';
const materialIcon = (name: string) => ui + 'materials/' + name + '.webp';
const shopIcon = (name: string) => ui + 'shop/' + name + '.webp';

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

// Each profession resource and crafted trade good has its own artwork.
// Resource IDs are stable for existing saves and server-mirrored inventory.
const MATERIAL_BY_ID: Record<string, string> = {
  'gather-ore': 'iron-ore',
  'gather-herb': 'healing-herbs',
  'gather-wood': 'wood-logs',
  'gather-crystal': 'magic-crystal',
  'gather-hide': 'animal-hide',
};
const MATERIAL_BY_NAME: Record<string, string> = {
  'железная руда': 'iron-ore',
  'iron ore': 'iron-ore',
  'лекарственная трава': 'healing-herbs',
  'healing herbs': 'healing-herbs',
  'древесина': 'wood-logs',
  'wood': 'wood-logs',
  'магический кристалл': 'magic-crystal',
  'magic crystal': 'magic-crystal',
  'шкура': 'animal-hide',
  'hide': 'animal-hide',
  'набор ремесленника': 'craftsman-toolkit',
  'craftsman toolkit': 'craftsman-toolkit',
  'ящик припасов': 'supply-crate',
  'supply crate': 'supply-crate',
  'королевский ларец': 'royal-chest',
  'royal chest': 'royal-chest',
  'древний механизм': 'ancient-mechanism',
  'ancient mechanism': 'ancient-mechanism',
};
const MATERIAL_BY_EMOJI: Record<string, string> = {
  '⛏️': 'iron-ore',
  '🌿': 'healing-herbs',
  '🪵': 'wood-logs',
  '💎': 'magic-crystal',
  '🐾': 'animal-hide',
  '🧰': 'craftsman-toolkit',
  '📦': 'supply-crate',
  '🗝️': 'royal-chest',
  '⚙️': 'ancient-mechanism',
};

export function resourceArt(resourceId: string): string {
  const asset = MATERIAL_BY_ID[resourceId];
  return asset ? materialIcon(asset) : CURRENCY_ART.material;
}

type ArtSource = Pick<InventoryItem, 'id' | 'name' | 'icon' | 'type' | 'effect' | 'arenaEffect' | 'equipment'>
  | Pick<ShopItem, 'id' | 'name' | 'icon' | 'type' | 'effect' | 'arenaEffect' | 'equipment'>;

const rootItemArt = (filename: string): string => import.meta.env.BASE_URL + filename;
const CONSUMABLE_ART_BY_NAME: Record<string, string> = {};
for (const entry of Object.values(MAIL_ITEM_VISUALS)) {
  CONSUMABLE_ART_BY_NAME[entry.name.toLocaleLowerCase()] = entry.image;
  CONSUMABLE_ART_BY_NAME[entry.nameEn.toLocaleLowerCase()] = entry.image;
}

/** Stable item identity wins over generic stat icons.
 * Purchased, gifted and saved copies can have different IDs but share the same name. */
function consumableArt(item: ArtSource): string | null {
  const canonical = MAIL_ITEM_VISUALS[item.id]?.image
    ?? CONSUMABLE_ART_BY_NAME[item.name.trim().toLocaleLowerCase()];
  if (canonical) return rootItemArt(canonical);

  // Crafted master recipes have their own looks, separate from shop consumables.
  if (/зелье здоровья мастера|master.*health potion/i.test(item.name)) return itemIcon('potion-green');
  if (/эликсир силы мастера|master.*strength elixir/i.test(item.name)) return itemIcon('potion-fire');
  if (/большое зелье мастера|master.*large health potion/i.test(item.name)) return itemIcon('potion-hp');
  if (/эликсир легенды|legendary elixir/i.test(item.name)) return itemIcon('potion-energy');

  if (item.arenaEffect === 'time') return rootItemArt('potion-time.webp');
  if (item.arenaEffect === 'adrenaline') return rootItemArt('potion-adrenaline.webp');
  return null;
}

function inventoryMaterialArt(item: ArtSource): string {
  const asset = MATERIAL_BY_ID[item.id]
    ?? MATERIAL_BY_NAME[item.name.trim().toLocaleLowerCase()]
    ?? MATERIAL_BY_EMOJI[item.icon];
  // Keep the generic forge icon for unknown/shop materials.
  return asset ? materialIcon(asset) : CURRENCY_ART.material;
}

/** Match the icon to the actual weapon; a sword must not appear as an axe.
 * Keep the old generic weapon icon for legacy/unrecognized weapons.
 * Cosmetic only — no item properties or combat statistics are altered.
 */
export function equipmentArt(equipment: Equipment): string {
  const name = equipment.name.toLowerCase();
  if (equipment.slot === 'armor' && /латные доспехи|plate armor/.test(name)) return eq('plate-armor');
  if (equipment.slot !== 'weapon') return SLOT_ART[equipment.slot];
  if (/клинок рыцаря|knight.*blade/.test(name)) return eq('knight-blade');
  if (/героический меч|heroic sword/.test(name)) return eq('hero-sword');
  if (/топор|секир|axe|hatchet/.test(name)) return SLOT_ART.weapon;
  if (/лук|арбалет|bow|crossbow/.test(name) || equipment.icon === '🏹') return itemIcon('bow');
  if (/посох|жезл|staff|wand/.test(name) || equipment.icon === '🪄') return itemIcon('staff');
  if (/меч|клинок|сабл|рапир|sword|blade|saber|sabre|rapier/.test(name) || ['⚔️', '🗡️', '🔱'].includes(equipment.icon)) {
    return eq('sword');
  }
  return SLOT_ART.weapon;
}

const SHOP_BUNDLE_ART: Record<string, string> = {
  shop_stone_5: 'stone-bundle',
  shop_gem_pack_1: 'gem-pouch-small',
  shop_gem_pack_2: 'gem-chest-large',
};

export function itemArt(item: ArtSource): string {
  const bundle = SHOP_BUNDLE_ART[item.id];
  if (bundle) return shopIcon(bundle);
  if (item.equipment) return equipmentArt(item.equipment);
  if (item.type === 'gem_pack') return '/gem-pack.webp';
  if (item.type === 'stone') return CURRENCY_ART.stones;
  if (item.type === 'material') return inventoryMaterialArt(item);
  const uniqueArt = consumableArt(item);
  if (uniqueArt) return uniqueArt;
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
