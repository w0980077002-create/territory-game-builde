import { useSyncExternalStore } from 'react';

type Listener = () => void;

export function create<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    get: () => state,
    set: (updater: Partial<T> | ((prev: T) => T)) => {
      if (typeof updater === 'function') {
        state = (updater as (prev: T) => T)(state);
      } else {
        state = { ...state, ...updater };
      }
      listeners.forEach((l) => l());
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: ReturnType<typeof create<T>>): T {
  return useSyncExternalStore(
    store.subscribe,
    store.get,
    store.get,
  );
}
