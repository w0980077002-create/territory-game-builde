import type { GameState, InventoryItem } from './types';
import { newElixirExpiry } from './elixirExpiry';

/**
 * TERRITORY-CITY's Trial rewards. Only the first completed victory of a
 * particular floor is eligible for a chest, even if a test/admin resets floors.
 * Common chest: every non-milestone floor; larger chests keep their original schedules.
 * No premium gems or awakening stones are generated here.
 *
 * This is the playable TEST-era loot model; trade and bracelet spending are
 * deliberately disabled until the server inventory/auction supports them.
 */
export type TrialChestTier = 'common' | 'explorer' | 'guardian' | 'legendary';
export type TrialBlueprintId = 'guardian_blade' | 'guardian_amulet';
export type TrialComponentId = 'guardian_shard' | 'trial_essence' | 'ancient_mechanism';

export const TRIAL_LOOT_ASSET_BASE = 'assets/territory/ui/trial-loot/';
export const TRIAL_BLUEPRINTS: readonly { id: TrialBlueprintId; name: string; nameEn: string; profession: string }[] = [
  { id: 'guardian_blade', name: 'Клинок Стража', nameEn: "Guardian's Blade", profession: 'smith' },
  { id: 'guardian_amulet', name: 'Амулет Стража', nameEn: "Guardian's Amulet", profession: 'jeweler' },
];
export const TRIAL_COMPONENTS: readonly { id: TrialComponentId; name: string; nameEn: string }[] = [
  { id: 'guardian_shard', name: 'Осколок силы Стража', nameEn: 'Guardian Power Shard' },
  { id: 'trial_essence', name: 'Эссенция Испытаний', nameEn: 'Trial Essence' },
  { id: 'ancient_mechanism', name: 'Древний механизм', nameEn: 'Ancient Mechanism' },
];
export const TRIAL_CHEST_RULES = {
  explorer: { reputation: 0.03, fragment: 0.04, ingredient: 0.20, gold: 90, gems: 2, materials: 1, elixirs: 1 },
  guardian: { reputation: 0.05, fragment: 0.07, ingredient: 0.35, gold: 160, gems: 3, materials: 2, elixirs: 2 },
  legendary: { reputation: 0.10, fragment: 0.12, ingredient: 0.60, gold: 280, gems: 5, materials: 3, elixirs: 3 },
} as const;
export const TRIAL_FRAGMENT_WEIGHTS = [22, 22, 20, 20, 11, 5] as const;

export interface TrialChestReward {
  floor: number;
  tier: TrialChestTier;
  gold: number;
  gems: number;
  materials: number;
  elixirs: number;
  /** The ordinary chest's 150-HP potions; absent in legacy special chest receipts. */
  potions?: number;
  reputation: number;
  fragment?: { blueprint: TrialBlueprintId; part: number };
  component?: { id: TrialComponentId; qty: number };
}

export function trialChestTier(floor: number): TrialChestTier | null {
  if (!Number.isSafeInteger(floor) || floor < 1) return null;
  if (floor % 25 === 0) return 'legendary';
  if (floor % 10 === 0) return 'guardian';
  if (floor % 5 === 0) return 'explorer';
  return 'common';
}

function draw(random: () => number): number {
  const value = random();
  return Number.isFinite(value) ? Math.min(1 - Number.EPSILON, Math.max(0, value)) : 1 - Number.EPSILON;
}

export function rollTrialChest(floor: number, random: () => number = Math.random): TrialChestReward | null {
  const tier = trialChestTier(floor);
  if (!tier) return null;
  if (tier === 'common') {
    // Exactly ONE of four consumable/resource bonuses; no rare drops,
    // reputation or premium currency on ordinary floors.
    const bonus = draw(random);
    return {
      floor, tier,
      gold: 20 + Math.floor(draw(random) * 21),
      gems: bonus >= 0.95 ? 1 : 0,
      materials: bonus >= 0.45 && bonus < 0.80 ? 1 : 0,
      elixirs: bonus >= 0.80 && bonus < 0.95 ? 1 : 0,
      potions: bonus < 0.45 ? 1 : 0,
      reputation: 0,
    };
  }
  const chances = TRIAL_CHEST_RULES[tier];
  const reward: TrialChestReward = {
    floor, tier, gold: chances.gold, gems: chances.gems,
    materials: chances.materials, elixirs: chances.elixirs,
    reputation: draw(random) < chances.reputation ? 1 : 0,
  };
  if (draw(random) < chances.fragment) {
    const blueprint = TRIAL_BLUEPRINTS[Math.floor(draw(random) * TRIAL_BLUEPRINTS.length)].id;
    const ticket = draw(random) * 100;
    let sum = 0;
    let part = 6;
    for (let i = 0; i < TRIAL_FRAGMENT_WEIGHTS.length; i++) {
      sum += TRIAL_FRAGMENT_WEIGHTS[i];
      if (ticket < sum) { part = i + 1; break; }
    }
    reward.fragment = { blueprint, part };
  }
  if (draw(random) < chances.ingredient) {
    const component = TRIAL_COMPONENTS[Math.floor(draw(random) * TRIAL_COMPONENTS.length)];
    reward.component = { id: component.id, qty: tier === 'legendary' ? 1 + Math.floor(draw(random) * 2) : 1 };
  }
  return reward;
}

export function trialFragmentItemId(blueprint: TrialBlueprintId, part: number): string {
  return 'trial_fragment_' + blueprint + '_' + part;
}
export function trialComponentItemId(id: TrialComponentId): string {
  return 'trial_component_' + id;
}

