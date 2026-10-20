import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchArenaView, type ArenaMessage, type ArenaView } from './arenaApi';

const POLL_MS = 2200;
const MAX_MESSAGES = 500;

export function useArenaRoom(roomId: string, onGone: () => void) {
  const [view, setView] = useState<ArenaView | null>(null);
  const [messages, setMessages] = useState<ArenaMessage[]>([]);
  const [offline, setOffline] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const lastId = useRef(0);
  const inFlight = useRef(false);
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await fetchArenaView(roomId, lastId.current);
      if (!next) {
        onGoneRef.current();
        return;
      }
      setOffline(false);
      setClockOffset(next.now - Date.now());
      setView(next);
      if (next.messages.length) {
        lastId.current = next.messages[next.messages.length - 1].id;
        setMessages((prev) => [...prev, ...next.messages].slice(-MAX_MESSAGES));
      }
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, [roomId]);

  // Keep the 2.2-second refresh for live fights, but slow the waiting / finished
  // room and NEVER poll a hidden Telegram Mini App. This prevents inactive
  // arena sessions from saturating the shared Supabase connection pool.
  const roomStatus = view?.room.status;
  useEffect(() => {
    if (document.visibilityState !== 'hidden') void refresh();
    const intervalMs = roomStatus === 'active' ? POLL_MS : roomStatus === 'finished' ? 4_000 : 2_500;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, intervalMs);
    const resumed = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', resumed);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resumed);
    };
  }, [refresh, roomStatus]);

  return { view, messages, offline, clockOffset, refresh };
}

export function useCountdown(target: number | null, clockOffset: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // The display shows whole seconds: 250ms React updates are wasted work,
    // especially when both arena clocks have no target.
    if (!target) return;
    const tick = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    tick();
    const t = window.setInterval(tick, 1_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [target]);
  if (!target) return 0;
  return Math.max(0, Math.ceil((target - (now + clockOffset)) / 1000));
}
