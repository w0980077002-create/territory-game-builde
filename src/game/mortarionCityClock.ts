/** Server-anchored clock for the five-day Mortarion raid. The device wall clock
 * must never extend or restart a global event. */
export function mortarionCityTimeRemaining(endsAt: string, serverNow: string, receivedAt: number, now: number): number | null {
  const end = Date.parse(endsAt);
  const server = Date.parse(serverNow);
  if (!Number.isFinite(end) || !Number.isFinite(server)) return null;
  return Math.max(0, end - server - Math.max(0, now - receivedAt));
}

export function formatMortarionCityCountdown(ms: number, en: boolean): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return `${days}${en ? 'd' : 'д'} ${two(hours)}:${two(minutes)}:${two(secs)}`;
}
