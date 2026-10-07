import { supabase } from './supabase';
import type { GameState, InventoryItem } from './types';

export interface BeginPveBattleResult {
  battleId: string;
  battleStones: number;
}

export interface ClaimPveWinResult {
  gameState: GameState;
  gold: number;
  xp: number;
  gems: number;
  forgeMaterials: number;
  loot: InventoryItem | null;
}

export async function beginPveBattle(enemyId: string, kind: 'stage' | 'trial'): Promise<BeginPveBattleResult> {
  const battleId = crypto.randomUUID();
  const { data, error } = await supabase.rpc('begin_pve_battle', {
    p_enemy_id: enemyId,
    p_kind: kind,
    p_battle_id: battleId,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('Сервер не вернул данные боя');

  const result = data as { battle_id?: string; battle_stones?: number; error?: string };
  if (result.error) throw new Error(result.error);
  if (!result.battle_id || typeof result.battle_stones !== 'number') throw new Error('Некорректный ответ начала боя');

  return { battleId: result.battle_id, battleStones: result.battle_stones };
}

export async function claimPveWin(battleId: string): Promise<ClaimPveWinResult> {
  const { data, error } = await supabase.rpc('claim_pve_win', { p_battle_id: battleId });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('Сервер не вернул награду');

  const result = data as {
    error?: string;
    game_state?: GameState;
    gold?: number;
    xp?: number;
    gems?: number;
    forge_materials?: number;
    loot?: InventoryItem | null;
  };
  if (result.error) throw new Error(result.error);
  if (!result.game_state) throw new Error('Сервер не вернул состояние игры');

  return {
    gameState: result.game_state,
    gold: Number(result.gold ?? 0),
    xp: Number(result.xp ?? 0),
    gems: Number(result.gems ?? 0),
    forgeMaterials: Number(result.forge_materials ?? 0),
    loot: result.loot ?? null,
  };
}
