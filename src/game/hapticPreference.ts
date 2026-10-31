/** Device-only comfort preference. Never part of player state or server rewards. */
export const HAPTIC_PREFERENCE_KEY = 'territory_haptic_feedback';
let sessionPreference: boolean | null = null;

export function hapticsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  if (sessionPreference !== null) return sessionPreference;
  try { return window.localStorage.getItem(HAPTIC_PREFERENCE_KEY) !== 'off'; }
  catch { return true; } // Private browsing / restricted WebViews.
}

export function setHapticsEnabled(enabled: boolean): void {
  sessionPreference = enabled; // Even when storage is blocked, the current session obeys the switch.
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(HAPTIC_PREFERENCE_KEY, enabled ? 'on' : 'off'); }
  catch { /* The game and combat remain available without device storage. */ }
}
