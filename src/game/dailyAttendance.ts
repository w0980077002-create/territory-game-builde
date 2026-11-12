import { calendarDayKey, previousCalendarDayKey } from './weeklyQuests';

export type DailyRewardAttendance = {
  streak: number;
  /** Last day the reward was actually collected. Never rewrite this to fake a claim. */
  lastDay: string;
  /** Latest consecutive day when the player was present but did not collect a reward. */
  attendanceGraceDay?: string;
};

/**
 * Missing the CLAIM button must not erase a daily series when the player
 * actually visited the game yesterday. This function changes attendance
 * metadata only: it never awards resources or manufactures a claim receipt.
 *
 * Call BEFORE applyTimeEffects replaces dailyResetDay with today's date.
 */
export function preserveDailyRewardStreakOnAttendance<T extends DailyRewardAttendance>(
  reward: T,
  previousActiveDay: string,
  now = Date.now(),
): T {
  const yesterday = previousCalendarDayKey(now);
  const dayBeforeYesterday = previousCalendarDayKey(Date.parse(`${yesterday}T12:00:00.000Z`));
  const legacyYesterday = new Date(now - 86_400_000).toDateString();
  if (previousActiveDay !== yesterday && previousActiveDay !== legacyYesterday) return reward;
  if (reward.lastDay === yesterday || reward.lastDay === legacyYesterday) return reward;
  if (reward.attendanceGraceDay === yesterday) return reward;

  const lastAttended = reward.attendanceGraceDay ?? reward.lastDay;
  const legacyDayBeforeYesterday = new Date(now - 2 * 86_400_000).toDateString();
  if (lastAttended !== dayBeforeYesterday && lastAttended !== legacyDayBeforeYesterday) return reward;

  return { ...reward, attendanceGraceDay: yesterday };
}

/** Preserves streak for real daily attendance, but never credits unclaimed rewards. */
export function canContinueDailyRewardStreak(reward: DailyRewardAttendance, now = Date.now()): boolean {
  const yesterday = previousCalendarDayKey(now);
  return reward.lastDay === yesterday
    || reward.lastDay === new Date(now - 86_400_000).toDateString()
    || reward.attendanceGraceDay === yesterday;
}

/** The player can collect only once per UTC day, regardless of attendance grace. */
export function collectedDailyRewardToday(reward: DailyRewardAttendance, now = Date.now()): boolean {
  return reward.lastDay === calendarDayKey(now) || reward.lastDay === new Date(now).toDateString();
}
