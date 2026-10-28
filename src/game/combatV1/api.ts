import { supabase } from '../supabase';
import type { CombatCommand } from './service';
import { parseCombatCommand } from './service';

/** Integration API for ChatGPT's existing screens. Never mutates GameState. */
const key = 'territory_v1_pending_combat';
let pending = false;

export async function pendingCombatCommand(): Promise<CombatCommand | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('combat_auth_required');
  if (typeof localStorage === 'undefined') throw new Error('combat_storage_unavailable');
  const raw = localStorage.getItem(key + ':' + user.id);
  if (!raw) return null;
  return parseCombatCommand(JSON.parse(raw));
}

/** Caller reuses the exact operationId after timeout/reopen, never grants a reward. */
export async function requestCombat(command: CombatCommand): Promise<Record<string, unknown>> {
  if (pending) throw new Error('combat_request_pending');
  const checked = parseCombatCommand(command);
  pending = true;
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('combat_auth_required');
    const storageKey = key + ':' + user.id;
    if (checked.action !== 'resume') {
      if (typeof localStorage === 'undefined') throw new Error('combat_storage_unavailable');
      const unresolved = localStorage.getItem(storageKey);
      if (unresolved && JSON.stringify(parseCombatCommand(JSON.parse(unresolved))) !== JSON.stringify(checked))
        throw new Error('combat_retry_pending_operation');
      localStorage.setItem(storageKey, JSON.stringify(checked));
    }
    const { data, error } = await supabase.functions.invoke('territory-combat', { body: checked });
    if (error && checked.action !== 'resume') {
      // A structured rejection from this service confirms no mutation for this
      // command. Unknown transport/HTTP outcomes remain durable for replay.
      const response = 'context' in error ? error.context : null;
      if (response instanceof Response && response.status === 409) {
        const rejected = await response.clone().json().catch(() => null);
        if (typeof rejected?.error === 'string' && /^combat_[a-z_]+$/.test(rejected.error)) {
          localStorage.removeItem(storageKey);
          throw new Error(rejected.error);
        }
      }
    }
    // Unknown network outcomes keep the durable command for exact replay.
    if (error || !data || data.success !== true) throw new Error(data?.error || 'combat_request_unavailable');
    if (checked.action !== 'resume') localStorage.removeItem(storageKey);
    return data;
  } finally { pending = false; }
}
