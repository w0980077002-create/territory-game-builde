import type { GameState, InventoryItem } from './types';
import { elixirExpiryTime, isElixirExpired, isPerishableItem } from './elixirExpiry';
import { VIP_AUTO_BELT_LEVEL } from './vipProgram';

export const BELT_STACK = 5;

export interface BeltContext {
  level: number;
  activeDays: number;
  arenaWins: number;
}

interface SlotRule {
  title: string;
  titleEn: string;
  check: (c: BeltContext) => { open: boolean; progress: string; progressEn: string };
}

/** Each later slot is earned only through confirmed arena victories.
 * No level, active-day, VIP, or clan requirement.
 */
export const BELT_WIN_GOALS = [0, 100, 500, 1000, 2000, 3500, 5000] as const;

const need = (have: number, goal: number) => `${Math.min(Math.max(0, have), goal)}/${goal}`;

export const BELT_RULES: SlotRule[] = BELT_WIN_GOALS.map((requiredWins) => ({
  title: requiredWins === 0 ? 'Открыт сразу' : `${requiredWins} побед на арене`,
  titleEn: requiredWins === 0 ? 'Unlocked from the start' : `${requiredWins} arena wins`,
  check: (c) => ({
    open: requiredWins === 0 || c.arenaWins >= requiredWins,
    progress: requiredWins === 0 ? '' : `победы ${need(c.arenaWins, requiredWins)}`,
    progressEn: requiredWins === 0 ? '' : `wins ${need(c.arenaWins, requiredWins)}`,
  }),
}));

/** Reconcile saved belts after login: locked slots and duplicate consumable kinds
 * return safely to inventory. Never discard a player's existing stock.
 * The validated arena win count comes from players.arena_wins, not game_state.
 */
export function reconcileLockedBelt(state: GameState, arenaWins: number): GameState {
  const c = beltContext(state, arenaWins);
  let next = state;
  const assignedKinds: InventoryItem[] = [];
  for (let i = 0; i < BELT_WIN_GOALS.length; i++) {
    const slot = next.belt[i];
    if (!slot) continue;
    if (!isSlotOpen(i, c) || slot.qty > BELT_STACK ||
        assignedKinds.some((assigned) => sameBeltKind(assigned, slot))) {
      next = takeFromBelt(next, i);
    } else {
      assignedKinds.push(slot);
    }
  }
  return next;
}

export const beltContext = (state: GameState, arenaWins: number): BeltContext => ({
  level: state.player.level,
  activeDays: state.activeDays,
  arenaWins,
});

export const isSlotOpen = (i: number, c: BeltContext) => BELT_RULES[i].check(c).open;

export const canBelt = (item: InventoryItem) =>
  (item.type === 'potion' || item.type === 'elixir' || item.type === 'arena') && !isElixirExpired(item);

/** One consumable kind can occupy only one belt slot. Expiry batches do not
 * create a different kind; they must not spread across additional slots.
 */
export const sameBeltKind = (a: InventoryItem, b: InventoryItem): boolean =>
  a.type === b.type && a.name === b.name && a.rarity === b.rarity
  && a.arenaEffect === b.arenaEffect
  && JSON.stringify(a.effect ?? null) === JSON.stringify(b.effect ?? null);

/** A single warehouse tile per identical consumable. It is a display-only
 * aggregate: source inventory IDs and individual expiration dates remain intact.
 * The tile ID and timer always point to the earliest valid original batch. */
export function groupConsumablesForDisplay(items: ReadonlyArray<InventoryItem>): InventoryItem[] {
  const groups: InventoryItem[] = [];
  for (const item of items.filter(isPerishableItem).filter(item => item.qty > 0)
    .sort((a, b) => elixirExpiryTime(a) - elixirExpiryTime(b))) {
    const existing = groups.find(group => sameBeltKind(group, item));
    if (existing) existing.qty += item.qty;
    else groups.push({ ...item });
  }
  return groups;
}

export type ArenaItemCode = 'heal_small' | 'heal_large' | 'attack' | 'defense' | 'crit';

export type BeltAction =
  | { kind: 'time' }
  | { kind: 'revive' }
  | { kind: 'item'; code: ArenaItemCode };

export function beltAction(item: InventoryItem): BeltAction | null {
  if (isElixirExpired(item)) return null;
  if (item.arenaEffect === 'time') return { kind: 'time' };
  if (item.arenaEffect === 'adrenaline') return { kind: 'revive' };
  const e = item.effect;
  if (!e) return null;
  if (e.stat === 'hp') return { kind: 'item', code: e.value >= 150 ? 'heal_large' : 'heal_small' };
  if (e.stat === 'attack') return { kind: 'item', code: 'attack' };
  if (e.stat === 'defense') return { kind: 'item', code: 'defense' };
  if (e.stat === 'critChance') return { kind: 'item', code: 'crit' };
  return null;
}

/** Equip from the oldest unexpired lot of the tapped consumable kind.
 * Do not mix dates inside a belt slot: its expiry must remain authoritative.
 * When an existing slot is partly filled, only its exact lot can top it up.
 */
