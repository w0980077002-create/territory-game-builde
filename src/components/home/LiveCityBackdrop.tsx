/**
 * Layered scenery, not a video: inexpensive animations on the approved
 * portrait harbour illustration. Stage coordinates match 1024x1536 artwork.
 * UI, hitboxes, save data and fighter positions are deliberately untouched.
 */
export const CITY_MOTION_KEY = 'territory_city_motion';
export const CITY_BACKGROUND_KEY = 'territory_city_background';
export type CityBackground = 'winter' | 'classic' | 'sunlit';

export function initialCityBackground(): CityBackground {
  if (typeof window === 'undefined') return 'winter';
  try {
    // Respect an explicit existing choice. New players get the approved snowy scenery.
    const saved = window.localStorage.getItem(CITY_BACKGROUND_KEY);
    return saved === 'classic' || saved === 'sunlit' ? saved : 'winter';
  } catch { return 'winter'; }
}

export function initialCityMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = window.localStorage.getItem(CITY_MOTION_KEY);
    if (saved === 'off') return false;
    if (saved === 'on') return true;
    // The harbour uses layered gradient, blur and blend animations. On
    // memory-constrained phones the effects can force full-screen repaints.
    // Default those devices to the static (identical artwork) scene; players
    // can still enable all animations explicitly from Settings.
    const device = navigator as Navigator & { deviceMemory?: number };
    const mobile = window.matchMedia('(max-width: 640px)').matches;
    const constrained = mobile && (
      (typeof device.deviceMemory === 'number' && device.deviceMemory <= 4) ||
      (device.deviceMemory === undefined && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
    );
    return !constrained && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const prefix = import.meta.env.BASE_URL + 'assets/territory/scenes/';

export function LiveCityBackdrop({ animated, background = 'winter' }: { animated: boolean; background?: CityBackground }) {
  const isClassic = background === 'classic';
  const isWinter = background === 'winter';
  return (
    <div className="live-city-viewport absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div
        className={`live-city-stage ${isWinter ? 'live-city-stage--winter' : ''} ${isClassic && animated ? 'live-city-running' : ''}`}
        style={{
          // Original 800x1421 winter cliff scene approved for the living City.
          // Preserve the natural portrait aspect and the visible wood/rope/metal ledge.
          // Keep motion effects exclusive to the classic harbour.
          backgroundImage: isWinter
            ? `linear-gradient(180deg, rgba(17,39,66,.06), rgba(12,26,46,.15)), url("${prefix}winter-cliff-approved.webp")`
            : `url("${prefix}${isClassic ? 'live-city-bg.webp' : 'sunlit-harbor.webp'}")`,
          backgroundSize: isWinter ? 'cover, cover' : isClassic ? '100% 100%' : 'cover',
          backgroundPosition: isWinter ? 'center, center 50%' : 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {isClassic && animated && (
          <>
            <span className="live-city-waterfall city-falls-left" />
            <span className="live-city-waterfall city-falls-center" />
            <span className="live-city-waterfall city-falls-right" />
            <span className="live-city-water-sparkles" />
            <img src={prefix + 'live-city-ship.webp'} className="live-city-ship city-ship-near" draggable={false} alt="" />
            <img src={prefix + 'live-city-ship-far.webp'} className="live-city-ship city-ship-far" draggable={false} alt="" />
            <span className="live-city-flame city-fire-left" />
            <span className="live-city-flame city-fire-right" />
            <span className="live-city-banner city-banner-left" />
            <span className="live-city-banner city-banner-center" />
          </>
        )}
      </div>
    </div>
  );
}
