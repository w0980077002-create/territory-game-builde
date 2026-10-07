import { supabase, isSupabaseConfigured } from './supabase';
import { useGame, recordBattleResult } from './actions';
import { generateChapter, generateTrial } from './engine';
import { blessedGold, consumeBlessing, recordTrialWin, trialReward } from './progression';
import type { Enemy, GameState, InventoryItem } from './types';

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

type LocalBattle = { enemy: Enemy; kind: 'stage' | 'trial' };
const localBattles = new Map<string, LocalBattle>();

function enemyForLocal(enemyId: string, kind: 'stage' | 'trial'): Enemy | null {
  if (kind === 'trial') {
    const state = useGame.get();
    const enemy = generateTrial(state.trialLevel);
    return enemy.id === enemyId ? enemy : { ...enemy, id: enemyId };
  }
  const chapter = generateChapter(useGame.get().currentChapter);
  return chapter.enemies.find((e) => e.id === enemyId) ?? (chapter.boss.id === enemyId ? chapter.boss : null);
}

export async function beginPveBattle(enemyId: string, kind: 'stage' | 'trial'): Promise<BeginPveBattleResult> {
  const battleId = crypto.randomUUID();

  if (!isSupabaseConfigured) {
    const enemy = enemyForLocal(enemyId, kind);
    if (!enemy) throw new Error('Не удалось подготовить бой');
    const stones = useGame.get().battleStones;
    if (stones < 1) throw new Error('Нет боевых камней');
    localBattles.set(battleId, { enemy, kind });
    return { battleId, battleStones: stones - 1 };
  }

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
    if (!battle) throw new Error('Срок боя истёк. Начни новый бой.');
    localBattles.delete(battleId);

    const state = useGame.get();
    if (battle.kind === 'trial') {
      const reward = trialReward(state.trialLevel);
      const gameState = recordTrialWin(state, battle.enemy);
      return {
        gameState,
        gold: reward.gold ?? 0,
        xp: battle.enemy.rewardXp,
        gems: reward.gems ?? 0,
        forgeMaterials: 1,
        loot: null,
      };
    }

    const gold = blessedGold(state, battle.enemy.rewardGold);
    const gameState = recordBattleResult(
      consumeBlessing(state),
      battle.enemy,
      { gold, xp: battle.enemy.rewardXp, loot: battle.enemy.rewardLoot },
    );
    return {
      gameState,
      gold,
      xp: battle.enemy.rewardXp,
      gems: 0,
      forgeMaterials: gameState.forgeMaterials - state.forgeMaterials,
      loot: battle.enemy.rewardLoot ?? null,
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