export function putInBelt(state: GameState, itemId: string, c: BeltContext): GameState | null {
  const requested = state.inventory.find(i => i.id === itemId);
  if (!requested || !canBelt(requested) || !Number.isSafeInteger(requested.qty) || requested.qty <= 0) return null;
  const candidates = state.inventory.filter(i => sameBeltKind(i, requested)
    && canBelt(i) && Number.isSafeInteger(i.qty) && i.qty > 0)
    .sort((a, b) => elixirExpiryTime(a) - elixirExpiryTime(b));
  if (!candidates.length) return null;

  const belt = [...state.belt];
  const occupiedIndex = belt.findIndex(slot => slot && sameBeltKind(slot, requested));
  let index: number;
  let source: InventoryItem | undefined;
  if (occupiedIndex >= 0) {
    const existing = belt[occupiedIndex]!;
    if (!isSlotOpen(occupiedIndex, c) || existing.qty >= BELT_STACK) return null;
    // A partially occupied belt slot cannot silently combine expiration dates.
    source = candidates.find(i => !isPerishableItem(i) || i.expiresAt === existing.expiresAt);
    if (!source) return null;
    index = occupiedIndex;
  } else {
    index = belt.findIndex((slot, i) => !slot && isSlotOpen(i, c));
    if (index < 0) return null;
    source = candidates[0];
  }

  const current = belt[index]?.qty ?? 0;
  const moved = Math.min(BELT_STACK - current, source.qty);
  if (moved <= 0) return null;
  belt[index] = { ...source, id: `belt_${index}`, qty: current + moved };
  const inventory = state.inventory
    .map(i => i.id === source.id ? { ...i, qty: i.qty - moved } : i)
    .filter(i => i.qty > 0);
  return { ...state, belt, inventory };
}

export function takeFromBelt(state: GameState, index: number): GameState {
  const slot = state.belt[index];
  if (!slot) return state;
  const belt = state.belt.map((s, i) => (i === index ? null : s));
  if (isElixirExpired(slot)) return { ...state, belt };
  const existing = state.inventory.find((i) =>
    i.type === slot.type && i.name === slot.name && i.rarity === slot.rarity
    && i.arenaEffect === slot.arenaEffect && JSON.stringify(i.effect ?? null) === JSON.stringify(slot.effect ?? null)
    && (!isPerishableItem(slot) || i.expiresAt === slot.expiresAt)
  );
  const inventory = existing
    ? state.inventory.map((i) => (i.id === existing.id ? { ...i, qty: i.qty + slot.qty } : i))
    : [...state.inventory, { ...slot, id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}` }];
  return { ...state, belt, inventory };
}

export function consumeBelt(state: GameState, index: number): GameState {
  const slot = state.belt[index];
  if (!slot) return state;
  if (isElixirExpired(slot)) return { ...state, belt: state.belt.map((s, i) => i === index ? null : s) };
  const belt = state.belt.map((s, i) => (i !== index || !s ? s : s.qty > 1 ? { ...s, qty: s.qty - 1 } : null));
  return { ...state, belt };
}

/** VIP-only convenience after a completed fight. Moves *existing* inventory
 * batches into the selected belt slots; never mints a potion or mixes expiries.
 * The pre-fight template remembers a selection even if its last dose was spent.
 * Non-VIP players always keep their manual belt management.
 */
export function refillVipBeltAfterBattle(
  state: GameState,
  selectedBeforeFight: ReadonlyArray<InventoryItem | null>,
  arenaWins: number,
  vipLevel: number,
): GameState {
  if (!Number.isFinite(vipLevel) || vipLevel < VIP_AUTO_BELT_LEVEL) return state;
  if (!Number.isSafeInteger(arenaWins) || arenaWins < 0) return state;
  const belt = [...state.belt];
  const inventory = state.inventory.map(item => ({ ...item }));
  const ctx = beltContext(state, arenaWins);
  let changed = false;

  for (let slotIndex = 0; slotIndex < belt.length; slotIndex++) {
    if (!isSlotOpen(slotIndex, ctx)) continue;
    const equipped = belt[slotIndex];
    if (equipped && isElixirExpired(equipped)) continue;
    const template = equipped ?? selectedBeforeFight[slotIndex];
    if (!template || !['potion', 'elixir', 'arena'].includes(template.type)) continue;
    if (belt.some((item, index) => index !== slotIndex && item && sameBeltKind(item, template))) continue;
    const currentQty = equipped?.qty ?? 0;
    if (!Number.isSafeInteger(currentQty) || currentQty < 0 || currentQty >= BELT_STACK) continue;

    const candidates = inventory
      .filter(item => Number.isSafeInteger(item.qty) && item.qty > 0
        && canBelt(item) && sameBeltKind(item, template)
        // Keep precisely the same expiry batch when a dose remains in the belt.
        && (!equipped || !isPerishableItem(item) || item.expiresAt === equipped.expiresAt))
      .sort((a, b) => {
        const aExpiry = a.expiresAt ? Date.parse(a.expiresAt) : Number.MAX_SAFE_INTEGER;
        const bExpiry = b.expiresAt ? Date.parse(b.expiresAt) : Number.MAX_SAFE_INTEGER;
        return aExpiry - bExpiry;
      });

    let nextQty = currentQty;
    let nextItem = equipped;
    for (const candidate of candidates) {
      if (nextQty >= BELT_STACK) break;
      if (nextItem && isPerishableItem(candidate) && candidate.expiresAt !== nextItem.expiresAt) continue;
      const moved = Math.min(BELT_STACK - nextQty, candidate.qty);
      if (moved <= 0) continue;
      // Find the exact selected inventory batch; two batches with identical
      // names but different expiration dates remain separate.
      const original = inventory.find(item => item.id === candidate.id);
      if (!original || original.qty < moved) continue;
      original.qty -= moved;
      nextQty += moved;
      if (!nextItem) nextItem = { ...candidate, id: `belt_${slotIndex}`, qty: 0 };
      changed = true;
    }
    if (nextItem && nextQty > currentQty) belt[slotIndex] = { ...nextItem, qty: nextQty };
  }

  if (!changed) return state;
  return { ...state, belt, inventory: inventory.filter(item => item.qty > 0) };
}
