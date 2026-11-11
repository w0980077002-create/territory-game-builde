/**
 * Isolated legendary Goose-Hugger combat sandbox.
 * Do not import useGame, wallet, inventory, Supabase or save helpers here.
 * Owner: goose is a legendary ALL-GAME companion, never a cave enemy.
 * Art is locked to the approved goose-aviator image; this module is not an art substitute.
 */
export type GooseDemoSkill = 'hug' | 'commotion' | 'honk';

export const GOOSE_DEMO_SKILLS: Readonly<Record<GooseDemoSkill, { cooldown: number; labelRu: string; labelEn: string }>> = Object.freeze({
  hug: { cooldown: 8, labelRu: 'Обнимусь!', labelEn: 'Hug!' },
  commotion: { cooldown: 5, labelRu: 'Гусиный переполох', labelEn: 'Goose Commotion' },
  honk: { cooldown: 12, labelRu: 'Победное га-га!', labelEn: 'Victory Honk!' },
});
export const GOOSE_DEMO_ROLE = Object.freeze({
  id: 'follower_goose_hugger_preview',
  nameRu: 'Гусь-Обнимусь',
  nameEn: 'Goose-Hugger',
  rarity: 'legendary',
  mode: 'preview-only',
  activeFollowerSlots: 2,
} as const);

export interface GooseDemoState {
  time: number;
  heroHp: number;
  enemyHp: number;
  heroMaxHp: number;
  enemyMaxHp: number;
  shield: number;
  shieldUntil: number;
  honkUntil: number;
  nextEnemyAttack: number;
  auto: boolean;
  casts: Record<GooseDemoSkill, number>;
  nextReady: Record<GooseDemoSkill, number>;
  events: string[];
}

/** Explicitly fake values, never derived from the player's statistics or inventory. */
export function createGooseDemo(): GooseDemoState {
  return {
    time: 0, heroHp: 500, enemyHp: 600, heroMaxHp: 500, enemyMaxHp: 600,
    shield: 0, shieldUntil: 0, honkUntil: 0, nextEnemyAttack: 3, auto: false,
    casts: { hug: 0, commotion: 0, honk: 0 },
    nextReady: { hug: 0, commotion: 0, honk: 0 },
    events: ['Тестовый бой: настоящие ресурсы не используются'],
  };
}

export function useGooseDemoSkill(current: GooseDemoState, skill: GooseDemoSkill): GooseDemoState {
  if (!GOOSE_DEMO_SKILLS[skill] || current.heroHp <= 0 || current.enemyHp <= 0
    || current.time < current.nextReady[skill]) return current;
  if (skill === 'hug' && current.shield > 0 && current.time < current.shieldUntil) return current;
  if (skill === 'honk' && current.time < current.honkUntil) return current;
  const state: GooseDemoState = {
    ...current, casts: { ...current.casts, [skill]: current.casts[skill] + 1 },
    nextReady: { ...current.nextReady, [skill]: current.time + GOOSE_DEMO_SKILLS[skill].cooldown },
    events: [],
  };
  if (skill === 'hug') {
    state.shield = 90;
    state.shieldUntil = state.time + 4;
    state.events = ['🪽 Обнимусь! Гусь защищает героя'];
  }
  if (skill === 'commotion') {
    const hit = state.time < state.honkUntil ? 105 : 70;
    state.enemyHp = Math.max(0, state.enemyHp - hit);
    state.events = ['⚡ Гусиный переполох: −' + hit + ' HP врагу'];
  }
  if (skill === 'honk') {
    state.honkUntil = state.time + 5;
    state.events = ['📣 Га-га! Усиление отряда на 5 секунд'];
  }
  return state;
}

export function setGooseDemoAuto(current: GooseDemoState, auto: boolean): GooseDemoState {
  return { ...current, auto };
}

/** Pure, deterministic step. No network/storage calls or saved progression. */
export function stepGooseDemo(current: GooseDemoState, duration: number): GooseDemoState {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 10
    || current.heroHp <= 0 || current.enemyHp <= 0) return current;
  let state = { ...current, events: [] };
  const end = state.time + duration;
  // Resolve every attack independently, including a long browser frame.
  while (state.nextEnemyAttack <= end && state.heroHp > 0 && state.enemyHp > 0) {
    const strikeAt = state.nextEnemyAttack;
    state.nextEnemyAttack += 3;
    const remaining = strikeAt < state.shieldUntil ? state.shield : 0;
    const absorbed = Math.min(60, remaining);
    state.shield -= absorbed;
    state.heroHp = Math.max(0, state.heroHp - (60 - absorbed));
    state.events.push(absorbed > 0 ? '🛡 Гусь прикрыл героя: ' + absorbed : '💥 Герой получил удар');
  }
  state.time = end;
  if (state.time >= state.shieldUntil) state.shield = 0;
  if (state.auto && state.enemyHp > 0 && state.heroHp > 0) {
    if (state.shield === 0 && state.nextReady.hug <= state.time) state = useGooseDemoSkill(state, 'hug');
    else if (state.honkUntil <= state.time && state.nextReady.honk <= state.time) state = useGooseDemoSkill(state, 'honk');
    else if (state.nextReady.commotion <= state.time) state = useGooseDemoSkill(state, 'commotion');
  }
  return state;
}
