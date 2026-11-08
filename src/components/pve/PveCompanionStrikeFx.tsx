import type { CSSProperties } from 'react';

/**
 * The companion's original FighterFigure already plays the authentic attack
 * pose. This overlay only carries that confirmed attack across the battlefield.
 * It never emits a strike, invokes PvE logic, or alters HP / rewards.
 */
type StrikeStyle = 'shield' | 'blade' | 'leaf' | 'arrow' | 'rune' | 'crystal';

const FOLLOWER_STRIKE: Record<string, StrikeStyle> = {
  follower_1: 'shield',
  follower_2: 'blade',
  follower_3: 'leaf',
  follower_4: 'arrow',
  follower_5: 'rune',
  follower_6: 'crystal',
};

export function PveCompanionStrikeFx({
  followerId, eventKey, speed,
}: {
  followerId: string;
  eventKey: number;
  speed: number;
}) {
  // The Witch already animates her own approved pumpkin projectile.
  const kind = FOLLOWER_STRIKE[followerId];
  if (!kind || !Number.isSafeInteger(eventKey) || eventKey <= 0) return null;
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? Math.min(speed, 4) : 1;
  const style = { '--companion-strike-ms': `${Math.round(810 / safeSpeed)}ms` } as CSSProperties;
  return (
    <span
      key={eventKey}
      data-testid="pve-companion-strike-fx"
      data-kind={kind}
      className="pve-companion-strike-fx absolute inset-0 z-[35] pointer-events-none"
      style={style}
      aria-hidden="true"
    >
      <i className="pve-companion-strike-fx__origin" />
      <i className="pve-companion-strike-fx__projectile">
        <i className="pve-companion-strike-fx__core" />
        <i className="pve-companion-strike-fx__tail" />
      </i>
      <i className="pve-companion-strike-fx__contact">
        <i />
        <i />
        <i />
      </i>
    </span>
  );
}
