/**
 * Dark Energy (Cave) Blessing — three slots for special SHOP elixirs.
 *
 * This is NOT the city blessing: nothing here may read or call
 * `GameState.blessing` / `claimBlessing` or its +50% gold for three fights.
 *
 * Owner-confirmed: each elixir type raises the drop chance of a different
 * Dark Energy loot category. NOT confirmed: prices, percentages, stacking and
 * the moment of consumption — therefore no percentage and no price exists in
 * this file. The sandbox only marks the boosted category.
 */
import type { CaveLootCategory } from './floors';

export const CAVE_BLESSING_SLOTS = 3;
export const CAVE_ELIXIRS = [
  { id: 'cave_bless_gear', category: 'gear', ru: 'Эликсир теневого кузнеца', en: "Shadowsmith's Elixir",
    boostRu: 'Тёмные вещи', boostEn: 'Dark gear', art: 'assets/territory/cave/elixirs/elixir-gear.webp' },
  { id: 'cave_bless_gems', category: 'gems', ru: 'Эликсир гранильщика', en: "Gemcutter's Elixir",
    boostRu: 'Самоцветы', boostEn: 'Gems', art: 'assets/territory/cave/elixirs/elixir-gems.webp' },
  { id: 'cave_bless_essence', category: 'essence', ru: 'Эликсир сборщика эссенции', en: "Essence Gatherer's Elixir",
    boostRu: 'Тёмная эссенция', boostEn: 'Dark essence', art: 'assets/territory/cave/elixirs/elixir-essence.webp' },
  { id: 'cave_bless_sets', category: 'sets', ru: 'Эликсир властителя', en: "Sovereign's Elixir",
    boostRu: 'Комплектные вещи', boostEn: 'Set pieces', art: 'assets/territory/cave/elixirs/elixir-sets.webp' },
] as const satisfies readonly { id: string; category: CaveLootCategory; ru: string; en: string; boostRu: string; boostEn: string; art: string }[];
export type CaveElixirId = (typeof CAVE_ELIXIRS)[number]['id'];
export type CaveElixirStock = Readonly<Partial<Record<CaveElixirId, number>>>;
export type CaveBlessingSlots = readonly (CaveElixirId | null)[];

const ids = new Set<string>(CAVE_ELIXIRS.map(e => e.id));
export const isCaveElixir = (value: unknown): value is CaveElixirId => typeof value === 'string' && ids.has(value);
export const caveElixir = (id: CaveElixirId) => CAVE_ELIXIRS.find(e => e.id === id)!;
export const emptyBlessing = (): CaveBlessingSlots => Array<CaveElixirId | null>(CAVE_BLESSING_SLOTS).fill(null);

type Fail = { ok: false; reason: 'invalid_slot' | 'invalid_elixir' | 'not_owned' | 'empty_slot' };
type Done = { ok: true; stock: CaveElixirStock; slots: CaveBlessingSlots };
const validSlot = (slot: unknown): slot is number => Number.isInteger(slot) && (slot as number) >= 0 && (slot as number) < CAVE_BLESSING_SLOTS;
const move = (stock: CaveElixirStock, id: CaveElixirId, delta: number): CaveElixirStock => {
  const next: Partial<Record<CaveElixirId, number>> = { ...stock };
  const amount = (next[id] ?? 0) + delta;
  if (amount > 0) next[id] = amount; else delete next[id];
  return next;
};

/** Three slots never mean three free bonuses: only an OWNED elixir can be placed. */
export function placeElixir(stock: CaveElixirStock, slots: CaveBlessingSlots, slot: unknown, id: unknown): Done | Fail {
  if (!validSlot(slot)) return { ok: false, reason: 'invalid_slot' };
  if (!isCaveElixir(id)) return { ok: false, reason: 'invalid_elixir' };
  if ((stock[id] ?? 0) < 1) return { ok: false, reason: 'not_owned' };
  const previous = slots[slot];
  let next = move(stock, id, -1);
  if (previous) next = move(next, previous, 1);
  return { ok: true, stock: next, slots: slots.map((e, i) => i === slot ? id : e) };
}

export function takeElixirBack(stock: CaveElixirStock, slots: CaveBlessingSlots, slot: unknown): Done | Fail {
  if (!validSlot(slot)) return { ok: false, reason: 'invalid_slot' };
  const previous = slots[slot];
  if (!previous) return { ok: false, reason: 'empty_slot' };
  return { ok: true, stock: move(stock, previous, 1), slots: slots.map((e, i) => i === slot ? null : e) };
}

export const boostedCategories = (slots: CaveBlessingSlots): CaveLootCategory[] =>
  [...new Set(slots.filter((e): e is CaveElixirId => !!e).map(e => caveElixir(e).category))];
