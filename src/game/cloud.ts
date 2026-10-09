import { supabase } from './supabase';
import type { GameState } from './types';
import { createInitialGame, getComputedStats } from './engine';
import { EQUIPMENT_BALANCE_VERSION, migrateGameStateBalance } from './equipmentBalance';

export interface CloudProfile {
  state: GameState;
  arenaRating: number;
  arenaWins: number;
  arenaLosses: number;
  vip: number;
  photoUrl: string | null;
  balanceMigrated?: boolean;
}

function mergeWithDefaults(saved: Partial<GameState> | null, name: string): GameState {
  const defaults = createInitialGame();
  if (!saved) return { ...defaults, player: { ...defaults.player, name } };
  const migrated = migrateGameStateBalance(saved);
  return {
    ...defaults,
    ...migrated,
    player: {
      ...defaults.player,
      ...migrated.player,
      stats: { ...defaults.player.stats, ...migrated.player?.stats },
      equipped: migrated.player?.equipped ?? {},
    },
    quests: migrated.quests?.length ? migrated.quests : defaults.quests,
    achievements: migrated.achievements?.length ? migrated.achievements : defaults.achievements,
    followers: migrated.followers?.length ? migrated.followers : defaults.followers,
    belt: Array.from({ length: 7 }, (_, i) => migrated.belt?.[i] ?? null),
    activeDays: migrated.activeDays ?? 1,
    battleStones: migrated.battleStones ?? defaults.battleStones,
    settings: { ...defaults.settings, ...migrated.settings },
    blessing: migrated.blessing ?? defaults.blessing,
    dailyReward: migrated.dailyReward ?? defaults.dailyReward,
    mailClaimed: migrated.mailClaimed ?? [],
    trialLevel: migrated.trialLevel ?? 1,
    appearance: migrated.appearance === 'm2' ? migrated.appearance : 'm2',
    dailyStonesBought: migrated.dailyStonesBought ?? 0,
    dailyStonesDate: migrated.dailyStonesDate ?? defaults.dailyStonesDate,
  };
}

export async function loadCloudSave(userId: string, displayName: string): Promise<CloudProfile> {
  const { data, error } = await supabase
    .from('players')
    .select('game_state, arena_rating, arena_wins, arena_losses, display_name, vip_level, photo_url')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!data) {
    const state = mergeWithDefaults(null, displayName);
    const { error: insertError } = await supabase
      .from('players')
      .insert({ id: userId, display_name: displayName, ...summaryColumns(state) });
    if (insertError) throw new Error(insertError.message);
    return { state, arenaRating: 1000, arenaWins: 0, arenaLosses: 0, vip: 0, photoUrl: null };
  }

  const savedState = data.game_state as Partial<GameState> | null;
  const balanceMigrated = !savedState || (savedState.balanceVersion ?? 0) < EQUIPMENT_BALANCE_VERSION;
  return {
    state: mergeWithDefaults(savedState, data.display_name || displayName),
    balanceMigrated,
    arenaRating: data.arena_rating,
    arenaWins: data.arena_wins,
    arenaLosses: data.arena_losses,
    vip: data.vip_level ?? 0,
    photoUrl: data.photo_url ?? null,
  };
}

function summaryColumns(state: GameState) {
  const stats = getComputedStats(state);
  return {
    level: state.player.level,
    xp: state.player.xp,
    gold: state.player.gold,
    gems: state.player.gems,
    energy: state.player.energy,
    max_energy: state.player.maxEnergy,
    current_chapter: state.currentChapter,
    chapter_wins: state.chapterWins,
    total_battles_won: state.totalBattlesWon,
    total_bosses_defeated: state.totalBossesDefeated,
    forge_materials: state.forgeMaterials,
    attack: stats.attack,
    defense: stats.defense,
    max_hp: stats.maxHp,
    crit_chance: stats.critChance,
    game_state: state,
    updated_at: new Date().toISOString(),
  };
}

export async function saveCloudSave(userId: string, state: GameState): Promise<boolean> {
  const { error } = await supabase.from('players').update(summaryColumns(state)).eq('id', userId);
  if (error) console.error('Save failed:', error.message);
  return !error;
}

export interface LeaderRow {
  player_id: string;
  display_name: string;
  level: number;
  arena_rating: number;
  arena_wins: number;
  total_battles_won: number;
  photo_url: string | null;
}

export async function getLeaderboard(limit = 100, orderBy: 'arena_rating' | 'total_battles_won' = 'arena_rating'): Promise<LeaderRow[]> {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('player_id, display_name, level, arena_rating, arena_wins, total_battles_won, photo_url')
    .order(orderBy, { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as LeaderRow[];
}

export interface PublicGear {
  slot: string;
  name: string;
  rarity: string;
  level: number;
  attack: number;
  defense: number;
  hp: number;
  critChance: number;
}

export interface PublicProfile {
  id: string;
  name: string;
  photo: string | null;
  level: number;
  vip: number;
  rating: number;
  wins: number;
  losses: number;
  attack: number;
  defense: number;
  maxHp: number;
  critChance: number;
  battlesWon: number;
  bosses: number;
  chapter: number;
  follower: { name: string; level: number } | null;
  equipped: PublicGear[];
}

export async function getPublicProfile(playerId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc('public_player_profile', { p_player: playerId });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || !('id' in data)) return null;
  const p = data as PublicProfile;
  return { ...p, equipped: Array.isArray(p.equipped) ? p.equipped : [] };
}
