import type { GameState, InventoryItem } from './types';

export const BELT_STACK = 5;

export interface BeltContext {
  level: number;
  activeDays: number;
  arenaWins: number;
}

interface SlotRule {
  title: string;
  check: (c: BeltContext) => { open: boolean; progress: string };
}

const need = (have: number, goal: number) => `${Math.min(have, goal)}/${goal}`;

export const BELT_RULES: SlotRule[] = [
  { title: 'Открыт сразу', check: () => ({ open: true, progress: '' }) },
  {
    title: 'Уровень 5',
    check: (c) => ({ open: c.level >= 5, progress: `уровень ${need(c.level, 5)}` }),
  },
  {
    title: 'Уровень 12 и 5 дней в игре',
    check: (c) => ({
      open: c.level >= 12 && c.activeDays >= 5,
      progress: `уровень ${need(c.level, 12)} · дни ${need(c.activeDays, 5)}`,
    }),
  },
  {
    title: 'Уровень 20 и 14 дней в игре',
    check: (c) => ({
      open: c.level >= 20 && c.activeDays >= 14,
      progress: `уровень ${need(c.level, 20)} · дни ${need(c.activeDays, 14)}`,
    }),
  },
  {
    title: '150 побед на арене',
    check: (c) => ({ open: c.arenaWins >= 150, progress: `победы ${need(c.arenaWins, 150)}` }),
  },
  {
    title: 'Клановый квест «Сага рода»',
    check: () => ({ open: false, progress: 'откроется вместе с кланами' }),
  },
  {
    title: 'Легенда Вальхаллы: уровень 40 и 500 побед на арене',
    check: (c) => ({
      open: c.level >= 40 && c.arenaWins >= 500,
      progress: `уровень ${need(c.level, 40)} · победы ${need(c.arenaWins, 500)}`,
    }),
  },
];

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
  const existing = state.inventory.find((i) => i.name === slot.name && i.type !== 'equipment');
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
