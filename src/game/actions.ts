import { create } from './store';
import { prepareNewEquipment, capEquipmentToHeroLevel } from './equipmentBalance';
import { calendarDayKey, weeklyQuestKey } from './weeklyQuests';
import { reconcileFollowers } from './followers';
import { canBuyShopItem, shopStonesBoughtToday, SHOP_STONES_PER_DAY, MAX_SHOP_PURCHASE_QTY } from './purchaseGuard';
import type { GameState } from './types';
import {
  createInitialGame,
  createInitialQuests,
  xpForLevel,
  HERO_MAX_LEVEL,
} from './engine';
import type { InventoryItem, ShopItem, Equipment, Enemy } from './types';

export const useGame = create<GameState>(createInitialGame());

export const useArena = create({ rating: 1000, wins: 0, losses: 0 });

export const useAccount = create({ vip: 0, vipUntil: null as string|null, permanentVip:0, vipRemaining:0, vipCheckedAt:0, username: null as string | null });

export function grantRewards(state: GameState, gold: number, xp: number): GameState {
  const withGold = { ...state, player: { ...state.player, gold: state.player.gold + gold } };
  return { ...withGold, ...addXp(withGold, xp) } as GameState;
}

const ENERGY_REGEN_MS = 5 * 60 * 1000;

export function applyTimeEffects(state: GameState, now = Date.now()): GameState {
  let next = state;
  const { energy, maxEnergy } = state.player;
  const last = state.lastEnergyAt || now;
  if (energy >= maxEnergy) {
    if (state.lastEnergyAt !== now) next = { ...next, lastEnergyAt: now };
  } else {
    const ticks = Math.floor((now - last) / ENERGY_REGEN_MS);
    if (ticks > 0) {
      const newEnergy = Math.min(maxEnergy, energy + ticks);
      next = {
        ...next,
        player: { ...next.player, energy: newEnergy },
        lastEnergyAt: newEnergy >= maxEnergy ? now : last + ticks * ENERGY_REGEN_MS,
      };
    }
  }

  const today = calendarDayKey(now);
  if (state.dailyResetDay === new Date(now).toDateString() && state.dailyResetDay !== today) {
    next = { ...next, dailyResetDay: today };
  } else if (state.dailyResetDay !== today) {
    const fresh = createInitialQuests();
    next = {
      ...next,
      dailyResetDay: today,
      activeDays: (next.activeDays ?? 1) + (state.dailyResetDay ? 1 : 0),
      quests: next.quests.map((q) =>
        q.type === 'daily' ? (fresh.find((f) => f.id === q.id) ?? q) : q,
      ).concat(fresh.filter((f) => !next.quests.some((q) => q.id === f.id))),
    };
  }
  // Weekly quests were previously never reset. A legacy save without a week
  // marker is anchored to the current week without discarding earned progress.
  // Subsequent Sunday calendar boundaries reset only weekly quests, never story/achievements.
  const thisWeek = weeklyQuestKey(now);
  if (!state.weeklyResetWeek) {
    next = { ...next, weeklyResetWeek: thisWeek };
  } else if (state.weeklyResetWeek !== thisWeek) {
    const weeklyDefaults = createInitialQuests().filter((q) => q.type === 'weekly');
    const known = new Set(next.quests.map((q) => q.id));
    next = {
      ...next,
      weeklyResetWeek: thisWeek,
      quests: next.quests.map((q) => q.type === 'weekly'
        ? (weeklyDefaults.find((fresh) => fresh.id === q.id) ?? q)
        : q,
      ).concat(weeklyDefaults.filter((q) => !known.has(q.id))),
    };
  }
  return next;
}

export function msUntilNextEnergy(state: GameState, now = Date.now()): number | null {
  if (state.player.energy >= state.player.maxEnergy) return null;
  return Math.max(0, ENERGY_REGEN_MS - (now - state.lastEnergyAt));
}

export function addXp(state: GameState, amount: number): Partial<GameState> {
  // At level 100 no more experience or base stats can be farmed.
  if (state.player.level >= HERO_MAX_LEVEL) {
    return { player: { ...state.player, level: HERO_MAX_LEVEL, xp: 0, xpToNext: 0 } };
  }

  let xp = state.player.xp + amount;
  let level = state.player.level;
  let xpToNext = state.player.xpToNext > 0 ? state.player.xpToNext : xpForLevel(level);
  let stats = { ...state.player.stats };
  let maxEnergy = state.player.maxEnergy;

  while (level < HERO_MAX_LEVEL && xp >= xpToNext) {
    xp -= xpToNext;
    level++;
    xpToNext = xpForLevel(level);
    stats.maxHp += 20;
    stats.hp = stats.maxHp;
    stats.attack += 5;
    stats.defense += 2;
    maxEnergy += 1;
  }
  if (level >= HERO_MAX_LEVEL) {
    xp = 0;
    xpToNext = 0;
  }

  const followers = reconcileFollowers(state.followers, level);

  return {
    player: {
      ...state.player,
      xp,
      level,
      xpToNext,
      stats,
      maxEnergy,
    },
    followers,
  };
}

