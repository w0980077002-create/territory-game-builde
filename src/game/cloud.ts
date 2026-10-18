import { supabase } from './supabase';
import { ensurePlayerSession } from './auth';
import type { GameState } from './types';
import { createInitialGame, getComputedStats } from './engine';
import { EQUIPMENT_BALANCE_VERSION, migrateGameStateBalance } from './equipmentBalance';
import { createCoalescingWriter } from './saveQueue';
import { reconcileFollowers } from './followers';
import { nextSaveTimestamp, validSaveToken } from './saveToken';
import { safeWalletVersion, walletMatchesVersion, type WalletVersion } from './walletVersion';
import { validEconomySnapshot } from './economyInvariant';
import { getPlayableAppearance } from './appearance';

export interface CloudProfile {
  state: GameState;
  arenaRating: number;
  arenaWins: number;
  arenaLosses: number;
  vip: number;
  photoUrl: string | null;
  balanceMigrated?: boolean;
  rosterMigrated?: boolean;
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
    followers: reconcileFollowers(migrated.followers, migrated.player?.level ?? defaults.player.level),
    activeFollowerId: migrated.activeFollowerId ?? null,
    belt: Array.from({ length: 7 }, (_, i) => migrated.belt?.[i] ?? null),
    activeDays: migrated.activeDays ?? 1,
    battleStones: migrated.battleStones ?? defaults.battleStones,
    settings: { ...defaults.settings, ...migrated.settings },
    blessing: migrated.blessing ?? defaults.blessing,
    dailyReward: migrated.dailyReward ?? defaults.dailyReward,
    mailClaimed: migrated.mailClaimed ?? [],
    trialLevel: migrated.trialLevel ?? 1,
    appearance: getPlayableAppearance(migrated.appearance),
    dailyStonesBought: migrated.dailyStonesBought ?? 0,
    dailyStonesDate: migrated.dailyStonesDate ?? defaults.dailyStonesDate,
  };
}

