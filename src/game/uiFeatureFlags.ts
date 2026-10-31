/**
 * TERRITORY reversible interface switches.
 *
 * Only hides the shortcut in the game's top HUD (City and Arena).
 * The full leaderboard screen, rankings and player progress are untouched.
 *
 * Restore on request: switch this value to true and redeploy the frontend.
 */
export const SHOW_TOP_LEADERBOARD_SHORTCUT = false;

/** Temporarily conceal the separate Kyiv-time championship UX; Arena TOP-50 remains live.
 * This is display-only. Never modify season prizes, server records, or saved wins here.
 * Re-enable by flipping the flag after the server seasons are reconciled.
 */
export const SHOW_WEEKLY_CHAMPIONSHIP = false;
