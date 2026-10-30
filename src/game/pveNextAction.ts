/**
 * A post-battle "Next fight" may wait briefly for a referral receipt.
 * Leaving the battle during that wait must never start another fight or debit
 * a battle stone in an unmounted screen. A rejected referral is non-blocking.
 */
export type DeferredNextResult = 'started' | 'blocked' | 'cancelled';

export async function runDeferredNextBattle(
  referralSettlement: Promise<unknown>,
  isStillInBattle: () => boolean,
  start: () => boolean,
  timeoutMs = 1400,
): Promise<DeferredNextResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      referralSettlement.catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  if (!isStillInBattle()) return 'cancelled';
  return start() ? 'started' : 'blocked';
}
