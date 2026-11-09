import { useGame } from './actions';
import { supabase } from './supabase';
import { acceptMonopolyClaimReceipt, protectFortuneSave, releaseArenaRejectedAction, saveCloudSave, saveTokens } from './cloud';
import type { TrialChestReward } from './trialLoot';

const busy = new Set<string>();

/**
 * Open one server-reserved Trial chest. No client loot roll, no local wallet
 * mutation, and no retry of an uncertain network operation.
 *
 * Save the current hero first so the server updates the authoritative latest
 * game_state. Once the RPC starts, fence off any queued older autosaves.
 */
export async function openTrialChest(userId: string, floor: number): Promise<{ loot: TrialChestReward; alreadyOpened: boolean }> {
  if (!userId || !Number.isSafeInteger(floor) || floor < 1 || floor > 10000 || busy.has(userId)) {
    throw new Error('trial_chest_busy');
  }
  const snapshot = useGame.get();
  if (!snapshot.trialChestUnopenedFloors?.includes(floor)) throw new Error('trial_chest_missing');
  busy.add(userId);
  try {
    if (!await saveCloudSave(userId, snapshot) || useGame.get() !== snapshot) {
      throw new Error('trial_chest_reload_required');
    }
    const expected = saveTokens.get(userId);
    if (!expected) throw new Error('trial_chest_reload_required');
    protectFortuneSave(userId);
    const { data, error } = await supabase.rpc('territory_trial_chest_open_v1', {
      p_floor: floor, p_expected: expected,
    });
    if (error) {
      // A definitive database exception rolls back the transaction. A network
      // exception never reaches this branch and keeps old writes fenced.
      if (error.code === 'P0001' || error.code === 'P0002' || error.code === '23514') {
        releaseArenaRejectedAction(userId);
      }
      throw new Error(error.message || 'trial_chest_reload_required');
    }
    if (!data || data.success !== true || !data.receipt || data.receipt.floor !== floor) {
      throw new Error('trial_chest_invalid_receipt');
    }
    const serverState = acceptMonopolyClaimReceipt(userId, data);
    if (serverState.trialChestUnopenedFloors?.includes(floor)
      || !serverState.trialChestOpenedFloors?.includes(floor)) {
      throw new Error('trial_chest_invalid_receipt');
    }
    useGame.set(serverState);
    return { loot: data.receipt as TrialChestReward, alreadyOpened: data.already_opened === true };
  } finally {
    busy.delete(userId);
  }
}
