import { supabase } from './supabase';
import { getSaveToken, adoptServerWallet, unblockSave } from './cloudInt';
import { validEconomySnapshot } from './economyInvariant';
import type { GameState } from './types';

export const CLAN_CREATION_RED_GEMS_COST = 30;


export interface ClanSummary {
  id: string;
  name: string;
  tag: string;
  emblem: number;
  color1: string;
  color2: string;
  level: number;
  rating: number;
  season_medal: number;
  join_mode: 'open' | 'apply' | 'closed';
  min_level: number;
  description: string;
  members: number;
  capacity: number;
  online?: number;
}

export interface ClanDirectory {
  my_clan_id: string | null;
  my_invites: { id: number; clan_id: string; name: string; tag: string; emblem: number; color1: string; color2: string; members: number }[];
  my_applications: string[];
  clans: ClanSummary[];
}

export interface ClanState {
  clan: {
    id: string; name: string; tag: string; emblem: number; color1: string; color2: string;
    description: string; join_mode: string; min_level: number; level: number;
    xp: number; xp_needed: number; rating: number; season_medal: number;
    treasury_gold: number; treasury_points: number; leader_id: string; members: number; capacity: number;
  };
  my_role: 'leader' | 'deputy' | 'officer' | 'veteran' | 'member';
  members: { player_id: string; display_name: string; role: string; level: number; power: number; contributed_gold: number; contributed_points: number; online: boolean }[];
  buildings: Record<string, { lvl: number }>;
  events: { id: number; kind: string; body: string; created_at: string }[];
  chat: { id: number; author_id: string | null; author_name: string; author_role: string; kind: string; body: string; created_at: string }[];
  boss: { boss_no: number; hp: number; max_hp: number; expires_at: string } | null;
  my_boss_damage: number;
  boss_attacks_left: number;
  boss_claimed: boolean;
  quests: { id: string; progress: number; target: number; claimed: boolean }[];
  treasury_log: { id: number; kind: string; gold: number; points: number; note: string; created_at: string }[];
  war: { id: number; score_a: number; score_b: number; ends_at: string; my_side: 'a' | 'b'; enemy_name: string; enemy_tag: string } | null;
  my_war_strikes_today: number;
  season: { started_at: string; ends_at: string } | null;
}

/** Receipt from wallet-touching RPCs: new server-verified state. */
export interface WalletReceipt {
  state: GameState;
  updated_at: string;
  gold: number;
  gems: number;
}

function adoptReceipt(userId: string, data: unknown): WalletReceipt {
  if (!data || typeof data !== 'object' || (data as { success?: unknown }).success !== true) {
    throw new Error('clan_invalid_receipt');
  }
  const d = data as { state: GameState; updated_at: string; gold: number; gems: number };
  if (typeof d.updated_at !== 'string' || !Number.isFinite(Date.parse(d.updated_at))) {
    throw new Error('clan_invalid_receipt');
  }
  if (!validEconomySnapshot(d.state) || !Number.isSafeInteger(d.gold) || !Number.isSafeInteger(d.gems)) {
    throw new Error('clan_invalid_receipt');
  }
  adoptServerWallet(userId, d.updated_at, { gold: d.gold, gems: d.gems });
  unblockSave(userId);
  return { state: d.state, updated_at: d.updated_at, gold: d.gold, gems: d.gems };
}

/** Requires a fresh cloud save revision; clan RPCs mutate the wallet server-side. */
function expectedRevision(userId: string): string {
  const revision = getSaveToken(userId);
  if (!revision) throw new Error('clan_reload_save');
  return revision;
}

export async function fetchClanDirectory(query: string): Promise<ClanDirectory> {
  const { data, error } = await supabase.rpc('clan_directory', { p_query: query.slice(0, 40) });
  if (error) throw new Error(error.message);
  return data as ClanDirectory;
}

export async function fetchClanState(clanId: string, userId: string, afterChatId = 0): Promise<ClanState> {
  const { data, error } = await supabase.rpc('clan_state', { p_clan: clanId, p_after: afterChatId });
  if (error) throw new Error(error.message);
  return data as ClanState;
}

export async function fetchClanRankings(): Promise<{ season: { started_at: string; ends_at: string } | null; clans: ClanSummary[]; history: { season: number; rank: number; medal: number; name: string; tag: string; rating: number }[] }> {
  const { data, error } = await supabase.rpc('clan_rankings');
  if (error) throw new Error(error.message);
  return data;
}

export async function createClan(userId: string, input: {
  name: string; tag: string; emblem: number; color1: string; color2: string;
  description: string; joinMode: string; minLevel: number;
}): Promise<WalletReceipt & { clan_id: string }> {
  const revision = expectedRevision(userId);
  const { data, error } = await supabase.rpc('clan_create', {
    p_name: input.name, p_tag: input.tag, p_emblem: input.emblem,
    p_color1: input.color1, p_color2: input.color2, p_description: input.description,
    p_join_mode: input.joinMode, p_min_level: input.minLevel, p_expected: revision,
  });
  if (error) throw new Error(error.message);
  const receipt = adoptReceipt(userId, data);
  return { ...receipt, clan_id: (data as { clan_id: string }).clan_id };
}

