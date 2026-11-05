import { supabase } from './supabase';
import { ensurePlayerSession } from './auth';
import { useGame } from './actions';
import {
  acceptMonopolyClaimReceipt, protectFortuneSave, releaseArenaRejectedAction,
  saveBlocked, saveCloudSave, saveTokens,
} from './cloud';
import { validSaveToken } from './saveToken';

const ENABLED = import.meta.env?.VITE_VIP_EQUIPMENT_PRESETS_ENABLED === 'true';
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const slots = ['helmet','amulet','armor','weapon','shield','ring','boots'] as const;
type PresetNo = 1 | 2;
type PendingApply = { version: 1; slot: PresetNo; expected: string; operation: string };

export type VipEquipmentPresetStatus = {
  vip: number;
  presets: { slot: PresetNo; equipmentIds: Record<string,string|null> }[];
};

const key = (userId: string) => 'territory:vip-equipment-apply:v1:' + userId;
const flights = new Map<string,Promise<boolean>>();

function validSlot(value: unknown): value is PresetNo {
  return value === 1 || value === 2;
}
function readPending(userId: string): PendingApply | null {
  const raw = window.localStorage.getItem(key(userId));
  if (!raw) return null;
  let record: PendingApply;
  try { record = JSON.parse(raw) as PendingApply; }
  catch { throw new Error('vip_preset_corrupt_pending'); }
  if (record.version !== 1 || !validSlot(record.slot)
    || !validSaveToken(record.expected) || !UUID.test(record.operation))
    throw new Error('vip_preset_corrupt_pending');
  return record;
}
function writePending(userId: string, record: PendingApply) {
  const raw = JSON.stringify(record);
  window.localStorage.setItem(key(userId),raw);
  if (window.localStorage.getItem(key(userId)) !== raw)
    throw new Error('vip_preset_storage_unavailable');
}
function clearPending(userId: string, record: PendingApply) {
  if (window.localStorage.getItem(key(userId)) !== JSON.stringify(record))
    throw new Error('vip_preset_pending_mismatch');
  window.localStorage.removeItem(key(userId));
  if (window.localStorage.getItem(key(userId)) !== null)
    throw new Error('vip_preset_storage_unavailable');
}
async function owner(userId: string) {
  if (!UUID.test(userId) || !await ensurePlayerSession(userId))
    throw new Error('vip_preset_login_required');
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== userId)
    throw new Error('vip_preset_login_required');
}
export function vipEquipmentPresetsEnabled(): boolean { return ENABLED; }
/** Returns the original preset slot for an exact operation replay, never
 * guesses a new operation when a WebView lost its acknowledgement. */
export function pendingVipEquipmentPresetSlot(userId: string): 1 | 2 | null {
  if (!ENABLED) return null;
  try { return readPending(userId)?.slot ?? null; }
  catch { return null; }
}
export function hasPendingVipEquipmentPreset(userId: string): boolean {
  if (!ENABLED) return false;
  // Unreadable storage is NOT evidence that a pending save can be discarded.
  try { return readPending(userId)!==null; } catch { return true; }
}

/** Close the normal cloud save queue on startup until the original UUID has
 * been replayed. A timeout is NEVER evidence of server rollback. */
export function restoreVipEquipmentPresetFence(userId: string): boolean {
  if (!hasPendingVipEquipmentPreset(userId)) return false;
  protectFortuneSave(userId);
  return true;
}
export function parseVipEquipmentPresetStatus(value: unknown): VipEquipmentPresetStatus {
  if (!value || typeof value!=='object') throw new Error('vip_preset_status_invalid');
  const data=value as Record<string,unknown>;
  if (!Number.isInteger(data.vip) || Number(data.vip)<0 || Number(data.vip)>10
    || !Array.isArray(data.presets) || data.presets.length>2)
    throw new Error('vip_preset_status_invalid');
  const seen = new Set<number>();
  const presets: VipEquipmentPresetStatus['presets']=[];
  for(const row of data.presets) {
    if (!row || typeof row!=='object') throw new Error('vip_preset_status_invalid');
    const item=row as Record<string,unknown>;
    if (!validSlot(item.slot) || seen.has(item.slot)
      || !item.equipment_ids || typeof item.equipment_ids!=='object'
      || Array.isArray(item.equipment_ids)) throw new Error('vip_preset_status_invalid');
    const ids=item.equipment_ids as Record<string,unknown>;
    if (Object.keys(ids).length!==7 ||
      slots.some(slot=>!(slot in ids) || !(ids[slot]===null ||
        (typeof ids[slot]==='string' && ids[slot].length>0 && ids[slot].length<=160))))
      throw new Error('vip_preset_status_invalid');
    seen.add(item.slot);
    presets.push({slot:item.slot,equipmentIds:ids as Record<string,string|null>});
  }
  return {vip:Number(data.vip),presets};
}
export async function fetchVipEquipmentPresets(userId: string): Promise<VipEquipmentPresetStatus> {
  if (!ENABLED) throw new Error('vip_preset_not_enabled');
  await owner(userId);
  const {data,error}=await supabase.rpc('territory_vip_equipment_presets_status_v1');
  if (error) throw new Error('vip_preset_unavailable');
  return parseVipEquipmentPresetStatus(data);
}

