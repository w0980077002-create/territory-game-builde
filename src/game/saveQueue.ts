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
