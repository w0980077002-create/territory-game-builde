import type { GameState } from './types';
import { grantRewards, updateProgress } from './actions';
import type { Enemy } from './types';

export const dayKey = (now = Date.now()) => new Date(now).toDateString();

export interface Reward {
  gold?: number;
  gems?: number;
  redGems?: number;
  stones?: number;
}

export function applyReward(state: GameState, r: Reward): GameState {
  return {
    ...state,
    battleStones: state.battleStones + (r.stones ?? 0),
    player: {
      ...state.player,
      gold: state.player.gold + (r.gold ?? 0),
      gems: state.player.gems + (r.gems ?? 0),
      redGems: state.player.redGems + (r.redGems ?? 0),
    },
  };
}

export const DAILY_REWARDS: Reward[] = [
  { gold: 150, stones: 2 },
  { gold: 250, stones: 2 },
  { gems: 5, stones: 3 },
  { gold: 400, stones: 3 },
  { gems: 8, stones: 3 },
  { gold: 600, stones: 4 },
  { gems: 15, stones: 5, redGems: 1 },
];

export function dailyStatus(state: GameState, now = Date.now()) {
  const today = dayKey(now);
  const yesterday = dayKey(now - 86400000);
  const { streak, lastDay } = state.dailyReward;
  const claimedToday = lastDay === today;
  const continues = lastDay === yesterday;
  const nextIndex = claimedToday ? (streak - 1) % 7 : continues ? streak % 7 : 0;
  return { claimedToday, dayIndex: nextIndex };
}

export function claimDaily(state: GameState, now = Date.now()): GameState | null {
  const { claimedToday, dayIndex } = dailyStatus(state, now);
  if (claimedToday) return null;
  const yesterday = dayKey(now - 86400000);
  const streak = state.dailyReward.lastDay === yesterday ? state.dailyReward.streak + 1 : 1;
  return {
    ...applyReward(state, DAILY_REWARDS[dayIndex]),
    dailyReward: { streak, lastDay: dayKey(now) },
  };
}

export interface Letter {
  id: string;
  from: string;
  title: string;
  body: string;
  reward: Reward;
}

export const MAIL: Letter[] = [
  {
    id: 'welcome',
    from: 'Совет ярлов',
    title: 'Добро пожаловать в Territory',
    body: 'Земли ждут нового героя. Проходи главы похода, сражайся на арене и собирай снаряжение. Прими подарок на первые шаги.',
    reward: { gold: 300, gems: 10, stones: 5 },
  },
  {
    id: 'stones_intro',
    from: 'Хранитель камней',
    title: 'Боевые камни',
    body: 'Каждый бой в походе и в Испытаниях стоит 1 боевой камень. Камни не восстанавливаются сами: получай их за ежедневную награду, задания и в Лавке.',
    reward: { stones: 3 },
  },
];

export function claimMail(state: GameState, id: string): GameState | null {
  const letter = MAIL.find((l) => l.id === id);
  if (!letter || state.mailClaimed.includes(id)) return null;
  return { ...applyReward(state, letter.reward), mailClaimed: [...state.mailClaimed, id] };
}

export const BLESSING_CHARGES = 3;
export const BLESSING_BONUS = 0.5;

export const blessingReady = (state: GameState, now = Date.now()) => state.blessing.day !== dayKey(now);

export function claimBlessing(state: GameState, now = Date.now()): GameState | null {
  if (!blessingReady(state, now)) return null;
  return { ...state, blessing: { day: dayKey(now), charges: BLESSING_CHARGES } };
}

export function blessedGold(state: GameState, gold: number) {
  return state.blessing.charges > 0 ? Math.round(gold * (1 + BLESSING_BONUS)) : gold;
}

export function consumeBlessing(state: GameState): GameState {
  if (state.blessing.charges <= 0) return state;
  return { ...state, blessing: { ...state.blessing, charges: state.blessing.charges - 1 } };
}

export function spendStones(state: GameState, amount: number): GameState | null {
  if (state.battleStones < amount) return null;
  return { ...state, battleStones: state.battleStones - amount };
}

export function trialReward(level: number): Reward {
  return { gold: 40 + level * 12, gems: level % 5 === 0 ? 5 : 1 };
}

export function recordTrialWin(state: GameState, enemy: Enemy): GameState {
  const r = trialReward(state.trialLevel);
  let next = grantRewards(applyReward(state, { gems: r.gems }), r.gold ?? 0, enemy.rewardXp);
  next = { ...next, trialLevel: next.trialLevel + 1, forgeMaterials: next.forgeMaterials + 1 };
  return updateProgress(next, 'battle_win', 1);
}

