/**
 * Dark Cave TEST SANDBOX — one pure reducer for the owner-playable preview.
 *
 * It holds a device-local demo warehouse: Umbra items, essence, gems, cave
 * blessing elixirs and fund claims. It is intentionally isolated:
 *  - it never touches GameState, the cloud save, wallets, ordinary equipment,
 *    runes or the city blessing;
 *  - nothing in it is a server grant, so nothing here is a real reward;
 *  - every action carries an operation id and a repeated id is a no-op, the
 *    same idempotency rule the future server contract must satisfy.
 */
import { boostedCategories, emptyBlessing, isCaveElixir, placeElixir, takeElixirBack, CAVE_BLESSING_SLOTS,
  type CaveBlessingSlots, type CaveElixirId, type CaveElixirStock } from './blessing';
import { type CaveLootCategory } from './floors';
import { fundReward, planFundClaim } from './fund';
import { addGemDrop, emptySockets, insertGem, quickSynthesizeGems, removeGem, synthesizeGem, GEM_FRAMES, GEM_TYPES,
  SOCKETS_PER_FRAME, parseGemKey, type GemInventory, type GemKey, type GemSockets, type GemTypeId } from './gems';
import { pick, seededRng, type Rng } from './rng';
import { dismantleYield, enhanceCost, equippedItems, reforgeCost, rerollAffixes, rollUmbraItem, umbraTemplate, UMBRA_MAX_ENHANCE,
  UMBRA_SLOTS, UMBRA_STORAGE_CAP, type UmbraItem, type UmbraLoadout, type UmbraSlotId } from './umbra';

export type CaveLoot = Readonly<{
  opId: string;
  floor: number;
  items: readonly UmbraItem[];
  /** Items that did not fit into the warehouse and were NOT received. */
  overflow: number;
  essence: number;
  gems: readonly { type: GemTypeId; level: number }[];
  boosted: readonly CaveLootCategory[];
}>;

export type CaveSandbox = Readonly<{
  v: 1;
  seq: number;
  items: readonly UmbraItem[];
  loadout: UmbraLoadout;
  essence: number;
  gems: GemInventory;
  sockets: GemSockets;
  elixirs: CaveElixirStock;
  blessSlots: CaveBlessingSlots;
  fundClaimed: readonly number[];
  lastLoot: CaveLoot | null;
  ops: readonly string[];
}>;

export const emptySandbox = (): CaveSandbox => ({
  v: 1, seq: 0, items: [], loadout: {}, essence: 0, gems: {}, sockets: emptySockets(), elixirs: {},
  blessSlots: emptyBlessing(), fundClaimed: [], lastLoot: null, ops: [],
});

export type CaveAction =
  | { type: 'loot'; floor: number; boss: boolean }
  | { type: 'equip'; itemId: string }
  | { type: 'unequip'; slot: UmbraSlotId }
  | { type: 'lock'; itemId: string; locked: boolean }
  | { type: 'enhance'; itemId: string }
  | { type: 'enhanceAll' }
  | { type: 'dismantle'; itemIds: readonly string[] }
  | { type: 'reforge'; itemId: string }
  | { type: 'synth'; gem: string; level: number }
  | { type: 'quickSynth' }
  | { type: 'socket'; frame: string; index: number; key: string }
  | { type: 'unsocket'; frame: string; index: number }
  | { type: 'takeElixir'; elixir: string }
  | { type: 'bless'; slot: number; elixir: string | null }
  | { type: 'fundClaim'; threshold: number; maxFloor: number }
  | { type: 'reset' };

export type CaveResult = { state: CaveSandbox; ok: boolean; reason?: string; replay?: boolean; gained?: number; count?: number };

const OPS_KEPT = 300;
const fail = (state: CaveSandbox, reason: string): CaveResult => ({ state, ok: false, reason });
const isWorn = (state: CaveSandbox, id: string) => Object.values(state.loadout).includes(id);
const patchItem = (state: CaveSandbox, item: UmbraItem): CaveSandbox =>
  ({ ...state, items: state.items.map(i => i.id === item.id ? item : i) });

