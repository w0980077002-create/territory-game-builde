import { useId, useState, type CSSProperties } from 'react';
import { getFollowerArt } from '@/game/combatArt';
import './articulatedCow.css';

export type CowMotion = 'idle' | 'attack' | 'heal';

/**
 * The shipped Battle Cow is a 493x564 SVG containing its approved illustration.
 * All moving fragments refer to that SAME source: never replace the outfit,
 * face, hat, crystal weapon or proportions with generic character art.
 *
 * The trace follows five localized silhouette areas of the existing artwork.
 * Everything else stays in a masked, stationary core. Movements are small to
 * keep hoof joints closed; they are not a substitute for painted back-facing
 * surfaces or a complete 3-D rig.
 */
const PARTS = {
  head: {
    polygon: '245,134 334,107 432,128 453,188 419,260 377,310 300,314 247,263',
    pivot: [328, 289],
  },
  staffHand: {
    polygon: '114,250 187,241 240,288 242,355 217,426 134,429 101,352',
    pivot: [182, 288],
  },
  offHand: {
    polygon: '387,270 454,257 478,304 475,369 432,403 389,356',
    pivot: [417, 299],
  },
  hindLeg: {
    polygon: '108,377 193,374 265,419 259,507 224,548 127,548 93,468',
    pivot: [191, 402],
  },
  frontLeg: {
    polygon: '278,414 355,407 427,435 441,501 406,552 297,552',
    pivot: [354, 438],
  },
} as const;
type CowPart = keyof typeof PARTS;

interface Props {
  name: string;
  motion?: CowMotion;
  speed?: number;
  className?: string;
}

/** Purely cosmetic, never processes a hit or updates HP. */
export function ArticulatedCow({ name, motion = 'idle', speed = 1, className = '' }: Props) {
  const uid = useId().replace(/:/g, '');
  const [failed, setFailed] = useState(false);
  const art = getFollowerArt('follower_6');
  const supportsMasks = typeof SVGMaskElement !== 'undefined' && typeof SVGImageElement !== 'undefined';
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? Math.min(4, Math.max(0.5, speed)) : 1;
  const css = { '--cow-action-ms': `${Math.round(810 / safeSpeed)}ms` } as CSSProperties;
  if (!supportsMasks || failed) {
    return <img src={art} alt={name} draggable={false}
      data-testid="cow-original-fallback" className={`${className} city-follower-idle`} />;
  }

  const partEntries = Object.entries(PARTS) as [CowPart, typeof PARTS[CowPart]][];
  return (
    <svg viewBox="0 0 493 564" preserveAspectRatio="xMidYMax meet" role="img"
      aria-label={name} data-original-cow="battle_cow" data-motion={motion}
      className={`articulated-cow ${className}`} style={css}
      onErrorCapture={() => setFailed(true)}>
      <defs>
        <mask id={uid + '-rest'} maskUnits="userSpaceOnUse"
          maskContentUnits="userSpaceOnUse" x="0" y="0" width="493" height="564">
          <rect width="493" height="564" fill="white" />
          {partEntries.map(([part, shape]) => (
            <polygon key={part} points={shape.polygon} fill="black" />
          ))}
        </mask>
        {partEntries.map(([part, shape]) => (
          <clipPath id={uid + '-' + part} clipPathUnits="userSpaceOnUse" key={part}>
            <polygon points={shape.polygon} />
          </clipPath>
        ))}
      </defs>
      <image href={art} x="0" y="0" width="493" height="564"
        mask={`url(#${uid}-rest)`} />
      {partEntries.map(([part, shape]) => (
        <g key={part} data-cow-part={part}
          className={`articulated-cow__joint articulated-cow__joint--${part}`}
          style={{ transformOrigin: `${shape.pivot[0]}px ${shape.pivot[1]}px` }}>
          <image href={art} x="0" y="0" width="493" height="564"
            clipPath={`url(#${uid}-${part})`} />
        </g>
      ))}
    </svg>
  );
}
