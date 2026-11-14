/** Pure, fail-closed reconciliation of a durable forge operation marker.
 * An authenticated Stage8 inventory response is the sole item-level authority.
 * A failed or never-delivered forge roll does NOT advance the item and must
 * keep its operation UUID for safe idempotent replay.
 */
export type PendingForgeMarker = { itemId: string; level: number; operationId: string };
export type ServerOwnedForgeItem = { itemId: string; output: Record<string, unknown> };

export function isPreviouslyCommittedStage8Upgrade(
  pending: PendingForgeMarker,
  owned: readonly ServerOwnedForgeItem[],
): boolean {
  if (!Number.isSafeInteger(pending.level) || pending.level < 1 || pending.level >= 500
    || !/^stage8_[0-9a-f-]{36}$/i.test(pending.itemId)) return false;
  const match = owned.find((item) => `stage8_${item.itemId}`.toLowerCase() === pending.itemId.toLowerCase());
  if (!match || !match.output || typeof match.output !== 'object') return false;
  const equipment = match.output.equipment;
  if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) return false;
  const serverLevel = (equipment as Record<string, unknown>).level;
  // The only conclusive proof of a stale *successful* operation is that the
  // authoritative item registry already passed its expected level.
  return typeof serverLevel === 'number' && Number.isSafeInteger(serverLevel)
    && serverLevel > pending.level && serverLevel <= 500;
}
