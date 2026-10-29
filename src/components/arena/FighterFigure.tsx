import type { CSSProperties } from 'react';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { useLanguage } from '@/game/i18n';
import './fighterEffects.css';

interface Props {
  src: string;
  combatFrames?: {
    idle: string;
    attack: string;
    block: string;
    dodge?: string;
    hit: string;
    death: string;
  };
  name: string;
  dir: 1 | -1;
  /** Mirror right-facing hero artwork for a left-facing opponent. */
  mirror?: boolean;
  alive: boolean;
  strike: StrikeEvent | null;
  idleSeconds: number;
  combatSpeed?: number;
  /** Enlarge the EXISTING artwork without introducing replacement characters. */
  scale?: number;
  className: string;
}

export function FighterFigure({
  src, combatFrames, name, dir, mirror = false, alive, strike,
  idleSeconds, combatSpeed = 1, scale = 1, className,
}: Props) {
  // The existing server/combat queue is the ONLY source for attacks and damage.
  const role = !strike ? null : strike.attacker === name ? 'attacker' : strike.target === name ? 'target' : null;
  const tone = strike?.tone;
  const swing = strike ? Math.abs(strike.key) % 3 : 0;
  const motion = role === 'attacker' ? `battle-swing-${swing}`
    : role !== 'target' ? ''
    : tone === 'dodge' ? 'animate-dodge'
    : tone === 'block' ? 'animate-guard'
    : 'animate-recoil';
  const speed = Number.isFinite(combatSpeed) && combatSpeed > 0 ? combatSpeed : 1;
  const size = Number.isFinite(scale) ? Math.min(1.35, Math.max(0.8, scale)) : 1;
  const style = {
    '--dir': dir,
    '--fighter-scale': size,
    '--fighter-hit-delay': `${Math.round(280 / speed)}ms`,
    '--fighter-impact-duration': `${Math.round(470 / speed)}ms`,
    '--fighter-motion-duration': `${Math.round(810 / speed)}ms`,
    '--fighter-sweep-duration': `${Math.round(440 / speed)}ms`,
  } as CSSProperties;

  const pose = !alive ? combatFrames?.death ?? src
    : role === 'attacker' ? combatFrames?.attack ?? src
    : role === 'target' && tone === 'dodge' ? combatFrames?.dodge ?? combatFrames?.idle ?? src
    : role === 'target' && tone === 'block' ? combatFrames?.block ?? src
    : role === 'target' ? combatFrames?.hit ?? src
    : combatFrames?.idle ?? src;

  return (
    <div className="fighter-figure absolute inset-0 pointer-events-none" style={style}>
      <div key={role ? `${strike?.key}-${role}` : 'still'} className={`fighter-figure__motion absolute inset-0 ${motion}`}>
        <div className="fighter-figure__size absolute inset-0">
          <div className={`absolute inset-0 ${mirror ? 'battle-mirror-art' : ''}`}>
            <img
              src={pose}
              alt={name}
              draggable={false}
              onError={(event) => {
                // Missing poses fall back to the same character's idle art.
                const img = event.currentTarget;
                const candidates = [combatFrames?.idle, src, import.meta.env.BASE_URL + 'assets/territory/characters/heroes/male_viking/idle.webp'];
                const attempt = Number(img.dataset.artRetry ?? '0');
                if (attempt < candidates.length) {
                  img.dataset.artRetry = String(attempt + 1);
                  img.src = candidates[attempt] ?? src;
                }
              }}
              className={`${className} select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.8)] ${!alive ? 'grayscale opacity-40 translate-y-2' : !role ? 'animate-idle' : ''}`}
              style={!role && alive ? { animationDuration: `${idleSeconds}s` } : undefined}
            />
          </div>
        </div>
        {role === 'attacker' && <span aria-hidden="true" className={`fighter-figure__sweep fighter-figure__sweep--${swing}`} />}
      </div>
      {role === 'target' && strike && <Impact key={strike.key} strike={strike} />}
    </div>
  );
}

function Impact({ strike }: { strike: StrikeEvent }) {
  const { language } = useLanguage();
  const crit = strike.tone === 'crit';
  const label = strike.tone === 'dodge' ? (language === 'en' ? 'DODGE!' : 'УКЛОН!')
    : strike.tone === 'block' ? (language === 'en' ? 'BLOCK!' : 'БЛОК!') : null;

  return (
    <div className={`fighter-impact fighter-impact--${strike.tone}`} aria-hidden="true">
      {strike.tone === 'dodge'
        ? <span className="fighter-impact__trail" />
        : strike.tone === 'block'
          ? <span className="fighter-impact__shield" />
          : <>
            <span className="fighter-impact__arc" />
            <span className="fighter-impact__spark" />
            <span className="fighter-impact__shock" />
          </>}
      {(label || strike.amount !== null) && (
        <span className="fighter-impact__label">
          {crit && <small>{language === 'en' ? 'CRIT!' : 'КРИТ!'}</small>}
          {label ?? `−${strike.amount}`}
        </span>
      )}
    </div>
  );
}
