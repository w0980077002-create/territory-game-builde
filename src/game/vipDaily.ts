import { supabase } from './supabase';
import { useGame } from './actions';
import {
  acceptMonopolyClaimReceipt, protectFortuneSave, releaseArenaRejectedAction,
  saveBlocked, saveCloudSave, saveTokens,
} from './cloud';

/** Client for the owner-reviewed, not-yet-deployed server VIP daily RPC.
 * No client-side reward creation. Lost responses retry the same UUID.
 */
export interface VipDailyStatus {
  vip: number;
  serverDay: string;
  nextResetAt: string;
  claimedToday: boolean;
}
export interface VipDailyReward {
  gold: number;
  gems: number;
  stones: number;
  vip: number;
  day: string;
}
type VipDailyReply = {
  success: true;
  vip?: number;
  server_day?: string;
  next_reset_at?: string;
  claimed_today?: boolean;
  updated_at: string;
  game_state: unknown;
  wallet_gold: number;
  wallet_gems: number;
  reward?: VipDailyReward;
  replayed?: boolean;
};
type Pending = { operation: string; expected: string };
const tasks = new Map<string, Promise<unknown>>();
const pendingKey = (userId: string) => `territory.vip.daily.pending.v1:${userId}`;

function loadPending(userId: string): Pending | null {
  const raw = window.localStorage.getItem(pendingKey(userId));
  if (raw === null) return null;
  const value = JSON.parse(raw) as Partial<Pending>;
  if (typeof value.operation !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.operation)
    || typeof value.expected !== 'string' || !Number.isFinite(Date.parse(value.expected)))
    throw new Error('vip_daily_pending_corrupt');
  return {operation: value.operation, expected: value.expected};
}
function validatedStatus(data: unknown): VipDailyStatus {
  if (!data || typeof data !== 'object') throw new Error('vip_daily_invalid_status');
  const v = data as Record<string, unknown>;
  if (v.success !== true || !Number.isInteger(v.vip) || (v.vip as number) < 0 || (v.vip as number) > 10
    || typeof v.server_day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.server_day)
    || typeof v.next_reset_at !== 'string' || !Number.isFinite(Date.parse(v.next_reset_at))
    || typeof v.claimed_today !== 'boolean') throw new Error('vip_daily_invalid_status');
  return {vip:v.vip as number,serverDay:v.server_day,nextResetAt:v.next_reset_at,claimedToday:v.claimed_today};
}
async function rpc(action: 'status' | 'claim', operation?: string, expected?: string): Promise<VipDailyReply> {
  const {data,error} = await supabase.rpc('territory_vip_daily_v1', {
    p_action:action,p_operation:operation ?? null,p_expected:expected ?? null,
  });
  if (error) throw Object.assign(new Error(error.message || 'vip_daily_unavailable'), {
    definiteRollback: /^(?:[0-9A-Z]{5}|PGRST\d+)$/.test(error.code ?? ''),
  });
  if (!data || typeof data !== 'object' || data.success !== true
    || typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at))
    || !data.game_state || !Number.isSafeInteger(data.wallet_gold)
    || !Number.isSafeInteger(data.wallet_gems))
    throw new Error('vip_daily_invalid_receipt');
  return data as VipDailyReply;
}
function validateReward(data: VipDailyReply): VipDailyReward {
  const reward = data.reward;
  if (!reward || ![reward.gold,reward.gems,reward.stones].every(
    x => Number.isSafeInteger(x) && x >= 0)
    || !Number.isInteger(reward.vip) || reward.vip < 1 || reward.vip > 10
    || typeof reward.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reward.day))
    throw new Error('vip_daily_invalid_reward');
  return reward;
}
function exclusive<T>(userId:string, work:()=>Promise<T>): Promise<T> {
  if (tasks.has(userId)) return tasks.get(userId) as Promise<T>;
  const task=work(); tasks.set(userId,task);
  void task.finally(()=>{if(tasks.get(userId)===task)tasks.delete(userId);}).catch(()=>{});
  return task;
}
export function fetchVipDailyStatus(userId:string): Promise<VipDailyStatus> {
  return exclusive(userId,async()=>{
    if (loadPending(userId)) {
      // An uncertain payout must be recovered before presenting a fresh claim.
      await recoverVipDaily(userId);
    }
    return validatedStatus(await rpc('status'));
  });
}
/** On all ambiguous network errors the original operation ID is retained.
 * A definite SQL rollback is reconciled against the current server snapshot
 * before the pending ID is cleared and saves can continue.
 */
async function settle(userId:string,pending:Pending):Promise<VipDailyReward> {
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
export function recoverVipDaily(userId:string):Promise<VipDailyReward | null> {
  // This path is safe even after an app restart: use the original UUID.
  const pending=loadPending(userId);
  if(!pending)return Promise.resolve(null);
  return settle(userId,pending);
}
export function claimVipDaily(userId:string): Promise<VipDailyReward> {
  return exclusive(userId,async()=>{
    if (loadPending(userId)) return settle(userId,loadPending(userId)!);
    if (saveBlocked.has(userId)) throw new Error('vip_daily_reload_required');
    const snapshot=useGame.get();
    if (!await saveCloudSave(userId,snapshot) || useGame.get()!==snapshot)
      throw new Error('vip_daily_save_unconfirmed');
    const expected=saveTokens.get(userId);
    if(!expected)throw new Error('vip_daily_reload_required');
    const operation=crypto.randomUUID();
    const pending={operation,expected};
    window.localStorage.setItem(pendingKey(userId),JSON.stringify(pending));
    return settle(userId,pending);
  });
}
