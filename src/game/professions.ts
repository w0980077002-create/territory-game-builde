import type { Equipment, InventoryItem, ProfessionId, ProfessionProgress } from './types';
import { prepareNewEquipment } from './equipmentBalance';

export const PROFESSION_DEFINITIONS: {
  id: ProfessionId;
  name: string;
  icon: string;
  description: string;
}[] = [
  { id: 'smith', name: 'Кузнец', icon: '⚒️', description: 'Оружие, броня и щиты' },
  { id: 'alchemist', name: 'Алхимик', icon: '⚗️', description: 'Зелья и боевые эликсиры' },
  { id: 'artisan', name: 'Ремесленник', icon: '🧰', description: 'Материалы и полезные наборы' },
  { id: 'jeweler', name: 'Ювелир', icon: '💍', description: 'Кольца, амулеты и украшения' },
  { id: 'engineer', name: 'Инженер', icon: '⚙️', description: 'Защитные устройства и механизмы' },
];

export const RESOURCE_DEFINITIONS = [
  { id: 'gather-ore', name: 'Железная руда', icon: '⛏️', rarity: 'common' as const, value: 8 },
  { id: 'gather-herb', name: 'Лекарственная трава', icon: '🌿', rarity: 'common' as const, value: 7 },
  { id: 'gather-wood', name: 'Древесина', icon: '🪵', rarity: 'common' as const, value: 6 },
  { id: 'gather-crystal', name: 'Магический кристалл', icon: '💎', rarity: 'rare' as const, value: 20 },
] as const;

export type ResourceId = typeof RESOURCE_DEFINITIONS[number]['id'];
export interface Ingredient { id: ResourceId; qty: number }
interface RecipeOutput {
  name: string;
  icon: string;
  type: InventoryItem['type'];
  rarity: InventoryItem['rarity'];
  description: string;
  effect?: InventoryItem['effect'];
  equipment?: Omit<Equipment, 'id'>;
}
export interface CraftRecipe {
  id: string;
  profession: ProfessionId;
  name: string;
  icon: string;
  description: string;
  requiredLevel: number;
  masteryXp: number;
  ingredients: Ingredient[];
  output: RecipeOutput;
}

const gear = (slot: Equipment['slot'], rarity: Equipment['rarity'], level: number, stats: Pick<Equipment, 'attack' | 'defense' | 'hp' | 'critChance'>): Omit<Equipment, 'id'> => ({
  slot, rarity, level, ...stats, name: '', icon: '',
});

