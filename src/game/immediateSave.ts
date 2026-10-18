/**
 * Starts saving on every game-state change instead of waiting for a debounce.
 * Exactly one request runs at a time; changes made while it is in flight are
 * followed by a fresh save of the latest state.
 *
 * Never reports "saved" until the server acknowledges the most recent change.
 * A failed request retains the dirty revision and retries with backoff.
 * The cloud writer itself still enforces optimistic locking and wallet checks.
 */
export type ImmediateSaveStatus = 'saved' | 'saving' | 'error';

export function createImmediateSaveController(
  saveLatest: () => Promise<boolean>,
  report: (status: ImmediateSaveStatus) => void,
  schedule: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let revision = 0;
  let savedRevision = 0;
  let busy = false;
  let stopped = false;
  let failed = false;
  let retryDelay = 2000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function clearRetry() {
    if (retryTimer !== null) {
      cancel(retryTimer);
      retryTimer = null;
    }
  }

  function retryLater() {
    if (stopped || retryTimer !== null || revision === savedRevision) return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, 30000);
    retryTimer = schedule(() => {
      retryTimer = null;
      void send();
    }, delay);
  }

  async function send(): Promise<void> {
    if (stopped || busy || savedRevision === revision) return;
    clearRetry();
    busy = true;
    const sentRevision = revision;
    let ok = false;
    try {
      // Capture the newest snapshot only when the network request starts.
      ok = await saveLatest();
    } catch (error) {
      console.error('Cloud autosave failed:', error);
    } finally {
      busy = false;
      if (stopped) return;
      if (ok) {
        savedRevision = sentRevision;
        failed = false;
        retryDelay = 2000;
        if (revision === savedRevision) report('saved');
        else void send();
      } else {
        // In particular, do NOT turn a CAS conflict into a blind overwrite.
        failed = true;
        report('error');
        retryLater();
      }
    }
  }

  return {
    changed() {
      if (stopped) return;
      revision += 1;
      if (!failed) report('saving');
      if (failed) retryLater();
      else void send();
    },
    // On Telegram WebView backgrounding, pagehide, and reconnection.
    flush() {
      if (stopped) return;
      clearRetry();
      void send();
    },
    stop() {
      stopped = true;
      clearRetry();
    },
  };
}
