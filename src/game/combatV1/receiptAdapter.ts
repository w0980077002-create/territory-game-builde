import { supabase } from '../supabase';
import { ensurePlayerSession } from '../auth';
import { acceptAdventureSettlementReceipt, acceptAdventureStartReceipt, validateAdventureSettlementReceipt, validateAdventureStartReceipt, acceptAdventureLatestCloudSnapshot, protectFortuneSave, releaseArenaRejectedAction, saveBlocked, saveCloudSave, saveTokens } from '../cloud';
import type { GameState } from '../types';
import { parseCombatCommand, type CombatCommand } from './service';

type Start = Extract<CombatCommand, { action: 'start' }>;
type Advance = Extract<CombatCommand, { action: 'advance' }>;
type Resume = Extract<CombatCommand, { action: 'resume' }>;
type Hooks = { getState(): GameState; applyState(state: GameState): void };
const key = (userId: string) => `territory_adventure_pending_v1:${userId}`;
const startKey = (userId: string) => `territory_adventure_start_v1:${userId}`;
const active = new Set<string>();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Only these machine-readable HTTP 409 responses prove this exact server
 * operation was rejected. Never infer rollback from timeouts or generic 503s. */
const definitelyRejected = new Set([
  'combat_revision_conflict', 'combat_no_elapsed_time', 'combat_already_finished',
  'combat_catchup_required', 'combat_skill_not_available',
  'combat_active_session_exists', 'combat_session_not_found',
  'combat_encounter_not_available', 'combat_profile_needs_reconciliation',
  'combat_profile_not_verified', 'combat_not_enabled',
  'combat_settlement_not_ready', 'combat_no_dark_stones', 'combat_starts_paused', 'combat_canary_not_allowed',
]);

async function isVerifiedRollback(error: unknown): Promise<boolean> {
  if (!record(error) || !record(error.context)) return false;
  const response = error.context;
  if (response.status !== 409 || typeof response.clone !== 'function') return false;
  try {
    const payload: unknown = await (response as { clone: () => Response }).clone().json();
    return record(payload) && typeof payload.error === 'string' && definitelyRejected.has(payload.error);
  } catch { return false; }
}

/** Do not clear a receipt fence merely because a request failed. Only a
 * verified 409 rollback plus a fresh owner-scoped cloud snapshot can release it.
 * This protects both legacy autosave and the confirmed server-side wallet. */
function checkedPendingAdvance(userId: string): boolean {
  try { return localStorage.getItem(key(userId)) !== null; }
  catch { return false; }
}

async function recoverRejectedOperation(
  userId: string, error: unknown, hooks: Hooks, pendingKey: string,
): Promise<boolean> {
  if (!await isVerifiedRollback(error)) return false;
  if (!await ensurePlayerSession(userId)) return false;
  const auth = await supabase.auth.getUser();
  if (auth.error || auth.data.user?.id !== userId) return false;
  const snapshot = await supabase.from('players')
    .select('id,updated_at,game_state,gold,gems').eq('id', userId).maybeSingle();
  if (snapshot.error || !snapshot.data || typeof snapshot.data.updated_at !== 'string') return false;
  const localRevision = saveTokens.get(userId);
  if (!localRevision || !Number.isFinite(Date.parse(localRevision))
    || Date.parse(snapshot.data.updated_at) < Date.parse(localRevision)) return false;
  // Existing validator checks account, wallet, complete game state and save date.
  const state = acceptAdventureLatestCloudSnapshot(userId, snapshot.data, snapshot.data.updated_at);
  hooks.applyState(state);
  localStorage.removeItem(pendingKey);
  releaseArenaRejectedAction(userId);
  return true;
}

/** Call before allowing autosave on remount. A pending command has an uncertain
 * outcome and must be replayed with its original ID, or resolved by reload. */
export function restoreAdventureSaveFence(userId: string): Advance | null {
  if (typeof localStorage === 'undefined') throw new Error('adventure_storage_unavailable');
  const raw = localStorage.getItem(key(userId));
  if (!raw) return null;
  // Fence even when the persisted data is corrupt: a request may have committed.
  protectFortuneSave(userId);
  const value = parseCombatCommand(JSON.parse(raw));
  if (value.action !== 'advance') throw new Error('adventure_invalid_pending');
  return value;
}

