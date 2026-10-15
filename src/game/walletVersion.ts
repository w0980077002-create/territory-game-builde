/** Legacy dual-snapshot compare-and-swap guard. 
 * A trusted RPC sometimes updates gems without advancing players.updated_at.
 * This guard detects that divergence before a background save can undo it.
 * It is deliberately NOT a server-side anti-cheat mechanism: attackers can
 * still call the old UPDATE endpoint while its write grants remain active.
 */
export type WalletVersion = { gold: number; gems: number };
const valid = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 2147483647;
export function safeWalletVersion(
  fromDb: { gold?: unknown; gems?: unknown } | null,
  previous: { gold?: unknown; gems?: unknown } | null | undefined,
): WalletVersion {
  const gold = fromDb?.gold ?? previous?.gold;
  const gems = fromDb?.gems ?? previous?.gems;
  if (!valid(gold) || !valid(gems)) throw new Error('invalid_server_wallet');
  return { gold, gems };
}
export function walletMatchesVersion(
  version: WalletVersion, current: { gold: number; gems: number },
): boolean {
  return version.gold === current.gold && version.gems === current.gems;
}
