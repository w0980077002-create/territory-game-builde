import { useEffect, useState } from 'react';
import { supabase } from '@/game/supabase';

// Purely visual reminder: the server remains the authority for claiming rewards.
type GatherStatus = {
  active: { resource_id: string; finishes_at: string } | null;
  server_now: string;
};

const GATHER_CHANGED = 'territory:gather-updated';

export function notifyGatherStatusChanged(): void {
  window.dispatchEvent(new Event(GATHER_CHANGED));
}

export function useGatherReady(enabled: boolean): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let latestRequest = 0;
    let finishTimer: number | undefined;

    const refresh = async () => {
      const request = ++latestRequest;
      try {
        const { data, error } = await supabase.rpc('territory_gather_status');
        if (cancelled || request !== latestRequest || error || !data || typeof data !== 'object') return;
        const status = data as GatherStatus;
        if (finishTimer !== undefined) window.clearTimeout(finishTimer);
        finishTimer = undefined;
        if (!status.active) {
          setReady(false);
          return;
        }
        const finish = Date.parse(status.active.finishes_at);
        const serverNow = Date.parse(status.server_now);
        if (!Number.isFinite(finish) || !Number.isFinite(serverNow)) {
          setReady(false);
          return;
        }
        const remaining = finish - serverNow;
        setReady(remaining <= 0);
        if (remaining > 0) {
          // A local timer updates the badge without constantly contacting the server.
          finishTimer = window.setTimeout(() => {
            if (!cancelled) setReady(true);
          }, Math.min(remaining, 2147483647));
        }
      } catch {
        // Keep the last known state on transient connectivity failures.
      }
    };

    const onResume = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onChanged = () => { void refresh(); };
    void refresh();
    const interval = window.setInterval(onResume, 60000);
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('online', onChanged);
    window.addEventListener(GATHER_CHANGED, onChanged);
    return () => {
      cancelled = true;
      if (finishTimer !== undefined) window.clearTimeout(finishTimer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('online', onChanged);
      window.removeEventListener(GATHER_CHANGED, onChanged);
    };
  }, [enabled]);

  return ready;
}