export async function loadCloudSave(userId: string, displayName: string): Promise<CloudProfile> {
  const { data, error } = await supabase
    .from('players')
    .select('game_state, gold, gems, arena_rating, arena_wins, arena_losses, display_name, vip_level, photo_url, updated_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!data) {
    const state = mergeWithDefaults(null, displayName);
    const { data: inserted, error: insertError } = await supabase
      .from('players')
      .insert({ id: userId, display_name: displayName, ...summaryColumns(state) })
      .select('updated_at,gold,gems')
      .single();
    if (insertError || !validSaveToken(inserted?.updated_at)) throw new Error(insertError?.message || 'Missing save revision');
    saveTokens.set(userId, inserted.updated_at);
    walletVersions.set(userId, safeWalletVersion(inserted, state.player));
    saveBlocked.delete(userId);
    return { state, arenaRating: 1000, arenaWins: 0, arenaLosses: 0, vip: 0, photoUrl: null };
  }

  if (!validSaveToken(data.updated_at)) throw new Error('Missing save revision');
  saveTokens.set(userId, data.updated_at);
  walletVersions.set(userId, safeWalletVersion(data, (data.game_state as Partial<GameState> | null)?.player));
  saveBlocked.delete(userId);
  const savedState = data.game_state as Partial<GameState> | null;
  const balanceMigrated = !savedState || (savedState.balanceVersion ?? 0) < EQUIPMENT_BALANCE_VERSION;
  return {
    state: mergeWithDefaults(savedState, data.display_name || displayName),
    balanceMigrated,
    rosterMigrated: !savedState || !savedState.followers?.some((f) => f.id === 'follower_5'),
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

/** Version is anchored to the exact row loaded from Supabase (no schema change).
 * Different devices cannot blindly overwrite a newer server snapshot.
 * This is only a safety net, NOT economic protection from forged API updates.
 */
const saveTokens = new Map<string, string>();
const walletVersions = new Map<string, WalletVersion>();
const saveBlocked = new Set<string>();

export { saveTokens, walletVersions, saveBlocked };

/** One coalescing queue per authenticated player within this browser session. */
const saveWriters = new Map<string, (snapshot: ReturnType<typeof summaryColumns>) => Promise<boolean>>();

export function saveCloudSave(userId: string, state: GameState): Promise<boolean> {
  // The SQL guard rejects malformed/contradictory snapshots. Fail locally first
  // so we never poison a pending save queue with invalid currency values.
  if (!validEconomySnapshot(state)) {
    console.error('Refusing invalid economy snapshot: no cloud write attempted');
    return Promise.resolve(false);
  }
  // Capture an immutable-by-convention snapshot BEFORE the asynchronous queue.
  // Without this, later state mutations can change the contents of a queued save.
  const snapshot = summaryColumns(state);
  let writer = saveWriters.get(userId);
  if (!writer) {
    writer = createCoalescingWriter(async (columns: ReturnType<typeof summaryColumns>) => {
      if (saveBlocked.has(userId)) return false;
      const expected = saveTokens.get(userId);
      const wallet = walletVersions.get(userId);
      if (!validSaveToken(expected) || !wallet) return false;
      // Prevent anonymous 401 writes after iOS Telegram WebView loses the
      // persisted Supabase session; restore only this hero's verified identity.
      if (!await ensurePlayerSession(userId)) {
        console.warn('Save postponed: Telegram session could not be verified');
        return false;
      }
      // Guard server-side currency changes that may not bump updated_at.
      // Example: profession RPC spends gems independently of this browser.
      const { data, error } = await supabase.from('players')
        .update({ ...columns, updated_at: nextSaveTimestamp(expected) })
        .eq('id', userId)
        .eq('updated_at', expected)
        .eq('gold', wallet.gold)
        .eq('gems', wallet.gems)
        .select('updated_at,gold,gems')
        .maybeSingle();
      if (error) {
        console.error('Save failed:', error.message);
        return false;
      }
      if (!validSaveToken(data?.updated_at)) {
        // Another device or a background server operation moved the row.
        // Never overwrite it with a stale snapshot. A blind retry is unsafe.
        saveBlocked.add(userId);
        console.warn('Save conflict: refusing stale snapshot to protect player progress');
        return false;
      }
      const nextWallet = safeWalletVersion(data, columns.game_state.player);
      if (!walletMatchesVersion(nextWallet, columns.game_state.player)) {
        saveBlocked.add(userId);
        console.error('Save acknowledgement differs from submitted wallet; reload required');
        return false;
      }
      walletVersions.set(userId, nextWallet);
      saveTokens.set(userId, data.updated_at);
      return true;
    });
    saveWriters.set(userId, writer);
  }
  return writer(snapshot);
}

/** One verified server-side inventory mutation. Call after awaiting saveCloudSave
 * for the EXACT current state; old snapshots must never resurrect consumed gear. */
export async function recycleCloudEquipment(
  userId: string,
  itemId: string,
  action: 'discard' | 'salvage',
): Promise<{ state: GameState; remainingToday: number; awarded: number }> {
  const revision = saveTokens.get(userId);
  if (!validSaveToken(revision) || saveBlocked.has(userId) || !itemId || itemId.length > 150) {
    throw new Error('recycle_reload_required');
  }
  const { data, error } = await supabase.rpc('territory_inventory_recycle_v1', {
    p_item: itemId, p_action: action, p_expected: revision,
  });
  if (error) throw new Error(error.message || 'recycle_unavailable');
  if (!data || typeof data !== 'object' || data.success !== true
      || data.item_id !== itemId || data.action !== action
      || !validSaveToken(data.updated_at)
      || !Number.isSafeInteger(data.remaining_today)
      || data.remaining_today < 0 || data.remaining_today > 3
      || data.awarded !== (action === 'salvage' ? 1 : 0)
      || !validEconomySnapshot(data.game_state as GameState)) {
    throw new Error('recycle_invalid_receipt');
  }
  const state = data.game_state as GameState;
  if (state.inventory.some((item) => item.id === itemId)) throw new Error('recycle_item_still_present');
  const wallet = safeWalletVersion({ gold: data.gold, gems: data.gems }, state.player);
  if (!walletMatchesVersion(wallet, state.player)) throw new Error('recycle_wallet_mismatch');
  // CAS token must follow the server's atomic update, not a guessed timestamp.
  saveTokens.set(userId, data.updated_at);
  walletVersions.set(userId, wallet);
  saveBlocked.delete(userId);
  return { state, remainingToday: data.remaining_today, awarded: data.awarded };
}

/** Server-only Game Hall payouts. Consume the exact cloud revision before
 * reflecting earned gold in local state, so autosaves never mint hall rewards. */
export async function claimHallGoldCloud(userId: string): Promise<{state:GameState;gold:number}> {
 const expected=saveTokens.get(userId);
 if(!validSaveToken(expected) || saveBlocked.has(userId))throw new Error('hall_reload_required');
 const {data,error}=await supabase.rpc('territory_hall_claim_v1',{p_expected:expected});
 if(error)throw new Error(error.message);
 if(!data || data.success!==true || !validSaveToken(data.updated_at) ||
  !Number.isSafeInteger(data.awarded) || data.awarded<1 ||
  !validEconomySnapshot(data.game_state as GameState))throw new Error('hall_invalid_receipt');
 const state=data.game_state as GameState;
 const wallet=safeWalletVersion({gold:data.wallet_gold,gems:data.wallet_gems},state.player);
 if(!walletMatchesVersion(wallet,state.player))throw new Error('hall_wallet_mismatch');
 saveTokens.set(userId,data.updated_at);
 walletVersions.set(userId,wallet);
 saveBlocked.delete(userId);
 return {state,gold:data.awarded};
}

/** Referral payouts are accepted only as server-verified, revisioned receipts.
 * All shards and sealed chests live in the private server ledger, not a user-editable save. */
export async function claimReferralCloud(userId: string): Promise<{
  state: GameState;
  receipt: {
    gold:number; gems:number; stones:number; materials:number;
    red_gems:number; welcome_elixirs:number; friends_claimed:number;
  };
}> {
 const expected=saveTokens.get(userId);
 if(!validSaveToken(expected) || saveBlocked.has(userId))throw new Error('referral_reload_required');
 const {data,error}=await supabase.rpc('territory_referral_claim_v1',{p_expected:expected});
 if(error) throw new Error(error.message);
 if(!data || typeof data!=='object' || data.success!==true || !validSaveToken(data.updated_at)
   || !validEconomySnapshot(data.game_state as GameState)) throw new Error('referral_invalid_receipt');
 const keys=['gold','gems','stones','materials','red_gems','welcome_elixirs','friends_claimed'] as const;
 for(const key of keys) {
   if(!Number.isSafeInteger(data[key]) || data[key]<0)throw new Error('referral_invalid_award');
 }
 const wallet=safeWalletVersion({gold:data.wallet_gold,gems:data.wallet_gems},(data.game_state as GameState).player);
 if(!walletMatchesVersion(wallet,(data.game_state as GameState).player))throw new Error('referral_wallet_mismatch');
 saveTokens.set(userId,data.updated_at);
 walletVersions.set(userId,wallet);
 saveBlocked.delete(userId);
 return {state:data.game_state as GameState,receipt:{
  gold:data.gold,gems:data.gems,stones:data.stones,materials:data.materials,
  red_gems:data.red_gems,welcome_elixirs:data.welcome_elixirs,friends_claimed:data.friends_claimed
 }};
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

export async function getLeaderboard(limit = 100, orderBy: 'arena_rating' | 'arena_wins' | 'total_battles_won' = 'arena_rating'): Promise<LeaderRow[]> {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('player_id, display_name, level, arena_rating, arena_wins, total_battles_won, photo_url')
    .order(orderBy, { ascending: false })
    .order('arena_rating', { ascending: false })
    .order('player_id', { ascending: true })
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
