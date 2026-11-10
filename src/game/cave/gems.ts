/**
 * Cave gems — an independent system (NOT the 15 TERRITORY runes, NOT Umbra item
 * instances). Owner rules of 2026-11-10:
 *  - a natural cave drop is exclusively Lv.1, Lv.2 or Lv.3;
 *  - 3 gems of the SAME type and SAME level -> 1 gem of that type, level + 1;
 *  - no random failure, no extra price; the maximum level is not decided, so
 *    no cap is invented here.
 * All functions are pure: they return a new inventory or a typed refusal.
 */
export const GEM_TYPES = [
  { id: 'ruby', ru: 'Рубин ярости', en: 'Ruby of Fury', stat: 'attack', base: 6, color: '#e2475d' },
  { id: 'azure', ru: 'Лазурит стойкости', en: 'Azure of Resolve', stat: 'defense', base: 5, color: '#4b8ef0' },
  { id: 'emerald', ru: 'Изумруд жизни', en: 'Emerald of Life', stat: 'hp', base: 40, color: '#3fc27d' },
  { id: 'storm', ru: 'Грозовой кристалл', en: 'Storm Crystal', stat: 'crit', base: 0.4, color: '#f2c94c' },
  { id: 'amethyst', ru: 'Аметист заслона', en: 'Amethyst of Warding', stat: 'block', base: 0.4, color: '#b46cf2' },
  { id: 'moon', ru: 'Лунный опал', en: 'Moon Opal', stat: 'dodge', base: 0.3, color: '#b9d6f2' },
] as const;
export type GemTypeId = (typeof GEM_TYPES)[number]['id'];
export type GemStat = (typeof GEM_TYPES)[number]['stat'];
export type GemKey = `${GemTypeId}:${number}`;
export type GemInventory = Readonly<Partial<Record<GemKey, number>>>;

export const NATURAL_GEM_LEVELS = [1, 2, 3] as const;
export const SYNTH_INPUT = 3;

const typeIds = new Set<string>(GEM_TYPES.map(g => g.id));
export const isGemType = (value: unknown): value is GemTypeId => typeof value === 'string' && typeIds.has(value);
export const isGemLevel = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;
export const gemKey = (type: GemTypeId, level: number): GemKey => `${type}:${level}`;
export function parseGemKey(key: string): { type: GemTypeId; level: number } | null {
  const [type, raw, extra] = key.split(':');
  const level = Number(raw);
  return extra === undefined && isGemType(type) && isGemLevel(level) && String(level) === raw ? { type, level } : null;
}
export const gemType = (id: GemTypeId) => GEM_TYPES.find(g => g.id === id)!;
export const gemArt = (id: GemTypeId) => `assets/territory/cave/gems/${id}.webp`;
export const gemCount = (inv: GemInventory, type: GemTypeId, level: number) => inv[gemKey(type, level)] ?? 0;

/** Test-sandbox attribute curve; live values need owner approval. */
export function gemValue(type: GemTypeId, level: number): number {
  const raw = gemType(type).base * Math.pow(1.8, level - 1);
  return raw >= 10 ? Math.round(raw) : Math.round(raw * 10) / 10;
}

type Fail<R extends string> = { ok: false; reason: R };
const put = (inv: GemInventory, key: GemKey, delta: number): GemInventory => {
  const next: Partial<Record<GemKey, number>> = { ...inv };
  const amount = (next[key] ?? 0) + delta;
  if (amount > 0) next[key] = amount; else delete next[key];
  return next;
};

/** A cave drop may only create Lv.1–3; anything else is refused, never clamped. */
export function addGemDrop(inv: GemInventory, type: unknown, level: unknown):
  { ok: true; inventory: GemInventory } | Fail<'invalid_type' | 'invalid_drop_level'> {
  if (!isGemType(type)) return { ok: false, reason: 'invalid_type' };
  if (!(NATURAL_GEM_LEVELS as readonly unknown[]).includes(level)) return { ok: false, reason: 'invalid_drop_level' };
  return { ok: true, inventory: put(inv, gemKey(type, level as number), 1) };
}

/** Exactly 3 identical (type, level) -> 1 of (type, level + 1). */
export function synthesizeGem(inv: GemInventory, type: unknown, level: unknown):
  { ok: true; inventory: GemInventory; made: GemKey } | Fail<'invalid_type' | 'invalid_level' | 'not_enough'> {
  if (!isGemType(type)) return { ok: false, reason: 'invalid_type' };
  if (!isGemLevel(level)) return { ok: false, reason: 'invalid_level' };
  if (gemCount(inv, type, level) < SYNTH_INPUT) return { ok: false, reason: 'not_enough' };
  const made = gemKey(type, level + 1);
  return { ok: true, inventory: put(put(inv, gemKey(type, level), -SYNTH_INPUT), made, 1), made };
}

/**
 * Quick synthesis: applies the same 3:1 recipe to every available triple,
 * cascading upwards. Total gem "mass" (3^(level-1) per gem) is conserved.
 */
