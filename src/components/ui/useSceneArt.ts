import { useEffect, useState } from 'react';

type SceneArtStatus = 'loading' | 'ready' | 'error';

/**
 * Wait for original artwork to DOWNLOAD and DECODE before revealing a composed
 * game scene. No replacement assets, no changes to game or server state.
 *
 * Call with a stable array declared outside the component.
 */
export function useSceneArt(assets: readonly string[]) {
  const [status, setStatus] = useState<SceneArtStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');

    const load = (path: string): Promise<boolean> => new Promise(resolve => {
      const image = new Image();
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        image.onload = null;
        image.onerror = null;
        resolve(ok);
      };
      image.onerror = () => finish(false);
      image.onload = () => {
        if (typeof image.decode === 'function') {
          void image.decode().then(() => finish(true), () => finish(true));
        } else finish(true);
      };
      image.src = import.meta.env.BASE_URL + path.replace(/^\/+/, '');
      // Cached images may be complete before their load event is dispatched.
      if (image.complete) {
        if (image.naturalWidth > 0) image.onload?.(new Event('load'));
        else finish(false);
      }
    });

    void Promise.all(assets.map(load)).then(results => {
      if (active) setStatus(results.every(Boolean) ? 'ready' : 'error');
    });
    return () => { active = false; };
  }, [assets, attempt]);

  return { status, retry: () => setAttempt(current => current + 1) };
}