function addMaterial(inventory: InventoryItem[], item: InventoryItem): InventoryItem[] {
  const previous = inventory.find(i => i.id === item.id);
  if (previous) return inventory.map(i => i.id === item.id ? { ...i, qty: i.qty + item.qty } : i);
  return [...inventory, item];
}

export function applyTrialChest(state: GameState, loot: TrialChestReward | null, now = Date.now()): GameState {
  // Existing progress and the already-paid chest stay intact after floor resets.
  if (!loot || trialChestTier(loot.floor) !== loot.tier || state.trialChestClaims?.includes(loot.floor)) {
    return { ...state, lastTrialChest: null };
  }
  let inventory = state.inventory;
  if (loot.fragment) {
    const { blueprint, part } = loot.fragment;
    const target = TRIAL_BLUEPRINTS.find(x => x.id === blueprint);
    if (target && Number.isSafeInteger(part) && part >= 1 && part <= 6) {
      inventory = addMaterial(inventory, {
        id: trialFragmentItemId(blueprint, part),
        name: 'Фрагмент ' + part + '/6 · ' + target.name,
        icon: '📜', type: 'material', rarity: part === 6 ? 'legendary' : part === 5 ? 'epic' : 'rare',
        qty: 1, description: 'Часть редкого чертежа. Не портится. Для будущего создания предмета мастером.',
      });
    }
  }
  if (loot.component) {
    const def = TRIAL_COMPONENTS.find(x => x.id === loot.component?.id);
    if (def && Number.isSafeInteger(loot.component.qty) && loot.component.qty > 0 && loot.component.qty <= 2) {
      inventory = addMaterial(inventory, {
        id: trialComponentItemId(def.id), name: def.name, icon: '✦', type: 'material', rarity: 'epic',
        qty: loot.component.qty, description: 'Редкий ингредиент из Испытаний для будущих рецептов профессий. Не портится.',
      });
    }
  }
  if ((loot.potions ?? 0) > 0) {
    // Each earned floor creates a dated batch. Never refresh the expiry of an
    // existing stack after a floor reset or duplicate award.
    inventory = [...inventory, {
      id: 'trial_health_potion_' + loot.floor,
      name: 'Большое зелье здоровья',
      icon: '⚗️', type: 'potion', rarity: 'rare',
      qty: loot.potions!, description: 'Восстанавливает 150 HP мгновенно',
      effect: { stat: 'hp', value: 150, duration: 'instant' },
      expiresAt: newElixirExpiry(now),
    }];
  }
  if (loot.elixirs > 0) {
    // Separate dated batch: 7-day consumable expiration must never extend an old batch.
    inventory = [...inventory, {
      id: 'trial_elixir_' + loot.floor,
      name: 'Эликсир силы',
      icon: '💪', type: 'elixir', rarity: 'rare',
      qty: loot.elixirs,
      description: '+10 к атаке на один бой',
      effect: { stat: 'attack', value: 10, duration: 'battle' },
      expiresAt: newElixirExpiry(now),
    }];
  }
  return {
    ...state,
    inventory,
    territoryCityReputation: (state.territoryCityReputation ?? 0) + loot.reputation,
    trialChestClaims: [...(state.trialChestClaims ?? []), loot.floor],
    lastTrialChest: loot,
    player: {
      ...state.player,
      gold: state.player.gold + loot.gold,
      gems: state.player.gems + loot.gems,
    },
    forgeMaterials: state.forgeMaterials + loot.materials,
  };
}

export function ownedTrialFragmentCount(state: Pick<GameState, 'inventory'>, blueprint: TrialBlueprintId, part: number): number {
  return state.inventory.find(i => i.id === trialFragmentItemId(blueprint, part))?.qty ?? 0;
}


export function trialBlueprintItemId(blueprint: TrialBlueprintId): string {
  return 'trial_blueprint_' + blueprint;
}

export function hasAssembledTrialBlueprint(state: Pick<GameState, 'inventory'>, blueprint: TrialBlueprintId): boolean {
  return state.inventory.some(item => item.id === trialBlueprintItemId(blueprint) && item.qty > 0);
}

/**
 * Only a full set of six DISTINCT numbered fragments can be assembled.
 * This creates an owned, permanent recipe document, NOT finished equipment.
 * Crafting must still respect the player's profession, mastery and ingredients.
 */
export function assembleTrialBlueprint(state: GameState, blueprint: TrialBlueprintId): GameState | null {
  const definition = TRIAL_BLUEPRINTS.find(x => x.id === blueprint);
  // Fragments are tradable hunt loot, but only the matching profession may
  // assemble its working blueprint. Others keep or eventually sell the parts.
  if (!definition || state.professions?.active !== definition.profession || hasAssembledTrialBlueprint(state, blueprint)) return null;
  if (![1, 2, 3, 4, 5, 6].every(part => ownedTrialFragmentCount(state, blueprint, part) >= 1)) return null;
  const spent = state.inventory
    .map(item => {
      if (![1, 2, 3, 4, 5, 6].some(part => item.id === trialFragmentItemId(blueprint, part))) return item;
      return { ...item, qty: item.qty - 1 };
    }).filter(item => item.qty > 0);
  const assembled: InventoryItem = {
    id: trialBlueprintItemId(blueprint),
    name: 'Чертёж · ' + definition.name,
    icon: '📜',
    type: 'material', rarity: 'legendary', qty: 1,
    description: 'Постоянный чертёж мастера. Для создания готового предмета нужны профессия, мастерство и редкие материалы. Крафт по этому чертежу пока готовится.',
  };
  return { ...state, inventory: [...spent, assembled] };
}