/** Sandbox loot roll. Illustrative only — NOT a live drop table or rate. */
function rollLoot(state: CaveSandbox, opId: string, floor: number, boss: boolean): { state: CaveSandbox; loot: CaveLoot } {
  const rng: Rng = seededRng('cave-loot:' + opId);
  const boosted = boostedCategories(state.blessSlots);
  const has = (c: CaveLootCategory) => boosted.includes(c);
  let seq = state.seq;
  const items: UmbraItem[] = [];
  let overflow = 0;
  const wanted = (boss ? 2 : 1) + (has('gear') ? 1 : 0);
  for (let i = 0; i < wanted; i++) {
    const item = rollUmbraItem(rng, { id: `umbra-${++seq}`, floor, boss, forceSet: has('sets'), source: opId });
    if (state.items.length + items.length >= UMBRA_STORAGE_CAP) overflow++; else items.push(item);
  }
  const essence = Math.round((5 + Math.floor(floor / 5)) * (boss ? 2 : 1) * (has('essence') ? 1.5 : 1));
  let gems = state.gems;
  const dropped: { type: GemTypeId; level: number }[] = [];
  if (floor >= 6) {
    for (let i = 0; i < (boss ? 2 : 1) + (has('gems') ? 1 : 0); i++) {
      const roll = rng();
      const level = roll < 0.7 ? 1 : roll < 0.93 ? 2 : 3;
      const type = pick(rng, GEM_TYPES).id;
      // addGemDrop refuses anything outside Lv.1–3, so a higher gem can never drop.
      const added = addGemDrop(gems, type, level);
      if (added.ok) { gems = added.inventory; dropped.push({ type, level }); }
    }
  }
  const loot: CaveLoot = { opId, floor, items, overflow, essence, gems: dropped, boosted };
  // Sandbox proposal: installed elixirs are spent by one looted victory.
  return { state: { ...state, seq, items: [...state.items, ...items], essence: state.essence + essence, gems, blessSlots: emptyBlessing(), lastLoot: loot }, loot };
}

