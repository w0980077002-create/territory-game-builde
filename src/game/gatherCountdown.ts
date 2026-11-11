/** Read-only countdown from the server's gathering finish timestamp.
 * Never authorize a claim or change a wallet based on this display value. */
export function gatherTimeLabel(
  finishesAt: string, serverOffsetMs: number, nowMs: number,
  language: 'ru' | 'en', compact = false,
): string | null {
  const finish = Date.parse(finishesAt);
  if (!Number.isFinite(finish) || !Number.isFinite(serverOffsetMs) || !Number.isFinite(nowMs)) return null;
  const left = Math.max(0, Math.ceil((finish - (nowMs + serverOffsetMs)) / 1000));
  if (left === 0) return language === 'en' ? 'Ready' : 'Готово';
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  if (compact) {
    if (hours > 0) return language === 'en' ? `${hours}h ${minutes}m` : `${hours}ч ${minutes}м`;
    return language === 'en' ? `${minutes}m ${seconds}s` : `${minutes}м ${seconds}с`;
  }
  return [hours,minutes,seconds].map(v => String(v).padStart(2,'0')).join(':');
}
