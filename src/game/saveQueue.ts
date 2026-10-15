/**
 * Serializes writes from a single game session.
 * A slow earlier network request must never overwrite a later autosave.
 * This is NOT a security boundary: multi-device CAS and server-side validation
 * are still required before the economy can be considered secure.
 */
export function createSequentialWriter<T>(write: (snapshot: T) => Promise<boolean>) {
  let tail: Promise<unknown> = Promise.resolve();
  return (snapshot: T): Promise<boolean> => {
    const current = tail.then(() => write(snapshot));
    // A failed save must not permanently block subsequent snapshots.
    tail = current.then(() => undefined, () => undefined);
    return current;
  };
}

/** Serialize writes while keeping only the newest not-yet-sent snapshot.
 * A running save is allowed to finish; updates received during it are merged
 * into a single latest pending save, avoiding a long tail of stale snapshots.
 * Every caller resolves/rejects with the actual request that persisted its
 * snapshot (or a later replacement). This is still client-only protection.
 */
export function createCoalescingWriter<T>(write: (snapshot: T) => Promise<boolean>) {
  type Waiting = { snapshot: T; resolve: (ok: boolean) => void; reject: (error: unknown) => void };
  let pending: Waiting[] = [];
  let busy = false;

  const pump = async () => {
    if (busy || pending.length === 0) return;
    busy = true;
    // Keep the latest state only. Earlier callers in this batch are fulfilled
    // by the newer state, since it contains their superseding snapshot.
    const batch = pending;
    pending = [];
    try {
      const ok = await write(batch[batch.length - 1].snapshot);
      batch.forEach((job) => job.resolve(ok));
    } catch (error) {
      batch.forEach((job) => job.reject(error));
    } finally {
      busy = false;
      if (pending.length) void pump();
    }
  };
  return (snapshot: T): Promise<boolean> => new Promise((resolve, reject) => {
    pending.push({ snapshot, resolve, reject });
    void pump();
  });
}
