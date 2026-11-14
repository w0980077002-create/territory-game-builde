import type { IdleCombatEvent, IdleCombatState } from '../idleEngine/types.ts';

export type CaveBeltItem = {
  id: string; type: 'potion' | 'elixir'; name: string; rarity: string; qty: number;
  effect: { stat: 'hp' | 'attack' | 'defense' | 'critChance'; value: number };
  arenaEffect?: unknown;
};
export type CaveBeltCharge = { item: CaveBeltItem; sourceReference: string; used: number };

/** Only an independently attested server projection may enter this function.
 * Never call it on the player's writable game_state.belt. */
export function pinCaveBelt(charges: (CaveBeltCharge | null)[]): (CaveBeltCharge | null)[] {
  const kinds = new Set<string>();
  return Array.from({ length: 7 }, (_, slot) => {
    const charge = charges[slot], item = charge?.item;
    if (!charge || !item || !['potion', 'elixir'].includes(item.type) || item.arenaEffect
      || typeof charge.sourceReference !== 'string' || !charge.sourceReference
      || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.rarity !== 'string'
      || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 5
      || !item.effect || !['hp', 'attack', 'defense', 'critChance'].includes(item.effect.stat)
      || !Number.isFinite(item.effect.value) || item.effect.value <= 0 || item.effect.value > 1_000_000) return null;
    const kind = JSON.stringify([item.type, item.name, item.rarity, item.effect.stat, item.effect.value]);
    if (kinds.has(kind)) return null;
    kinds.add(kind);
    return { item: structuredClone(item), sourceReference: charge.sourceReference, used: 0 };
  });
}

/** Applies the same flat HP/attack/defense and percentage-point crit effect as
 * classic PvE. The SQL commit must independently authorize and debit the dose. */
export function applyCaveCharge(original: IdleCombatState, slot: number) {
  const charge = original.caveRuntime?.belt?.[slot];
  if (!charge || charge.used >= charge.item.qty || charge.used >= 5) throw new Error('combat_belt_unavailable');
  const state = structuredClone(original), hero = state.actors.hero;
  const effect = charge.item.effect;
  if (effect.stat === 'hp' && hero.stats.hp >= hero.stats.maxHp) throw new Error('combat_belt_no_effect');
  if (effect.stat === 'critChance' && hero.stats.critChance >= 1) throw new Error('combat_belt_no_effect');
  if ((effect.stat === 'attack' || effect.stat === 'defense') && hero.stats[effect.stat] >= 1_000_000_000)
    throw new Error('combat_belt_no_effect');
  const before = effect.stat === 'hp' ? hero.stats.hp : hero.stats[effect.stat];
  if (effect.stat === 'hp') hero.stats.hp = Math.min(hero.stats.maxHp, hero.stats.hp + effect.value);
  else if (effect.stat === 'critChance') hero.stats.critChance = Math.min(1, hero.stats.critChance + effect.value / 100);
  else hero.stats[effect.stat] = Math.min(1_000_000_000, hero.stats[effect.stat] + effect.value);
  state.caveRuntime!.belt![slot]!.used++;
  const event: IdleCombatEvent = {
    id: `cave_belt_${state.nextEventId++}`, atMs: state.atMs, actor: 'hero', target: 'hero',
    type: effect.stat === 'hp' ? 'heal' : 'status_apply',
    value: (effect.stat === 'hp' ? hero.stats.hp : hero.stats[effect.stat]) - before,
    effectId: `belt_${slot}:${effect.stat}`, vfxKey: 'cave_belt',
  };
  return { state, events: [event], beltDebit: { slot, sourceReference: charge.sourceReference,
    snapshot: charge.item, usedBefore: charge.used } };
}
