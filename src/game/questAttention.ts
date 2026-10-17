import type { GameState, Quest } from './types';
import type { SocialStatus } from './socialQuests';

export interface QuestAlerts {
  count: number;
  newCount: number;
  readyCount: number;
}

const STORAGE_PREFIX = 'territory:quest-alerts-seen:v1:';

function key(q: Quest, game: GameState): string {
  if (q.type === 'daily') return `daily:${game.dailyResetDay}:${q.id}`;
  if (q.type === 'weekly') return `weekly:${game.weeklyResetWeek ?? ''}:${q.id}`;
  return `story:${q.id}`;
}

/** All unfinished tasks that can be shown in the quest journal (not achievements). */
export function availableQuestKeys(game: GameState, social: SocialStatus | null): string[] {
  const regular = game.quests.filter((q) => !q.claimed).map((q) => key(q, game));
  if (social) {
    if (!social.chat) regular.push('social:chat');
    if (!social.news) regular.push('social:news');
  }
  return regular;
}

/** Red notification: unseen task, or ANY completed-but-unclaimed regular quest. */
export function getQuestAlerts(game: GameState, social: SocialStatus | null, seen: readonly string[]): QuestAlerts {
  const known = new Set(seen);
  let count = 0, newCount = 0, readyCount = 0;
  for (const q of game.quests) {
    if (q.claimed) continue;
    if (q.current >= q.target) { readyCount++; count++; }
    else if (!known.has(key(q, game))) { newCount++; count++; }
  }
  if (social) {
    for (const task of ['chat', 'news'] as const) {
      if (!social[task] && !known.has('social:' + task)) { newCount++; count++; }
    }
  }
  return { count, newCount, readyCount };
}

export function readSeenQuests(userId: string): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + userId) ?? '[]');
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').slice(-64) : [];
  } catch { return []; }
}

export function rememberSeenQuests(userId: string, game: GameState, social: SocialStatus | null): string[] {
  const seen = availableQuestKeys(game, social);
  try { window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(seen)); } catch { /* optional UI preference */ }
  return seen;
}
