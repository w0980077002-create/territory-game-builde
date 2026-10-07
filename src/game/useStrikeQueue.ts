import { useEffect, useRef, useState } from 'react';
import type { ArenaMessage } from './arenaApi';

export interface StrikeEvent {
  key: number;
  attacker: string;
  target: string;
  tone: 'hit' | 'crit' | 'block' | 'dodge';
  amount: number | null;
}

const STRIKE_MS = 1050;
const MAX_QUEUE = 6;
const PAIR_RE = /^(.+?) → (.+?): /;
const DMG_RE = /−(\d+) \[/;

function toStrike(m: ArenaMessage): StrikeEvent | null {
  if (m.kind !== 'hit' && m.kind !== 'crit' && m.kind !== 'block' && m.kind !== 'dodge') return null;
  const pair = PAIR_RE.exec(m.body);
  if (!pair) return null;
  const dmg = DMG_RE.exec(m.body);
  return { key: m.id, attacker: pair[1], target: pair[2], tone: m.kind, amount: dmg ? Number(dmg[1]) : null };
}

export function useStrikeQueue(messages: ArenaMessage[], ready: boolean, names: string[]): StrikeEvent | null {
  const [queue, setQueue] = useState<StrikeEvent[]>([]);
  const lastSeen = useRef<number | null>(null);
  const watched = names.join('\u0000');

  useEffect(() => {
    if (!ready) return;
    const lastId = messages.length ? messages[messages.length - 1].id : 0;
    if (lastSeen.current === null) {
      lastSeen.current = lastId;
      return;
    }
    const since = lastSeen.current;
    lastSeen.current = Math.max(since, lastId);
    const who = new Set(watched.split('\u0000'));
    const fresh = messages
      .filter((m) => m.id > since)
      .map(toStrike)
      .filter((e): e is StrikeEvent => e !== null && (who.has(e.attacker) || who.has(e.target)));
    if (fresh.length) setQueue((q) => [...q, ...fresh].slice(-MAX_QUEUE));
  }, [messages, ready, watched]);

  const current = queue[0] ?? null;
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), STRIKE_MS);
    return () => clearTimeout(t);
  }, [current]);

  return current;
}
