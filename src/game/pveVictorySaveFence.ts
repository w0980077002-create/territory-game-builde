/**
 * Runtime fence for the old Campaign / Trials results.
 *
 * The classic battle is still locally resolved; this is NOT a server combat
 * attestation. It does guarantee that no follow-up classic fight starts after
 * an unacknowledged victory save. The save callback uses the existing
 * player-row CAS writer, and does not grant or calculate any rewards.
 */
export type PveVictorySaveState = 'pending' | 'confirmed' | 'failed';

type Fence = {
  state: PveVictorySaveState;
  promise: Promise<boolean>;
};
const pendingByPlayer = new Map<string, Fence>();

export function pveVictorySaveBlocked(playerId: string): boolean {
  const record = pendingByPlayer.get(playerId);
  return !!record && record.state !== 'confirmed';
}

export function pveVictorySaveState(playerId: string): PveVictorySaveState | null {
  return pendingByPlayer.get(playerId)?.state ?? null;
}

/** Exactly one concurrent save for a given hero. On failure the fence stays
 * closed until a retry receives a real database acknowledgement; a second
 * attempt never replays the battle or the local reward calculation.
 */
export function confirmPveVictorySave(
  playerId: string,
  persistSnapshot: () => Promise<boolean>,
): Promise<boolean> {
  if (!playerId.trim()) return Promise.resolve(false);
  const current = pendingByPlayer.get(playerId);
  if (current?.state === 'pending') return current.promise;

  const next: Fence = { state: 'pending', promise: Promise.resolve(false) };
  pendingByPlayer.set(playerId, next);
  next.promise = Promise.resolve()
    .then(persistSnapshot)
    .then(saved => {
      const confirmed = saved === true;
      if (pendingByPlayer.get(playerId) === next) next.state = confirmed ? 'confirmed' : 'failed';
      return confirmed;
    })
    .catch(() => {
      if (pendingByPlayer.get(playerId) === next) next.state = 'failed';
      return false;
    });
  return next.promise;
}
