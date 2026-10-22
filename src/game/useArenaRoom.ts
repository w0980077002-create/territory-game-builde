import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchArenaView, type ArenaMessage, type ArenaView } from './arenaApi';

const POLL_MS = 2200;
// Only a short on-screen log is needed; old messages are deleted server-side.
const MAX_MESSAGES = 250;

export function useArenaRoom(roomId: string, onGone: () => void) {
  const [view, setView] = useState<ArenaView | null>(null);
  const [messages, setMessages] = useState<ArenaMessage[]>([]);
  const [offline, setOffline] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const lastId = useRef(0);
  const inFlight = useRef(false);
  // The server clock changes every poll, but unchanged fighters must not
  // re-render the full animated battle scene on every network response.
  const lastCombatSignature = useRef('');
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
      const offset = next.now - Date.now();
      setClockOffset((previous) => Math.abs(previous - offset) > 1_000 ? offset : previous);
      const signature = JSON.stringify([next.room, next.me, next.participants]);
      if (signature !== lastCombatSignature.current) {
        lastCombatSignature.current = signature;
        setView(next);
      }
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
