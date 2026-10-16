import type { GameState, InventoryItem } from './types';

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

/** Returning items in newly locked slots happens exactly once at save loading.
 * Copies of the same consumable are stacked if possible; nothing is destroyed.
 * The validated arena win count comes from players.arena_wins, not game_state.
 */
export function reconcileLockedBelt(state: GameState, arenaWins: number): GameState {
  const c = beltContext(state, arenaWins);
  let next = state;
  for (let i = 0; i < BELT_WIN_GOALS.length; i++) {
    if (next.belt[i] && !isSlotOpen(i, c)) {
      next = takeFromBelt(next, i);
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
  item.type === 'potion' || item.type === 'elixir' || item.type === 'arena';

export type ArenaItemCode = 'heal_small' | 'heal_large' | 'attack' | 'defense' | 'crit';

export type BeltAction =
  | { kind: 'time' }
  | { kind: 'revive' }
  | { kind: 'item'; code: ArenaItemCode };

export function beltAction(item: InventoryItem): BeltAction | null {
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

export function putInBelt(state: GameState, itemId: string, c: BeltContext): GameState | null {
  const item = state.inventory.find((i) => i.id === itemId);
  if (!item || !canBelt(item)) return null;
  const belt = [...state.belt];
  let index = belt.findIndex((s, i) => s?.name === item.name && s.qty < BELT_STACK && isSlotOpen(i, c));
  if (index < 0) index = belt.findIndex((s, i) => !s && isSlotOpen(i, c));
  if (index < 0) return null;

  const current = belt[index]?.qty ?? 0;
  const moved = Math.min(BELT_STACK - current, item.qty);
  belt[index] = { ...item, id: `belt_${index}`, qty: current + moved };
  const inventory = state.inventory
    .map((i) => (i.id === itemId ? { ...i, qty: i.qty - moved } : i))
    .filter((i) => i.qty > 0);
  return { ...state, belt, inventory };
}

export function takeFromBelt(state: GameState, index: number): GameState {
  const slot = state.belt[index];
  if (!slot) return state;
  const belt = state.belt.map((s, i) => (i === index ? null : s));
  const existing = state.inventory.find((i) =>
    i.type === slot.type && i.name === slot.name && i.rarity === slot.rarity
    && i.arenaEffect === slot.arenaEffect && JSON.stringify(i.effect ?? null) === JSON.stringify(slot.effect ?? null)
  );
  const inventory = existing
    ? state.inventory.map((i) => (i.id === existing.id ? { ...i, qty: i.qty + slot.qty } : i))
    : [...state.inventory, { ...slot, id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}` }];
  return { ...state, belt, inventory };
}

export function consumeBelt(state: GameState, index: number): GameState {
  const slot = state.belt[index];
  if (!slot) return state;
  const belt = state.belt.map((s, i) => (i !== index || !s ? s : s.qty > 1 ? { ...s, qty: s.qty - 1 } : null));
  return { ...state, belt };
}
