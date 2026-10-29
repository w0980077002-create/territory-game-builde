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
  /** Mirror hero-style right-facing art for an opponent. Native-left monsters do not mirror. */
  mirror?: boolean;
  alive: boolean;
  strike: StrikeEvent | null;
  idleSeconds: number;
  /** Playback speed for combat feedback; defaults to the arena's normal pace. */
  combatSpeed?: number;
  className: string;
}

export function FighterFigure({ src, combatFrames, name, dir, mirror = false, alive, strike, idleSeconds, combatSpeed = 1, className }: Props) {
  const role = !strike ? null : strike.attacker === name ? 'attacker' : strike.target === name ? 'target' : null;
  const tone = strike?.tone;
  // Three visually distinct swings are derived from the event key.
  // These are cosmetic only and cannot alter the server's strike result.
  const swing = strike ? Math.abs(strike.key) % 3 : 0;
  const motion = role === 'attacker' ? `battle-swing-${swing}`
    : role !== 'target' ? ''
    : tone === 'dodge' ? 'animate-dodge'
    : tone === 'block' ? 'animate-guard'
    : 'animate-recoil';
  const style = { '--dir': dir } as CSSProperties;
  const speed = Number.isFinite(combatSpeed) && combatSpeed > 0 ? combatSpeed : 1;
  const motionTiming = speed === 1 || !role ? undefined : {
    animationDuration: `${(role === 'attacker' ? [840, 820, 880][swing] : tone === 'dodge' ? 500 : tone === 'block' ? 350 : 450) / speed}ms`,
    animationDelay: `${(role === 'attacker' ? 0 : tone === 'dodge' ? 320 : 400) / speed}ms`,
  };

  return (
    <div className="absolute inset-0" style={style}>
      <div key={role ? `${strike?.key}-${role}` : 'still'} className={`absolute inset-0 ${motion}`} style={motionTiming}>
        {/* Mirror the ART separately from the movement transform. Combat labels remain readable. */}
        <div className={`absolute inset-0 ${mirror ? 'battle-mirror-art' : ''}`}>
          <img
            src={!alive ? combatFrames?.death ?? src
              : role === 'attacker' ? combatFrames?.attack ?? src
              : role === 'target' && tone === 'dodge' ? combatFrames?.dodge ?? combatFrames?.idle ?? src
              : role === 'target' && tone === 'block' ? combatFrames?.block ?? src
              : role === 'target' && tone !== 'dodge' ? combatFrames?.hit ?? src
              : combatFrames?.idle ?? src}
            alt={name}
            draggable={false}
            onError={(event) => {
              // On missing art, never retry the same broken URL forever.
              const img = event.currentTarget;
              const candidates = [combatFrames?.idle, src, import.meta.env.BASE_URL + 'assets/territory/characters/heroes/male_viking/idle.webp'];
              const attempt = Number(img.dataset.artRetry ?? '0');
              if (attempt < candidates.length) {
                img.dataset.artRetry = String(attempt + 1);
                img.src = candidates[attempt] ?? src;
              }
            }}
            className={`${className} motion-reduce:animate-none select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.8)] transition-[filter,opacity] duration-500 ${
              alive ? 'animate-idle' : 'grayscale opacity-40 translate-y-2'
            }`}
            style={{ animationDuration: `${idleSeconds}s` }}
          />
        </div>
      </div>

      {role === 'target' && strike && <Impact key={strike.key} strike={strike} speed={speed} />}
    </div>
  );
}

function Impact({ strike, speed }: { strike: StrikeEvent; speed: number }) {
  const { language } = useLanguage();
  const crit = strike.tone === 'crit';
  const label = strike.tone === 'dodge' ? (language === 'en' ? 'DODGE!' : 'УКЛОН!')
    : strike.tone === 'block' ? (language === 'en' ? 'BLOCK!' : 'БЛОК!') : null;
  const timing = (duration: number, delay: number): CSSProperties | undefined => speed === 1 ? undefined : {
    animationDuration: `${duration / speed}ms`, animationDelay: `${delay / speed}ms`,
  };

  return (
    <div className={`fighter-impact fighter-impact--${strike.tone}`} aria-hidden="true">
      {strike.tone === 'dodge' ? <span className="fighter-impact__trail" style={timing(350, 320)} />
        : strike.tone === 'block' ? <span className="fighter-impact__shield" style={timing(390, 360)} />
        : <>
          <span className="fighter-impact__arc" style={timing(420, 310)} />
          <span className="fighter-impact__spark" style={timing(350, 360)} />
        </>}
      {(label || strike.amount !== null) && (
        <span className="fighter-impact__label" style={timing(480, 360)}>
          {crit && <small>{language === 'en' ? 'CRIT!' : 'КРИТ!'}</small>}
          {label ?? `−${strike.amount}`}
        </span>
      )}
    </div>
  );
}
