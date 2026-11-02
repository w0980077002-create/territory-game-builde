import type { PumpkinEntitlement } from './halloweenCompanion2026';

/** Server chooses the deadline delay; local time never grants an entitlement.
 * Timers are bounded on errors, deduplicated, and disposed on account change. */
export function watchPumpkinEntitlement(read: () => Promise<PumpkinEntitlement>, install: () => void,
  win: Window = window, doc: Document = document): () => void {
  let stopped = false, inFlight = false, queued = false, awarded = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelTimer = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
  const schedule = (delay: number) => { cancelTimer(); timer = setTimeout(refresh, delay); };
  const refresh = () => {
    if (stopped || awarded) return;
    if (inFlight) { queued = true; return; }
    cancelTimer(); inFlight = true;
    void read().then(result => {
      if (stopped) return;
      failures = 0;
      if (result.kind === 'eligible') { awarded = true; install(); }
      else if (result.kind === 'event_active') schedule(result.retryAfterMs);
    }).catch(() => {
      if (!stopped && failures < 4) schedule([5000, 30000, 120000, 600000][failures++]);
    }).finally(() => {
      inFlight = false;
      if (queued && !stopped && !awarded) { queued = false; refresh(); }
    });
  };
  const onResume = () => { failures = 0; refresh(); };
  const onVisible = () => { if (doc.visibilityState === 'visible') onResume(); };
  win.addEventListener('online', onResume); win.addEventListener('pageshow', onResume);
  doc.addEventListener('visibilitychange', onVisible);
  refresh();
  return () => { stopped = true; cancelTimer(); win.removeEventListener('online', onResume);
    win.removeEventListener('pageshow', onResume); doc.removeEventListener('visibilitychange', onVisible); };
}