/** Fence uncertain start debits before the app enables its autosave queue. */
export function restoreAdventureStartFence(userId:string):Start|null{
 if(typeof localStorage==='undefined')throw new Error('adventure_storage_unavailable');
 const raw=localStorage.getItem(startKey(userId));
 if(!raw)return null;
 protectFortuneSave(userId);
 const command=parseCombatCommand(JSON.parse(raw));
 if(command.action!=='start')throw new Error('adventure_invalid_start_marker');
 return command;
}

/** Commit one server-authorized stone debit; use the SAME UUID on retries. */
export async function requestAdventureStart(userId:string,command:Start,hooks:Hooks):Promise<Record<string,unknown>>{
 if(active.has(userId))throw new Error('adventure_request_pending');
 active.add(userId);
 let fenced=false;
 try{
   const checked=parseCombatCommand(command);
   if(checked.action!=='start')throw new Error('adventure_invalid_command');
   if(!await ensurePlayerSession(userId))throw new Error('adventure_auth_required');
   const auth=await supabase.auth.getUser();
   if(auth.error||auth.data.user?.id!==userId)throw new Error('adventure_auth_required');
   const wasBlocked=saveBlocked.has(userId);
   const old=restoreAdventureStartFence(userId);
   if(old && JSON.stringify(old)!==JSON.stringify(checked))throw new Error('adventure_retry_pending_operation');
   if(!old && wasBlocked)throw new Error('adventure_save_blocked');
   if(!old){
     const snapshot=hooks.getState();
     const serialized=JSON.stringify(snapshot);
     if(!await saveCloudSave(userId,snapshot)||JSON.stringify(hooks.getState())!==serialized)
       throw new Error('adventure_save_required');
     localStorage.setItem(startKey(userId),JSON.stringify(checked));
   }
   protectFortuneSave(userId);fenced=true;
   const {data,error}=await supabase.functions.invoke('territory-combat',{body:checked});
   if(error){
     // Keep the original HTTP 409 only when its machine code verifies rollback.
     // A timeout, 503 or unknown error remains indistinguishable from a commit.
     if(await isVerifiedRollback(error)) throw error;
     throw new Error('adventure_unconfirmed');
   }
   if(!record(data)||data.success!==true||typeof data.session_id!=='string'
     ||!record(data.start_save)||!record(data.state)||data.state.status!=='fighting')
     throw new Error('adventure_unconfirmed');
   const check=await supabase.from('players').select('id,updated_at,game_state,gold,gems').eq('id',userId).maybeSingle();
   if(check.error||!check.data)throw new Error('adventure_reload_required');
   validateAdventureStartReceipt(data.start_save,data.session_id);
   if(check.data.updated_at !== data.start_save.updated_at){
     // Confirmed original start followed by newer authoritative cloud activity.
     hooks.applyState(acceptAdventureLatestCloudSnapshot(userId,check.data,data.start_save.updated_at));
   }else{
     const adopted=acceptAdventureStartReceipt(userId,data.start_save,data.session_id);
     if(adopted)hooks.applyState(adopted);
   }
   localStorage.removeItem(startKey(userId));
   releaseArenaRejectedAction(userId);fenced=false;
   return data;
 }catch(error){
   if(fenced){
     try{
       if(await recoverRejectedOperation(userId,error,hooks,startKey(userId)))
         throw new Error('adventure_definitively_rejected');
     }catch(recoveryError){
       if(recoveryError instanceof Error && recoveryError.message==='adventure_definitively_rejected')
         throw recoveryError;
     }
     protectFortuneSave(userId);
   }
   throw error;
 }
 finally{active.delete(userId);}
}

/** Submit an advance or resume, preserving an uncertain advance across remounts.
 * The caller must keep editing disabled during the operation and invoke
 * restoreAdventureSaveFence before starting autosave after a remount. */
