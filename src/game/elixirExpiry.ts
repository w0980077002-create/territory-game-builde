import type { GameState, InventoryItem } from './types';

/** All potions, elixirs and Arena consumables are permanent (owner decision 11 Nov 2026).
 * Keep the historical predicate name for API compatibility; it now simply
 * identifies consumables and NEVER implies that they expire.
 */
export const isPerishableItem = (item: InventoryItem): boolean =>
  item.type === 'elixir' || item.type === 'potion' || item.type === 'arena';

/** Older profiles may still carry an expiresAt field, but it is not authoritative.
 * Do not delete or reject the item, even when its historical timestamp is past.
 */
export function elixirExpiryTime(_item: InventoryItem): number {
  return Infinity;
}
export function isElixirExpired(_item: InventoryItem, _now = Date.now()): boolean {
  return false;
}
export function newElixirBatch(item: InventoryItem, _now = Date.now()): InventoryItem {
  if (!isPerishableItem(item) || !Object.prototype.hasOwnProperty.call(item, 'expiresAt')) return item;
  const next = { ...item };
  delete next.expiresAt;
  return next;
}

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

/** Save-preserving migration: remove obsolete expiry metadata from existing
 * consumables (inventory AND equipped belt), retaining exact quantities, type,
 * rarity, power and every item. Forge materials keep their permanent batches.
 */
export function reconcileElixirExpiry(state: GameState, _now = Date.now()): GameState {
  let changed = false;
  const normalize = (item: InventoryItem): InventoryItem => {
    if (!isPerishableItem(item) || !Object.prototype.hasOwnProperty.call(item, 'expiresAt')) return item;
    changed = true;
    const next = { ...item };
    delete next.expiresAt;
    return next;
  };
  const inventory = state.inventory.map(normalize);
  const belt = state.belt.map(item => item ? normalize(item) : null);
  const materialChanges = reconcileForgeMaterialBatches(state);
  return changed || materialChanges
    ? { ...state, inventory, belt, ...materialChanges } : state;
}

/** Kept only for old callers; permanent consumables have no countdown. */
export function elixirTimeLeftLabel(_item: InventoryItem, _language: string, _now = Date.now()): string {
  return '';
}
