/**
 * Device-local storage for the Dark Cave test sandbox (one per device, not an
 * account inventory). Separate key, separate from the game save: clearing it can never affect a player's real progress.
 */
import { useSyncExternalStore } from 'react';
import { applyCaveAction, decodeSandbox, emptySandbox, type CaveAction, type CaveResult, type CaveSandbox } from './sandbox';

const KEY = 'territory_cave_sandbox_v1';
let cache: CaveSandbox | null = null;
const listeners = new Set<() => void>();

function read(): CaveSandbox {
  if (cache) return cache;
  let state = emptySandbox();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = decodeSandbox(JSON.parse(raw));
  } catch {
    // Unreadable storage simply starts an empty sandbox.
  }
  cache = state;
  return state;
}

export function dispatchCave(action: CaveAction, opId: string = crypto.randomUUID()): CaveResult {
  const result = applyCaveAction(read(), action, opId);
  if (result.ok && !result.replay) {
    cache = result.state;
    try {
      localStorage.setItem(KEY, JSON.stringify(result.state));
    } catch {
      // Telegram WebView may deny storage; the sandbox then lives for this visit only.
    }
    listeners.forEach(listener => listener());
  }
  return result;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useCaveSandbox() {
  const state = useSyncExternalStore(subscribe, read);
  return [state, dispatchCave] as const;
}
export type CaveDispatch = ReturnType<typeof useCaveSandbox>[1];
