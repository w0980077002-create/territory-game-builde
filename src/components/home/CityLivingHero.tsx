import { useEffect, useState } from 'react';
import { SkeletalFighter } from '@/components/combat2d/SkeletalFighter';
import { ArticulatedHero, getOriginalArticulatedHero } from '@/components/combat2d/ArticulatedHero';
import { getFighterRig, rigAsset } from '@/components/combat2d/fighterRigs';
import { getAppearanceIcon } from '@/game/appearance';

const RIG_PARTS = ['head', 'torso', 'arm-right', 'arm-left', 'leg-right', 'leg-left', 'weapon', 'shield'] as const;

/**
 * Real joint-based idle motion in the City for existing, hand-approved rigs.
 * Other appearances keep their original sprite, with no character substitution.
 * This component does not trigger fights, strikes, damage, healing or rewards.
 */
export function CityLivingHero({ appearance, name }: { appearance: string; name: string }) {
  const art = getAppearanceIcon(appearance);
  const rig = getFighterRig(art);
  const originalCutout = getOriginalArticulatedHero(art);
  const [ready, setReady] = useState<{ id: string; ok: boolean } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    // Some embedded/older Telegram WebViews do not implement matchMedia at all.
    // Keep their original hero visible while the art rig is being verified.
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    // Older iOS Telegram WebViews expose the legacy MediaQueryList listener API.
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    if (typeof media.addListener === 'function') {
      media.addListener(update);
      return () => media.removeListener?.(update);
    }
  }, []);

  useEffect(() => {
    if (!rig || reducedMotion) return;
    let active = true;
    // Each visible part has its own verified bitmap. Never show a partial rig
    // while a missing cutout is loading or when a character changes appearance.
    const load = RIG_PARTS.map((part) => {
      const image = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Missing city rig asset: ${part}`));
      });
      image.src = rigAsset(rig, part);
      // Some Telegram WebViews lack HTMLImageElement.decode().
      // The load/error handlers are registered before src to avoid cached-image races.
      return typeof image.decode === 'function'
        ? image.decode().catch(() => loaded)
        : loaded;
    });
    void Promise.all(load).then(
      () => { if (active) setReady({ id: rig.id, ok: true }); },
      () => { if (active) setReady({ id: rig.id, ok: false }); },
    );
    return () => { active = false; };
  }, [rig, reducedMotion]);

  // Prefer the existing original 2D art on small/reduced-motion devices.
  const hasRig = !!rig && !reducedMotion && ready?.id === rig.id && ready.ok;
  return (
    <div data-testid="city-living-hero" className="relative h-full w-full flex items-end justify-center pointer-events-none">
      {hasRig && rig ? (
        <div data-testid="city-hero-joint-rig" className="absolute inset-0">
          <SkeletalFighter
            rig={rig}
            name={name}
            dir={1}
            alive
            strike={null}
            speed={1}
            className="absolute inset-0 h-full w-full"
            onAssetError={() => setReady({ id: rig.id, ok: false })}
          />
        </div>
      ) : originalCutout && !reducedMotion ? (
        <span data-testid="city-hero-articulated" className="absolute inset-0">
          <ArticulatedHero kind={originalCutout} art={art} name={name}
            motion="idle" className="absolute inset-0 h-full w-full" />
        </span>
      ) : (
        <img src={art} alt={name}
          className="home-hero-art city-hero-idle relative max-h-full max-w-full object-contain object-bottom"
          draggable={false} />
      )}
    </div>
  );
}
