import type { GameState, InventoryItem } from './types';

export const ELIXIR_SHELF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

export function newElixirExpiry(now = Date.now()): string {
  return new Date(now + ELIXIR_SHELF_LIFE_MS).toISOString();
}

export function elixirExpiryTime(item: InventoryItem): number {
  if (item.type !== 'elixir') return Infinity;
  const timestamp = item.expiresAt ? Date.parse(item.expiresAt) : NaN;
  return Number.isFinite(timestamp) ? timestamp : Infinity;
}

export function isElixirExpired(item: InventoryItem, now = Date.now()): boolean {
  return item.type === 'elixir' && elixirExpiryTime(item) <= now;
}

/** Every acquired batch has its own fixed deadline; refreshing a stack is forbidden. */
export function newElixirBatch(item: InventoryItem, now = Date.now()): InventoryItem {
  return { ...item, expiresAt: newElixirExpiry(now) };
}

/** Backwards-compatible one-time grace period for existing un-dated elixirs.
 * Run on cloud load and on clock ticks. Never changes currency, potions, or equipment.
 */
export function reconcileElixirExpiry(state: GameState, now = Date.now()): GameState {
  const deadline = newElixirExpiry(now);
  let changed = false;
  let found = false;

  const reconcile = (item: InventoryItem): InventoryItem | null => {
    if (item.type !== 'elixir') return item;
    found = true;
    const expiry = elixirExpiryTime(item);
    if (expiry <= now) {
      changed = true;
      return null;
    }
    if (expiry === Infinity) {
      changed = true;
      return { ...item, expiresAt: deadline };
    }
    return item;
  };

  const inventory = state.inventory.map(reconcile).filter((item): item is InventoryItem => item !== null);
  const belt = state.belt.map((item) => (item ? reconcile(item) : null));
  const migrated = found && !state.elixirExpiryStartedAt;
  return changed || migrated
    ? { ...state, inventory, belt, elixirExpiryStartedAt: state.elixirExpiryStartedAt ?? new Date(now).toISOString() }
    : state;
}

export function elixirTimeLeftLabel(item: InventoryItem, language: string, now = Date.now()): string {
  if (item.type !== 'elixir') return '';
  const milliseconds = Math.max(0, elixirExpiryTime(item) - now);
  if (!Number.isFinite(milliseconds)) return language === 'en' ? '7 days' : '7 суток';
  if (milliseconds === 0) return language === 'en' ? 'Expired' : 'Просрочен';
  const hours = Math.ceil(milliseconds / (60 * 60 * 1000));
  if (hours <= 24) return language === 'en' ? `${hours}h left` : `${hours} ч осталось`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return language === 'en' ? `${days}d ${remainder}h left` : `${days} д ${remainder} ч`;
}
