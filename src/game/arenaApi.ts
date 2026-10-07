import { supabase } from './supabase';
import type { ArenaItemCode } from './belt';

export type ArenaMode = 'duel' | 'team' | 'chaos';
export type Zone = 'head' | 'chest' | 'belly' | 'legs';

export const ZONES: { id: Zone; label: string; mult: number }[] = [
  { id: 'head', label: 'Голова', mult: 1.25 },
  { id: 'chest', label: 'Грудь', mult: 1 },
  { id: 'belly', label: 'Живот', mult: 1 },
  { id: 'legs', label: 'Ноги', mult: 0.85 },
];

export const TEAM_NAMES: Record<number, string> = { 1: 'Волки', 2: 'Вороны' };

export interface ArenaFighter {
  id: string;
  name: string;
  level: number;
  rating: number;
  hp: number;
  maxHp: number;
  team: number | null;
  kills: number;
  damage: number;
  left: boolean;
  moved: boolean;
}

export interface ArenaMessage {
  id: number;
  kind: 'system' | 'join' | 'leave' | 'hit' | 'crit' | 'block' | 'dodge' | 'kill' | 'timeout' | 'item' | 'revive' | 'chat';
  author: string | null;
  body: string;
  at: number;
}

export interface ArenaView {
  now: number;
  room: {
    id: string;
    mode: ArenaMode;
    status: 'waiting' | 'active' | 'finished';
    round: number;
    timeout: number;
    deadline: number | null;
    startsAt: number;
    winnerTeam: number | null;
  };
  me: {
    id: string;
    team: number | null;
    rewarded: boolean;
    revivesUsed: number;
    ratingChange: number | null;
    moved: boolean;
    auto: boolean;
    vip: number;
    autoMinVip: number;
  };
  participants: ArenaFighter[];
  messages: ArenaMessage[];
}

export interface ArenaReward {
  won: boolean;
  draw: boolean;
  gold: number;
  xp: number;
  kills: number;
  ratingChange: number;
  rating: number;
  wins: number;
  losses: number;
}

const ERRORS: Record<string, string> = {
  not_active: 'Бой уже не идёт',
  not_member: 'Ты не участвуешь в этом бою',
  dead: 'Павшие не могут действовать',
  invalid_zones: 'Выбери 1 зону удара и 2 разные зоны защиты',
  invalid_target: 'Эта цель недоступна',
  already_moved: 'Ход в этом раунде уже сделан',
  too_fast: 'Не так быстро',
  min_timeout: 'Тайм уже минимальный — 30 сек.',
  revive_limit: 'Адреналин можно использовать не больше 3 раз за бой',
  no_player: 'Профиль героя не найден',
  vip_required: 'Автобой доступен с VIP 3 уровня',
  item_round: 'Только одно зелье за раунд',
  full_hp: 'Здоровье и так полное',
  buff_active: 'Этот эликсир уже действует в этом бою',
};

function friendly(error: { message?: string } | null): string {
  const code = Object.keys(ERRORS).find((k) => error?.message?.includes(k));
  if (!code) console.error('arena error', error);
  return code ? ERRORS[code] : 'Связь с ареной прервалась. Попробуй ещё раз.';
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendly(error));
  return data as T;
}

export const currentArenaRoom = () => call<string | null>('arena_current_room');
export const joinArena = (mode: ArenaMode) => call<string>('arena_join', { p_mode: mode });
export const leaveArena = (room: string) => call<void>('arena_leave', { p_room: room });
export const sendArenaChat = (room: string, text: string) => call<void>('arena_chat', { p_room: room, p_text: text });
export const applyTimePotion = (room: string) => call<number>('arena_time_potion', { p_room: room });
export const reviveAlly = (room: string, target: string) => call<void>('arena_revive', { p_room: room, p_target: target });
export const setArenaAuto = (room: string, on: boolean) => call<void>('arena_set_auto', { p_room: room, p_on: on });
export const drinkArenaItem = (room: string, kind: ArenaItemCode) => call<void>('arena_use_item', { p_room: room, p_kind: kind });
export const submitArenaMove = (room: string, target: string, attack: Zone, blocks: Zone[]) =>
  call<void>('arena_move', { p_room: room, p_target: target, p_attack: attack, p_blocks: blocks });

export async function fetchArenaView(room: string, after: number): Promise<ArenaView | null> {
  const data = await call<ArenaView | { error: string }>('arena_state', { p_room: room, p_after: after });
  if (!data || 'error' in data) return null;
  return data;
}

export async function claimArenaReward(room: string): Promise<ArenaReward | null> {
  const data = await call<ArenaReward | { error: string }>('arena_claim_reward', { p_room: room });
  if (!data || 'error' in data) return null;
  return data;
}