export function quickSynthesizeGems(inv: GemInventory): { inventory: GemInventory; made: { key: GemKey; count: number }[] } {
  let current = inv;
  const made = new Map<GemKey, number>();
  for (const { id } of GEM_TYPES) {
    for (let level = 1; ; level++) {
      // Each pass shrinks the stack threefold, so the highest level is finite.
      const highest = Math.max(0, ...Object.keys(current).map(parseGemKey).filter(g => g?.type === id).map(g => g!.level));
      if (level > highest) break;
      const triples = Math.floor(gemCount(current, id, level) / SYNTH_INPUT);
      if (!triples) continue;
      const key = gemKey(id, level + 1);
      current = put(put(current, gemKey(id, level), -triples * SYNTH_INPUT), key, triples);
      made.set(key, (made.get(key) ?? 0) + triples);
    }
  }
  return { inventory: current, made: [...made].map(([key, count]) => ({ key, count })) };
}

/** Conserved quantity used by tests: one Lv.N gem equals 3^(N-1) Lv.1 gems. */
export function gemMass(inv: GemInventory): number {
  return Object.entries(inv).reduce((sum, [key, count]) => {
    const gem = parseGemKey(key);
    return gem ? sum + (count ?? 0) * Math.pow(SYNTH_INPUT, gem.level - 1) : sum;
  }, 0);
}

/**
 * Socket frames. The reference shows equipment-category rows with three
 * sockets each. Which TERRITORY items finally own sockets is NOT decided, so
 * frames are stand-alone here and touch neither main gear nor Umbra items.
 */
export const GEM_FRAMES = [
  { id: 'weapon', ru: 'Оружие', en: 'Weapon' },
  { id: 'helmet', ru: 'Шлем', en: 'Helmet' },
  { id: 'chest', ru: 'Нагрудник', en: 'Chest' },
  { id: 'belt', ru: 'Пояс', en: 'Belt' },
  { id: 'greaves', ru: 'Поножи', en: 'Greaves' },
  { id: 'boots', ru: 'Сапоги', en: 'Boots' },
] as const;
export type GemFrameId = (typeof GEM_FRAMES)[number]['id'];
export const SOCKETS_PER_FRAME = 3;
export type GemSockets = Readonly<Record<GemFrameId, readonly (GemKey | null)[]>>;

const frameIds = new Set<string>(GEM_FRAMES.map(f => f.id));
export const emptySockets = (): GemSockets => Object.fromEntries(
  GEM_FRAMES.map(f => [f.id, Array<GemKey | null>(SOCKETS_PER_FRAME).fill(null)])) as unknown as GemSockets;
const validSocket = (frame: unknown, index: unknown): frame is GemFrameId =>
  typeof frame === 'string' && frameIds.has(frame) && Number.isInteger(index) && (index as number) >= 0 && (index as number) < SOCKETS_PER_FRAME;

/** Moves one owned gem into a socket; a replaced gem returns to the inventory. */
export function insertGem(inv: GemInventory, sockets: GemSockets, frame: unknown, index: number, key: string):
  { ok: true; inventory: GemInventory; sockets: GemSockets } | Fail<'invalid_socket' | 'invalid_gem' | 'not_owned'> {
  if (!validSocket(frame, index)) return { ok: false, reason: 'invalid_socket' };
  const gem = parseGemKey(key);
  if (!gem) return { ok: false, reason: 'invalid_gem' };
  const owned = gemKey(gem.type, gem.level);
  if ((inv[owned] ?? 0) < 1) return { ok: false, reason: 'not_owned' };
  const previous = sockets[frame][index];
  let inventory = put(inv, owned, -1);
  if (previous) inventory = put(inventory, previous, 1);
  return { ok: true, inventory, sockets: { ...sockets, [frame]: sockets[frame].map((g, i) => i === index ? owned : g) } };
}

export function removeGem(inv: GemInventory, sockets: GemSockets, frame: unknown, index: number):
  { ok: true; inventory: GemInventory; sockets: GemSockets } | Fail<'invalid_socket' | 'empty_socket'> {
  if (!validSocket(frame, index)) return { ok: false, reason: 'invalid_socket' };
  const previous = sockets[frame][index];
  if (!previous) return { ok: false, reason: 'empty_socket' };
  return { ok: true, inventory: put(inv, previous, 1), sockets: { ...sockets, [frame]: sockets[frame].map((g, i) => i === index ? null : g) } };
}

/** "Total gem attributes": sum over every socketed gem. */
export function gemTotals(sockets: GemSockets): Partial<Record<GemStat, number>> {
  const totals: Partial<Record<GemStat, number>> = {};
  for (const frame of GEM_FRAMES) for (const key of sockets[frame.id]) {
    const gem = key && parseGemKey(key);
    if (!gem) continue;
    const stat = gemType(gem.type).stat;
    totals[stat] = Math.round(((totals[stat] ?? 0) + gemValue(gem.type, gem.level)) * 10) / 10;
  }
  return totals;
}
