/**
 * Device-local storage for the Dark Cave test sandbox (one per device, not an
 * account inventory). Separate key, separate from the game save: clearing it can never affect a player's real progress.
 */
import { createContext, useContext, useCallback, useSyncExternalStore } from 'react';
import { applyCaveAction, decodeSandbox, emptySandbox, type CaveAction, type CaveResult, type CaveSandbox } from './sandbox';

const KEY = 'territory_cave_sandbox_v1';
export const CaveSandboxAccount = createContext<string | undefined>(undefined);
const caches = new Map<string, CaveSandbox>();
const listeners = new Set<() => void>();

function read(key = KEY): CaveSandbox {
  const cache = caches.get(key);
  if (cache) return cache;
  let state = emptySandbox();
  try {
    const raw = localStorage.getItem(key);
    if (raw) state = decodeSandbox(JSON.parse(raw));
  } catch {
    // Unreadable storage simply starts an empty sandbox.
  }
  caches.set(key, state);
  return state;
}

export function dispatchCave(action: CaveAction, opId: string = crypto.randomUUID(), key = KEY): CaveResult {
  const result = applyCaveAction(read(key), action, opId);
  if (result.ok && !result.replay) {
    caches.set(key, result.state);
    try {
      localStorage.setItem(key, JSON.stringify(result.state));
    } catch {
      // Telegram WebView may deny storage; the sandbox then lives for this visit only.
    }
    listeners.forEach(listener => listener());
  }
  return result;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useCaveSandbox() {
  const account = useContext(CaveSandboxAccount);
  const key = account ? KEY + ':' + account : KEY;
  const snapshot = useCallback(() => read(key), [key]);
  const dispatch = useCallback((action: CaveAction, opId?: string) => dispatchCave(action, opId, key), [key]);
  const state = useSyncExternalStore(subscribe, snapshot);
  return [state, dispatch] as const;
}
export type CaveDispatch = ReturnType<typeof useCaveSandbox>[1];
