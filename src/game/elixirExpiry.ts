import type { GameState, InventoryItem } from './types';

export const ELIXIR_SHELF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** All battle consumables, including health and time potions, expire in seven days. */
export const isPerishableItem = (item: InventoryItem): boolean =>
  item.type === 'elixir' || item.type === 'potion' || item.type === 'arena';

export function newElixirExpiry(now = Date.now()): string {
  return new Date(now + ELIXIR_SHELF_LIFE_MS).toISOString();
}

export function elixirExpiryTime(item: InventoryItem): number {
  if (!isPerishableItem(item)) return Infinity;
  const timestamp = item.expiresAt ? Date.parse(item.expiresAt) : NaN;
  return Number.isFinite(timestamp) ? timestamp : Infinity;
}

export function isElixirExpired(item: InventoryItem, now = Date.now()): boolean {
  return isPerishableItem(item) && elixirExpiryTime(item) <= now;
}

/** A new receipt gets a fresh batch. Never refresh the time of existing stock. */
export function newElixirBatch(item: InventoryItem, now = Date.now()): InventoryItem {
  return isPerishableItem(item) ? { ...item, expiresAt: newElixirExpiry(now) } : item;
}

type MaterialBatch = NonNullable<GameState['forgeMaterialBatches']>[number];
const validQty = (n: number): boolean => Number.isSafeInteger(n) && n > 0;

/** Keep the old numeric material wallet, but track dated lots separately.
 * Server-awarded increments create new lots; crafting and training spend old ones first.
 */
function reconcileForgeMaterialBatches(state: GameState, now: number): Pick<GameState, 'forgeMaterials' | 'forgeMaterialBatches'> | null {
  const balance = Math.max(0, Number.isSafeInteger(state.forgeMaterials) ? state.forgeMaterials : 0);
  const raw = state.forgeMaterialBatches;
  if (!raw && balance === 0) return null;
  const expiry = newElixirExpiry(now);
  let changed = !raw;
  let batches: MaterialBatch[] = (raw ?? []).filter((batch) => {
    const okay = validQty(batch.qty) && Number.isFinite(Date.parse(batch.expiresAt));
    if (!okay) changed = true;
    return okay;
  });
  if (!raw && balance > 0) batches = [{ qty: balance, expiresAt: expiry }];

  const tracked = batches.reduce((sum, batch) => sum + batch.qty, 0);
  if (tracked < balance) {
    const increase = balance - tracked;
    // Merge receipts within one minute to keep saves compact on long farming sessions.
    const last = batches[batches.length - 1];
    if (last && Math.abs(Date.parse(last.expiresAt) - Date.parse(expiry)) < 60_000)
      batches = [...batches.slice(0, -1), { ...last, qty: last.qty + increase }];
    else batches = [...batches, { qty: increase, expiresAt: expiry }];
    changed = true;
  } else if (tracked > balance) {
    let spent = tracked - balance;
    batches = batches.slice().sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
      .map((batch) => {
        const consumed = Math.min(batch.qty, spent);
        spent -= consumed;
        return consumed ? { ...batch, qty: batch.qty - consumed } : batch;
      }).filter((batch) => batch.qty > 0);
    changed = true;
  }

  const alive = batches.filter((batch) => Date.parse(batch.expiresAt) > now);
  const expiredAmount = batches.reduce((total, batch) => total + (Date.parse(batch.expiresAt) <= now ? batch.qty : 0), 0);
  if (expiredAmount > 0) changed = true;
  return changed ? { forgeMaterials: Math.max(0, balance - expiredAmount), forgeMaterialBatches: alive } : null;
}

/** One-time grace for old stocks; live updates normalize server-granted lots.
 * Expired consumables disappear from inventory and belt; equipment is untouched.
 */
export function reconcileElixirExpiry(state: GameState, now = Date.now()): GameState {
  const deadline = newElixirExpiry(now);
  let changed = false;
  let found = false;

  const reconcile = (item: InventoryItem): InventoryItem | null => {
    if (!isPerishableItem(item)) return item;
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
  const materialChanges = reconcileForgeMaterialBatches(state, now);
  const migrated = found && !state.elixirExpiryStartedAt;
  return changed || migrated || materialChanges
    ? { ...state, inventory, belt, ...materialChanges,
      elixirExpiryStartedAt: migrated ? new Date(now).toISOString() : state.elixirExpiryStartedAt }
    : state;
}

export function elixirTimeLeftLabel(item: InventoryItem, language: string, now = Date.now()): string {
  if (!isPerishableItem(item)) return '';
  const milliseconds = Math.max(0, elixirExpiryTime(item) - now);
  if (!Number.isFinite(milliseconds)) return language === 'en' ? '7 days' : '7 суток';
  if (milliseconds === 0) return language === 'en' ? 'Expired' : 'Просрочен';
  const hours = Math.ceil(milliseconds / (60 * 60 * 1000));
  if (hours <= 24) return language === 'en' ? `${hours}h left` : `${hours} ч осталось`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return language === 'en' ? `${days}d ${remainder}h left` : `${days} д ${remainder} ч`;
}

export function forgeMaterialTimeLeftLabel(state: GameState, language: string, now = Date.now()): string {
  const earliest = Math.min(...(state.forgeMaterialBatches ?? []).map((batch) => Date.parse(batch.expiresAt)));
  return Number.isFinite(earliest)
    ? elixirTimeLeftLabel({ type: 'elixir', expiresAt: new Date(earliest).toISOString() } as InventoryItem, language, now)
    : language === 'en' ? '7 days' : '7 суток';
}