export const DAILY_STONE_LIMIT = SHOP_STONES_PER_DAY;

function getStoneBoughtToday(state: GameState, now = new Date()): number {
  return shopStonesBoughtToday(state, now);
}

export function stonesRemainingToday(state: GameState, now = new Date()): number {
  return Math.max(0, DAILY_STONE_LIMIT - getStoneBoughtToday(state, now));
}

export function maxStoneQty(state: GameState, item: ShopItem, now = new Date()): number {
  const perUnit = item.amount ?? 1;
  if (!Number.isSafeInteger(perUnit) || perUnit < 1 || perUnit > DAILY_STONE_LIMIT) return 0;
  const remaining = stonesRemainingToday(state, now);
  return Math.min(MAX_SHOP_PURCHASE_QTY, Math.floor(remaining / perUnit));
}

export function buyItem(state: GameState, shopItem: ShopItem, qty: number = 1): GameState | null {
  if (!canBuyShopItem(state, shopItem, qty)) return null;

  const now = new Date();
  const today = calendarDayKey(now.getTime());
  const isStone = shopItem.type === 'stone';
  const stonePerUnit = isStone ? (shopItem.amount ?? 1) : 0;
  const stoneTotal = stonePerUnit * qty;
  const currentBought = isStone ? getStoneBoughtToday(state, now) : 0;

  if (isStone && currentBought + stoneTotal > DAILY_STONE_LIMIT) return null;

  const totalGold = (shopItem.priceGold ?? 0) * qty;
  const totalGems = (shopItem.priceGems ?? 0) * qty;

  if (shopItem.priceGold && state.player.gold < totalGold) return null;
  if (shopItem.priceGems && state.player.gems < totalGems) return null;

  let gold = state.player.gold;
  let gems = state.player.gems;
  let inventory = [...state.inventory];
  let forgeMaterials = state.forgeMaterials;
  let battleStones = state.battleStones;
  let dailyStonesBought = state.dailyStonesBought;
  let dailyStonesDate = state.dailyStonesDate;

  if (isStone) {
    dailyStonesDate = today;
    dailyStonesBought = currentBought + stoneTotal;
  }

  if (shopItem.priceGold) gold -= totalGold;
  if (shopItem.priceGems) gems -= totalGems;

  if (shopItem.type === 'gem_pack') {
    gems += (shopItem.amount ?? 0) * qty;
  } else if (shopItem.type === 'stone') {
    battleStones += (shopItem.amount ?? 1) * qty;
  } else if (shopItem.type === 'material') {
    forgeMaterials += qty;
  } else if (shopItem.type === 'equipment') {
    if (!shopItem.equipment) return null;
    for (let i = 0; i < qty; i++) {
      const newEquipment: Equipment = capEquipmentToHeroLevel(prepareNewEquipment({
        ...shopItem.equipment,
        id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}_${i}`,
      }), state.player.level);
      inventory.push({
        id: newEquipment.id,
        name: shopItem.name,
        icon: shopItem.icon,
        type: 'equipment',
        rarity: shopItem.rarity,
        qty: 1,
        description: `Уровень ${newEquipment.level} · ${newEquipment.rarity}`,
        equipment: newEquipment,
      });
    }
  } else {
    const existing = inventory.find(
      (i) => i.name === shopItem.name && i.type !== 'equipment',
    );
    if (existing) {
      inventory = inventory.map((i) =>
        i.id === existing.id ? { ...i, qty: i.qty + qty } : i,
      );
    } else {
      const newItem: InventoryItem = {
        id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: shopItem.name,
        icon: shopItem.icon,
        type: shopItem.type as InventoryItem['type'],
        rarity: shopItem.rarity,
        qty,
        description: shopItem.description,
        effect: shopItem.effect,
        arenaEffect: shopItem.arenaEffect,
      };
      inventory.push(newItem);
    }
  }

  const next: GameState = {
    ...state,
    player: { ...state.player, gold, gems },
    inventory,
    forgeMaterials,
    battleStones,
    dailyStonesBought,
    dailyStonesDate,
  };
  return shopItem.priceGold ? updateProgress(next, 'gold_spent', totalGold) : next;
}

export function equipItem(state: GameState, item: InventoryItem): GameState {
  if (!item.equipment) return state;
  const eq = capEquipmentToHeroLevel(item.equipment, state.player.level);
  const slot = eq.slot;
  const currentEquipped = state.player.equipped[slot];

  let inventory = state.inventory.filter((i) => i.id !== item.id);

  if (currentEquipped) {
    inventory.push({
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: currentEquipped.name,
      icon: currentEquipped.icon,
      type: 'equipment',
      rarity: currentEquipped.rarity,
      qty: 1,
      description: `Уровень ${currentEquipped.level} · ${currentEquipped.rarity}`,
      equipment: currentEquipped,
    });
  }

  const equipped = { ...state.player.equipped, [slot]: eq };

  return {
    ...state,
    player: { ...state.player, equipped },
    inventory,
  };
}

export function unequipItem(state: GameState, slot: Equipment['slot']): GameState {
  const eq = state.player.equipped[slot];
  if (!eq) return state;

  const inventory = [...state.inventory, {
    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: eq.name,
    icon: eq.icon,
    type: 'equipment' as const,
    rarity: eq.rarity,
    qty: 1,
    description: `Уровень ${eq.level} · ${eq.rarity}`,
    equipment: eq,
  }];

  const equipped = { ...state.player.equipped };
  delete equipped[slot];

  return {
    ...state,
    player: { ...state.player, equipped },
    inventory,
  };
}

export function claimQuest(state: GameState, questId: string): GameState {
  const quest = state.quests.find((q) => q.id === questId);
  if (!quest || quest.claimed || quest.current < quest.target) return state;

  const xpResult = addXp(state, quest.rewardXp);
  return {
    ...state,
    ...xpResult,
    battleStones: state.battleStones + (quest.rewardStones ?? 0),
    quests: state.quests.map((q) =>
      q.id === questId ? { ...q, claimed: true } : q,
    ),
    player: {
      ...(xpResult as any).player || state.player,
      gold: state.player.gold + quest.rewardGold,
      gems: state.player.gems + quest.rewardGems,
    },
  };
}

export function claimAchievement(state: GameState, achId: string): GameState {
  const ach = state.achievements.find((a) => a.id === achId);
  if (!ach || ach.claimed || ach.current < ach.target) return state;

  return {
    ...state,
    achievements: state.achievements.map((a) =>
      a.id === achId ? { ...a, claimed: true } : a,
    ),
    player: {
      ...state.player,
      gems: state.player.gems + ach.rewardGems,
    },
  };
}

export function updateProgress(
  state: GameState,
  type: 'battle_win' | 'boss_win' | 'gold_spent' | 'chapter_complete' | 'arena_win',
  amount: number = 1,
): GameState {
  const quests = state.quests.map((q) => {
    if (q.claimed) return q;
    let updated = q;
    if (type === 'arena_win' && q.id === 'q_daily_3') {
      updated = { ...q, current: Math.min(q.target, q.current + amount) };
    }
    if (type === 'battle_win' && q.id === 'q_daily_1') {
      updated = { ...q, current: Math.min(q.target, q.current + amount) };
    }
    if (type === 'boss_win' && q.id === 'q_weekly_1') {
      updated = { ...q, current: Math.min(q.target, q.current + amount) };
    }
    if (type === 'gold_spent' && q.id === 'q_daily_2') {
      updated = { ...q, current: Math.min(q.target, q.current + amount) };
    }
    if (type === 'chapter_complete' && q.id === 'q_story_1') {
      updated = { ...q, current: Math.min(q.target, q.current + amount) };
    }
    return updated;
  });

  const achievements = state.achievements.map((a) => {
    if (a.claimed) return a;
    if (type === 'battle_win' && (a.id === 'ach_1' || a.id === 'ach_2')) {
      return { ...a, current: a.current + amount };
    }
    if (type === 'boss_win' && a.id === 'ach_4') {
      return { ...a, current: a.current + amount };
    }
    if (type === 'chapter_complete' && a.id === 'ach_3') {
      return { ...a, current: a.current + amount };
    }
    return a;
  });

  return { ...state, quests, achievements };
}

export function recordBattleResult(
  state: GameState,
  enemy: Enemy,
  rewards: { gold: number; xp: number },
): GameState {
  let newState: GameState = {
    ...state,
    player: {
      ...state.player,
      gold: state.player.gold + rewards.gold,
    },
    totalBattlesWon: state.totalBattlesWon + (enemy.isBoss ? 0 : 1),
    totalBossesDefeated: state.totalBossesDefeated + (enemy.isBoss ? 1 : 0),
    forgeMaterials: state.forgeMaterials + (enemy.isBoss ? 3 : Math.random() < 0.35 ? 1 : 0),
  };

  const xpResult = addXp(newState, rewards.xp);
  newState = { ...newState, ...xpResult } as GameState;

  // Update chapter progress
  if (!enemy.isBoss) {
    newState = {
      ...newState,
      chapterWins: newState.chapterWins + 1,
    };
  } else {
    const nextChapter = newState.currentChapter + 1;
    newState = {
      ...newState,
      currentChapter: nextChapter,
      chapterWins: 0,
    };
    newState = updateProgress(newState, 'chapter_complete', 1) as GameState;
  }

  newState = updateProgress(newState, 'battle_win', 1) as GameState;
  if (enemy.isBoss) {
    newState = updateProgress(newState, 'boss_win', 1) as GameState;
  }

  // Update gold achievement
  newState = {
    ...newState,
    achievements: newState.achievements.map((a) =>
      a.id === 'ach_5' && !a.claimed
        ? { ...a, current: newState.player.gold }
        : a,
    ),
  };

  return newState;
}
