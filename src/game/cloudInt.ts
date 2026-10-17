/** Bridge to cloud.ts session-scoped save tokens and wallet versions.
 * Exposes only the operations the clan layer needs: reading the current
 * compare-and-swap revision, adopting a server-verified wallet receipt,
 * and clearing a save block after the server returned fresh state. */
import { saveTokens, walletVersions, saveBlocked } from './cloud';

export function getSaveToken(userId: string): string | undefined {
  return saveTokens.get(userId);
}

export function adoptServerWallet(userId: string, updatedAt: string, wallet: { gold: number; gems: number }): void {
  saveTokens.set(userId, updatedAt);
  walletVersions.set(userId, wallet);
}

export function unblockSave(userId: string): void {
  saveBlocked.delete(userId);
}
