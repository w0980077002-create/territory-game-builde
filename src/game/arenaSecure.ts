import { supabase } from './supabase';
import { useGame } from './actions';
import { acceptMonopolyClaimReceipt, protectFortuneSave, releaseArenaRejectedAction, saveBlocked, saveCloudSave, saveTokens } from './cloud';
import type { ArenaMode, ArenaReward } from './arenaApi';
import type { ArenaItemCode } from './belt';

interface ArenaSecureReceipt {
  success: boolean;
  already_claimed?: boolean;
  room_id?: string;
  joined_new?: boolean;
  updated_at: string;
  game_state: unknown;
  wallet_gold: number;
  wallet_gems: number;
  reward?: ArenaReward;
}

let pending: Promise<unknown> | null = null;

/** All balance-affecting Arena RPCs share the production CAS save protocol.
 * Flush one current snapshot, apply one verified server transaction, then
 * install the exact server revision. No local second debit or payout. */
async function transact(args: {
  p_action: 'join' | 'item' | 'claim';
  p_mode?: ArenaMode;
  p_room?: string;
  p_slot?: number;
  p_kind?: ArenaItemCode | 'time' | 'adrenaline';
  p_target?: string;
}): Promise<ArenaSecureReceipt> {
  if (pending) throw new Error('Дождись завершения предыдущего действия');
  const task = (async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    const id = auth?.user?.id;
    if (authError || !id) throw new Error('Проверь подключение к Telegram');
    const snapshot = useGame.get();
    if (!await saveCloudSave(id, snapshot) || useGame.get() !== snapshot)
      throw new Error('Сохранение изменилось. Повтори действие.');
    const expected = saveTokens.get(id);
    if (!expected || saveBlocked.has(id)) throw new Error('Перезайди в игру для синхронизации');
    // When an RPC times out after it has committed, never retry from a stale
    // local state: block any queued write until the player reloads.
    protectFortuneSave(id);
    const { data, error } = await supabase.rpc('arena_secure_v1', {
      ...args, p_expected: expected,
    });
    if (error) {
      // A PostgreSQL RAISE EXCEPTION (P0001) guarantees a rolled-back
      // transaction. An HTTP/network failure does not: keep saves frozen then.
      if (error.code === 'P0001') releaseArenaRejectedAction(id);
      throw new Error(error.message || 'Не удалось подтвердить действие на сервере');
    }
    const receipt = data as ArenaSecureReceipt;
    if (!receipt?.success || !receipt.updated_at || !receipt.game_state)
      throw new Error('Не удалось проверить ответ арены');
    const next = acceptMonopolyClaimReceipt(id, receipt);
    if (useGame.get() !== snapshot) {
      // Server mutation already happened; never overwrite it with an older snapshot.
      useGame.set(next);
      throw new Error('Состояние обновлено сервером. Повтори действие.');
    }
    useGame.set(next);
    return receipt;
  })();
  pending = task;
  try {
    return await task;
  } finally {
    pending = null;
  }
}

export async function secureArenaJoin(mode: ArenaMode): Promise<string> {
  const receipt = await transact({ p_action: 'join', p_mode: mode });
  if (!receipt.room_id) throw new Error('Не удалось получить комнату арены');
  return receipt.room_id;
}

export async function secureArenaItem(
  room: string, slot: number, kind: ArenaItemCode | 'time' | 'adrenaline', target?: string,
): Promise<void> {
  await transact({
    p_action: 'item', p_room: room, p_slot: slot, p_kind: kind,
    ...(target ? { p_target: target } : {}),
  });
}

export async function secureArenaClaim(room: string): Promise<{
  reward: ArenaReward | null;
  alreadyClaimed: boolean;
}> {
  const receipt = await transact({ p_action: 'claim', p_room: room });
  return {
    reward: receipt.already_claimed ? null : receipt.reward ?? null,
    alreadyClaimed: receipt.already_claimed === true,
  };
}
