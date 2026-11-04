import { supabase } from './supabase';
import { exclusiveVipClaim } from './vipClaimQueue';
import { useGame } from './actions';
import {
  acceptMonopolyClaimReceipt, protectFortuneSave, releaseArenaRejectedAction,
  saveBlocked, saveCloudSave, saveTokens,
} from './cloud';

/** Client for the owner-reviewed, not-yet-deployed server VIP weekly RPC.
 * No client-side reward creation. Lost responses retry the same UUID.
 */
export interface VipWeeklyStatus {
  vip: number;
  serverWeek: string;
  nextResetAt: string;
  claimedThisWeek: boolean;
}
export interface VipWeeklyReward {
  gold: number;
  gems: number;
  stones: number;
  vip: number;
  week: string;
  materials: number;
}
type VipWeeklyReply = {
  success: true;
  vip?: number;
  server_week?: string;
  next_reset_at?: string;
  claimed_this_week?: boolean;
  updated_at: string;
  game_state: unknown;
  wallet_gold: number;
  wallet_gems: number;
  reward?: VipWeeklyReward;
  replayed?: boolean;
};
type Pending = { operation: string; expected: string };
const pendingKey = (userId: string) => `territory.vip.weekly.pending.v1:${userId}`;

function loadPending(userId: string): Pending | null {
  const raw = window.localStorage.getItem(pendingKey(userId));
  if (raw === null) return null;
  const value = JSON.parse(raw) as Partial<Pending>;
  if (typeof value.operation !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.operation)
    || typeof value.expected !== 'string' || !Number.isFinite(Date.parse(value.expected)))
    throw new Error('vip_weekly_pending_corrupt');
  return {operation: value.operation, expected: value.expected};
}
function validatedStatus(data: unknown): VipWeeklyStatus {
  if (!data || typeof data !== 'object') throw new Error('vip_weekly_invalid_status');
  const v = data as Record<string, unknown>;
  if (v.success !== true || !Number.isInteger(v.vip) || (v.vip as number) < 0 || (v.vip as number) > 10
    || typeof v.server_week !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.server_week)
    || typeof v.next_reset_at !== 'string' || !Number.isFinite(Date.parse(v.next_reset_at))
    || typeof v.claimed_this_week !== 'boolean') throw new Error('vip_weekly_invalid_status');
  return {vip:v.vip as number,serverWeek:v.server_week,nextResetAt:v.next_reset_at,claimedThisWeek:v.claimed_this_week};
}
async function rpc(action: 'status' | 'claim', operation?: string, expected?: string): Promise<VipWeeklyReply> {
  const {data,error} = await supabase.rpc('territory_vip_weekly_v1', {
    p_action:action,p_operation:operation ?? null,p_expected:expected ?? null,
  });
  if (error) throw Object.assign(new Error(error.message || 'vip_weekly_unavailable'), {
    // PostgREST and transport errors do not prove whether a claim committed.
    definiteRollback: /^[0-9A-Z]{5}$/.test(error.code ?? ''),
  });
  if (!data || typeof data !== 'object' || data.success !== true
    || typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at))
    || !data.game_state || !Number.isSafeInteger(data.wallet_gold)
    || !Number.isSafeInteger(data.wallet_gems))
    throw new Error('vip_weekly_invalid_receipt');
  return data as VipWeeklyReply;
}
function validateReward(data: VipWeeklyReply): VipWeeklyReward {
  const reward = data.reward;
  if (!reward || ![reward.gold,reward.gems,reward.stones,reward.materials].every(
    x => Number.isSafeInteger(x) && x >= 0)
    || !Number.isInteger(reward.vip) || reward.vip < 2 || reward.vip > 10
    || typeof reward.week !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reward.week))
    throw new Error('vip_weekly_invalid_reward');
  return reward;
}
export function fetchVipWeeklyStatus(userId:string): Promise<VipWeeklyStatus> {
  return exclusiveVipClaim(userId,async()=>{
    const pending=loadPending(userId);
    if (pending) {
      // An uncertain payout must be recovered before presenting a fresh claim.
      await settle(userId,pending);
    }
    return validatedStatus(await rpc('status'));
  });
}
/** On all ambiguous network errors the original operation ID is retained.
 * A definite SQL rollback is reconciled against the current server snapshot
 * before the pending ID is cleared and saves can continue.
 */
async function settle(userId:string,pending:Pending):Promise<VipWeeklyReward> {
  protectFortuneSave(userId);
  try {
    const data=await rpc('claim',pending.operation,pending.expected);
    const reward=validateReward(data);
    const verified=acceptMonopolyClaimReceipt(userId,data);
    useGame.set(verified);
    window.localStorage.removeItem(pendingKey(userId));
    return reward;
  }catch(e){
    if ((e as {definiteRollback?:boolean}).definiteRollback) {
      try {
        const current=await rpc('status');
        const verified=acceptMonopolyClaimReceipt(userId,current);
        useGame.set(verified);
        window.localStorage.removeItem(pendingKey(userId));
        releaseArenaRejectedAction(userId);
      }catch {
        // A failed reconciliation is NOT permission to unlock the old save.
      }
    }
    throw e;
  }
}
export function recoverVipWeekly(userId:string):Promise<VipWeeklyReward | null> {
  return exclusiveVipClaim(userId,()=>{
    // This path is safe even after an app restart: use the original UUID.
    const pending=loadPending(userId);
    return pending ? settle(userId,pending) : Promise.resolve(null);
  });
}
export function claimVipWeekly(userId:string): Promise<VipWeeklyReward> {
  return exclusiveVipClaim(userId,async()=>{
    if (loadPending(userId)) return settle(userId,loadPending(userId)!);
    if (saveBlocked.has(userId)) throw new Error('vip_weekly_reload_required');
    const snapshot=useGame.get();
    if (!await saveCloudSave(userId,snapshot) || useGame.get()!==snapshot)
      throw new Error('vip_weekly_save_unconfirmed');
    const expected=saveTokens.get(userId);
    if(!expected)throw new Error('vip_weekly_reload_required');
    const operation=crypto.randomUUID();
    const pending={operation,expected};
    window.localStorage.setItem(pendingKey(userId),JSON.stringify(pending));
    return settle(userId,pending);
  });
}
