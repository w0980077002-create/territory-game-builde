import { supabase } from '../supabase';
import type { GameState } from '../types';
import { GOOSE_FOLLOWER, GOOSE_ID, GOOSE_PRICE } from '../followers';
import { useGame } from '../actions';
import { acceptMonopolyClaimReceipt, protectFortuneSave, releaseArenaRejectedAction, saveCloudSave, saveTokens } from '../cloud';

export function installGoose(state: GameState, owned: boolean, title?: string): GameState {
  return { ...state, gooseCompanionVerified: owned, gooseCompanionTitle: owned ? title : undefined,
    followers: state.followers.filter(f => f.id !== GOOSE_ID).concat(owned ? [{ ...GOOSE_FOLLOWER }] : []) };
}
function entitlement(data: unknown): { owned: boolean; title?: string } {
  const r = data as Record<string, unknown> | null;
  if (!r || r.companion_id !== GOOSE_ID || r.price !== GOOSE_PRICE || typeof r.owned !== 'boolean'
    || (r.owned && (typeof r.receipt !== 'string' || !r.receipt))) throw new Error('goose_invalid_receipt');
  return { owned: r.owned, title: r.title === 'Адвокат 5000 побед' ? r.title : undefined };
}
let entitlementEpoch = 0;
export async function refreshGoose(): Promise<void> {
  const epoch = entitlementEpoch;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase.rpc('territory_goose_status_v1');
  if (error) throw new Error(error.message);
  const verified = entitlement(data);
  const { data: current } = await supabase.auth.getUser();
  if (epoch === entitlementEpoch && current.user?.id === user.id) useGame.set(s => installGoose(s, verified.owned, verified.title));
}
let busy = false;
/** Same CAS/save fence as existing paid operations. An uncertain response keeps
 * old saves fenced. Retrying after reload reads the unique ownership ledger. */
export async function buyGoose(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('goose_login_required');
    const snapshot = useGame.get();
    if (!await saveCloudSave(user.id, snapshot) || useGame.get() !== snapshot) throw new Error('goose_reload_required');
    const expected = saveTokens.get(user.id);
    if (!expected) throw new Error('goose_reload_required');
    protectFortuneSave(user.id);
    const { data, error } = await supabase.rpc('territory_goose_buy_v1', { p_operation: crypto.randomUUID(), p_expected: expected });
    if (error) {
      if (error.code === 'P0001') releaseArenaRejectedAction(user.id);
      throw new Error(error.message);
    }
    const verified = entitlement(data);
    const {data: current} = await supabase.auth.getUser();
    if (current.user?.id !== user.id) throw new Error('goose_session_changed');
    if (!verified.owned || data.success !== true) throw new Error('goose_invalid_receipt');
    entitlementEpoch++;
    useGame.set(installGoose(acceptMonopolyClaimReceipt(user.id, data), true, verified.title));
  } finally { busy = false; }
}
