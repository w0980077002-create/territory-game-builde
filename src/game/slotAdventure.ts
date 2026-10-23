import { fairDemoInt } from './vikingSlots';

/**
 * Pure preview game rules. The sealed arrangements are prepared once when a
 * round begins. Picking a different tile can therefore produce a different
 * reward, unlike the old random-roll-on-click implementation.
 *
 * NEVER use these client-produced results for actual TERRITORY currency.
 */
export type BonusTile =
  | { id: number; kind: 'treasure'; payout: number }
  | { id: number; kind: 'shield'; payout: 0 }
  | { id: number; kind: 'trap'; payout: 0 };
export type RiskCard = { id: number; wins: boolean };
export type SuperChest = { id: number; payout: number };

type Random = (maxExclusive: number) => number;

function shuffle<T>(items: T[], random: Random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('slot_invalid_random');
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function validStake(stake: number): void {
  if (!Number.isSafeInteger(stake) || stake < 1 || stake > 100) throw new Error('slot_invalid_stake');
}
export function prepareBonusTiles(stake: number, random: Random = fairDemoInt): BonusTile[] {
  validStake(stake);
  return shuffle([
    { id: 0, kind: 'treasure' as const, payout: stake },
    { id: 1, kind: 'treasure' as const, payout: 2 * stake },
    { id: 2, kind: 'treasure' as const, payout: 3 * stake },
    { id: 3, kind: 'shield' as const, payout: 0 as const },
    { id: 4, kind: 'trap' as const, payout: 0 as const },
  ], random);
}
export function prepareSuperChests(stake: number, random: Random = fairDemoInt): SuperChest[] {
  validStake(stake);
  return shuffle([3, 5, 9].map((multiple,id) => ({id,payout:multiple * stake})), random);
}
export function prepareRiskCards(random: Random = fairDemoInt): RiskCard[] {
  return shuffle([true,false,true,false].map((wins,id) => ({id,wins})), random);
}
export type BonusProgress = { picksLeft: number; shields: number; total: number };
export type BonusPick = {
  next: BonusProgress;
  endedByTrap: boolean;
  superReady: boolean;
  blockedTrap: boolean;
  credited: number;
};
export function resolveBonusTile(previous: BonusProgress, tile: BonusTile): BonusPick {
  if (!Number.isSafeInteger(previous.picksLeft) || previous.picksLeft < 1 || previous.picksLeft > 5 ||
    !Number.isSafeInteger(previous.shields) || previous.shields < 0 || previous.shields > 5 ||
    !Number.isSafeInteger(previous.total) || previous.total < 0 ||
    !['treasure','shield','trap'].includes(tile.kind) ||
    !Number.isSafeInteger(tile.payout) || tile.payout < 0) throw new Error('slot_invalid_bonus_state');
  const blockedTrap = tile.kind === 'trap' && previous.shields > 0;
  const endedByTrap = tile.kind === 'trap' && !blockedTrap;
  const credited = tile.kind === 'treasure' ? tile.payout : 0;
  const next = {
    picksLeft: previous.picksLeft - 1,
    shields: previous.shields + (tile.kind === 'shield' ? 1 : blockedTrap ? -1 : 0),
    total: previous.total + credited,
  };
  return {next,endedByTrap,blockedTrap,credited,superReady:next.picksLeft===0 && !endedByTrap};
}
