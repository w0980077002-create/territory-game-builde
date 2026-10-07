import { create } from './store';
import type { GameState } from './types';
import {
  createInitialGame,
  createInitialQuests,
  xpForLevel,
} from './engine';
import type { InventoryItem, ShopItem, Equipment, Enemy } from './types';

export const useGame = create<GameState>(createInitialGame());

export const useArena = create({ rating: 1000, wins: 0, losses: 0 });

export const useAccount = create({ vip: 0, username: null as string | null });

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

  const today = new Date(now).toDateString();
  if (state.dailyResetDay !== today) {
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
  return next;
}

export function msUntilNextEnergy(state: GameState, now = Date.now()): number | null {
  if (state.player.energy >= state.player.maxEnergy) return null;
  return Math.max(0, ENERGY_REGEN_MS - (now - state.lastEnergyAt));
}

export function addXp(state: GameState, amount: number): Partial<GameState> {
  let xp = state.player.xp + amount;
  let level = state.player.level;
  let xpToNext = state.player.xpToNext;
  let stats = { ...state.player.stats };
  let maxEnergy = state.player.maxEnergy;

  while (xp >= xpToNext) {
    xp -= xpToNext;
    level++;
    xpToNext = xpForLevel(level);
    stats.maxHp += 20;
    stats.hp = stats.maxHp;
    stats.attack += 5;
    stats.defense += 2;
    maxEnergy += 1;
  }

  const followers = state.followers.map((f) =>
    f.id === 'follower_1' && level >= 3 && !f.unlocked
      ? { ...f, unlocked: true }
      : f,
  );

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

export function buyItem(state: GameState, shopItem: ShopItem): GameState | null {
  if (shopItem.priceGold && state.player.gold < shopItem.priceGold) return null;
  if (shopItem.priceGems && state.player.gems < shopItem.priceGems) return null;

  let gold = state.player.gold;
  let gems = state.player.gems;
  let inventory = [...state.inventory];
  let forgeMaterials = state.forgeMaterials;
  let battleStones = state.battleStones;

  if (shopItem.priceGold) gold -= shopItem.priceGold;
  if (shopItem.priceGems) gems -= shopItem.priceGems;

  if (shopItem.type === 'gem_pack') {
    gems += shopItem.amount ?? 0;
  } else if (shopItem.type === 'stone') {
    battleStones += shopItem.amount ?? 1;
  } else if (shopItem.type === 'material') {
    forgeMaterials += 1;
  } else if (shopItem.type === 'equipment') {
    if (!shopItem.equipment) return null;
    const newEquipment: Equipment = {
      ...shopItem.equipment,
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    };
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
  } else {
    const existing = inventory.find(
      (i) => i.name === shopItem.name && i.type !== 'equipment',
    );
    if (existing) {
      inventory = inventory.map((i) =>
        i.id === existing.id ? { ...i, qty: i.qty + 1 } : i,
      );
    } else {
      const newItem: InventoryItem = {
        id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: shopItem.name,
        icon: shopItem.icon,
        type: shopItem.type as InventoryItem['type'],
        rarity: shopItem.rarity,
        qty: 1,
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
  };
  return shopItem.priceGold ? updateProgress(next, 'gold_spent', shopItem.priceGold) : next;
}

export function equipItem(state: GameState, item: InventoryItem): GameState {
  if (!item.equipment) return state;
  const eq = item.equipment;
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
  rewards: { gold: number; xp: number; loot?: InventoryItem },
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

  if (rewards.loot) {
    newState = {
      ...newState,
      inventory: [...newState.inventory, rewards.loot],
    };
  }

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