/** Save the server's CURRENT equipped configuration, never client-supplied
 * equipment IDs. The client only provides slot and current CAS revision. */
export async function saveVipEquipmentPreset(userId: string,slot: PresetNo): Promise<void> {
  if (!ENABLED) throw new Error('vip_preset_not_enabled');
  if (!validSlot(slot) || hasPendingVipEquipmentPreset(userId) || saveBlocked.has(userId))
    throw new Error('vip_preset_recovery_required');
  await owner(userId);
  const snapshot=useGame.get();
  if (!await saveCloudSave(userId,snapshot) || useGame.get()!==snapshot)
    throw new Error('vip_preset_save_required');
  const expected=saveTokens.get(userId);
  if (!validSaveToken(expected) || saveBlocked.has(userId))
    throw new Error('vip_preset_save_required');
  const {data,error}=await supabase.rpc('territory_vip_equipment_preset_save_v1',{
    p_slot:slot,p_expected:expected,
  });
  if (error || !data || data.success!==true || data.preset_no!==slot
    || data.updated_at!==expected) throw new Error('vip_preset_save_unconfirmed');
}

/** Save -> persist operation UUID -> trusted server switch -> adopt cloud CAS.
 * Any unknown network failure retains the SAME operation key for replay.
 * A duplicate callback must not move gear or create another inventory item. */
export function applyVipEquipmentPreset(userId: string,slot: PresetNo): Promise<boolean> {
  if (!ENABLED || !validSlot(slot)) return Promise.reject(new Error('vip_preset_not_enabled'));
  const active=flights.get(userId);
  if (active) return active;
  const job=(async()=>{
    await owner(userId);
    let record=readPending(userId);
    if (record && record.slot!==slot) throw new Error('vip_preset_recovery_required');
    let snapshot: ReturnType<typeof useGame.get> | null = null;
    if (!record) {
      if (saveBlocked.has(userId)) throw new Error('vip_preset_save_blocked');
      snapshot=useGame.get();
      if (!await saveCloudSave(userId,snapshot) || useGame.get()!==snapshot)
        throw new Error('vip_preset_save_required');
      const expected=saveTokens.get(userId);
      if (!validSaveToken(expected) || saveBlocked.has(userId))
        throw new Error('vip_preset_save_required');
      record={version:1,slot,expected,operation:crypto.randomUUID()};
      writePending(userId,record);
    }
    protectFortuneSave(userId);
    try {
      const {data,error}=await supabase.rpc('territory_vip_equipment_preset_apply_v1',{
        p_slot:record.slot,p_expected:record.expected,p_operation:record.operation,
      });
      if (error) throw error;
      if (!data || data.success!==true || data.operation_id!==record.operation)
        throw new Error('vip_preset_invalid_receipt');
      const state=acceptMonopolyClaimReceipt(userId,data);
      // Never leave an older local state in front of a confirmed server update.
      const localChanged = snapshot!==null && useGame.get()!==snapshot;
      useGame.set(state);
      clearPending(userId,record);
      if (localChanged) throw new Error('vip_preset_reload_required');
      return true;
    } catch(error) {
      if (error && typeof error==='object' && 'code' in error
        && (error as {code?:unknown}).code==='P0001') {
        // PostgreSQL P0001 proves rollback for this operation. No gear moved.
        clearPending(userId,record);
        releaseArenaRejectedAction(userId);
      }
      throw error;
    }
  })();
  flights.set(userId,job);
  void job.finally(()=>{if(flights.get(userId)===job)flights.delete(userId);}).catch(()=>{});
  return job;
}
