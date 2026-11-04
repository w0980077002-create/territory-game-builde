import { useId, type CSSProperties } from 'react';
import './articulatedHero.css';

export type OriginalArticulatedHero = 'male_rogue' | 'female_warrior' | 'female_archer';
type Part = 'head' | 'weapon' | 'guard' | 'legLeft' | 'legRight';
type Cutout = { points: string; pivot: readonly [number, number] };
type Layout = Readonly<Record<Part, Cutout>>;

/**
 * The actual original 512x512 transparent portraits are the only art source.
 * Per-appearance hand-positioned cutouts retain the exact approved outfit,
 * weapon, face and proportions instead of painting a generic replacement.
 * The original beneath each cutout is masked out: an arm is never duplicated.
 * Presentation only; damage, RNG, loot and PvP remain server/game-authoritative.
 */
const LAYOUTS: Record<OriginalArticulatedHero, Layout> = {
  male_rogue: {
    head: { points: '203,156 240,118 314,110 384,153 394,245 355,313 289,334 219,296', pivot: [291, 235] },
    weapon: { points: '339,270 371,274 400,298 431,288 458,176 482,181 489,218 470,314 466,354 426,386 390,366 346,327', pivot: [371, 275] },
    guard: { points: '29,250 72,227 116,214 172,211 202,267 248,314 249,363 164,394 76,374 28,348', pivot: [151, 239] },
    legLeft: { points: '49,380 116,341 181,355 232,418 193,511 65,511', pivot: [151, 374] },
    legRight: { points: '269,363 345,337 422,384 455,511 293,511', pivot: [352, 376] },
  },
  female_warrior: {
    head: { points: '108,204 158,150 222,130 315,135 337,226 301,309 215,332 135,296', pivot: [240, 241] },
    weapon: { points: '51,115 100,116 115,269 179,257 204,303 167,364 139,398 60,379 51,300', pivot: [160, 270] },
    guard: { points: '308,216 366,217 452,266 475,343 459,429 380,448 310,404 298,309', pivot: [339, 263] },
    legLeft: { points: '89,357 157,346 217,385 218,454 170,511 73,511', pivot: [174, 378] },
    legRight: { points: '272,354 348,352 419,416 420,511 280,511', pivot: [330, 380] },
  },
  female_archer: {
    head: { points: '160,119 227,72 329,70 368,136 346,231 305,273 220,263 156,217', pivot: [296, 198] },
    weapon: { points: '347,161 397,114 444,128 473,219 487,285 456,355 443,405 396,406 355,307', pivot: [366, 244] },
    guard: { points: '129,241 190,225 228,267 223,320 187,356 141,352 121,310', pivot: [196, 250] },
    legLeft: { points: '116,339 202,338 244,393 224,458 188,510 99,510', pivot: [202, 367] },
    legRight: { points: '286,334 352,333 410,404 428,505 299,510', pivot: [349, 368] },
  },
};

export function getOriginalArticulatedHero(idleArt: string): OriginalArticulatedHero | null {
  const match = idleArt.match(/\/characters\/heroes\/(male_rogue|female_warrior|female_archer)\/idle\.webp(?:[?#].*)?$/);
  return match ? match[1] as OriginalArticulatedHero : null;
}

export type ArticulatedMotion = 'idle' | 'attack' | 'block' | 'dodge' | 'hit' | 'victory' | 'death';

/** Arms/legs/head are separate DOM SVG groups and animate at their own pivots.
 * Every active motion comes solely from the caller's confirmed StrikeEvent.
 * CSS handles idle without recurring React state, timers or false attacks.
 */
export function ArticulatedHero({
  kind, art, name, dir = 1, motion = 'idle', speed = 1, className = '', onAssetError,
}: {
  kind: OriginalArticulatedHero;
  art: string;
  name: string;
  dir?: 1 | -1;
  motion?: ArticulatedMotion;
  speed?: number;
  className?: string;
  onAssetError?: () => void;
}) {
  const uid = useId().replace(/:/g, '');
  const parts = Object.entries(LAYOUTS[kind]) as [Part, Cutout][];
  const duration = Number.isFinite(speed) && speed > 0 ? Math.round(810 / speed) : 810;
  const style = { '--articulated-action-ms': duration + 'ms' } as CSSProperties;
  return (
    <svg className={`articulated-hero ${className}`} style={style}
      viewBox="0 0 512 512" preserveAspectRatio="xMidYMax meet"
      role="img" aria-label={name} data-original-hero={kind} data-motion={motion}
      onErrorCapture={onAssetError}>
      <defs>
        <mask id={uid + '-core'} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
          <rect width="512" height="512" fill="white"/>
          {parts.map(([part, cut]) => <polygon key={part} points={cut.points} fill="black"/>)}
        </mask>
        {parts.map(([part, cut]) => <clipPath id={uid + '-' + part} key={part}>
          <polygon points={cut.points}/>
        </clipPath>)}
      </defs>
      <g transform={dir === -1 ? 'translate(512 0) scale(-1 1)' : undefined}>
        <image href={art} x="0" y="0" width="512" height="512"
          mask={`url(#${uid}-core)`} />
        {parts.map(([part, cut]) => (
          <g key={part} data-articulated-part={part}
            className={`articulated-hero__part articulated-hero__part--${part}`}
            style={{ transformOrigin: `${cut.pivot[0]}px ${cut.pivot[1]}px` }}>
            <image href={art} x="0" y="0" width="512" height="512"
              clipPath={`url(#${uid}-${part})`} />
          </g>
        ))}
      </g>
    </svg>
  );
}