export async function requestAdventureSettlement(userId: string, command: Advance | Resume, hooks: Hooks): Promise<Record<string, unknown>> {
  if (active.has(userId)) throw new Error('adventure_request_pending');
  active.add(userId);
  let fenced = false;
  try {
    if (typeof localStorage === 'undefined') throw new Error('adventure_storage_unavailable');
    const checked = parseCombatCommand(command);
    if (checked.action !== 'advance' && checked.action !== 'resume') throw new Error('adventure_invalid_command');
    if (!await ensurePlayerSession(userId)) throw new Error('adventure_auth_required');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || user?.id !== userId) throw new Error('adventure_auth_required');
    const wasBlocked = saveBlocked.has(userId);
    const old = restoreAdventureSaveFence(userId);
    // Read-only resume can reconcile a confirmed terminal battle without a new debit.
    if (!old && wasBlocked && checked.action !== 'resume') throw new Error('adventure_save_blocked');
    if (old && JSON.stringify(old) !== JSON.stringify(checked)) throw new Error('adventure_retry_pending_operation');
    if (!old && checked.action === 'advance') {
      const snapshot = hooks.getState();
      const serialized = JSON.stringify(snapshot);
      if (!await saveCloudSave(userId, snapshot) || JSON.stringify(hooks.getState()) !== serialized)
        throw new Error('adventure_save_required');
      localStorage.setItem(key(userId), JSON.stringify(checked));
    }
    // Block queued stale snapshots until a confirmed result has been installed.
    protectFortuneSave(userId);
    fenced = true;
    const { data, error } = await supabase.functions.invoke('territory-combat', { body: checked });
    if (error) {
      if (await isVerifiedRollback(error)) throw error;
      throw new Error('adventure_unconfirmed');
    }
    if (!record(data) || data.success !== true || data.session_id !== checked.sessionId || !record(data.state)
      || !Number.isSafeInteger(data.revision) || Number(data.revision)<0
      || (checked.action === 'advance' && data.revision !== checked.revision+1))
      throw new Error('adventure_unconfirmed');
    const terminal = ['hero_won', 'enemy_won', 'draw'].includes(String(data.state.status));
    if (terminal) {
      if (!record(data.settlement) || data.settlement.outcome !== data.state.status) throw new Error('adventure_invalid_receipt');
      // A replay may predate another device's save. Check the current row
      // before exposing its snapshot; the normal CAS still guards later saves.
      const currentUser = await supabase.auth.getUser();
      if (currentUser.error || currentUser.data.user?.id !== userId) throw new Error('adventure_auth_required');
      const current = await supabase.from('players').select('id,updated_at,game_state,gold,gems').eq('id', userId).maybeSingle();
      if (current.error || !current.data) throw new Error('adventure_reload_required');
      validateAdventureSettlementReceipt(data.settlement,checked.sessionId);
      if (current.data.updated_at !== data.settlement.updated_at) {
        // Adopt the latest verified state; old reward is already in server ledger.
        hooks.applyState(acceptAdventureLatestCloudSnapshot(userId,current.data,data.settlement.updated_at));
      } else {
        const state = acceptAdventureSettlementReceipt(userId, data.settlement, checked.sessionId);
        if (state) hooks.applyState(state);
      }
    } else if (data.state.status !== 'fighting' || data.settlement != null) {
      throw new Error('adventure_invalid_receipt');
    } else if (!old && wasBlocked) {
      throw new Error('adventure_save_blocked');
    }
    if (checked.action === 'advance') localStorage.removeItem(key(userId));
    releaseArenaRejectedAction(userId);
    fenced = false;
    return data;
  } catch (error) {
    // acceptAdventureSettlementReceipt installs the token before the caller's
    // state update. If that update fails, retain the fence and require reload.
    if (fenced) {
      try {
        if (checkedPendingAdvance(userId) && await recoverRejectedOperation(userId,error,hooks,key(userId)))
          throw new Error('adventure_definitively_rejected');
      } catch (recoveryError) {
        if (recoveryError instanceof Error && recoveryError.message === 'adventure_definitively_rejected')
          throw recoveryError;
      }
      protectFortuneSave(userId);
    }
    throw error;
  } finally { active.delete(userId); }
}