export async function contributeClan(userId: string, clanId: string, gold: number, materials: number): Promise<WalletReceipt> {
  const revision = expectedRevision(userId);
  const { data, error } = await supabase.rpc('clan_contribute', {
    p_clan: clanId, p_gold: gold, p_materials: materials, p_expected: revision,
  });
  if (error) throw new Error(error.message);
  return adoptReceipt(userId, data);
}

export async function claimClanBoss(userId: string, clanId: string): Promise<WalletReceipt> {
  const revision = expectedRevision(userId);
  const { data, error } = await supabase.rpc('clan_boss_claim', { p_clan: clanId, p_expected: revision });
  if (error) throw new Error(error.message);
  return adoptReceipt(userId, data);
}

export async function claimClanQuest(userId: string, clanId: string, questId: string): Promise<WalletReceipt> {
  const revision = expectedRevision(userId);
  const { data, error } = await supabase.rpc('clan_quest_claim', { p_clan: clanId, p_quest_id: questId, p_expected: revision });
  if (error) throw new Error(error.message);
  return adoptReceipt(userId, data);
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

type RpcBuilder = { error: { message: string } | null } | PromiseLike<{ error: { message: string } | null }>;

/** Wraps a void RPC; maps DB errors to translated codes. */
async function voidRpc(fn: () => RpcBuilder): Promise<SimpleResult> {
  try {
    const res = await fn();
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'clan_error' };
  }
}

export const clanApply = (clanId: string) => voidRpc(() => supabase.rpc('clan_apply', { p_clan: clanId }));
export const clanCancelApplication = (clanId: string) => voidRpc(() => supabase.rpc('clan_cancel_application', { p_clan: clanId }));
export const clanAcceptInvite = (clanId: string) => voidRpc(() => supabase.rpc('clan_accept_invite', { p_clan: clanId }));
export const clanDeclineInvite = (clanId: string) => voidRpc(() => supabase.rpc('clan_decline_invite', { p_clan: clanId }));
export const clanLeave = () => voidRpc(() => supabase.rpc('clan_leave'));
export const clanKick = (playerId: string) => voidRpc(() => supabase.rpc('clan_kick', { p_player: playerId }));
export const clanSetRole = (playerId: string, role: string) => voidRpc(() => supabase.rpc('clan_set_role', { p_player: playerId, p_role: role }));
export const clanTransfer = (playerId: string) => voidRpc(() => supabase.rpc('clan_transfer', { p_player: playerId }));
export const clanInvitePlayer = (playerId: string) => voidRpc(() => supabase.rpc('clan_invite_player', { p_player: playerId }));
export const clanAcceptApp = (playerId: string) => voidRpc(() => supabase.rpc('clan_accept_app', { p_player: playerId }));
export const clanRejectApp = (playerId: string) => voidRpc(() => supabase.rpc('clan_reject_app', { p_player: playerId }));
export const clanChatSend = (clanId: string, body: string) => voidRpc(() => supabase.rpc('clan_chat_send', { p_clan: clanId, p_body: body }));
export const clanChatMute = (clanId: string, playerId: string, minutes: number) => voidRpc(() => supabase.rpc('clan_chat_mute', { p_clan: clanId, p_player: playerId, p_minutes: minutes }));
export const clanBuildingUpgrade = (clanId: string, key: string) => voidRpc(() => supabase.rpc('clan_building_upgrade', { p_clan: clanId, p_key: key }));
export const clanBuildingCollect = (clanId: string) => voidRpc(() => supabase.rpc('clan_building_collect', { p_clan: clanId }));
export const clanBossAttack = (clanId: string) => voidRpc(() => supabase.rpc('clan_boss_attack', { p_clan: clanId }));
export const clanBossSync = (clanId: string) => voidRpc(() => supabase.rpc('clan_boss_sync', { p_clan: clanId }));
export const clanWarSignup = (clanId: string) => voidRpc(() => supabase.rpc('clan_war_signup', { p_clan: clanId }));
export const clanWarStrike = async (clanId: string): Promise<{ ok: true; score: number } | { ok: false; error: string }> => {
  try {
    const { data, error } = await supabase.rpc('clan_war_strike', { p_clan: clanId });
    if (error) return { ok: false, error: error.message };
    if (!data || typeof data !== 'object') return { ok: false, error: 'clan_error' };
    return { ok: true, score: Number((data as { score?: unknown }).score ?? 0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'clan_error' };
  }
};

export async function clanUpdate(clanId: string, input: {
  description: string; joinMode: string; minLevel: number; emblem: number; color1: string; color2: string;
}): Promise<SimpleResult> {
  return voidRpc(() => supabase.rpc('clan_update', {
    p_clan: clanId, p_description: input.description, p_join_mode: input.joinMode,
    p_min_level: input.minLevel, p_emblem: input.emblem, p_color1: input.color1, p_color2: input.color2,
  }));
}
