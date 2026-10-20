import type { GameState, ShopItem } from './types';
import { calendarDayKey } from './weeklyQuests';

// Guard malformed/oversized UI requests. Server validation remains mandatory.
export const MAX_SHOP_PURCHASE_QTY = 1000;
export const MAX_SERVER_INTEGER = 2147483647;
export const SHOP_STONES_PER_DAY = 25;

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SERVER_INTEGER;
}

export function shopStonesBoughtToday(state: GameState, now = new Date()): number {
  if (state.dailyStonesDate !== calendarDayKey(now.getTime()) && state.dailyStonesDate !== now.toDateString()) return 0;
  // Corrupt or forged counters must not silently remove the local limit.
  return validNonNegativeInteger(state.dailyStonesBought) && state.dailyStonesBought <= SHOP_STONES_PER_DAY
    ? state.dailyStonesBought
    : SHOP_STONES_PER_DAY;
}

export function canBuyShopItem(state: GameState, item: ShopItem, qty: number, now = new Date()): boolean {
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > MAX_SHOP_PURCHASE_QTY) return false;
  const goldEach = item.priceGold ?? 0;
  const gemsEach = item.priceGems ?? 0;
  if (!validNonNegativeInteger(goldEach) || !validNonNegativeInteger(gemsEach)) return false;
  if (!validNonNegativeInteger(state.player.gold) || !validNonNegativeInteger(state.player.gems)) return false;
  const totalGold = goldEach * qty;
  const totalGems = gemsEach * qty;
  if (!validNonNegativeInteger(totalGold) || !validNonNegativeInteger(totalGems)) return false;
  if (state.player.gold < totalGold || state.player.gems < totalGems) return false;
  if (item.type === 'equipment' && !item.equipment) return false;
  if (item.type === 'stone') {
    const amount = item.amount ?? 1;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > SHOP_STONES_PER_DAY) return false;
    const stonesToAdd = amount * qty;
    if (!validNonNegativeInteger(stonesToAdd)) return false;
    if (!validNonNegativeInteger(state.battleStones) || state.battleStones + stonesToAdd > MAX_SERVER_INTEGER) return false;
    if (shopStonesBoughtToday(state, now) + stonesToAdd > SHOP_STONES_PER_DAY) return false;
  }
  if (item.type === 'gem_pack') {
    const amount = item.amount ?? 0;
    if (!validNonNegativeInteger(amount) || amount < 1 || !validNonNegativeInteger(amount * qty)) return false;
    if (state.player.gems - totalGems + amount * qty > MAX_SERVER_INTEGER) return false;
  }
  if (item.type === 'material' && (!validNonNegativeInteger(state.forgeMaterials) || state.forgeMaterials + qty > MAX_SERVER_INTEGER)) return false;
  return true;
}