export const PROFESSION_RECIPES: CraftRecipe[] = [
  // Smith: combat gear deliberately matches existing shop gear stat budgets.
  { id: 'smith_apprentice_blade', profession: 'smith', name: 'Меч подмастерья', icon: '⚔️', description: 'Надёжный клинок для начинающего героя.', requiredLevel: 1, masteryXp: 30, ingredients: [{ id: 'gather-ore', qty: 5 }, { id: 'gather-wood', qty: 2 }], output: { name: 'Меч подмастерья', icon: '⚔️', type: 'equipment', rarity: 'common', description: 'Кованый меч. +8 к атаке.', equipment: { ...gear('weapon', 'common', 1, { attack: 8 }), name: 'Меч подмастерья', icon: '⚔️' } } },
  { id: 'smith_leather_armor', profession: 'smith', name: 'Кожаная броня', icon: '🦺', description: 'Базовая броня для путешествий.', requiredLevel: 1, masteryXp: 35, ingredients: [{ id: 'gather-ore', qty: 3 }, { id: 'gather-wood', qty: 5 }], output: { name: 'Кожаная броня', icon: '🦺', type: 'equipment', rarity: 'common', description: 'Защита +5, здоровье +30.', equipment: { ...gear('armor', 'common', 1, { defense: 5, hp: 30 }), name: 'Кожаная броня', icon: '🦺' } } },
  { id: 'smith_knight_blade', profession: 'smith', name: 'Клинок рыцаря', icon: '🗡️', description: 'Редкий клинок с усиленным балансом.', requiredLevel: 50, masteryXp: 120, ingredients: [{ id: 'gather-ore', qty: 20 }, { id: 'gather-wood', qty: 10 }, { id: 'gather-crystal', qty: 3 }], output: { name: 'Клинок рыцаря', icon: '🗡️', type: 'equipment', rarity: 'rare', description: 'Атака +18, шанс критического удара +3%.', equipment: { ...gear('weapon', 'rare', 3, { attack: 18, critChance: 3 }), name: 'Клинок рыцаря', icon: '🗡️' } } },
  { id: 'smith_ancient_blade', profession: 'smith', name: 'Клинок древних', icon: '🔱', description: 'Рецепт мастера 300-го уровня.', requiredLevel: 300, masteryXp: 500, ingredients: [{ id: 'gather-ore', qty: 80 }, { id: 'gather-wood', qty: 30 }, { id: 'gather-crystal', qty: 20 }], output: { name: 'Клинок древних', icon: '🔱', type: 'equipment', rarity: 'legendary', description: 'Атака +35, критический шанс +8%. Сила легендарной экипировки масштабируется по общему балансу игры.', equipment: { ...gear('weapon', 'legendary', 5, { attack: 35, critChance: 8 }), name: 'Клинок древних', icon: '🔱' } } },

  // Alchemist: consumables reuse the same effect model as current shop items.
  { id: 'alchemist_health_potion', profession: 'alchemist', name: 'Зелье здоровья', icon: '🧪', description: 'Мгновенно восстанавливает 50 HP.', requiredLevel: 1, masteryXp: 20, ingredients: [{ id: 'gather-herb', qty: 3 }], output: { name: 'Зелье здоровья мастера', icon: '🧪', type: 'potion', rarity: 'common', description: 'Восстанавливает 50 HP мгновенно.', effect: { stat: 'hp', value: 50, duration: 'instant' } } },
  { id: 'alchemist_strength', profession: 'alchemist', name: 'Эликсир силы', icon: '💪', description: '+10 к атаке на один бой.', requiredLevel: 5, masteryXp: 50, ingredients: [{ id: 'gather-herb', qty: 5 }, { id: 'gather-crystal', qty: 1 }], output: { name: 'Эликсир силы мастера', icon: '💪', type: 'elixir', rarity: 'rare', description: '+10 к атаке на один бой.', effect: { stat: 'attack', value: 10, duration: 'battle' } } },
  { id: 'alchemist_greater_potion', profession: 'alchemist', name: 'Большое зелье здоровья', icon: '⚗️', description: 'Мгновенно восстанавливает 150 HP.', requiredLevel: 25, masteryXp: 90, ingredients: [{ id: 'gather-herb', qty: 10 }, { id: 'gather-crystal', qty: 3 }], output: { name: 'Большое зелье мастера', icon: '⚗️', type: 'potion', rarity: 'rare', description: 'Восстанавливает 150 HP мгновенно.', effect: { stat: 'hp', value: 150, duration: 'instant' } } },
  { id: 'alchemist_legendary_elixir', profession: 'alchemist', name: 'Эликсир легенды', icon: '🧬', description: 'Рецепт мастера 300-го уровня. Усиление действует один бой.', requiredLevel: 300, masteryXp: 500, ingredients: [{ id: 'gather-herb', qty: 50 }, { id: 'gather-crystal', qty: 20 }], output: { name: 'Эликсир легенды', icon: '🧬', type: 'elixir', rarity: 'legendary', description: '+20 к атаке на один бой.', effect: { stat: 'attack', value: 20, duration: 'battle' } } },

  // Artisan recipes produce trade goods rather than extra combat power.
  { id: 'artisan_toolkit', profession: 'artisan', name: 'Набор ремесленника', icon: '🧰', description: 'Полезный товар для будущей торговли.', requiredLevel: 1, masteryXp: 25, ingredients: [{ id: 'gather-wood', qty: 4 }, { id: 'gather-ore', qty: 2 }], output: { name: 'Набор ремесленника', icon: '🧰', type: 'material', rarity: 'common', description: 'Ремесленный товар. Предназначен для торговли и будущих рецептов.' } },
  { id: 'artisan_supply_crate', profession: 'artisan', name: 'Ящик припасов', icon: '📦', description: 'Плотный ящик с припасами для торговцев.', requiredLevel: 25, masteryXp: 80, ingredients: [{ id: 'gather-wood', qty: 15 }, { id: 'gather-herb', qty: 8 }], output: { name: 'Ящик припасов', icon: '📦', type: 'material', rarity: 'rare', description: 'Ценный ремесленный товар для торговли.' } },
  { id: 'artisan_royal_chest', profession: 'artisan', name: 'Королевский ларец', icon: '🗝️', description: 'Редкий ларец, рецепт для мастера 300-го уровня.', requiredLevel: 300, masteryXp: 500, ingredients: [{ id: 'gather-wood', qty: 50 }, { id: 'gather-ore', qty: 30 }, { id: 'gather-crystal', qty: 15 }], output: { name: 'Королевский ларец', icon: '🗝️', type: 'material', rarity: 'legendary', description: 'Легендарный ремесленный товар для будущего общего аукциона.' } },

  // Jeweler: accessories are kept within existing item stat budgets.
  { id: 'jeweler_raven_amulet', profession: 'jeweler', name: 'Амулет ворона', icon: '📿', description: 'Атака +6 и шанс крита +3%.', requiredLevel: 1, masteryXp: 45, ingredients: [{ id: 'gather-crystal', qty: 2 }, { id: 'gather-ore', qty: 5 }], output: { name: 'Амулет ворона мастера', icon: '📿', type: 'equipment', rarity: 'rare', description: 'Атака +6 и шанс крита +3%.', equipment: { ...gear('amulet', 'rare', 3, { attack: 6, critChance: 3 }), name: 'Амулет ворона мастера', icon: '📿' } } },
  { id: 'jeweler_power_ring', profession: 'jeweler', name: 'Кольцо силы', icon: '💍', description: 'Атака +15 и шанс крита +5%.', requiredLevel: 50, masteryXp: 125, ingredients: [{ id: 'gather-crystal', qty: 8 }, { id: 'gather-ore', qty: 12 }], output: { name: 'Кольцо силы мастера', icon: '💍', type: 'equipment', rarity: 'epic', description: 'Атака +15 и шанс крита +5%.', equipment: { ...gear('ring', 'epic', 5, { attack: 15, critChance: 5 }), name: 'Кольцо силы мастера', icon: '💍' } } },
  { id: 'jeweler_ancient_ring', profession: 'jeweler', name: 'Кольцо древних', icon: '💍', description: 'Легендарное украшение мастера 300-го уровня.', requiredLevel: 300, masteryXp: 500, ingredients: [{ id: 'gather-crystal', qty: 25 }, { id: 'gather-ore', qty: 60 }], output: { name: 'Кольцо древних', icon: '💍', type: 'equipment', rarity: 'legendary', description: 'Атака +15 и шанс крита +5%. Сохраняет базовый баланс аксессуаров.', equipment: { ...gear('ring', 'legendary', 5, { attack: 15, critChance: 5 }), name: 'Кольцо древних', icon: '💍' } } },

  // Engineer: defensive gear and trade goods.
  { id: 'engineer_oak_shield', profession: 'engineer', name: 'Укреплённый щит', icon: '🛡️', description: 'Защита +5 и здоровье +25.', requiredLevel: 1, masteryXp: 40, ingredients: [{ id: 'gather-wood', qty: 5 }, { id: 'gather-ore', qty: 4 }], output: { name: 'Укреплённый щит', icon: '🛡️', type: 'equipment', rarity: 'common', description: 'Защита +5 и здоровье +25.', equipment: { ...gear('shield', 'common', 2, { defense: 5, hp: 25 }), name: 'Укреплённый щит', icon: '🛡️' } } },
  { id: 'engineer_guard_helmet', profession: 'engineer', name: 'Шлем стража', icon: '⛑️', description: 'Защита +3 и здоровье +20.', requiredLevel: 25, masteryXp: 85, ingredients: [{ id: 'gather-ore', qty: 12 }, { id: 'gather-crystal', qty: 2 }], output: { name: 'Шлем стража', icon: '⛑️', type: 'equipment', rarity: 'rare', description: 'Защита +3 и здоровье +20.', equipment: { ...gear('helmet', 'rare', 3, { defense: 3, hp: 20 }), name: 'Шлем стража', icon: '⛑️' } } },
  { id: 'engineer_ancient_device', profession: 'engineer', name: 'Древний механизм', icon: '⚙️', description: 'Легендарный ремесленный товар мастера 300-го уровня.', requiredLevel: 300, masteryXp: 500, ingredients: [{ id: 'gather-ore', qty: 60 }, { id: 'gather-wood', qty: 40 }, { id: 'gather-crystal', qty: 20 }], output: { name: 'Древний механизм', icon: '⚙️', type: 'material', rarity: 'legendary', description: 'Легендарный инженерный товар для будущего общего аукциона.' } },
];

