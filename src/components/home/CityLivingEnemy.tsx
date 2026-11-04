import { useEffect, useState } from 'react';
import { SkeletalFighter } from '@/components/combat2d/SkeletalFighter';
import { getFighterRig, rigAsset } from '@/components/combat2d/fighterRigs';

const RIG_PARTS = ['head', 'torso', 'arm-right', 'arm-left', 'leg-right', 'leg-left', 'weapon', 'shield'] as const;

/** The current enemy remains the actual Campaign target; this is presentation only.
 * Only verified original cutouts may move independently. Every other enemy keeps
 * its original art, name, click target and campaign rules. */
export function CityLivingEnemy({ art, name }: { art: string; name: string }) {
  const rig = getFighterRig(art);
  const [ready, setReady] = useState<{ id: string; ok: boolean } | null>(null);
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const refresh = () => setReduced(media.matches);
    refresh();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', refresh);
      return () => media.removeEventListener('change', refresh);
    }
    if (typeof media.addListener === 'function') {
      media.addListener(refresh);
      return () => media.removeListener?.(refresh);
    }
  }, []);

  useEffect(() => {
    if (!rig || reduced) return;
    let active = true;
    const load = RIG_PARTS.map(part => {
      const image = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Missing enemy cutout: ' + part));
      });
      image.src = rigAsset(rig, part);
      return typeof image.decode === 'function' ? image.decode().catch(() => loaded) : loaded;
    });
    void Promise.all(load).then(
      () => { if (active) setReady({ id: rig.id, ok: true }); },
      () => { if (active) setReady({ id: rig.id, ok: false }); },
    );
    return () => { active = false; };
  }, [rig, reduced]);

  const showRig = !!rig && !reduced && ready?.id === rig.id && ready.ok;
  return <span data-testid="city-living-enemy" className="relative min-h-0 flex-1 w-full max-w-full pointer-events-none" aria-hidden="true">
    {showRig && rig
      ? <span data-testid="city-enemy-joint-rig" className="absolute inset-0">
          <SkeletalFighter rig={rig} name={name} dir={-1} alive strike={null} speed={1}
            className="absolute inset-0 h-full w-full" onAssetError={() => setReady({ id: rig.id, ok: false })} />
        </span>
      : <img src={art} alt="" draggable={false}
          className="city-enemy-idle absolute inset-0 h-full w-full object-contain object-bottom drop-shadow-[0_6px_8px_rgba(0,0,0,0.7)] transition-transform group-active:scale-95" />}
  </span>;
}