function reduce(state: CaveSandbox, action: CaveAction, opId: string): CaveResult {
  switch (action.type) {
    case 'loot': {
      if (!Number.isInteger(action.floor) || action.floor < 1 || action.floor > 100) return fail(state, 'invalid_floor');
      return { state: rollLoot(state, opId, action.floor, action.boss).state, ok: true };
    }
    case 'equip': {
      const item = state.items.find(i => i.id === action.itemId);
      if (!item) return fail(state, 'not_owned');
      return { state: { ...state, loadout: { ...state.loadout, [item.slot]: item.id } }, ok: true };
    }
    case 'unequip': {
      if (!state.loadout[action.slot]) return fail(state, 'empty_slot');
      const loadout = { ...state.loadout };
      delete loadout[action.slot];
      return { state: { ...state, loadout }, ok: true };
    }
    case 'lock': {
      const item = state.items.find(i => i.id === action.itemId);
      if (!item) return fail(state, 'not_owned');
      return { state: patchItem(state, { ...item, locked: action.locked }), ok: true };
    }
    case 'enhance': {
      const item = state.items.find(i => i.id === action.itemId);
      if (!item) return fail(state, 'not_owned');
      if (item.enhance >= UMBRA_MAX_ENHANCE) return fail(state, 'max_enhance');
      const cost = enhanceCost(item);
      if (state.essence < cost) return fail(state, 'not_enough_essence');
      return { state: { ...patchItem(state, { ...item, enhance: item.enhance + 1, spent: item.spent + cost }), essence: state.essence - cost }, ok: true, gained: -cost };
    }
    case 'enhanceAll': {
      // One-click: repeatedly raise the least enhanced WORN item while essence lasts.
      let next = state;
      let count = 0;
      for (;;) {
        const worn = equippedItems(next.items, next.loadout).filter(i => i.enhance < UMBRA_MAX_ENHANCE)
          .sort((a, b) => a.enhance - b.enhance || enhanceCost(a) - enhanceCost(b));
        const target = worn.find(i => enhanceCost(i) <= next.essence);
        if (!target) break;
        const cost = enhanceCost(target);
        next = { ...patchItem(next, { ...target, enhance: target.enhance + 1, spent: target.spent + cost }), essence: next.essence - cost };
        count++;
      }
      if (!count) return fail(state, equippedItems(state.items, state.loadout).length ? 'not_enough_essence' : 'nothing_equipped');
      return { state: next, ok: true, count, gained: next.essence - state.essence };
    }
    case 'dismantle': {
      const ids = [...new Set(action.itemIds)];
      if (!ids.length) return fail(state, 'nothing_selected');
      const targets = ids.map(id => state.items.find(i => i.id === id));
      if (targets.some(i => !i)) return fail(state, 'not_owned');
      // All-or-nothing: a protected item in the batch refuses the whole batch.
      if (targets.some(i => isWorn(state, i!.id))) return fail(state, 'item_equipped');
      if (targets.some(i => i!.locked)) return fail(state, 'item_locked');
      const gained = targets.reduce((sum, i) => sum + dismantleYield(i!), 0);
      return { state: { ...state, items: state.items.filter(i => !ids.includes(i.id)), essence: state.essence + gained }, ok: true, gained, count: ids.length };
    }
    case 'reforge': {
      const item = state.items.find(i => i.id === action.itemId);
      if (!item) return fail(state, 'not_owned');
      if (item.locked) return fail(state, 'item_locked');
      const cost = reforgeCost(item);
      if (state.essence < cost) return fail(state, 'not_enough_essence');
      return { state: { ...patchItem(state, { ...rerollAffixes(seededRng('cave-reforge:' + opId), item), spent: item.spent + cost }), essence: state.essence - cost }, ok: true, gained: -cost };
    }
    case 'synth': {
      const made = synthesizeGem(state.gems, action.gem, action.level);
      return made.ok ? { state: { ...state, gems: made.inventory }, ok: true } : fail(state, made.reason);
    }
    case 'quickSynth': {
      const made = quickSynthesizeGems(state.gems);
      const count = made.made.reduce((sum, m) => sum + m.count, 0);
      return count ? { state: { ...state, gems: made.inventory }, ok: true, count } : fail(state, 'not_enough');
    }
    case 'socket': {
      const done = insertGem(state.gems, state.sockets, action.frame, action.index, action.key);
      return done.ok ? { state: { ...state, gems: done.inventory, sockets: done.sockets }, ok: true } : fail(state, done.reason);
    }
    case 'unsocket': {
      const done = removeGem(state.gems, state.sockets, action.frame, action.index);
      return done.ok ? { state: { ...state, gems: done.inventory, sockets: done.sockets }, ok: true } : fail(state, done.reason);
    }
    case 'takeElixir': {
      if (!isCaveElixir(action.elixir)) return fail(state, 'invalid_elixir');
      const id: CaveElixirId = action.elixir;
      return { state: { ...state, elixirs: { ...state.elixirs, [id]: (state.elixirs[id] ?? 0) + 1 } }, ok: true };
    }
    case 'bless': {
      const done = action.elixir === null
        ? takeElixirBack(state.elixirs, state.blessSlots, action.slot)
        : placeElixir(state.elixirs, state.blessSlots, action.slot, action.elixir);
      return done.ok ? { state: { ...state, elixirs: done.stock, blessSlots: done.slots }, ok: true } : fail(state, done.reason);
    }
    case 'fundClaim': {
      const plan = planFundClaim(state.fundClaimed, action.threshold, action.maxFloor);
      if (!plan.ok) return fail(state, plan.reason);
      const reward = fundReward(action.threshold);
      let next: CaveSandbox = { ...state, essence: state.essence + reward.essence, fundClaimed: [...state.fundClaimed, action.threshold] };
      if (reward.gem) {
        const added = addGemDrop(next.gems, reward.gem.type, reward.gem.level);
        if (added.ok) next = { ...next, gems: added.inventory };
      }
      if (reward.item && next.items.length < UMBRA_STORAGE_CAP) {
        const item = rollUmbraItem(seededRng('cave-fund:' + action.threshold), { id: `umbra-${next.seq + 1}`, floor: action.threshold, boss: true, source: 'fund:' + action.threshold });
        next = { ...next, seq: next.seq + 1, items: [...next.items, item] };
      }
      return { state: next, ok: true, gained: reward.essence };
    }
    case 'reset':
      return { state: emptySandbox(), ok: true };
  }
}

