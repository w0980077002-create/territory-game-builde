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

/** Legacy server APIs still require a dated material-lot record. This far-future
 * compatibility value is NOT a gameplay expiration; forge materials never spoil.
 * Never subtract an old expired lot from the player's saved balance. */
export const PERMANENT_FORGE_BATCH_EXPIRY = '9999-12-31T23:59:59.000Z';

function reconcileForgeMaterialBatches(state: GameState): Pick<GameState, 'forgeMaterialBatches'> | null {
  const balance = Math.max(0, Number.isSafeInteger(state.forgeMaterials) ? state.forgeMaterials : 0);
  const existing = state.forgeMaterialBatches;
  if (existing?.length === (balance > 0 ? 1 : 0)
    && (balance === 0 || (existing[0].qty === balance
      && existing[0].expiresAt === PERMANENT_FORGE_BATCH_EXPIRY))) return null;
  return { forgeMaterialBatches: balance > 0
    ? [{ qty: balance, expiresAt: PERMANENT_FORGE_BATCH_EXPIRY }] : [] };
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
  const materialChanges = reconcileForgeMaterialBatches(state);
  const migrated = found && !state.elixirExpiryStartedAt;
  return changed || migrated || materialChanges
    ? { ...state, inventory, belt, ...materialChanges,
      elixirExpiryStartedAt: migrated ? new Date(now).toISOString() : state.elixirExpiryStartedAt }
    : state;
}

export function elixirTimeLeftLabel(item: InventoryItem, language: string, now = Date.now()): string {
  if (!isPerishableItem(item)) return '';
  const milliseconds = Math.max(0, elixirExpiryTime(item) - now);
  if (!Number.isFinite(milliseconds)) return language === 'en' ? '7d 00:00:00' : '7д 00:00:00';
  if (milliseconds === 0) return language === 'en' ? 'Expired' : 'Просрочен';
  const seconds = Math.ceil(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;
  const clock = [hours, minutes, restSeconds].map((n) => String(n).padStart(2, '0')).join(':');
  return language === 'en' ? `${days}d ${clock}` : `${days}д ${clock}`;
}

