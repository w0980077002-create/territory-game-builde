import { isSupabaseConfigured, supabase } from './supabase';
import type { GameState, InventoryItem, Enemy } from './types';
import { generateChapter, generateTrial } from './engine';
import { recordBattleResult, useGame } from './actions';
import { recordTrialWin, trialReward } from './progression';
import { PVE_STONE_COST } from './engine';

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

const localBattles = new Map<string, { enemyId: string; kind: 'stage' | 'trial' }>();

function findEnemy(enemyId: string, kind: 'stage' | 'trial', state: GameState): Enemy | null {
  if (kind === 'trial') return generateTrial(state.trialLevel);
  const chapter = generateChapter(state.currentChapter);
  return [...chapter.enemies, chapter.boss].find((e) => e.id === enemyId) ?? null;
}

export async function beginPveBattle(enemyId: string, kind: 'stage' | 'trial'): Promise<BeginPveBattleResult> {
  if (!isSupabaseConfigured) {
    const state = useGame.get();
    if (state.battleStones < PVE_STONE_COST) throw new Error('Нет боевых камней');
    const battleId = crypto.randomUUID();
    localBattles.set(battleId, { enemyId, kind });
    const battleStones = state.battleStones - PVE_STONE_COST;
    useGame.set((s) => ({ ...s, battleStones }));
    return { battleId, battleStones };
  }

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
  if (!isSupabaseConfigured) {
    const battle = localBattles.get(battleId);
    if (!battle) throw new Error('Бой не найден');
    localBattles.delete(battleId);

    const state = useGame.get();
    const enemy = findEnemy(battle.enemyId, battle.kind, state);
    if (!enemy) throw new Error('Враг не найден');

    if (battle.kind === 'trial') {
      const reward = trialReward(state.trialLevel);
      const gameState = recordTrialWin(state, enemy);
      return {
        gameState,
        gold: reward.gold ?? 0,
        xp: enemy.rewardXp,
        gems: reward.gems ?? 0,
        forgeMaterials: gameState.forgeMaterials - state.forgeMaterials,
        loot: null,
      };
    }

    const gameState = recordBattleResult(state, enemy, { gold: enemy.rewardGold, xp: enemy.rewardXp, loot: enemy.rewardLoot });
    return {
      gameState,
      gold: enemy.rewardGold,
      xp: enemy.rewardXp,
      gems: 0,
      forgeMaterials: gameState.forgeMaterials - state.forgeMaterials,
      loot: enemy.rewardLoot ?? null,
    };
  }

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