/** Idempotent entry point: the same opId can never apply twice. */
export function applyCaveAction(state: CaveSandbox, action: CaveAction, opId: string): CaveResult {
  if (typeof opId !== 'string' || opId.length < 8) return fail(state, 'invalid_operation');
  if (state.ops.includes(opId)) return { state, ok: true, replay: true };
  const result = reduce(state, action, opId);
  if (!result.ok) return result;
  return { ...result, state: { ...result.state, ops: action.type === 'reset' ? [] : [...result.state.ops, opId].slice(-OPS_KEPT) } };
}

/** Defensive decode of a stored sandbox; anything malformed starts clean. */
export function decodeSandbox(raw: unknown): CaveSandbox {
  const base = emptySandbox();
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return base;
  const data = raw as Record<string, unknown>;
  const num = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
  const slotIds = new Set<string>(UMBRA_SLOTS.map(s => s.id));
  const items = (Array.isArray(data.items) ? data.items : []).filter((item): item is UmbraItem =>
    !!item && typeof item === 'object' && typeof item.id === 'string' && !!umbraTemplate(item.templateId)
    && slotIds.has(item.slot) && umbraTemplate(item.templateId)!.slot === item.slot
    && Number.isInteger(item.rank) && item.rank >= 1 && item.rank <= 5 && Number.isInteger(item.level)
    && !!item.main && typeof item.main.value === 'number' && Array.isArray(item.affixes)
    && Number.isInteger(item.enhance) && item.enhance >= 0 && item.enhance <= UMBRA_MAX_ENHANCE).slice(0, UMBRA_STORAGE_CAP);
  const owned = new Map(items.map(i => [i.id, i]));
  const loadout: Partial<Record<UmbraSlotId, string>> = {};
  if (data.loadout && typeof data.loadout === 'object') for (const [slot, id] of Object.entries(data.loadout)) {
    if (typeof id === 'string' && owned.get(id)?.slot === slot) loadout[slot as UmbraSlotId] = id;
  }
  const gems: Partial<Record<GemKey, number>> = {};
  if (data.gems && typeof data.gems === 'object') for (const [key, count] of Object.entries(data.gems)) {
    if (parseGemKey(key) && num(count) > 0) gems[key as GemKey] = num(count);
  }
  const sockets: Record<string, readonly (GemKey | null)[]> = { ...emptySockets() };
  if (data.sockets && typeof data.sockets === 'object') for (const frame of GEM_FRAMES) {
    const row = (data.sockets as Record<string, unknown>)[frame.id];
    if (Array.isArray(row)) sockets[frame.id] = Array.from({ length: SOCKETS_PER_FRAME }, (_, i) =>
      typeof row[i] === 'string' && parseGemKey(row[i]) ? row[i] as GemKey : null);
  }
  const elixirs: Partial<Record<CaveElixirId, number>> = {};
  if (data.elixirs && typeof data.elixirs === 'object') for (const [id, count] of Object.entries(data.elixirs)) {
    if (isCaveElixir(id) && num(count) > 0) elixirs[id] = num(count);
  }
  const blessSlots = Array.from({ length: CAVE_BLESSING_SLOTS }, (_, i) => {
    const id = Array.isArray(data.blessSlots) ? data.blessSlots[i] : null;
    return isCaveElixir(id) ? id : null;
  });
  return {
    ...base, seq: Math.max(num(data.seq), items.length), items, loadout, essence: num(data.essence), gems,
    sockets: sockets as unknown as GemSockets, elixirs, blessSlots,
    fundClaimed: (Array.isArray(data.fundClaimed) ? data.fundClaimed : []).filter((n): n is number => Number.isInteger(n)),
    lastLoot: data.lastLoot && typeof data.lastLoot === 'object' && typeof (data.lastLoot as CaveLoot).opId === 'string'
      && Array.isArray((data.lastLoot as CaveLoot).items) ? data.lastLoot as CaveLoot : null,
    ops: (Array.isArray(data.ops) ? data.ops : []).filter((o): o is string => typeof o === 'string').slice(-OPS_KEPT),
  };
}
