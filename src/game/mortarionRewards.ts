import { supabase } from './supabase';
import { ensurePlayerSession } from './auth';
import { useGame } from './actions';
import { acceptMonopolyClaimReceipt, protectFortuneSave, releaseArenaRejectedAction, saveCloudSave, saveTokens } from './cloud';

export type MortarionRewardTier = 'participant' | 'hunter' | 'legendary';

export interface MortarionRewardReceipt {
  eventId: string;
  tier: MortarionRewardTier;
  place: number | null;
  totalHits: number;
  activeDays: number;
  hitDays: number[];
  gold: number;
  gems: number;
  materials: number;
  elixirs: number;
  fragment: boolean;
  ingredient: boolean;
  heart: boolean;
  awakeningStone: boolean;
  items: { id: string; name: string; qty: number }[];
  collectiveVictory: boolean;
  title: string | null;
  frame: string | null;
  medal: string | null;
}

export interface MortarionRewardStatus {
  active: boolean;
  closed: boolean;
  totalHits: number;
  activeDays: number;
  hitDays: number[];
  currentDay: number;
  requiredDays: number;
  tier: MortarionRewardTier;
  collectiveVictory: boolean;
  canClaim: boolean;
  claimed: boolean;
  receipt: MortarionRewardReceipt | null;
}

const nat = (value: unknown, upper = 2147483647): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= upper;

function parseReceipt(value: unknown): MortarionRewardReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('mortarion_invalid_reward');
  const o = value as Record<string, unknown>;
  if (o.eventId !== 'mortarion_2026' || !['participant','hunter','legendary'].includes(String(o.tier))
    || !nat(o.totalHits) || !nat(o.activeDays, 5)
    || !nat(o.gold) || !nat(o.gems) || !nat(o.materials) || !nat(o.elixirs)
    || !Array.isArray(o.hitDays) || !o.hitDays.every(d => nat(d,5) && d>0)
    || !Array.isArray(o.items) || o.items.some(item => !item || typeof item !== 'object')
    || (o.place !== null && (!nat(o.place,10) || o.place<1))
    || typeof o.heart !== 'boolean' || typeof o.awakeningStone !== 'boolean'
    || typeof o.fragment !== 'boolean' || typeof o.ingredient !== 'boolean'
    || typeof o.collectiveVictory !== 'boolean'
    || (o.title !== null && typeof o.title !== 'string')
    || (o.frame !== null && typeof o.frame !== 'string')
    || (o.medal !== null && typeof o.medal !== 'string')) throw new Error('mortarion_invalid_reward');
  return o as unknown as MortarionRewardReceipt;
}

export function parseMortarionRewardStatus(value: unknown): MortarionRewardStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('mortarion_invalid_reward_state');
  const o = value as Record<string, unknown>;
  if (!nat(o.totalHits) || !nat(o.activeDays,5) || !nat(o.currentDay,5)
    || !nat(o.requiredDays,5) || !['participant','hunter','legendary'].includes(String(o.tier))
    || typeof o.claimed !== 'boolean' || typeof o.canClaim !== 'boolean'
    || typeof o.closed !== 'boolean' || typeof o.active !== 'boolean'
    || typeof o.collectiveVictory !== 'boolean'
    || !Array.isArray(o.hitDays) || !o.hitDays.every(d=>nat(d,5) && d>0))
      throw new Error('mortarion_invalid_reward_state');
  return {
    active: o.active, closed: o.closed,
    totalHits: o.totalHits, activeDays: o.activeDays, hitDays: o.hitDays,
    currentDay: o.currentDay, requiredDays: o.requiredDays, tier: o.tier,
    collectiveVictory: o.collectiveVictory, canClaim: o.canClaim,
    claimed: o.claimed,
    receipt: o.receipt ? parseReceipt(o.receipt) : null,
  } as MortarionRewardStatus;
}

export async function getMortarionRewardStatus(): Promise<MortarionRewardStatus> {
  const {data,error} = await supabase.rpc('territory_mortarion_reward_status_v1');
  if(error) throw new Error(error.message || 'mortarion_reward_unavailable');
  return parseMortarionRewardStatus(data);
}

const busy = new Set<string>();
/** Atomic server-authoritative one-time reward. Never draw prizes on the client.
 * The save fence protects against a stale autosave overwriting a claimed chest.
 */
export async function claimMortarionReward(playerId: string): Promise<MortarionRewardReceipt> {
  if (!playerId || busy.has(playerId)) throw new Error('mortarion_reward_busy');
  busy.add(playerId);
  try {
    if (!await ensurePlayerSession(playerId)) throw new Error('mortarion_auth_required');
    const snapshot = useGame.get();
    if (!await saveCloudSave(playerId,snapshot) || useGame.get() !== snapshot)
      throw new Error('mortarion_rewards_reload_required');
    const expected = saveTokens.get(playerId);
    if (!expected) throw new Error('mortarion_rewards_reload_required');
    protectFortuneSave(playerId);
    const {data,error} = await supabase.rpc('territory_mortarion_reward_claim_v1',{p_expected:expected});
    if (error) {
      if (error.code === 'P0001' || error.code === 'P0002' || error.code === '23514') {
        releaseArenaRejectedAction(playerId);
      }
      throw new Error(error.message || 'mortarion_rewards_reload_required');
    }
    if (!data || data.success !== true) throw new Error('mortarion_invalid_reward_receipt');
    const receipt = parseReceipt(data.receipt);
    const serverState = acceptMonopolyClaimReceipt(playerId,data);
    if (!serverState.mortarionReward
      || serverState.mortarionReward.eventId !== 'mortarion_2026')
      throw new Error('mortarion_invalid_reward_receipt');
    useGame.set(serverState);
    return receipt;
  } finally {
    busy.delete(playerId);
  }
}
