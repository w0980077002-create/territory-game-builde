import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchArenaView, type ArenaMessage, type ArenaView } from './arenaApi';

const POLL_MS = 1500;
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

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { view, messages, offline, clockOffset, refresh };
}

export function useCountdown(target: number | null, clockOffset: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!target) return 0;
  return Math.max(0, Math.ceil((target - (now + clockOffset)) / 1000));
}