export function masteryXpToNext(level: number): number {
  return level >= 300 ? 0 : 100 + Math.max(0, level - 1) * 25;
}

export function addMasteryXp(progress: ProfessionProgress, amount: number): ProfessionProgress {
  let masteryLevel = Math.max(1, Math.min(300, Math.floor(progress.masteryLevel || 1)));
  let masteryXp = Math.max(0, progress.masteryXp || 0) + Math.max(0, amount);
  while (masteryLevel < 300) {
    const threshold = masteryXpToNext(masteryLevel);
    if (masteryXp < threshold) break;
    masteryXp -= threshold;
    masteryLevel += 1;
  }
  if (masteryLevel >= 300) masteryXp = 0;
  return { ...progress, masteryLevel, masteryXp };
}

export function countResource(inventory: InventoryItem[], id: ResourceId): number {
  return inventory.find((item) => item.id === id)?.qty ?? 0;
}

export function canCraft(inventory: InventoryItem[], recipe: CraftRecipe): boolean {
  return recipe.ingredients.every((ingredient) => countResource(inventory, ingredient.id) >= ingredient.qty);
}

export function craftItem(inventory: InventoryItem[], recipe: CraftRecipe): InventoryItem[] | null {
  if (!canCraft(inventory, recipe)) return null;
  let nextInventory = inventory.map((item) => {
    const ingredient = recipe.ingredients.find((entry) => entry.id === item.id);
    return ingredient ? { ...item, qty: item.qty - ingredient.qty } : item;
  }).filter((item) => item.qty > 0);

  const uniqueId = `crafted-${recipe.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const equipment = recipe.output.equipment
    ? prepareNewEquipment({ ...recipe.output.equipment, id: uniqueId })
    : undefined;
  const outputItem: InventoryItem = {
    id: uniqueId,
    name: recipe.output.name,
    icon: recipe.output.icon,
    type: recipe.output.type,
    rarity: recipe.output.rarity,
    qty: 1,
    description: recipe.output.description,
    effect: recipe.output.effect,
    equipment,
  };

  if (outputItem.type !== 'equipment') {
    const existing = nextInventory.find((item) => item.name === outputItem.name && item.type === outputItem.type && item.rarity === outputItem.rarity);
    if (existing) nextInventory = nextInventory.map((item) => item.id === existing.id ? { ...item, qty: item.qty + 1 } : item);
    else nextInventory = [...nextInventory, outputItem];
  } else {
    nextInventory = [...nextInventory, outputItem];
  }
  return nextInventory;
}
