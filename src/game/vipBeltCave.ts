import { useAccount, useArena, useGame } from './actions';
import { beltContext, refillBeltFromInventory } from './belt';
import { saveBlocked, saveCloudSave, saveTokens } from './cloud';
import { supabase } from './supabase';
import { validSaveToken } from './saveToken';

type TerminalCaveReceipt = {
  session_id: string;
  state: { status: string };
  settlement?: { outcome: string } | null;
};

const sessionIdPattern = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const playerIdPattern = sessionIdPattern;
const pending = new Map<string, Promise<boolean>>();
const markerKey = (userId: string, source: 'cave' | 'arena', sessionId: string) =>
  `territory.vip.belt.${source}.v1:${userId}:${sessionId}`;

function currentVip() {
  const account = useAccount.get();
  const remaining = account.vipRemaining - (performance.now() - account.vipCheckedAt);
  return Math.max(account.permanentVip, remaining > 0 ? account.vip : 0);
}

/** Compare only the affected fields: postgres may legitimately normalize
 * derived stats in the rest of game_state when saving. */
function equals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => equals(value, b[index]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(right, key)
      && equals(left[key], right[key]));
}

/**
 * Apply a Cave belt refill ONLY after the receipt adapter has already adopted
 * a terminal server settlement for this very session. The operation performs
 * no award, only a conserved inventory->belt move. It never retries a write
 * with uncertain delivery and never clears a global combat save fence.
 *
 * A durable per-session marker blocks repeated terminal replay within this
 * Telegram WebView. Cross-device saves remain protected by player-row CAS.
 */
export function persistCaveVipBeltAfterSettlement(
  userId: string, receipt: TerminalCaveReceipt,
): Promise<boolean> {
  const status = receipt?.state?.status;
  if (!['hero_won', 'enemy_won', 'draw'].includes(status)
    || receipt?.settlement?.outcome !== status) return Promise.resolve(false);
  return persistVipBeltAfterConfirmedReceipt(userId, 'cave', receipt.session_id);
}

/** Call only AFTER secureArenaClaim accepted the authenticated server receipt.
 * The 'already_claimed' replay is a valid receipt, not a second payout. */
export function persistArenaVipBeltAfterClaim(
  userId: string, roomId: string, verifiedWins?: number,
): Promise<boolean> {
  return persistVipBeltAfterConfirmedReceipt(userId, 'arena', roomId, verifiedWins);
}

function persistVipBeltAfterConfirmedReceipt(
  userId: string, source: 'cave' | 'arena', sessionId: string, verifiedWins?: number,
): Promise<boolean> {
  if (!playerIdPattern.test(userId) || !sessionIdPattern.test(sessionId))
    return Promise.resolve(false);
  const key = markerKey(userId, source, sessionId);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const task = (async () => {
    // Temporary VIP must not outlive its server deadline.
    if (currentVip() < 3 || saveBlocked.has(userId) || !validSaveToken(saveTokens.get(userId)))
      return false;
    const before = useGame.get();
    if (!before.autoRefillBelt) return false;
    const wins = verifiedWins !== undefined && Number.isSafeInteger(verifiedWins) && verifiedWins >= 0
      ? verifiedWins : useArena.get().wins;
    const next = refillBeltFromInventory(before, beltContext(before, wins));
    if (next === before) return false;

    // If local storage is disabled or a previous attempt is uncertain, leave
    // existing stock untouched. Never generate a fresh operation on replay.
    try {
      if (window.localStorage.getItem(key) !== null) return false;
      window.localStorage.setItem(key, 'pending');
      if (window.localStorage.getItem(key) !== 'pending') return false;
    } catch { return false; }

    // The CAS save may have committed even when a WebView lost the ACK. Keep
    // 'pending' on every failure and let regular cloud reload reconcile it.
    try {
      if (!await saveCloudSave(userId, next) || useGame.get() !== before) return false;
      if (saveBlocked.has(userId)) return false;
      const revision = saveTokens.get(userId);
      const { data, error } = await supabase.from('players')
        .select('updated_at,game_state,gold,gems').eq('id', userId).maybeSingle();
      const state = data?.game_state as { inventory?: unknown; belt?: unknown; beltRefillChoices?: unknown } | null;
      if (error || !data || !state || !validSaveToken(data.updated_at)
        || revision !== data.updated_at || !equals(state.inventory, next.inventory)
        || !equals(state.belt, next.belt)
        || !equals(state.beltRefillChoices ?? null, next.beltRefillChoices ?? null)
        || data.gold !== next.player.gold || data.gems !== next.player.gems
        || useGame.get() !== before) return false;
      useGame.set(next);
      try { window.localStorage.setItem(key, 'done'); } catch {
        // Keeping 'pending' would also be safe; never replay on a missing ACK.
      }
      return true;
    } catch {
      return false;
    }
  })();
  pending.set(key, task);
  void task.finally(() => { if (pending.get(key) === task) pending.delete(key); });
  return task;
}
