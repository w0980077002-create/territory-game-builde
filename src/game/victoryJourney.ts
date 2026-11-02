import { generateChapter, generateTrial, HERO_MAX_LEVEL } from './engine';
import type { Enemy, GameState } from './types';

export type VictoryJourney = {
  kind: 'stage' | 'trial';
  chapter: number;
  trialLevel: number;
  enemy: Enemy;
  /** Real campaign boss and count of ordinary encounters still required. */
  chapterBoss: Enemy | null;
  fightsUntilBoss: number | null;
  chapterFightsCompleted: number | null;
  chapterFightsTotal: number | null;
  level: number;
  leveledUp: boolean;
  xp: number;
  xpToNext: number;
  xpPercent: number;
  maxLevel: boolean;
};

/**
 * Read-only post-victory progress: use the actual saved hero and the existing
 * PvE catalog. Never synthesize rewards, stages, character levels or currency.
 */
export function getVictoryJourney(
  state: Pick<GameState, 'player' | 'currentChapter' | 'chapterWins' | 'trialLevel'>,
  kind: 'stage' | 'trial',
  levelAtFightStart: number,
): VictoryJourney {
  const chapter = generateChapter(state.currentChapter);
  const enemy = kind === 'trial'
    ? generateTrial(state.trialLevel)
    : state.chapterWins >= chapter.enemies.length
      ? chapter.boss
      : chapter.enemies[Math.max(0, state.chapterWins)];
  // Chapter progress is read from the saved win counter, not inferred from
  // player level, current enemy art or an invented quest/reward track.
  const completed = Math.min(chapter.enemies.length, Math.max(0, state.chapterWins));
  const fightsUntilBoss = Math.max(0, chapter.enemies.length - completed);
  const maxLevel = state.player.level >= HERO_MAX_LEVEL;
  const xpToNext = Math.max(0, state.player.xpToNext);
  const xp = Math.max(0, state.player.xp);
  return {
    kind, chapter: state.currentChapter, trialLevel: state.trialLevel,
    enemy,
    chapterBoss: kind === 'stage' ? chapter.boss : null,
    fightsUntilBoss: kind === 'stage' ? fightsUntilBoss : null,
    chapterFightsCompleted: kind === 'stage' ? completed : null,
    chapterFightsTotal: kind === 'stage' ? chapter.enemies.length : null,
    level: state.player.level,
    leveledUp: state.player.level > levelAtFightStart,
    xp, xpToNext, maxLevel,
    xpPercent: maxLevel ? 100 : Math.round(Math.min(100, 100 * xp / Math.max(1,xpToNext))),
  };
}
