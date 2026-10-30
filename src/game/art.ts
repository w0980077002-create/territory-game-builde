import type { Equipment, InventoryItem, ProfessionId, ShopItem } from './types';
import { MAIL_ITEM_VISUALS } from './mailRewardVisuals';

const ui = import.meta.env.BASE_URL + 'assets/territory/ui/';
const eq = (slot: string) => ui + 'equipment-cartoon/' + slot + '.webp';
const itemIcon = (name: string) => ui + 'items/' + name + '.webp';
const materialIcon = (name: string) => ui + 'materials/' + name + '.webp';
const shopIcon = (name: string) => ui + 'shop/' + name + '.webp';
const uniqueGearIcon = (name: string) => ui + 'unique-gear/' + name + '.webp';
const masterPortrait = (profession: ProfessionId) => ui + 'profession-masters/' + profession + '.webp';

/** Names are stable across bought, crafted and restored copies; random instance IDs aren't.
 * These are cosmetic overrides only and never change an item's balance or ownership. */
const UNIQUE_EQUIPMENT_BY_NAME: Record<string, string> = {
  'клинок древних': 'ancient-blade',
  'ancient blade': 'ancient-blade',
  'секира бури': 'storm-axe',
  'storm axe': 'storm-axe',
  'клинок первого ярла': 'jarl-blade',
  'first jarl blade': 'jarl-blade',
  'печать ярла': 'jarl-ring',
  'jarl seal': 'jarl-ring',
  'доспех мастера механизмов': 'jarl-armor',
  'master machinist armor': 'jarl-armor',
  'сапоги великого мастера': 'jarl-boots',
  'grandmaster boots': 'jarl-boots',
  'амулет ворона мастера': 'master-raven-amulet',
  'master raven amulet': 'master-raven-amulet',
  'клинок дозорного': 'watch-blade',
  'watchman blade': 'watch-blade',
  'сапфировое кольцо': 'sapphire-ring',
  'sapphire ring': 'sapphire-ring',
  'щит северной стражи': 'north-shield',
  'northern guard shield': 'north-shield',
  'латы северянина': 'north-armor',
  'northern armor': 'north-armor',
  'шлем старейшины': 'master-helm',
  'elder helmet': 'master-helm',
  'кольцо древних': 'ancient-ring',
  'ancient ring': 'ancient-ring',
  'кольцо силы мастера': 'master-power-ring',
  'master power ring': 'master-power-ring',
  // Stage 8 mid-tier crafted gear must not collapse to the same generic slot icon.
  'кольцо искры': 'spark-ring',
  'spark ring': 'spark-ring',
  'оберег северных врат': 'north-gate-amulet',
  'guardian of the northern gates': 'north-gate-amulet',
  'шлем дозорного': 'watch-helmet',
  'watchman helmet': 'watch-helmet',
  'сапоги следопыта': 'ranger-boots',
  'ranger boots': 'ranger-boots',
  'сапоги гонца': 'messenger-boots',
  'messenger boots': 'messenger-boots',
  'броня караванщика': 'caravan-armor',
  'caravan armor': 'caravan-armor',
};

const normalizeItemName = (name: string) => name.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

/** Five distinct master portraits are shared across legacy and Stage 8 screens. */
export const PROFESSION_ART: Record<ProfessionId, string> = {
  smith: masterPortrait('smith'),
  alchemist: masterPortrait('alchemist'),
  artisan: masterPortrait('artisan'),
  jeweler: masterPortrait('jeweler'),
  engineer: masterPortrait('engineer'),
};

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
const STAGE8_POTION_BY_NAME: Record<string, string> = {
  'травяной настой': 'herbal-infusion',
  'herbal infusion': 'herbal-infusion',
  'эликсир точности': 'focus-elixir',
  'precision elixir': 'focus-elixir',
  'зелье северного здоровья': 'north-health-potion',
  'northern health potion': 'north-health-potion',
};

/** Stable item identity wins over generic stat icons.
 * Purchased, gifted and saved copies can have different IDs but share the same name. */
function consumableArt(item: ArtSource): string | null {
  if (/эликсир стойкости ярла|jarl.*resilience elixir/i.test(item.name)) return uniqueGearIcon('legendary-elixir');
  const stage8Potion = STAGE8_POTION_BY_NAME[normalizeItemName(item.name)];
  if (stage8Potion) return uniqueGearIcon(stage8Potion);
  const canonical = MAIL_ITEM_VISUALS[item.id]?.image
    ?? CONSUMABLE_ART_BY_NAME[item.name.trim().toLocaleLowerCase()];
  if (canonical) return rootItemArt(canonical);

  // Crafted master recipes have their own looks, separate from shop consumables.
  if (/зелье здоровья мастера|master.*health potion/i.test(item.name)) return itemIcon('potion-green');
  if (/эликсир силы мастера|master.*strength elixir/i.test(item.name)) return itemIcon('potion-fire');
  if (/большое зелье мастера|master.*large health potion/i.test(item.name)) return itemIcon('potion-hp');
  if (/эликсир легенды|legendary elixir/i.test(item.name)) return itemIcon('potion-energy');

  if (item.arenaEffect === 'time') return rootItemArt('potion-time-viking.webp');
  if (item.arenaEffect === 'adrenaline') return rootItemArt('potion-adrenaline-viking.webp');
  return null;
}

function inventoryMaterialArt(item: ArtSource): string {
  if (item.id === 'cow_awakening_stone') return import.meta.env.BASE_URL + 'assets/territory/ui/items/awakening-stone.svg';
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
  const name = normalizeItemName(equipment.name);
  const special = UNIQUE_EQUIPMENT_BY_NAME[name];
  if (special) return uniqueGearIcon(special);
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

/** Artwork for recipe cards, including stage8 previews which aren't owned items yet. */
export function craftOutputArt(output: {
  name: string;
  icon: string;
  type: string;
  equipment?: { slot?: unknown };
}): string {
  const slots = Object.keys(SLOT_ART);
  const slot = output.equipment?.slot;
  if (output.type === 'equipment' && typeof slot === 'string' && slots.includes(slot)) {
    return equipmentArt({
      id: '', name: output.name, icon: output.icon, slot: slot as Equipment['slot'],
      rarity: 'common', level: 1,
    });
  }
  const preview = { id: '', name: output.name, icon: output.icon, type: output.type } as ArtSource;
  if (output.type === 'material') return inventoryMaterialArt(preview);
  return consumableArt(preview) ?? itemIcon('potion-green');
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
  if (e?.stat === 'hp' && e.value >= 150) return import.meta.env.BASE_URL + 'potion-hp-large-viking.webp';
  if (e?.stat === 'hp') return rootItemArt('potion-hp-viking.webp');
  if (e?.stat === 'attack') return rootItemArt('elixir-attack-viking.webp');
  if (e?.stat === 'defense') return rootItemArt('elixir-defense-viking.webp');
  if (e?.stat === 'critChance') return rootItemArt('elixir-crit-viking.webp');
  return itemIcon('potion-green');
}
